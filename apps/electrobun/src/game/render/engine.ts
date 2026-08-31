import { LayoutSystem } from "@pixi/layout";
import {
  Application,
  type Container,
  extensions,
  TextureSource,
} from "pixi.js";

import type { PerfSceneSample } from "@/game/stores/perf-store";
import type { CanvasSize, RenderStats } from "@/game/types";
import {
  DISPLAY_WIDTH,
  FULL_HEIGHT,
  GAME_HEIGHT,
  GAME_WIDTH,
  ZOOM_LEVELS,
} from "@/game/constants/battlefield";
import { perfStore } from "@/game/stores/perf-store";

extensions.add(LayoutSystem);
TextureSource.defaultOptions.scaleMode = "nearest";
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
  /** External GPU device (from Vello WASM) for zero-copy texture sharing. */
  gpu?: { adapter: GPUAdapter; device: GPUDevice };
}

export class Engine {
  private app: Application | null = null;
  private container: HTMLElement;
  private config: Omit<
    Required<EngineConfig>,
    "onResize" | "onResizeStart" | "onResizeEnd" | "gpu"
  > & {
    onResize?: (width: number, height: number) => void;
    onResizeStart?: () => void;
    onResizeEnd?: (width: number, height: number) => void;
    gpu?: { adapter: GPUAdapter; device: GPUDevice };
  };
  private baseZoom = 1;
  private currentZoom = 1;
  private currentZoomIndex = 0;
  private fps = 0;
  private frameCount = 0;
  private lastFpsUpdate = Date.now();
  private lastFrameTimeMs = 0;
  private lastDrawCalls = 0;
  /**
   * Optional scene sampler, installed by the battlefield bootstrap. Read once
   * a second alongside the FPS count and published to `perfStore` for the
   * admin panel — nothing is measured per frame that wasn't already.
   */
  perfSample: (() => PerfSceneSample | null) | null = null;
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
      gpu: config.gpu,
      onResize: config.onResize,
      onResizeStart: config.onResizeStart,
      onResizeEnd: config.onResizeEnd,
    };
  }

  async init(): Promise<void> {
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

    const initOptions: Record<string, unknown> = {
      width,
      height,
      backgroundColor: this.config.backgroundColor,
      resolution: 1,
      autoDensity: true,
      antialias: true,
      roundPixels: true,
      preferWebGLVersion: 1,
      preference: this.config.preferWebGPU ? "webgpu" : "webgl",
      layout: {
        enableDebug: false,
        throttle: 0,
      },
    };

    // If an external GPU device is provided (from Vello WASM), share it with Pixi.js.
    // This enables zero-copy GPU texture sharing between Vello and Pixi.js.
    if (this.config.gpu) {
      initOptions.gpu = this.config.gpu;
      initOptions.preference = "webgpu";
    }

    await this.app.init(initOptions as Parameters<Application["init"]>[0]);

    if (this.app.canvas && this.container) {
      this.container.appendChild(this.app.canvas);
    }

    this.app.stage.layout = {
      width: this.app.screen.width,
      height: this.app.screen.height,
    };

    this.setupResizeHandling();
    this.app.ticker.add(() => this.updateFps());
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
    this.app.stage.layout = {
      width,
      height,
    };

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

      let scene: PerfSceneSample | null = null;

      if (this.perfSample) {
        try {
          scene = this.perfSample();
        } catch {
          scene = null;
        }
      }

      perfStore.setState({ fps: this.fps, sampledAt: now, scene });
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

  /** Set GPU handles from Vello WASM (call before init) */
  setGpu(gpu: { adapter: GPUAdapter; device: GPUDevice }): void {
    this.config.gpu = gpu;
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

    if (this.app) {
      this.app.destroy(true, { children: true, texture: true });
      this.app = null;
    }
  }
}
