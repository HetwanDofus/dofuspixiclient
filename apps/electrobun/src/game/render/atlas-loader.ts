import type { Renderer, Texture } from "pixi.js";
import type { VelloRenderer } from "vello-wasm";
import { readTileExtras, type TileExtras } from "@dofus/dofasset-format";

import type { TileManifest } from "@/game/types";
import { createLogger } from "@/utils/logger";

import {
  AtlasCache,
  type AtlasManifest,
  type CachedTileData,
  type SpritesheetManifest,
} from "./atlas-cache";
import { getLoadProgress } from "./load-progress";
import { convertToTileManifest } from "./tile-manifest-converter";
import { TileVelloRenderer } from "./tile-vello-renderer";

const log = createLogger("AtlasLoader");

export class AtlasLoader {
  private readonly cache = new AtlasCache();
  private readonly pendingTileDataLoads = new Map<
    string,
    Promise<CachedTileData | null>
  >();
  private currentZoom = 1;
  private readonly velloRenderer: TileVelloRenderer;

  constructor(renderer: Renderer, basePath = "/assets/spritesheets") {
    this.velloRenderer = new TileVelloRenderer(renderer, basePath);
  }

  /** Set the Vello renderer (call after vello init, before prefetch). */
  setVelloRenderer(vello: VelloRenderer): void {
    this.velloRenderer.setVelloRenderer(vello);
  }

  /** Current zoom determines Vello render resolution. */
  setZoom(zoom: number): void {
    this.currentZoom = zoom;
  }

  getZoom(): number {
    return this.currentZoom;
  }

  /**
   * Load tile data (manifest + atlas). Deduplicates concurrent fetches for
   * the same tile via a pending-promise map.
   */
  private async loadTileData(tileKey: string): Promise<CachedTileData | null> {
    const cached = this.cache.getTileData(tileKey);

    if (cached) {
      return cached;
    }

    const pending = this.pendingTileDataLoads.get(tileKey);

    if (pending) {
      return pending;
    }

    const promise = this.doLoadTileData(tileKey);
    this.pendingTileDataLoads.set(tileKey, promise);

    try {
      return await promise;
    } finally {
      this.pendingTileDataLoads.delete(tileKey);
    }
  }

  private async doLoadTileData(
    tileKey: string
  ): Promise<CachedTileData | null> {
    // Ensure the .dofasset is in Vello (triggers the single fetch that also
    // gives us the Extras section — no more sidecar manifest.json fetch).
    await this.velloRenderer.loadAsset(tileKey);
    const bytes = this.velloRenderer.getAssetBytes(tileKey);
    if (!bytes) {
      return null;
    }

    const extras = readTileExtras(bytes);
    if (!extras) {
      log.warn(`Tile ${tileKey} .dofasset missing Extras section`);
      return null;
    }

    const manifest = spritesheetManifestFromExtras(extras);
    const animName = Object.keys(manifest.animations)[0];
    if (!animName) {
      return null;
    }
    const atlas = manifest.animations[animName] as AtlasManifest;

    // Single Vello path-walk per tile, cached forever. Anchor + canvas scale
    // linearly with zoom, so no re-query on zoom changes.
    const meta = this.velloRenderer.getAnimationMeta(tileKey);
    if (!meta) {
      log.warn(`Tile ${tileKey} Vello animation meta unavailable`);
      return null;
    }

    const data: CachedTileData = {
      manifest,
      atlas,
      renderMeta: {
        width: meta.width,
        height: meta.height,
        anchorX: meta.anchorX,
        anchorY: meta.anchorY,
      },
      baseTextures: new Map(),
    };

    this.cache.setTileData(tileKey, data);
    return data;
  }

  /** Rounded zoom key for cache bucketing (avoids excessive cache entries). */
  private zoomKey(): number {
    return Math.round(this.currentZoom * 100) / 100;
  }

  private frameCacheKey(tileKey: string, frameIndex: number): string {
    return `${tileKey}:${this.zoomKey()}:${frameIndex}`;
  }

  async loadTileManifest(tileKey: string): Promise<TileManifest | null> {
    const cached = this.cache.getTileManifest(tileKey);

    if (cached) {
      return cached;
    }

    const data = await this.loadTileData(tileKey);

    if (!data) {
      return null;
    }

    const [type] = tileKey.split("_");
    const tileManifest = convertToTileManifest(
      data,
      type as "ground" | "objects" | "tactic" | "cell"
    );
    this.cache.setTileManifest(tileKey, tileManifest);
    return tileManifest;
  }

  async loadFrame(
    tileKey: string,
    frameIndex: number,
    _scale: number
  ): Promise<Texture | null> {
    const cacheKey = this.frameCacheKey(tileKey, frameIndex);
    const cachedTexture = this.cache.getFromFrameCache(cacheKey);

    if (cachedTexture) {
      return cachedTexture;
    }

    if (!this.velloRenderer.hasAsset(tileKey)) {
      await this.velloRenderer.loadAsset(tileKey);
    }

    const texture = this.velloRenderer.renderFrame(
      tileKey,
      frameIndex,
      this.currentZoom,
      cacheKey
    );

    if (!texture) {
      return null;
    }

    this.cache.addToFrameCache(cacheKey, texture);
    return texture;
  }

  async loadAnimationFrames(
    tileKey: string,
    scale: number
  ): Promise<Texture[]> {
    const tile = await this.loadTileManifest(tileKey);

    if (!tile) {
      return [];
    }

    const frames = await Promise.all(
      Array.from({ length: tile.frameCount }, (_, i) =>
        this.loadFrame(tileKey, i, scale)
      )
    );

    return frames.filter((t): t is Texture => t !== null);
  }

  getTileManifest(tileKey: string): TileManifest | undefined {
    return this.cache.getTileManifest(tileKey);
  }

  /** Sync manifest lookup; returns null if not cached (call prefetchTiles first). */
  getTileManifestSync(tileKey: string): TileManifest | null {
    const cached = this.cache.getTileManifest(tileKey);

    if (cached) {
      return cached;
    }

    const data = this.cache.getTileData(tileKey);

    if (!data) {
      return null;
    }

    const [type] = tileKey.split("_");
    const tileManifest = convertToTileManifest(
      data,
      type as "ground" | "objects" | "tactic" | "cell"
    );

    this.cache.setTileManifest(tileKey, tileManifest);
    return tileManifest;
  }

  /** Sync frame lookup; returns null if base texture not cached. */
  loadFrameSync(
    tileKey: string,
    frameIndex: number,
    _scale: number
  ): Texture | null {
    const cacheKey = this.frameCacheKey(tileKey, frameIndex);
    const cached = this.cache.getFromFrameCache(cacheKey);

    if (cached) {
      return cached;
    }

    if (!this.velloRenderer.hasAsset(tileKey)) {
      return null;
    }

    const texture = this.velloRenderer.renderFrame(
      tileKey,
      frameIndex,
      this.currentZoom,
      cacheKey
    );

    if (texture) {
      this.cache.addToFrameCache(cacheKey, texture);
      return texture;
    }

    return null;
  }

  /** Sync animation frames; returns empty array if not cached. */
  loadAnimationFramesSync(tileKey: string, _scale: number): Texture[] {
    const manifest = this.getTileManifestSync(tileKey);

    if (!manifest) {
      return [];
    }

    const textures: Texture[] = [];

    for (let i = 0; i < manifest.frameCount; i++) {
      const texture = this.loadFrameSync(tileKey, i, 1);

      if (texture) {
        textures.push(texture);
      }
    }

    return textures;
  }

  /**
   * Prefetch tile data + Vello asset in parallel.
   * After prefetch, sync methods (loadFrameSync, getTileManifestSync) are
   * zero-cost.
   */
  async prefetchTiles(tileKeys: string[], _scale: number): Promise<void> {
    const progress = getLoadProgress();
    const total = tileKeys.length;
    let loaded = 0;

    await Promise.all(
      tileKeys.map(async (key) => {
        await this.loadTileData(key);
        this.getTileManifestSync(key);
        await this.velloRenderer.loadAsset(key);

        loaded++;
        progress.report("map-tiles", loaded, total);
      })
    );
  }

  clearFrameCache(): void {
    this.cache.clearFrameCache();
  }

  getFrameCacheMemoryBytes(): number {
    return this.cache.getFrameCacheMemoryBytes();
  }

  getFrameCacheEntryCount(): number {
    return this.cache.getFrameCacheEntryCount();
  }

  clearCache(): void {
    this.cache.clearAll();
  }

  /**
   * Clear only textures for a specific zoom level. Does NOT destroy textures —
   * lets GC handle cleanup to avoid GPU conflicts with in-flight draws.
   */
  clearZoomCache(zoom: number): void {
    this.cache.clearZoomLevel(zoom);
  }
}

/**
 * Rebuild the legacy SpritesheetManifest shape from the Extras section that
 * replaces manifest.json. Existing downstream code (convertToTileManifest,
 * tile-vello-renderer) keeps working unchanged.
 */
function spritesheetManifestFromExtras(
  extras: TileExtras
): SpritesheetManifest {
  const animations: SpritesheetManifest["animations"] = {};
  for (const [name, a] of Object.entries(extras.animations ?? {})) {
    animations[name] = {
      file: `${name}/atlas.svg`,
      version: extras.version ?? 1,
      animation: name,
      width: a.width,
      height: a.height,
      offsetX: a.offsetX,
      offsetY: a.offsetY,
      frames: a.frames ?? [],
      frameOrder: a.frameOrder ?? [],
      duplicates: a.duplicates ?? {},
      fps: a.fps,
      baseFrame: a.baseFrame,
      baseZOrder: a.baseZOrder,
      pages: a.pages,
    };
  }
  return {
    version: extras.version ?? 1,
    spriteId: extras.spriteId,
    behavior: extras.behavior,
    fps_hint: extras.fpsHint,
    autoplay: extras.autoplay,
    loop: extras.loop,
    states: extras.states,
    animations,
  };
}
