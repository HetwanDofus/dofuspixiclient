import { LayoutSystem } from "@pixi/layout";
import {
  Application,
  type Container,
  extensions,
  TextureSource,
} from "pixi.js";

import type { CanvasSize, RenderStats } from "@/types";
import {
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  FULL_HEIGHT,
  GAME_HEIGHT,
  GAME_WIDTH,
  ZOOM_LEVELS,
} from "@/constants/battlefield";

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
}

export class Engine {
  private app: Application | null = null;
  private container: HTMLElement;
  private config: Omit<
    Required<EngineConfig>,
    "onResize" | "onResizeStart" | "onResizeEnd"
  > & {
    onResize?: (width: number, height: number) => void;
    onResizeStart?: () => void;
    onResizeEnd?: (width: number, height: number) => void;
  };
  private baseZoom = 1;
  private currentZoom = 1;
  private currentZoomIndex = 0;
  private fps = 0;
  private frameCount = 0;
  private lastFpsUpdate = Date.now();
  private lastFrameTimeMs = 0;
  private lastDrawCalls = 0;
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

    this.lastContainerSize = {
      width: this.container.clientWidth || GAME_WIDTH,
      height: this.container.clientHeight || GAME_HEIGHT,
    };

    await this.app.init({
      width,
      height,
      backgroundColor: this.config.backgroundColor,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      antialias: true,
      roundPixels: true,
      preferWebGLVersion: 1,
      preference: this.config.preferWebGPU ? "webgpu" : "webgl",
      layout: {
        autoUpdate: true,
        enableDebug: false,
        throttle: 0,
      },
    });

    if (this.app.canvas && this.container) {
      this.container.appendChild(this.app.canvas);
    }

    this.hookRenderPerformance();

    (this.app.stage as Record<string, unknown>).layout = {
      width: this.app.screen.width,
      height: this.app.screen.height,
    };

    this.setupResizeHandling();
    this.app.ticker.add(() => this.updateFps());
  }

  private calculateCanvasSize(): CanvasSize {
    const containerWidth = this.container.clientWidth || GAME_WIDTH;
    const containerHeight = this.container.clientHeight || GAME_HEIGHT;
    const zoom = Math.min(
      containerWidth / DISPLAY_WIDTH,
      containerHeight / FULL_HEIGHT
    );

    return {
      width: Math.round(DISPLAY_WIDTH * zoom),
      height: Math.round(FULL_HEIGHT * zoom),
      zoom,
    };
  }

  private hookRenderPerformance(): void {
    if (!this.app) {
      return;
    }

    const appAny = this.app as Record<string, unknown>;
    const originalRender = (appAny.render as Function)?.bind(appAny);

    if (typeof originalRender === "function") {
      appAny.render = (...args: unknown[]) => {
        this.lastDrawCalls = 0;
        const start = performance.now();
        originalRender(...args);
        this.lastFrameTimeMs = performance.now() - start;
      };
    }

    const rendererAny = appAny.renderer as Record<string, unknown>;
    const batchPipe = (rendererAny?.renderPipes as Record<string, unknown>)
      ?.batch as Record<string, unknown>;

    if (batchPipe && typeof batchPipe.execute === "function") {
      const originalExecute = (batchPipe.execute as Function).bind(batchPipe);

      batchPipe.execute = (
        batch: Record<string, unknown>,
        ...rest: unknown[]
      ) => {
        if (
          batch &&
          batch.renderPipeId === "batch" &&
          (batch.size as number) > 0
        ) {
          this.lastDrawCalls++;
        }

        return originalExecute(batch, ...rest);
      };
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

    this.app.renderer.resize(width, height);
    (this.app.stage as Record<string, unknown>).layout = { width, height };

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

    if (this.app) {
      this.app.destroy(true, { children: true, texture: true });
      this.app = null;
    }
  }
}
