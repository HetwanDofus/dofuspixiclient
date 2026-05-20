import { createLogger } from "@/utils/logger";

import { renderHudAssetToCanvas } from "./hud-vello-atlas";
import {
  loadSwfBundle,
  renderSwfFrame,
  swfAnimFrameCount,
  swfBundleFrameRate,
  swfStripBounds,
  whenVelloReady,
} from "./vello-loader";

const log = createLogger("BannerView");

/**
 * Banner-circle "circle xtra" views from core.swf. Mirrors the canonical
 * `dofus.graphics.gapi.ui.banner.BannerCircleXtra` switch — the 5 views
 * the original client shows inside the banner circle:
 *
 *   • artwork  — per-guild face SWF (NOT served from core.swf; handled
 *                by FighterPortraitRenderer on a per-gfxId basis).
 *   • clock    — `UI_BannerClockBack` + `UI_BannerClockArrowHours` +
 *                `UI_BannerClockArrowMinutes` (hands rotated by React).
 *   • compass  — `UI_BannerCompassBack` + `UI_BannerCompassArrow` or
 *                `UI_BannerCompassNoArrow` (arrow rotated by React).
 *   • helper   — `Helper` (animated NPC); we render frame 0 for now.
 *   • map      — minimap content; rendered by the worldmap tile renderer
 *                (separate concern from core.swf chrome).
 *
 * This renderer ONLY emits static-frame canvases for the core.swf chrome
 * pieces. Composition + rotation is React's job (CSS transforms).
 *
 * Pattern mirrors `FighterPortraitRenderer`: one shared WASM bundle for
 * core.swf, `renderSwfFrame` per export, route through `renderHudAssetToCanvas`
 * (shared HudVelloAtlas), cache 2D canvases per (export, pixelSize).
 */

const CORE_SWF_URL = "/swf/core.swf";
const CORE_BUNDLE_NAME = "core";

/**
 * Soft cap on the (exportName, pixelSize, frame) → canvas cache. The
 * banner only shows one view at a time but the helper (boune) animates
 * across multiple frames; budget for ~64 entries × ~119² ≈ 3.6 MB CPU
 * so a 30-frame helper plus the static views all fit without thrash.
 */
const CANVAS_CACHE_CAP = 64;

/**
 * Banner-view exports we paint from core.swf. Adding a value here is enough
 * to let consumers ask for it — the renderer's per-export natural-size
 * cache, in-flight dedup, and bundle load all key off this name.
 */
export type BannerViewExport =
  | "UI_BannerClockBack"
  | "UI_BannerClockArrowHours"
  | "UI_BannerClockArrowMinutes"
  | "UI_BannerCompassBack"
  | "UI_BannerCompassArrow"
  | "UI_BannerCompassNoArrow"
  | "Helper";

export class BannerViewRenderer {
  private bundleLoaded = false;
  private bundleLoadPromise: Promise<boolean> | null = null;

  /**
   * Natural pixel bounds per export — width, height, and long edge
   * (used to scale to a target `pixelSize`). For animated exports
   * (Helper) we probe the UNION across every cycle frame so the
   * canvas dims accommodate the boune's full motion range; static
   * exports (clock/compass) collapse to the single-frame bounds.
   */
  private readonly naturalSizes = new Map<
    BannerViewExport,
    { width: number; height: number; longEdge: number }
  >();
  private readonly canvasCache = new Map<string, HTMLCanvasElement>();
  private readonly pendingRenders = new Map<
    string,
    Promise<HTMLCanvasElement | null>
  >();
  private readonly subscribers = new Map<string, Set<() => void>>();
  private readonly readySubscribers = new Set<() => void>();
  private ready = false;

  /**
   * Called once Vello WASM is initialized. We don't preload core.swf here —
   * the bundle is fetched lazily on the first `getCanvas` call so HUD boot
   * doesn't pay the network/decode cost when the banner isn't visible.
   */
  init(): void {
    this.ready = true;
    for (const cb of this.readySubscribers) {
      cb();
    }
    this.readySubscribers.clear();
  }

  isReady(): boolean {
    return this.ready;
  }

  peekCanvas(
    exportName: BannerViewExport,
    pixelSize: number,
    frame = 0,
  ): HTMLCanvasElement | null {
    return this.canvasCache.get(cacheKey(exportName, pixelSize, frame)) ?? null;
  }

  subscribe(
    exportName: BannerViewExport,
    pixelSize: number,
    cb: () => void,
    frame = 0,
  ): () => void {
    const key = cacheKey(exportName, pixelSize, frame);
    let set = this.subscribers.get(key);
    if (!set) {
      set = new Set();
      this.subscribers.set(key, set);
    }
    set.add(cb);
    return () => {
      set?.delete(cb);
      if (set?.size === 0) {
        this.subscribers.delete(key);
      }
    };
  }

  subscribeReady(cb: () => void): () => void {
    if (this.isReady()) {
      cb();
      return () => {};
    }
    this.readySubscribers.add(cb);
    return () => this.readySubscribers.delete(cb);
  }

  async getCanvas(
    exportName: BannerViewExport,
    pixelSize: number,
    frame = 0,
  ): Promise<HTMLCanvasElement | null> {
    if (pixelSize <= 0) {
      return null;
    }
    const key = cacheKey(exportName, pixelSize, frame);
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
    const promise = this.doRender(exportName, pixelSize, frame, key);
    this.pendingRenders.set(key, promise);
    try {
      return await promise;
    } finally {
      this.pendingRenders.delete(key);
    }
  }

  /**
   * Frame count of the deepest reachable animation inside `exportName`.
   * Helper (the "boune") has 1 root frame but its inner sub-clip
   * carries the wave/blink animation — `swfAnimFrameCount` walks past
   * the wrapper and returns the inner cycle length so callers can
   * drive a ticker. Returns 1 for purely static symbols.
   */
  animFrameCount(exportName: BannerViewExport): number {
    return Math.max(1, swfAnimFrameCount(CORE_BUNDLE_NAME, exportName));
  }

  /** core.swf's authored FPS — used to pace the helper ticker. */
  bundleFrameRate(): number {
    const fps = swfBundleFrameRate(CORE_BUNDLE_NAME);
    return fps > 0 ? fps : 24;
  }

  private async doRender(
    exportName: BannerViewExport,
    pixelSize: number,
    frame: number,
    key: string,
  ): Promise<HTMLCanvasElement | null> {
    if (!this.ready) {
      return null;
    }
    const loaded = await this.ensureBundle();
    if (!loaded) {
      return null;
    }
    const dims = this.naturalDims(exportName);
    if (dims.longEdge <= 0) {
      return null;
    }

    const resolution = pixelSize / dims.longEdge;
    // Snapshot dims must hold Vello's full output. Vello sizes the
    // texture as `ceil(x1*scale) - floor(x0*scale) + 2` per axis
    // (rust/vello-wasm/src/lib.rs:801-807, 1 px AA pad on every
    // side + worst-case floor/ceil rounding). A naive
    // `Math.round(natural * resolution)` snapshot is 2–3 px short
    // on each axis and `createImageBitmap` crops the helper's
    // right/bottom edges, pinning it to the canvas's top-left. We
    // over-size by 4 px on each axis so the snapshot always fully
    // contains the Vello render; the React mount's `objectFit:
    // contain` then centers the natural-aspect bitmap (the negligible
    // transparent overshoot is invisible).
    const SAFE_PAD = 4;
    const targetW =
      Math.max(1, Math.ceil(dims.width * resolution)) + SAFE_PAD;
    const targetH =
      Math.max(1, Math.ceil(dims.height * resolution)) + SAFE_PAD;
    // Route through the shared HudVelloAtlas (same path as spell icons +
    // fighter portraits): Vello renders to an rgba8unorm GPUTexture, the
    // atlas's secondary Pixi app blits it onto a bgra8unorm OffscreenCanvas
    // (the browser's preferred format on Mac), `createImageBitmap` snapshots
    // the painted sub-rect, and we bake it into a 2D `<canvas>` for React.
    // No pixel readback anywhere.
    const canvas = await renderHudAssetToCanvas(
      targetW,
      targetH,
      () => renderSwfFrame(CORE_BUNDLE_NAME, exportName, frame, resolution),
      true,
    );
    if (!canvas) {
      log.warn(`render failed for ${exportName}@${pixelSize}#${frame}`);
      return null;
    }

    this.canvasCache.set(key, canvas);
    while (this.canvasCache.size > CANVAS_CACHE_CAP) {
      const oldestKey = this.canvasCache.keys().next().value;
      if (oldestKey === undefined) break;
      this.canvasCache.delete(oldestKey);
    }
    this.notify(key);
    return canvas;
  }

  /**
   * Pure-bounds probe for a banner export. `swfStripBounds` returns
   * twips (1/20 px) and walks across `totalFrameCount` frames returning
   * the union — passing the symbol's deepest reachable anim cycle
   * length (via `swfAnimFrameCount`) makes the cached bounds large
   * enough to hold every frame Helper renders during animation, so the
   * canvas never crops mid-cycle. Static exports (clock/compass/back)
   * collapse to single-frame bounds.
   */
  private naturalDims(exportName: BannerViewExport): {
    width: number;
    height: number;
    longEdge: number;
  } {
    const cached = this.naturalSizes.get(exportName);
    if (cached !== undefined) {
      return cached;
    }
    const cycleFrames = Math.max(
      1,
      swfAnimFrameCount(CORE_BUNDLE_NAME, exportName),
    );
    const bounds = swfStripBounds(CORE_BUNDLE_NAME, exportName, cycleFrames);
    if (!bounds) {
      const empty = { width: 0, height: 0, longEdge: 0 };
      this.naturalSizes.set(exportName, empty);
      return empty;
    }
    const width = Math.max(0, (bounds.maxXTwip - bounds.minXTwip) / 20);
    const height = Math.max(0, (bounds.maxYTwip - bounds.minYTwip) / 20);
    const result = { width, height, longEdge: Math.max(width, height) };
    this.naturalSizes.set(exportName, result);
    return result;
  }

  private ensureBundle(): Promise<boolean> {
    if (this.bundleLoaded) {
      return Promise.resolve(true);
    }
    if (!this.bundleLoadPromise) {
      this.bundleLoadPromise = (async () => {
        try {
          // The banner mounts before Battlefield's `initVello()` finishes
          // — gate so `loadSwfBundle` doesn't throw "Vello not
          // initialized".
          await whenVelloReady();
          const ok = await loadSwfBundle(CORE_BUNDLE_NAME, CORE_SWF_URL);
          this.bundleLoaded = ok;
          return ok;
        } catch (err) {
          log.warn(`core.swf load failed: ${String(err)}`);
          return false;
        }
      })();
    }
    return this.bundleLoadPromise;
  }

  private notify(key: string): void {
    const set = this.subscribers.get(key);
    if (!set) {
      return;
    }
    for (const cb of set) {
      cb();
    }
  }
}

function cacheKey(
  exportName: BannerViewExport,
  pixelSize: number,
  frame: number,
): string {
  return `${exportName}:${pixelSize}#${frame}`;
}

let instance: BannerViewRenderer | null = null;

export function getBannerViewRenderer(): BannerViewRenderer {
  if (!instance) {
    instance = new BannerViewRenderer();
  }
  return instance;
}
