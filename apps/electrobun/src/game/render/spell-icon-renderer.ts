import type { VelloRenderer } from "vello-wasm";
import {
  ExternalSource,
  type Renderer,
  Sprite,
  Texture,
} from "pixi.js";

import { createLogger } from "@/utils/logger";

import type { VelloFrameResult } from "./vello-loader";

const log = createLogger("SpellIcon");

const ICONS_BASE_PATH = "/assets/dofassets/spells/icons";
const ICON_ASSET_ID_BASE = 500_000;

/**
 * Resolves a spell's hotbar icon into an HTMLCanvasElement at exactly the
 * pixel size the caller asks for. Pipeline:
 *
 *   1. fetch `<spell_id>.dofasset` — one per spell, fully tinted at build
 *      time (3-layer backdrop + frame + glyph composed by the asset
 *      pipeline compile stage).
 *   2. query Vello for the dofasset's *tight* content bounds at
 *      resolution 1 (`getFrameSize`). We cache this per-spell — it's
 *      dofasset geometry, independent of render size.
 *   3. pick a Vello resolution so `content × resolution = pixelSize`.
 *      Result: the GPU texture is *exactly* the pixel count the slot
 *      needs — no CSS scaling, no blur.
 *   4. Pixi wraps that GPUTexture via ExternalSource → Texture → Sprite
 *      → `extract.canvas` — a live DOM canvas React mounts directly.
 *
 * Cache keys combine spell_id + pixel size so a slot resize produces a
 * fresh render rather than a stretched copy.
 */
export class SpellIconRenderer {
  private vello: VelloRenderer | null = null;
  private pixi: Renderer | null = null;
  private nextAssetId = ICON_ASSET_ID_BASE;

  private readonly assetIds = new Map<number, number>();
  private readonly pendingLoads = new Map<number, Promise<number | null>>();
  /** Natural content size at resolution 1, per spell. Filled on first load. */
  private readonly naturalSizes = new Map<number, number>();
  private readonly canvasCache = new Map<string, HTMLCanvasElement>();
  private readonly pendingRenders = new Map<
    string,
    Promise<HTMLCanvasElement | null>
  >();
  /** Per-(spell, size) subscribers (React hooks), notified when a render lands. */
  private readonly subscribers = new Map<string, Set<() => void>>();
  /** Fired once `init()` attaches the Vello + Pixi handles. */
  private readonly readySubscribers = new Set<() => void>();

  init(vello: VelloRenderer, pixi: Renderer): void {
    this.vello = vello;
    this.pixi = pixi;
    for (const cb of this.readySubscribers) cb();
    this.readySubscribers.clear();
  }

  isReady(): boolean {
    return this.vello !== null && this.pixi !== null;
  }

  /** Sync cache peek. */
  peekCanvas(spellId: number, pixelSize: number): HTMLCanvasElement | null {
    return this.canvasCache.get(cacheKey(spellId, pixelSize)) ?? null;
  }

  /** Subscribes for the (spellId, pixelSize) render. */
  subscribe(
    spellId: number,
    pixelSize: number,
    cb: () => void
  ): () => void {
    const key = cacheKey(spellId, pixelSize);
    let set = this.subscribers.get(key);
    if (!set) {
      set = new Set();
      this.subscribers.set(key, set);
    }
    set.add(cb);
    return () => {
      set!.delete(cb);
      if (set!.size === 0) this.subscribers.delete(key);
    };
  }

  /** Subscribes to `init()`. Fires immediately if already ready. */
  subscribeReady(cb: () => void): () => void {
    if (this.isReady()) {
      cb();
      return () => {};
    }
    this.readySubscribers.add(cb);
    return () => this.readySubscribers.delete(cb);
  }

  /**
   * Entry point the React hook calls. `pixelSize` is the target canvas
   * width/height in pixels — the renderer produces a canvas whose
   * *natural* dimensions are exactly that. Concurrent requests for the
   * same (spellId, pixelSize) collapse onto one in-flight render.
   */
  async getCanvas(
    spellId: number,
    pixelSize: number
  ): Promise<HTMLCanvasElement | null> {
    if (spellId < 0 || pixelSize <= 0) return null;
    const key = cacheKey(spellId, pixelSize);
    const cached = this.canvasCache.get(key);
    if (cached) return cached;
    const pending = this.pendingRenders.get(key);
    if (pending) return pending;
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
    key: string
  ): Promise<HTMLCanvasElement | null> {
    const vello = this.vello;
    const pixi = this.pixi;
    if (!vello || !pixi) return null;

    const assetId = await this.loadAsset(spellId);
    if (assetId === null) return null;

    const natural = this.naturalSize(spellId, assetId);
    if (natural <= 0) return null;

    // Pick the resolution that lands the canvas exactly on `pixelSize`.
    const resolution = pixelSize / natural;
    const result = vello.renderFrame(
      assetId,
      "static",
      0,
      resolution
    ) as VelloFrameResult | null;
    if (!result) return null;

    const source = new ExternalSource({
      resource: result.texture,
      renderer: pixi,
      width: result.width,
      height: result.height,
      label: `spell-icon:${spellId}@${pixelSize}`,
    });
    source.alphaMode = "no-premultiply-alpha";
    source.scaleMode = "linear";
    source.format = "rgba8unorm";
    source.autoGarbageCollect = false;
    // `ExternalSource.resolution` = physical pixels per logical unit. Tiles
    // set this to `zoom` because they're placed in a scene scaled by zoom
    // (logical 1× cell, physical N× cell). For extract-to-standalone-canvas
    // we want sprite logical size == texture physical size, otherwise Pixi
    // divides the logical bbox by resolution and `extract.canvas` writes a
    // canvas at that smaller logical size — producing e.g. a 40×40 canvas
    // when the texture was 49×49 at resolution 1.225.
    source.resolution = 1;
    const texture = new Texture({ source });
    const pixiSprite = new Sprite(texture);

    try {
      const canvas = pixi.extract.canvas({
        target: pixiSprite,
      }) as HTMLCanvasElement;
      this.canvasCache.set(key, canvas);
      this.notify(key);
      return canvas;
    } catch (err) {
      log.warn(`extract failed for spell=${spellId}: ${String(err)}`);
      return null;
    } finally {
      pixiSprite.destroy();
      source.destroy();
    }
  }

  /**
   * Tight content bounds at resolution 1 (Vello computes tight path bounds,
   * not the dofasset's stored clipRect). Cached per spell — it's fixed
   * dofasset geometry, independent of the render size.
   */
  private naturalSize(spellId: number, assetId: number): number {
    const cached = this.naturalSizes.get(spellId);
    if (cached !== undefined) return cached;
    const vello = this.vello;
    if (!vello) return 0;
    const size = vello.getFrameSize(assetId, "static", 0, 1) as
      | Uint32Array
      | null;
    const w = size?.[0] ?? 0;
    this.naturalSizes.set(spellId, w);
    return w;
  }

  private async loadAsset(spellId: number): Promise<number | null> {
    const cached = this.assetIds.get(spellId);
    if (cached !== undefined) return cached;
    const pending = this.pendingLoads.get(spellId);
    if (pending) return pending;
    const vello = this.vello;
    if (!vello) return null;

    const promise = (async () => {
      try {
        const res = await fetch(`${ICONS_BASE_PATH}/${spellId}.dofasset`);
        if (!res.ok) return null;
        const data = new Uint8Array(await res.arrayBuffer());
        const id = this.nextAssetId++;
        vello.loadAsset(id, data);
        this.assetIds.set(spellId, id);
        return id;
      } catch (err) {
        log.warn(`fetch failed for spell=${spellId}: ${String(err)}`);
        return null;
      }
    })();
    this.pendingLoads.set(spellId, promise);
    try {
      return await promise;
    } finally {
      this.pendingLoads.delete(spellId);
    }
  }

  private notify(key: string): void {
    const set = this.subscribers.get(key);
    if (!set) return;
    for (const cb of set) cb();
  }
}

function cacheKey(spellId: number, pixelSize: number): string {
  return `${spellId}:${pixelSize}`;
}

let instance: SpellIconRenderer | null = null;

export function getSpellIconRenderer(): SpellIconRenderer {
  if (!instance) instance = new SpellIconRenderer();
  return instance;
}
