import { createLogger } from "@/utils/logger";

import { renderHudAssetToCanvas } from "./hud-vello-atlas";
import {
  loadSwfBundle,
  renderSwfSpellIcon,
  swfSpellIconNaturalSize,
} from "./vello-loader";

const log = createLogger("SpellIcon");

/**
 * Composition pack — same constant the asset-pipeline used.
 * Index 2 = "classic" pack: element-coloured backdrops (fire red,
 * water blue, etc.) — closest to vanilla 1.29.
 */
const PACK_INDEX = 2;

const BACK_SWF_PATH = "/swf/spells/icons/back";
const UP_SWF_PATH = "/swf/spells/icons/up";
const SPELLS_LANGS_PATH = "/assets/langs/fr/spells.json";

/**
 * Soft cap on the (spellId, pixelSize) → canvas cache. Each cached
 * entry holds a 2D `<canvas>` with the painted icon baked in via
 * `drawImage(bitmap)`. NO per-entry Vello surface — the rendering
 * routes through the shared `HudVelloAtlas`, which owns ONE surface
 * for all HUD output. Eviction is just a Map.delete; canvases drop
 * out via JS GC once no DOM ref remains.
 *
 * At hotbar's typical 48² each entry is ~9 KB CPU; 256 entries ≈
 * 2.3 MB. Bounded against extended fights and rapid spell-tooltip
 * hovers.
 */
const CANVAS_CACHE_CAP = 256;

interface SpellInfo {
  /** "up" icon source id — `up/<up>.swf` glyph layer. */
  up?: number;
  /** "back" icon source id — `back/<b>.swf` disc + frame layer. */
  b?: number;
  /** Per-pack glyph colours (`pc[PACK_INDEX]` is the active one). */
  pc?: number[];
  /** Per-pack disc colours (`bc[PACK_INDEX]`). */
  bc?: number[];
  /** Per-pack frame colours (`fc[PACK_INDEX]`). */
  fc?: number[];
}

interface SpellsLangsBundle {
  data: { S: Record<string, { i?: SpellInfo }> };
}

/**
 * Resolves a spell's hotbar icon into an `<canvas>` element painted by
 * Vello at exactly the pixel size the caller asks for. Pipeline:
 *
 *   1. fetch + cache `langs/fr/spells.json` once — the per-spell
 *      `info.{up,b,bc,fc,pc}` dictates which back+up SWFs to load and
 *      with what tints.
 *   2. lazy-load `back/<b>.swf` + `up/<up>.swf` SWF bundles.
 *   3. pure-bounds probe via `swfSpellIconNaturalSize` (CPU-only walk
 *      of the symbol bounds — microseconds, no GPU round-trip).
 *   4. for each (spellId, pixelSize): route the render through the
 *      shared `HudVelloAtlas`, which paints into ONE process-wide
 *      Vello surface and returns an ImageBitmap of the painted
 *      sub-rect. Bake the bitmap into a fresh 2D `<canvas>` and
 *      cache it. React mounts the result canvas directly.
 *
 * No per-icon Vello surface (the original per-canvas pattern was 40+
 * concurrent WebGPU swap chains during fights — replaced with a single
 * shared atlas surface). No `ExternalSource` (Vello and Pixi are on
 * separate `GPUDevice`s).
 */
export class SpellIconRenderer {
  /** Loaded langs bundle, populated lazily on first render request. */
  private langs: SpellsLangsBundle | null = null;
  private langsPending: Promise<SpellsLangsBundle | null> | null = null;

  /** "back-N" / "up-N" → bundle name once it's been `loadSwfBundle`'d. */
  private readonly loadedSubBundles = new Set<string>();
  private readonly pendingSubBundles = new Map<string, Promise<boolean>>();

  /** Tight content size at resolution 1 per spell. */
  private readonly naturalSizes = new Map<number, number>();
  private readonly canvasCache = new Map<string, HTMLCanvasElement>();
  private readonly pendingRenders = new Map<
    string,
    Promise<HTMLCanvasElement | null>
  >();
  /** Per-(spell, size) subscribers (React hooks), notified on render landing. */
  private readonly subscribers = new Map<string, Set<() => void>>();
  /** Fired once the Vello renderer is ready (i.e. WASM loaded + surface API available). */
  private readonly readySubscribers = new Set<() => void>();
  private ready = false;

  /**
   * Mark the renderer ready. Called after Vello WASM `init()` lands;
   * the legacy two-arg signature `init(vello, pixi)` is preserved so
   * the call site in `bootstrap.ts` doesn't need to change in this
   * pass — the args are simply ignored. `getSpellIconRenderer().init()`
   * (zero-arg) also works.
   */
  init(_vello?: unknown, _pixi?: unknown): void {
    this.ready = true;
    for (const cb of this.readySubscribers) {
      cb();
    }
    this.readySubscribers.clear();
  }

  isReady(): boolean {
    return this.ready;
  }

  getStats(): {
    canvasCache: number;
    pendingRenders: number;
    pendingSubBundles: number;
    loadedSubBundles: number;
    naturalSizes: number;
    subscribers: number;
  } {
    let subTotal = 0;
    for (const s of this.subscribers.values()) subTotal += s.size;
    return {
      canvasCache: this.canvasCache.size,
      pendingRenders: this.pendingRenders.size,
      pendingSubBundles: this.pendingSubBundles.size,
      loadedSubBundles: this.loadedSubBundles.size,
      naturalSizes: this.naturalSizes.size,
      subscribers: subTotal,
    };
  }

  /** Sync cache peek. */
  peekCanvas(spellId: number, pixelSize: number): HTMLCanvasElement | null {
    return this.canvasCache.get(cacheKey(spellId, pixelSize)) ?? null;
  }

  subscribe(spellId: number, pixelSize: number, cb: () => void): () => void {
    const key = cacheKey(spellId, pixelSize);
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
    spellId: number,
    pixelSize: number,
  ): Promise<HTMLCanvasElement | null> {
    if (spellId < 0 || pixelSize <= 0) {
      return null;
    }
    const key = cacheKey(spellId, pixelSize);
    const cached = this.canvasCache.get(key);
    if (cached) {
      // LRU touch.
      this.canvasCache.delete(key);
      this.canvasCache.set(key, cached);
      return cached;
    }
    const pending = this.pendingRenders.get(key);
    if (pending) {
      return pending;
    }
    const promise = this.doRender(spellId, pixelSize, key);
    this.pendingRenders.set(key, promise);
    try {
      return await promise;
    } finally {
      this.pendingRenders.delete(key);
    }
  }

  private async doRender(
    spellId: number,
    pixelSize: number,
    key: string,
  ): Promise<HTMLCanvasElement | null> {
    if (!this.ready) {
      return null;
    }

    const langs = await this.loadLangs();
    if (!langs) {
      return null;
    }
    const info = langs.data.S[String(spellId)]?.i;
    if (!info || info.up === undefined || info.b === undefined) {
      return null;
    }

    const upId = info.up;
    const backId = info.b;
    if (upId < 0 || backId < 0) {
      return null;
    }

    const [backReady, upReady] = await Promise.all([
      this.loadSubBundle(`back-${backId}`, `${BACK_SWF_PATH}/${backId}.swf`),
      this.loadSubBundle(`up-${upId}`, `${UP_SWF_PATH}/${upId}.swf`),
    ]);
    if (!backReady || !upReady) {
      return null;
    }
    const backBundle = `spell-icon-back-${backId}`;
    const upBundle = `spell-icon-up-${upId}`;

    const bc = pickPackColor(info.bc);
    const fc = pickPackColor(info.fc);
    const pc = pickPackColor(info.pc);

    // Pure-bounds probe — CPU-only `symbol_bounds` walk inside WASM,
    // no GPU dispatch. Cached per spell.
    const natural = this.naturalSize(spellId, backBundle, upBundle);
    if (natural <= 0) {
      return null;
    }

    const resolution = pixelSize / natural;

    // Route through the shared HUD atlas: Vello renders an
    // off-screen rgba8unorm texture, the atlas's secondary Pixi
    // Application blits it onto a bgra8unorm OffscreenCanvas (no
    // format warning), `createImageBitmap` snapshots the painted
    // sub-rect, and we bake the bitmap into a 2D `<canvas>` for
    // React to mount. Purely GPU — no pixel readback anywhere.
    const canvas = await renderHudAssetToCanvas(pixelSize, pixelSize, () =>
      renderSwfSpellIcon(backBundle, upBundle, bc, fc, pc, resolution),
    );
    if (!canvas) {
      log.warn(`render failed for spell=${spellId}@${pixelSize}`);
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
   * Pure-bounds natural-size probe — CPU-only `symbol_bounds` walk in
   * WASM. Cached per spell (disc geometry is fixed authored content).
   * No GPU dispatch, no surface attach/detach, no probe render.
   */
  private naturalSize(
    spellId: number,
    backBundle: string,
    upBundle: string,
  ): number {
    const cached = this.naturalSizes.get(spellId);
    if (cached !== undefined) {
      return cached;
    }
    const bounds = swfSpellIconNaturalSize(backBundle, upBundle);
    const w = bounds?.width ?? 0;
    this.naturalSizes.set(spellId, w);
    return w;
  }

  private async loadLangs(): Promise<SpellsLangsBundle | null> {
    if (this.langs) {
      return this.langs;
    }
    if (!this.langsPending) {
      this.langsPending = (async () => {
        try {
          const res = await fetch(SPELLS_LANGS_PATH);
          if (!res.ok) {
            log.warn(`langs fetch failed: ${res.status}`);
            return null;
          }
          const json = (await res.json()) as SpellsLangsBundle;
          this.langs = json;
          return json;
        } catch (err) {
          log.warn(`langs fetch error: ${String(err)}`);
          return null;
        }
      })();
    }
    return this.langsPending;
  }

  private async loadSubBundle(key: string, url: string): Promise<boolean> {
    if (this.loadedSubBundles.has(key)) {
      return true;
    }
    const pending = this.pendingSubBundles.get(key);
    if (pending) {
      return pending;
    }
    const promise = (async () => {
      try {
        const ok = await loadSwfBundle(`spell-icon-${key}`, url);
        if (ok) {
          this.loadedSubBundles.add(key);
        }
        return ok;
      } catch (err) {
        log.warn(`loadSubBundle ${key} threw: ${String(err)}`);
        return false;
      } finally {
        this.pendingSubBundles.delete(key);
      }
    })();
    this.pendingSubBundles.set(key, promise);
    return promise;
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

function cacheKey(spellId: number, pixelSize: number): string {
  return `${spellId}:${pixelSize}`;
}

/** Read `arr[PACK_INDEX]` as a packed RGB; default to white when absent. */
function pickPackColor(arr: number[] | undefined): number {
  if (!Array.isArray(arr) || arr.length === 0) {
    return 0xffffff;
  }
  const v = arr[PACK_INDEX];
  if (typeof v !== "number" || v < 0) {
    return 0xffffff;
  }
  return v >>> 0;
}

let instance: SpellIconRenderer | null = null;

export function getSpellIconRenderer(): SpellIconRenderer {
  if (!instance) {
    instance = new SpellIconRenderer();
  }
  return instance;
}
