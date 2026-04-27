import type { VelloRenderer } from "vello-wasm";
import { ExternalSource, type Renderer, Texture } from "pixi.js";

import { createLogger } from "@/utils/logger";

import type { VelloAnimationMeta, VelloFrameResult } from "./vello-loader";

const log = createLogger("TileVello");

/**
 * Renders tile frames through Vello WASM and wraps the resulting GPUTexture
 * as a Pixi.js ExternalSource. Owns the per-tile Vello asset ID map and the
 * per-frame texture-ID map (the latter is consulted by the atlas cache so
 * evicted frames can release their Vello allocations on dispose).
 */
export class TileVelloRenderer {
  private vello: VelloRenderer | null = null;
  private nextAssetId = 1;

  private readonly assetIds = new Map<string, number>();
  private readonly pendingLoads = new Map<string, Promise<boolean>>();
  /** Raw bytes per tileKey, retained so atlas-loader can read the Extras section. */
  private readonly assetBytes = new Map<string, Uint8Array>();
  /** cacheKey → vello texture ID, so the frame cache can tell Vello to drop it. */
  private readonly textureIds = new Map<string, number>();

  constructor(
    private readonly pixiRenderer: Renderer,
    private readonly basePath: string
  ) {}

  setVelloRenderer(vello: VelloRenderer): void {
    this.vello = vello;
  }

  hasAsset(tileKey: string): boolean {
    return this.assetIds.has(tileKey);
  }

  /** Raw dofasset bytes for a loaded tile, used to parse the Extras section. */
  getAssetBytes(tileKey: string): Uint8Array | undefined {
    return this.assetBytes.get(tileKey);
  }

  /**
   * Query the uniform canvas + anchor for this tile's "tile" animation at 1x.
   * Returns null if Vello isn't ready or the tile hasn't been loaded yet.
   */
  getAnimationMeta(tileKey: string): VelloAnimationMeta | null {
    const vello = this.vello;
    const assetId = this.assetIds.get(tileKey);
    if (!vello || assetId === undefined) return null;
    return vello.getAnimationMeta(
      assetId,
      "tile",
      1.0
    ) as VelloAnimationMeta | null;
  }

  /** Load a tile's `.dofasset` into Vello. Deduplicates concurrent loads. */
  async loadAsset(tileKey: string): Promise<boolean> {
    if (this.assetIds.has(tileKey)) {
      return true;
    }

    const pending = this.pendingLoads.get(tileKey);

    if (pending) {
      return pending;
    }

    const promise = this.doLoadAsset(tileKey);
    this.pendingLoads.set(tileKey, promise);

    try {
      return await promise;
    } finally {
      this.pendingLoads.delete(tileKey);
    }
  }

  /**
   * Render a single frame via Vello + wrap the resulting GPUTexture as a Pixi
   * Texture. Returns null if Vello isn't set or the tile asset isn't loaded.
   */
  renderFrame(
    tileKey: string,
    frameIndex: number,
    zoom: number,
    cacheKey: string
  ): Texture | null {
    const vello = this.vello;
    const assetId = this.assetIds.get(tileKey);

    if (!vello || assetId === undefined) {
      return null;
    }

    const result = vello.renderFrame(
      assetId,
      "tile",
      frameIndex,
      zoom
    ) as VelloFrameResult | null;

    if (!result) {
      return null;
    }

    this.textureIds.set(cacheKey, result.textureId);

    const source = new ExternalSource({
      resource: result.texture,
      renderer: this.pixiRenderer,
      width: result.width,
      height: result.height,
      label: `vello:${tileKey}:${frameIndex}`,
    });

    // Vello's fine.wgsl emits straight alpha; Pixi's batch shader premultiplies via blend state.
    source.alphaMode = "no-premultiply-alpha";
    source.scaleMode = "nearest";
    source.format = "rgba8unorm";
    // Manage GPU texture lifecycle ourselves — Pixi's GC would otherwise destroy it mid-render.
    source.autoGarbageCollect = false;
    source.resolution = zoom;

    return new Texture({ source });
  }

  private async doLoadAsset(tileKey: string): Promise<boolean> {
    const vello = this.vello;

    if (!vello) {
      return false;
    }

    // `tactic_<id>` and `cell_<id>` route to the flat spritesheets/{tactic,cell}/
    // folders produced by the staticTile publish stage (the tactic-view overlay
    // reuses this tile loader path because every staticTile dofasset ships a
    // `TileExtras` section with an `animations.tile` entry).
    const underscore = tileKey.indexOf("_");
    const type = underscore === -1 ? tileKey : tileKey.slice(0, underscore);
    const idStr = underscore === -1 ? "" : tileKey.slice(underscore + 1);
    const url =
      type === "tactic" || type === "cell"
        ? `${this.basePath}/${type}/${idStr}.dofasset`
        : `${this.basePath}/tiles/${type}/${idStr}.dofasset`;

    try {
      const res = await fetch(url);

      if (!res.ok) {
        return false;
      }

      const data = new Uint8Array(await res.arrayBuffer());
      // Auto-increment avoids ID conflicts between ground and objects tile ranges.
      const id = this.nextAssetId++;
      vello.loadAsset(id, data);
      this.assetIds.set(tileKey, id);
      this.assetBytes.set(tileKey, data);
      return true;
    } catch (e) {
      log.warn(`Failed to load dofasset for ${tileKey}:`, e);
      return false;
    }
  }
}
