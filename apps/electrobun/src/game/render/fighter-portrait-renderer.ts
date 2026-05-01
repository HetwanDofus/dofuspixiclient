import type { VelloRenderer } from "vello-wasm";
import {
  ExternalSource,
  type Renderer,
  Sprite,
  Texture,
} from "pixi.js";

import { createLogger } from "@/utils/logger";

import type { VelloFrameResult } from "./vello-loader";

const log = createLogger("FighterPortrait");

/**
 * Big-artwork portraits served by the asset pipeline. Mirrors canonical
 * `dofus.Constants.ARTWORKS_BIG_PATH` (`clips/artworks/big/<id>.swf`)
 * — every PlayableCharacter (including Monster, which extends it)
 * resolves `artworkFile` to that path keyed by `gfxFileName`. Players
 * use their numeric breed-gfx id, monsters use their monster gfx id; the
 * folder layout is flat with no subdirectories.
 */
const ARTWORKS_BIG_PATH = "/assets/dofassets/artworks/big";
const ARTWORK_ASSET_ID_BASE = 700_000;

/**
 * Renders the canonical Dofus 1.29 "big" portrait artwork for a fighter
 * (player breed or monster) into a standalone HTMLCanvasElement that the
 * React StringCourse turn-change banner mounts directly. The canonical
 * client loads `ARTWORKS_BIG_PATH + gfxFileName + ".swf"` (Game.as:389
 * `loadUIComponent("StringCourse", { gfx: artworkFile })`) and applies
 * per-zone color replacement via the artwork's own `stringCourseColor`
 * callback (see `dofus.graphics.gapi.ui.StringCourse.applyColor`). Big
 * artworks DO carry zone scripts (verified in the breed SWFs), so we
 * forward `[c1,c2,c3]` to Vello using the same encoding the in-world
 * character sprites use (`-1` → `0`, meaning "keep palette default").
 */
export class FighterPortraitRenderer {
  private vello: VelloRenderer | null = null;
  private pixi: Renderer | null = null;
  private nextAssetId = ARTWORK_ASSET_ID_BASE;

  private readonly assetIds = new Map<number, number | null>();
  private readonly pendingLoads = new Map<number, Promise<number | null>>();
  private readonly naturalSizes = new Map<number, number>();
  private readonly canvasCache = new Map<string, HTMLCanvasElement>();
  private readonly pendingRenders = new Map<
    string,
    Promise<HTMLCanvasElement | null>
  >();

  init(vello: VelloRenderer, pixi: Renderer): void {
    this.vello = vello;
    this.pixi = pixi;
  }

  isReady(): boolean {
    return this.vello !== null && this.pixi !== null;
  }

  /**
   * Returns the canvas matching `pixelSize` in physical pixels. The
   * loader picks a Vello resolution so `naturalSize × resolution =
   * pixelSize`, producing a crisp DOM canvas at exactly the slot's
   * dimensions. Concurrent calls for the same (gfxId, size, colors)
   * collapse onto a single in-flight render via `pendingRenders`.
   *
   * `colors` is `[c1, c2, c3]` as 0xRRGGBB (canonical
   * `stringCourseColor` zones). `-1` means "keep palette default".
   * Pass `null` / undefined when the fighter has no per-zone colors
   * (e.g. monsters).
   */
  async getCanvas(
    gfxId: number,
    pixelSize: number,
    colors?: readonly [number, number, number] | null
  ): Promise<HTMLCanvasElement | null> {
    if (gfxId < 0 || pixelSize <= 0) return null;
    const key = cacheKey(gfxId, pixelSize, colors);
    const cached = this.canvasCache.get(key);
    if (cached) return cached;
    const pending = this.pendingRenders.get(key);
    if (pending) return pending;
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
    key: string
  ): Promise<HTMLCanvasElement | null> {
    const vello = this.vello;
    const pixi = this.pixi;
    if (!vello || !pixi) return null;

    const assetId = await this.loadAsset(gfxId);
    if (assetId === null) return null;

    const natural = this.naturalSize(gfxId, assetId);
    if (natural <= 0) return null;

    const resolution = pixelSize / natural;
    const colorsArg = buildColorsArg(colors);
    const result = vello.renderFrame(
      assetId,
      "static",
      0,
      resolution,
      colorsArg
    ) as VelloFrameResult | null;
    if (!result) return null;

    const source = new ExternalSource({
      resource: result.texture,
      renderer: pixi,
      width: result.width,
      height: result.height,
      label: `fighter-portrait:${gfxId}@${pixelSize}`,
    });
    source.alphaMode = "no-premultiply-alpha";
    source.scaleMode = "linear";
    source.format = "rgba8unorm";
    source.autoGarbageCollect = false;
    source.resolution = 1;
    const texture = new Texture({ source });
    const sprite = new Sprite(texture);

    try {
      const canvas = pixi.extract.canvas({
        target: sprite,
      }) as HTMLCanvasElement;
      this.canvasCache.set(key, canvas);
      return canvas;
    } catch (err) {
      log.warn(`extract failed for gfxId=${gfxId}: ${String(err)}`);
      return null;
    } finally {
      sprite.destroy();
      source.destroy();
    }
  }

  /**
   * Tight content long-edge at resolution 1 — Vello's `getFrameSize`
   * returns the path's actual bbox `[width, height]`, not the SWF's
   * stored stage rect. Using `max(w, h)` as "natural size" makes the
   * caller's `pixelSize` parameter behave like a long-edge fit so non-
   * square artworks (most monsters: pious, dragodindes, bosses with
   * wide poses) don't render off-scale relative to square breeds. The
   * earlier width-only path made tall monsters render comfortably but
   * over-scaled wide ones, which the user reported as "doesn't show
   * up properly". Cached per gfxId — dofasset geometry is fixed.
   */
  private naturalSize(gfxId: number, assetId: number): number {
    const cached = this.naturalSizes.get(gfxId);
    if (cached !== undefined) return cached;
    const vello = this.vello;
    if (!vello) return 0;
    const size = vello.getFrameSize(assetId, "static", 0, 1) as
      | Uint32Array
      | null;
    const w = size?.[0] ?? 0;
    const h = size?.[1] ?? 0;
    const longEdge = Math.max(w, h);
    this.naturalSizes.set(gfxId, longEdge);
    return longEdge;
  }

  private async loadAsset(gfxId: number): Promise<number | null> {
    const cached = this.assetIds.get(gfxId);
    if (cached !== undefined) return cached;
    const pending = this.pendingLoads.get(gfxId);
    if (pending) return pending;
    const vello = this.vello;
    if (!vello) return null;

    const promise = (async () => {
      try {
        const res = await fetch(`${ARTWORKS_BIG_PATH}/${gfxId}.dofasset`);
        if (!res.ok) {
          this.assetIds.set(gfxId, null);
          return null;
        }
        const data = new Uint8Array(await res.arrayBuffer());
        const id = this.nextAssetId++;
        vello.loadAsset(id, data);
        this.assetIds.set(gfxId, id);
        return id;
      } catch (err) {
        log.warn(`fetch failed for gfxId=${gfxId}: ${String(err)}`);
        this.assetIds.set(gfxId, null);
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
  colors?: readonly [number, number, number] | null
): string {
  if (!colors || (colors[0] < 0 && colors[1] < 0 && colors[2] < 0)) {
    return `${gfxId}:${pixelSize}`;
  }
  return `${gfxId}:${pixelSize}:${colors[0]},${colors[1]},${colors[2]}`;
}

// Mirror `character-sprite.ts` buildColorsArg: -1 means "keep palette
// default", and the Vello replacement encodes that as 0 in the u32 slot.
function buildColorsArg(
  colors: readonly [number, number, number] | null | undefined
): Uint32Array | undefined {
  if (!colors || (colors[0] < 0 && colors[1] < 0 && colors[2] < 0)) {
    return undefined;
  }
  return new Uint32Array([
    colors[0] >= 0 ? colors[0] : 0,
    colors[1] >= 0 ? colors[1] : 0,
    colors[2] >= 0 ? colors[2] : 0,
  ]);
}

let instance: FighterPortraitRenderer | null = null;

export function getFighterPortraitRenderer(): FighterPortraitRenderer {
  if (!instance) instance = new FighterPortraitRenderer();
  return instance;
}
