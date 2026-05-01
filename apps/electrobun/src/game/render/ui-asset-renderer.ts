import type { VelloRenderer } from "vello-wasm";
import {
  ExternalSource,
  type Renderer,
  Sprite,
  Texture,
} from "pixi.js";

import { createLogger } from "@/utils/logger";

import type { VelloFrameResult } from "./vello-loader";

const log = createLogger("UiAsset");

/**
 * Generic Vello renderer for static UI dofassets — the canonical
 * `loader.swf` panels (UI_StringCourse, UI_Banner, UI_Inventory…)
 * extracted by the `ui.loader` asset-pipeline category. Mirrors
 * `SpellIconRenderer` / `FighterPortraitRenderer`: fetches the
 * dofasset, rasterises through Vello at a chosen resolution, hands
 * back a DOM canvas the React tree mounts directly.
 *
 * Resource paths are caller-supplied so the same instance can serve
 * multiple panel families. Cache key is `(path, resolution)` — the
 * panel's native size is fixed dofasset geometry, so different
 * resolution-factors get distinct canvases.
 */

const ASSET_ID_BASE = 800_000;

export class UiAssetRenderer {
  private vello: VelloRenderer | null = null;
  private pixi: Renderer | null = null;
  private nextAssetId = ASSET_ID_BASE;

  private readonly assetIds = new Map<string, number | null>();
  private readonly pendingLoads = new Map<string, Promise<number | null>>();
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
   * Returns a DOM canvas for the dofasset at `path`, rasterised at
   * `resolution` (1.0 = native dofasset size, 2.0 = double, etc.).
   * Concurrent calls collapse onto a single in-flight render.
   */
  async getCanvas(
    path: string,
    resolution: number
  ): Promise<HTMLCanvasElement | null> {
    if (!path || resolution <= 0) return null;
    const key = `${path}@${resolution}`;
    const cached = this.canvasCache.get(key);
    if (cached) return cached;
    const pending = this.pendingRenders.get(key);
    if (pending) return pending;
    const promise = this.doRender(path, resolution, key);
    this.pendingRenders.set(key, promise);
    try {
      return await promise;
    } finally {
      this.pendingRenders.delete(key);
    }
  }

  /**
   * Native bbox of the dofasset's static frame at resolution 1, in
   * physical pixels. Useful for the React layer to size the canvas
   * slot before the rasterised result lands.
   */
  async getNativeSize(
    path: string
  ): Promise<{ width: number; height: number } | null> {
    const vello = this.vello;
    if (!vello) return null;
    const assetId = await this.loadAsset(path);
    if (assetId === null) return null;
    const size = vello.getFrameSize(assetId, "static", 0, 1) as
      | Uint32Array
      | null;
    if (!size || size.length < 2) return null;
    return { width: size[0]!, height: size[1]! };
  }

  private async doRender(
    path: string,
    resolution: number,
    key: string
  ): Promise<HTMLCanvasElement | null> {
    const vello = this.vello;
    const pixi = this.pixi;
    if (!vello || !pixi) return null;

    const assetId = await this.loadAsset(path);
    if (assetId === null) return null;

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
      label: `ui-asset:${key}`,
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
      log.warn(`extract failed for ${path}: ${String(err)}`);
      return null;
    } finally {
      sprite.destroy();
      source.destroy();
    }
  }

  private async loadAsset(path: string): Promise<number | null> {
    const cached = this.assetIds.get(path);
    if (cached !== undefined) return cached;
    const pending = this.pendingLoads.get(path);
    if (pending) return pending;
    const vello = this.vello;
    if (!vello) return null;

    const promise = (async () => {
      try {
        const res = await fetch(path);
        if (!res.ok) {
          this.assetIds.set(path, null);
          return null;
        }
        const data = new Uint8Array(await res.arrayBuffer());
        const id = this.nextAssetId++;
        vello.loadAsset(id, data);
        this.assetIds.set(path, id);
        return id;
      } catch (err) {
        log.warn(`fetch failed for ${path}: ${String(err)}`);
        this.assetIds.set(path, null);
        return null;
      }
    })();
    this.pendingLoads.set(path, promise);
    try {
      return await promise;
    } finally {
      this.pendingLoads.delete(path);
    }
  }
}

let instance: UiAssetRenderer | null = null;

export function getUiAssetRenderer(): UiAssetRenderer {
  if (!instance) instance = new UiAssetRenderer();
  return instance;
}
