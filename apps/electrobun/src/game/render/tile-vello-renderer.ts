import { ImageSource, type Renderer, Texture } from "pixi.js";

import { createLogger } from "@/utils/logger";

import {
  isSwfBundleLoaded,
  renderSwfFrame,
  swfAnimFrameCount,
  uploadAndCloseBitmap,
  type VelloSwfFrameResult,
} from "./vello-loader";

const log = createLogger("TileVello");

/** Probe order for tile-key resolution — matches `swf-spike` `classify_map_tiles.rs`. */
const GROUND_BUNDLES = ["g1", "g2"] as const;
const OBJECT_BUNDLES = [
  "o1",
  "o2",
  "o3",
  "o4",
  "o5",
  "o6",
  "o7",
  "o8",
  "o9",
  "o10",
  "o11",
  "o12",
] as const;

interface TileResolution {
  bundle: string;
  exportName: string;
}

/**
 * Tile metadata derived from a single SWF query — uniform canvas size and the
 * Flash registration point within it. Cached forever per tile.
 */
export interface TileSwfMeta {
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  /** Frame count of the deepest animation reachable from this export. */
  frameCount: number;
}

/**
 * Renders tile frames through Vello WASM by looking each tileKey up in one of
 * the pre-loaded SWF bundles, then rendering the export. Wraps the resulting
 * GPUTexture as a Pixi.js ExternalSource. Owns the per-tile bundle/export
 * resolution cache and the per-frame texture-ID map (consulted by the atlas
 * cache so evicted frames can release their Vello allocations on dispose).
 */
export class TileVelloRenderer {
  private readonly resolutions = new Map<string, TileResolution | null>();
  private readonly metaCache = new Map<string, TileSwfMeta>();
  /**
   * Pixi sources created via `renderFrame` since the last drain. The
   * `AtlasLoader` pulls these on zoom invalidation so it can destroy
   * them as part of its retire batch — otherwise filter-tile + fallback
   * sources accumulate forever.
   *
   * Bridge path: source is a Pixi `ImageSource` over a Vello bitmap;
   * destroying it cascades into Pixi's uploaded GPUTexture. The
   * Rust-side `wgpu::Texture` already dropped during the bake.
   */
  private pendingSources: { source: ImageSource }[] = [];

  /**
   * Pixi renderer used to FORCE the source's first upload at bake
   * time (via `texture.initSource`). Without an explicit renderer
   * here, the bitmap close would race with Pixi's lazy upload and
   * crash with "External Image has been detached" the first time
   * the source is rendered. See `uploadAndCloseBitmap` in
   * vello-loader.ts.
   */
  private readonly pixiRenderer: Renderer;

  constructor(pixiRenderer: Renderer) {
    this.pixiRenderer = pixiRenderer;
  }

  /** Drain the list of sources created since the last call. */
  drainPendingSources(): { source: ImageSource }[] {
    const out = this.pendingSources;
    this.pendingSources = [];
    return out;
  }

  /**
   * Resolve a tileKey to its `(bundle, exportName)` pair by probing the
   * relevant pre-loaded bundles. Returns null if no bundle owns this tile.
   */
  resolveTile(tileKey: string): TileResolution | null {
    const cached = this.resolutions.get(tileKey);
    if (cached !== undefined) {
      return cached;
    }

    const underscore = tileKey.indexOf("_");
    const type = underscore === -1 ? tileKey : tileKey.slice(0, underscore);
    const idStr = underscore === -1 ? tileKey : tileKey.slice(underscore + 1);

    let result: TileResolution | null = null;
    if (type === "ground") {
      result = this.probe(GROUND_BUNDLES, idStr);
    } else if (type === "objects") {
      result = this.probe(OBJECT_BUNDLES, idStr);
    } else if (type === "cell" || type === "tactic") {
      // cell/tactic tile keys carry the export verbatim (often `s1`, `i7`,
      // or a string token rather than a decimal).
      if (isSwfBundleLoaded(type) && swfAnimFrameCount(type, idStr) > 0) {
        result = { bundle: type, exportName: idStr };
      }
    } else {
      log.warn(`Unknown tile type "${type}" in key "${tileKey}"`);
    }

    if (!result) {
      log.warn(`Tile ${tileKey} not found in any SWF bundle`);
    }
    this.resolutions.set(tileKey, result);
    return result;
  }

  hasAsset(tileKey: string): boolean {
    return this.resolveTile(tileKey) !== null;
  }

  /**
   * Read this tile's cached canvas size + anchor + frame count. Returns
   * null until at least one frame has rendered (which populates the cache
   * as a side effect — see `renderFrame`). Avoids the wasted-render storm
   * the previous "render frame 0 at resolution 1.0 just to peek at the
   * dimensions" approach caused on map load.
   */
  getMeta(tileKey: string): TileSwfMeta | null {
    return this.metaCache.get(tileKey) ?? null;
  }

  /**
   * Externally populate the meta cache — used by the batch path in
   * `AtlasLoader.prefetchTiles` which goes through `renderSwfBundleBatch`
   * and `renderSwfStrip` instead of per-tile `renderSwfFrame`.
   */
  setMeta(tileKey: string, meta: TileSwfMeta): void {
    this.metaCache.set(tileKey, meta);
  }

  /**
   * Wrap a SWF batch composite texture as a Pixi `ExternalSource` for use
   * as a shared source across N Pixi `Texture` sub-rectangles.
   */
  /**
   * Bridge path: wrap a Vello-produced batch `ImageBitmap` as a Pixi
   * `ImageSource` for use as a shared source across N Pixi `Texture`
   * sub-rectangles.
   */
  wrapBatchSource(
    bitmap: ImageBitmap,
    physWidth: number,
    physHeight: number,
    zoom: number,
    label: string
  ): ImageSource {
    const source = new ImageSource({
      resource: bitmap,
      width: physWidth,
      height: physHeight,
      label,
      alphaMode: "premultiply-alpha-on-upload",
      scaleMode: "linear",
      autoGarbageCollect: false,
    });
    source.resolution = zoom;
    uploadAndCloseBitmap(this.pixiRenderer, source, bitmap);
    return source;
  }

  /** Compatibility shim — kept async-shaped for the existing AtlasLoader call sites. */
  async loadAsset(tileKey: string): Promise<boolean> {
    return this.resolveTile(tileKey) !== null;
  }

  /**
   * Render a single frame via Vello + wrap the resulting GPUTexture as a Pixi
   * Texture. Returns null if the tile can't be resolved or rendered.
   */
  renderFrame(
    tileKey: string,
    frameIndex: number,
    zoom: number,
    cacheKey: string
  ): Texture | null {
    const res = this.resolveTile(tileKey);
    if (!res) {
      return null;
    }

    const result = renderSwfFrame(
      res.bundle,
      res.exportName,
      frameIndex,
      zoom
    ) as VelloSwfFrameResult | null;

    if (!result) {
      return null;
    }

    // Populate the meta cache from the first render — saves a separate
    // resolution-1.0 query (which used to flood the GPU command queue
    // during prefetch). Convert from physical pixels at the rendered
    // zoom to logical units so meta is resolution-independent.
    if (!this.metaCache.has(tileKey)) {
      this.metaCache.set(tileKey, {
        width: result.width / zoom,
        height: result.height / zoom,
        anchorX: result.anchorX / zoom,
        anchorY: result.anchorY / zoom,
        frameCount: swfAnimFrameCount(res.bundle, res.exportName),
      });
    }

    const source = new ImageSource({
      resource: result.bitmap,
      width: result.width,
      height: result.height,
      label: `swf:${res.bundle}:${res.exportName}:${frameIndex}`,
      alphaMode: "premultiply-alpha-on-upload",
      scaleMode: "linear",
      // Manage GPU texture lifecycle ourselves — Pixi's GC would
      // otherwise destroy it mid-render.
      autoGarbageCollect: false,
    });
    source.resolution = zoom;
    uploadAndCloseBitmap(this.pixiRenderer, source, result.bitmap);

    void cacheKey;
    this.pendingSources.push({ source });
    return new Texture({ source });
  }

  private probe(
    bundles: readonly string[],
    exportName: string
  ): TileResolution | null {
    for (const bundle of bundles) {
      if (!isSwfBundleLoaded(bundle)) {
        continue;
      }
      if (swfAnimFrameCount(bundle, exportName) > 0) {
        return { bundle, exportName };
      }
    }
    return null;
  }
}
