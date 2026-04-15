import type { VelloRenderer } from "vello-wasm";
import { ExternalSource, type Renderer, Texture } from "pixi.js";

import { createLogger } from "@/utils/logger";

import type { VelloFrameResult } from "./vello-loader";

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

    const [type, idStr] = tileKey.split("_");
    const url = `${this.basePath}/tiles/${type}/${idStr}.dofasset`;

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
      return true;
    } catch (e) {
      log.warn(`Failed to load dofasset for ${tileKey}:`, e);
      return false;
    }
  }
}
