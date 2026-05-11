import { LayoutSystem } from "@pixi/layout";
import {
  Application,
  type Container,
  extensions,
  TextureSource,
  Ticker,
} from "pixi.js";

import type { CanvasSize, RenderStats } from "@/game/types";
import {
  DISPLAY_WIDTH,
  FULL_HEIGHT,
  GAME_HEIGHT,
  GAME_WIDTH,
  ZOOM_LEVELS,
} from "@/game/constants/battlefield";
import type { Camera } from "@/game/render/camera";
import { getRenderWatchdog } from "@/game/render/render-watchdog";
import { getVelloGpu, setPixiRenderer } from "@/game/render/vello-loader";

extensions.add(LayoutSystem);
TextureSource.defaultOptions.scaleMode = "linear";
TextureSource.defaultOptions.autoGenerateMipmaps = false;

export interface EngineConfig {
  container: HTMLElement;
  backgroundColor?: number;
  preferWebGPU?: boolean;
  antialias?: boolean;
  onResize?: (width: number, height: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: (width: number, height: number) => void;
  resizeDebounceMs?: number;
  /**
   * Optional viewport `Camera` — when supplied, the engine publishes
   * containerSize + baseZoom + dpr changes into it on init / resize /
   * DPR media-query change. Subscribers (CanvasStack wrapper sizing,
   * surface reconfigure, Pixi resolution) react to camera updates
   * instead of reading state from ad-hoc places.
   */
  camera?: Camera;
}

export class Engine {
  private app: Application | null = null;
  private container: HTMLElement;
  private config: Omit<
    Required<EngineConfig>,
    "onResize" | "onResizeStart" | "onResizeEnd" | "camera"
  > & {
    onResize?: (width: number, height: number) => void;
    onResizeStart?: () => void;
    onResizeEnd?: (width: number, height: number) => void;
    camera?: Camera;
  };
  private dprMqlCleanup: (() => void) | null = null;
  private baseZoom = 1;
  private currentZoom = 1;
  private currentZoomIndex = 0;
  private fps = 0;
  private frameCount = 0;
  private lastFpsUpdate = Date.now();
  private lastFrameTimeMs = 0;
  private lastDrawCalls = 0;
  private fpsOverlay: HTMLDivElement | null = null;
  /** Optional extra debug info appended to FPS overlay each second */
  debugInfo: (() => string) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private lastContainerSize = { width: 0, height: 0 };
  private resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isResizing = false;

  constructor(config: EngineConfig) {
    this.container = config.container;
    this.config = {
      container: config.container,
      backgroundColor: config.backgroundColor ?? 0x000000,
      preferWebGPU: config.preferWebGPU ?? true,
      antialias: true,
      resizeDebounceMs: config.resizeDebounceMs ?? 300,
      onResize: config.onResize,
      onResizeStart: config.onResizeStart,
      onResizeEnd: config.onResizeEnd,
      camera: config.camera,
    };
  }

  /**
   * Push the engine's canonical viewport state into the configured
   * Camera. Called from `init()` and `handleResize()` so any
   * subscriber (CanvasStack wrapper, Vello surfaces, Pixi DPR
   * tracking) receives a single notification per resize event.
   */
  private publishToCamera(width: number, height: number, baseZoom: number): void {
    const camera = this.config.camera;
    if (!camera) {
      return;
    }
    camera.update({
      logicalWidth: DISPLAY_WIDTH,
      logicalHeight: FULL_HEIGHT,
      panX: 0,
      panY: 0,
      zoom: this.currentZoom,
      dpr: typeof window !== "undefined" ? window.devicePixelRatio : 1,
    });
    // Containers sizes aren't part of CameraState yet (see camera.ts);
    // baseZoom is implicit from `logicalWidth` + the displayed canvas
    // dims. Subscribers that need pixel-displayed dims compute
    // `logicalWidth × zoom` from the snapshot.
    void width;
    void height;
    void baseZoom;
  }

  /**
   * Initialize the Pixi `Application`. Caller passes the middle canvas
   * of the CanvasStack — Pixi takes ownership of it and renders into
   * it directly. The host (`Battlefield`) owns the wrapping `<div>` and
   * the sibling Vello canvases; Engine no longer mounts its own canvas.
   */
  async init(canvas: HTMLCanvasElement): Promise<void> {
    if (this.app) {
      return;
    }

    this.app = new Application();

    const { width, height, zoom } = this.calculateCanvasSize();
    this.baseZoom = zoom;
    this.currentZoomIndex = 0;
    this.currentZoom = this.baseZoom * ZOOM_LEVELS[this.currentZoomIndex];
    this.publishResolutionFactor(zoom);

    this.lastContainerSize = {
      width: this.container.clientWidth || GAME_WIDTH,
      height: this.container.clientHeight || GAME_HEIGHT,
    };

    // If Vello has been initialized, hand its `{adapter, device}` to
    // Pixi so both libraries render on ONE WebGPU device. This is what
    // enables Vello to produce GPUTextures consumable by Pixi as
    // ExternalSource (no cross-device handle gymnastics). Caller is
    // expected to have run `initVello()` before `engine.init()` —
    // when it has, `getVelloGpu()` returns the shared handles. If not
    // (Vello unavailable / failed init), `gpu` is omitted and Pixi
    // requests its own device — the consumer has already lost the
    // shared-device path so a fallback render is the right behavior.
    const sharedGpu = getVelloGpu();
    const initOptions: Record<string, unknown> = {
      canvas,
      width,
      height,
      backgroundColor: this.config.backgroundColor,
      // Transparent canvas — Pixi paints the world on top of the page
      // background. Kept at 0 because the legacy three-canvas stack
      // composited via DOM; with the new single-canvas pipeline a
      // future change can flip this to opaque if it improves blending.
      backgroundAlpha: 0,
      resolution: 1,
      autoDensity: true,
      antialias: true,
      roundPixels: true,
      preferWebGLVersion: 1,
      preference: this.config.preferWebGPU ? "webgpu" : "webgl",
      ...(sharedGpu ? { gpu: sharedGpu } : {}),
      layout: {
        enableDebug: false,
        throttle: 0,
      },
    };

    await this.app.init(initOptions as Parameters<Application["init"]>[0]);

    // Publish the Pixi renderer process-wide so renderers that don't
    // get a constructor-injected one (e.g. live spell casts spawned
    // deep inside the spell-runtime) can still wrap GPU textures via
    // ExternalSource. Both Vello and Pixi share the same GPUDevice.
    setPixiRenderer(this.app.renderer);

    // NOTE: `app.stage.layout` was intentionally removed. Setting a
    // Yoga layout on the stage swaps Container.updateLocalTransform
    // for the layout-aware version (@pixi/layout ContainerMixin) and
    // re-derives the stage's transform from Yoga state every frame.
    // Since no other container has `.layout` set, the stage has a
    // single-node layout tree with width/height equal to screen size.
    // Once the screen size desyncs from the actual canvas dims (e.g.
    // mid-resize or with autoDensity), Yoga keeps applying the stale
    // computed transform and child content past the cached bounds
    // never makes it into the render pass — the canonical "bottom
    // of the map stops rendering at some Y" symptom on every map.

    this.setupResizeHandling();
    this.publishToCamera(width, height, zoom);
    this.bindDprWatch();
    this.app.ticker.add(() => this.updateFps());

    // Feed the watchdog one sample per Pixi tick. We use Ticker.shared
    // so that even non-app ticks (e.g. extracted spell-icon renders)
    // contribute — but the main app ticker is what drives steady state.
    // deltaMS already accounts for browser rAF jitter. Registering on
    // app.ticker (not Ticker.shared) avoids double-counting since the
    // app ticker IS the shared ticker in default configurations.
    this.app.ticker.add(() => {
      getRenderWatchdog().recordFrame(Ticker.shared.deltaMS);
    });

    // FPS overlay
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;top:0;left:0;padding:4px 8px;background:rgba(0,0,0,0.7);color:#0f0;font:bold 14px monospace;z-index:999999;pointer-events:none";
    document.body.appendChild(overlay);
    this.fpsOverlay = overlay;
  }

  private calculateCanvasSize(): CanvasSize {
    const containerWidth = this.container.clientWidth || GAME_WIDTH;
    const containerHeight = this.container.clientHeight || GAME_HEIGHT;
    const rawZoom = Math.min(
      containerWidth / DISPLAY_WIDTH,
      containerHeight / FULL_HEIGHT
    );
    // Use raw zoom so the canvas fills the container with zero gaps.
    const zoom = Math.max(0.02, rawZoom);

    return {
      width: Math.min(Math.round(DISPLAY_WIDTH * zoom), containerWidth),
      height: Math.min(Math.round(FULL_HEIGHT * zoom), containerHeight),
      zoom,
    };
  }

  /** Publish the current base zoom to CSS so React UI (MainBanner etc.) scales in lockstep. */
  private publishResolutionFactor(zoom: number): void {
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty(
        "--resolution-factor",
        String(zoom)
      );
    }
  }

  private setupResizeHandling(): void {
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);
    window.addEventListener("resize", () => this.handleResize());
  }

  /**
   * Track DPR changes via `matchMedia(resolution: …dppx)` and republish
   * to camera. Browsers don't fire this on programmatic
   * `devicePixelRatio` reads — only when the user moves the window
   * between displays of different DPR (e.g. retina ↔ non-retina) or
   * explicitly changes browser zoom. The callback re-arms a fresh
   * matchMedia each fire because the queried DPR is pinned at
   * construction.
   */
  private bindDprWatch(): void {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function" ||
      this.dprMqlCleanup
    ) {
      return;
    }
    let mql = window.matchMedia(
      `(resolution: ${window.devicePixelRatio}dppx)`,
    );
    const handler = () => {
      const dpr = window.devicePixelRatio;
      this.config.camera?.setDpr(dpr);
      // Re-arm against the new DPR so the next change also fires.
      mql.removeEventListener("change", handler);
      mql = window.matchMedia(`(resolution: ${dpr}dppx)`);
      mql.addEventListener("change", handler);
      // Pixi reads `app.renderer.resolution` to size its physical
      // backing store. Update so a retina-↔-non-retina move keeps
      // strokes crisp.
      if (this.app) {
        try {
          (this.app.renderer as { resolution: number }).resolution = dpr;
        } catch {
          // some Pixi versions guard resolution setter — best effort.
        }
      }
    };
    mql.addEventListener("change", handler);
    this.dprMqlCleanup = () => {
      mql.removeEventListener("change", handler);
    };
  }

  handleResize(): void {
    if (!this.app) {
      return;
    }

    const containerWidth = this.container.clientWidth;
    const containerHeight = this.container.clientHeight;

    if (
      containerWidth === this.lastContainerSize.width &&
      containerHeight === this.lastContainerSize.height
    ) {
      return;
    }

    this.lastContainerSize = { width: containerWidth, height: containerHeight };

    const { width, height, zoom } = this.calculateCanvasSize();
    this.baseZoom = zoom;
    this.currentZoom = this.baseZoom * ZOOM_LEVELS[this.currentZoomIndex];
    this.publishResolutionFactor(zoom);

    this.app.renderer.resize(width, height);
    // See comment in init(): stage layout is intentionally NOT
    // re-applied on resize — the renderer handles its own viewport,
    // and a stale Yoga transform would clip rendered content.
    this.publishToCamera(width, height, zoom);

    // Notify resize start (only once per resize sequence)
    if (!this.isResizing) {
      this.isResizing = true;

      if (this.config.onResizeStart) {
        this.config.onResizeStart();
      }
    }

    // Immediate resize callback for continuous updates
    if (this.config.onResize) {
      this.config.onResize(width, height);
    }

    // Debounce the resize end
    if (this.resizeDebounceTimer) {
      clearTimeout(this.resizeDebounceTimer);
    }

    this.resizeDebounceTimer = setTimeout(() => {
      this.isResizing = false;
      this.resizeDebounceTimer = null;

      if (this.config.onResizeEnd) {
        this.config.onResizeEnd(width, height);
      }
    }, this.config.resizeDebounceMs);
  }

  private updateFps(): void {
    this.frameCount++;

    const now = Date.now();

    if (now - this.lastFpsUpdate >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsUpdate = now;

      if (this.fpsOverlay) {
        let text = `${this.fps} FPS`;

        if (this.debugInfo) {
          try {
            text += `  ${this.debugInfo()}`;
          } catch {}
        }

        this.fpsOverlay.textContent = text;
      }
    }
  }

  setZoomIndex(index: number): void {
    if (index < 0 || index >= ZOOM_LEVELS.length) {
      return;
    }

    this.currentZoomIndex = index;
    this.currentZoom = this.baseZoom * ZOOM_LEVELS[this.currentZoomIndex];
  }

  zoomIn(): boolean {
    if (this.currentZoomIndex < ZOOM_LEVELS.length - 1) {
      this.setZoomIndex(this.currentZoomIndex + 1);
      return true;
    }

    return false;
  }

  zoomOut(): boolean {
    if (this.currentZoomIndex > 0) {
      this.setZoomIndex(this.currentZoomIndex - 1);
      return true;
    }

    return false;
  }

  getApp(): Application {
    if (!this.app) {
      throw new Error("Engine not initialized");
    }

    return this.app;
  }

  getStage(): Container {
    return this.getApp().stage;
  }

  getZoom(): number {
    return this.currentZoom;
  }

  getZoomMultiplier(): number {
    return ZOOM_LEVELS[this.currentZoomIndex];
  }

  getBaseZoom(): number {
    return this.baseZoom;
  }

  getStats(): RenderStats {
    return {
      fps: this.fps,
      spriteCount: 0,
      drawCalls: this.lastDrawCalls,
      frameTimeMs: this.lastFrameTimeMs,
    };
  }

  getCanvas(): HTMLCanvasElement | null {
    return this.app?.canvas ?? null;
  }

  destroy(): void {
    if (this.resizeDebounceTimer) {
      clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.dprMqlCleanup) {
      this.dprMqlCleanup();
      this.dprMqlCleanup = null;
    }

    if (this.app) {
      this.app.destroy(true, { children: true, texture: true });
      this.app = null;
    }
  }
}
