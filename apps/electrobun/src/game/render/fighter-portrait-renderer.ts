import { createLogger } from "@/utils/logger";

import { renderHudAssetToCanvas } from "./hud-vello-atlas";
import {
  loadSwfBundle,
  renderSwfRoot,
  setSwfPlayerColors,
  swfRootNaturalSize,
} from "./vello-loader";

const log = createLogger("FighterPortrait");

/**
 * Big-artwork portraits for the StringCourse turn-change banner. Mirrors
 * canonical `dofus.Constants.ARTWORKS_BIG_PATH` (`clips/artworks/big/{gfxId}.swf`).
 *
 * Each cached entry owns one Vello-attached `<canvas>` painted by
 * `renderSwfRootToSurface`. React mounts the canvas directly. No
 * `ExternalSource`, no Pixi `extract.canvas` round-trip — Vello and
 * Pixi run on separate `GPUDevice`s.
 *
 * Source SWFs at `clips/artworks/big/{gfxId}.swf` have no named exports —
 * the visible portrait sits on the root timeline — so we use the root
 * render entry point.
 */
const ARTWORK_SWF_PATH = "/swf/artworks/big";

/**
 * Soft cap on the (gfxId, pixelSize, colors) → canvas cache. Each entry
 * holds a 2D `<canvas>` painted from the shared `HudVelloAtlas` via
 * `drawImage(bitmap)` — NO per-portrait Vello surface. The shared
 * atlas owns one process-wide surface. 64 entries × 256² ≈ 16 MB CPU.
 */
const CANVAS_CACHE_CAP = 64;

export class FighterPortraitRenderer {
  /** gfxId → bundle name (or null when load failed sticky-cached). */
  private readonly bundleNames = new Map<number, string | null>();
  private readonly pendingLoads = new Map<number, Promise<string | null>>();
  private readonly naturalSizes = new Map<number, number>();
  private readonly canvasCache = new Map<string, HTMLCanvasElement>();
  private readonly pendingRenders = new Map<
    string,
    Promise<HTMLCanvasElement | null>
  >();

  private ready = false;

  /**
   * Mark the renderer ready. Two-arg signature preserved so `bootstrap.ts`
   * doesn't need to change in this pass; both args are ignored.
   */
  init(_vello?: unknown, _pixi?: unknown): void {
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  /**
   * Returns the canvas matching `pixelSize` in physical pixels. Concurrent
   * calls for the same (gfxId, size, colors) collapse onto a single
   * in-flight render.
   */
  async getCanvas(
    gfxId: number,
    pixelSize: number,
    colors?: readonly [number, number, number] | null,
  ): Promise<HTMLCanvasElement | null> {
    if (gfxId < 0 || pixelSize <= 0) {
      return null;
    }
    const key = cacheKey(gfxId, pixelSize, colors);
    const cached = this.canvasCache.get(key);
    if (cached) {
      this.canvasCache.delete(key);
      this.canvasCache.set(key, cached);
      return cached;
    }
    const pending = this.pendingRenders.get(key);
    if (pending) {
      return pending;
    }
    const promise = this.doRender(gfxId, pixelSize, colors, key);
    this.pendingRenders.set(key, promise);
    try {
      return await promise;
    } finally {
      this.pendingRenders.delete(key);
    }
  }

  private async doRender(
    gfxId: number,
    pixelSize: number,
    colors: readonly [number, number, number] | null | undefined,
    key: string,
  ): Promise<HTMLCanvasElement | null> {
    if (!this.ready) {
      return null;
    }

    const bundleName = await this.loadBundle(gfxId);
    if (!bundleName) {
      return null;
    }

    const natural = this.naturalSize(gfxId, bundleName);
    if (natural <= 0) {
      return null;
    }

    const resolution = pixelSize / natural;
    applyZoneColors(colors);

    // Route through the shared HudVelloAtlas. Vello renders to an
    // off-screen rgba8unorm texture; the atlas's secondary Pixi
    // Application blits it onto a bgra8unorm OffscreenCanvas (the
    // browser's preferred format on Mac → no `getCurrentTexture`
    // perf warning), `createImageBitmap` snapshots the painted
    // region, and we bake it into a 2D `<canvas>` React mounts
    // directly. Purely GPU — no pixel readback.
    const canvas = await renderHudAssetToCanvas(pixelSize, pixelSize, () =>
      renderSwfRoot(bundleName, 0, resolution),
    );
    if (!canvas) {
      log.warn(`render failed for gfxId=${gfxId}@${pixelSize}`);
      return null;
    }

    this.canvasCache.set(key, canvas);
    while (this.canvasCache.size > CANVAS_CACHE_CAP) {
      const oldestKey = this.canvasCache.keys().next().value;
      if (oldestKey === undefined) break;
      this.canvasCache.delete(oldestKey);
    }
    return canvas;
  }

  /**
   * Pure-bounds long-edge probe at resolution 1. CPU-only walk inside
   * WASM, no GPU dispatch. Cached per gfxId (artwork bbox is fixed).
   */
  private naturalSize(gfxId: number, bundleName: string): number {
    const cached = this.naturalSizes.get(gfxId);
    if (cached !== undefined) {
      return cached;
    }
    const bounds = swfRootNaturalSize(bundleName, 0);
    const longEdge = bounds ? Math.max(bounds.width, bounds.height) : 0;
    this.naturalSizes.set(gfxId, longEdge);
    return longEdge;
  }

  private async loadBundle(gfxId: number): Promise<string | null> {
    const cached = this.bundleNames.get(gfxId);
    if (cached !== undefined) {
      return cached;
    }
    const pending = this.pendingLoads.get(gfxId);
    if (pending) {
      return pending;
    }

    const promise = (async () => {
      const bundleName = `artwork-big-${gfxId}`;
      try {
        const ok = await loadSwfBundle(
          bundleName,
          `${ARTWORK_SWF_PATH}/${gfxId}.swf`,
        );
        if (!ok) {
          this.bundleNames.set(gfxId, null);
          return null;
        }
        this.bundleNames.set(gfxId, bundleName);
        return bundleName;
      } catch (err) {
        log.warn(`fetch failed for gfxId=${gfxId}: ${String(err)}`);
        this.bundleNames.set(gfxId, null);
        return null;
      }
    })();
    this.pendingLoads.set(gfxId, promise);
    try {
      return await promise;
    } finally {
      this.pendingLoads.delete(gfxId);
    }
  }
}

function cacheKey(
  gfxId: number,
  pixelSize: number,
  colors?: readonly [number, number, number] | null,
): string {
  if (!colors || (colors[0] < 0 && colors[1] < 0 && colors[2] < 0)) {
    return `${gfxId}:${pixelSize}`;
  }
  return `${gfxId}:${pixelSize}:${colors[0]},${colors[1]},${colors[2]}`;
}

function applyZoneColors(
  colors: readonly [number, number, number] | null | undefined,
): void {
  if (!colors) {
    setSwfPlayerColors(0, 0, 0);
    return;
  }
  setSwfPlayerColors(
    colors[0] >= 0 ? colors[0] : 0,
    colors[1] >= 0 ? colors[1] : 0,
    colors[2] >= 0 ? colors[2] : 0,
  );
}

let instance: FighterPortraitRenderer | null = null;

export function getFighterPortraitRenderer(): FighterPortraitRenderer {
  if (!instance) {
    instance = new FighterPortraitRenderer();
  }
  return instance;
}
