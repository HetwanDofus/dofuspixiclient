import { wireColorsToZones } from "@/game/assets/color-zone";
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
 * Big-artwork portraits for the turn-change banner. Mirrors canonical
 * `dofus.Constants.ARTWORKS_BIG_PATH` (`clips/artworks/big/{gfxId}.swf`).
 *
 * Each cached entry owns one 2D `<canvas>` painted via the shared
 * `HudVelloAtlas`. React mounts the canvas directly.
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
  /**
   * Cached pixel bounds per gfxId — width, height, and long-edge.
   * Long-edge feeds the resolution math; per-axis dims feed the
   * snapshot canvas so it matches the artwork's natural aspect.
   * Earlier path forced a `pixelSize × pixelSize` square snapshot
   * which left the artwork pinned at the top-left of an oversized
   * canvas — the React mount with `objectFit: contain` then showed
   * the artwork crammed into one corner of its host.
   */
  private readonly naturalDimsByGfx = new Map<
    number,
    { width: number; height: number; longEdge: number }
  >();
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

  getStats(): {
    canvasCache: number;
    pendingRenders: number;
    pendingLoads: number;
    bundleNames: number;
    naturalDims: number;
  } {
    return {
      canvasCache: this.canvasCache.size,
      pendingRenders: this.pendingRenders.size,
      pendingLoads: this.pendingLoads.size,
      bundleNames: this.bundleNames.size,
      naturalDims: this.naturalDimsByGfx.size,
    };
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

    const dims = this.naturalDims(gfxId, bundleName);
    if (dims.longEdge <= 0) {
      return null;
    }

    const resolution = pixelSize / dims.longEdge;
    // Callers pass wire-order Player.color1/2/3 — redistribute to
    // engine zones per the canonical getColorIndex permutation.
    applyZoneColors(colors ? wireColorsToZones(gfxId, colors) : colors);

    // Over-size the snapshot to absorb Vello's 1-px AA pad + worst-
    // case floor/ceil rounding (rust/vello-wasm/src/lib.rs:801-807,
    // 2325-2358 for the root path). A naive `Math.round(natural *
    // resolution)` snapshot is 2–3 px short and `createImageBitmap`
    // crops the artwork's right/bottom edges, pinning the bitmap to
    // the canvas top-left. The React mount's `objectFit: contain`
    // centers the natural-aspect bitmap; the negligible transparent
    // overshoot is invisible.
    const SAFE_PAD = 4;
    const targetW =
      Math.max(1, Math.ceil(dims.width * resolution)) + SAFE_PAD;
    const targetH =
      Math.max(1, Math.ceil(dims.height * resolution)) + SAFE_PAD;
    const canvas = await renderHudAssetToCanvas(
      targetW,
      targetH,
      () => renderSwfRoot(bundleName, 0, resolution),
      true,
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
   * Pure-bounds probe at resolution 1. CPU-only walk inside WASM, no
   * GPU dispatch. Cached per gfxId (artwork bbox is fixed). Returns
   * width + height + long-edge so the render path can preserve the
   * artwork's natural aspect ratio in the snapshot canvas.
   */
  private naturalDims(
    gfxId: number,
    bundleName: string,
  ): { width: number; height: number; longEdge: number } {
    const cached = this.naturalDimsByGfx.get(gfxId);
    if (cached !== undefined) {
      return cached;
    }
    const bounds = swfRootNaturalSize(bundleName, 0);
    const width = bounds?.width ?? 0;
    const height = bounds?.height ?? 0;
    const dims = { width, height, longEdge: Math.max(width, height) };
    this.naturalDimsByGfx.set(gfxId, dims);
    return dims;
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
  // -1 = unset → authored fill (canonical applyColor sentinel; 0 = black).
  if (!colors) {
    setSwfPlayerColors(-1, -1, -1);
    return;
  }
  setSwfPlayerColors(colors[0], colors[1], colors[2]);
}

let instance: FighterPortraitRenderer | null = null;

export function getFighterPortraitRenderer(): FighterPortraitRenderer {
  if (!instance) {
    instance = new FighterPortraitRenderer();
  }
  return instance;
}
