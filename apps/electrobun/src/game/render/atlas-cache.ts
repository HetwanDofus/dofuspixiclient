import { Assets, type Texture } from "pixi.js";

import type { TileBehavior, TileManifest, TileState } from "@/game/types";

/**
 * Spritesheet manifest format (per-tile manifest.json)
 */
export interface SpritesheetManifest {
  version: number;
  spriteId: string;
  /** Tile behavior from tile-classifications.json (embedded by spritesheet compiler) */
  behavior?: TileBehavior;
  /** Animation fps hint from classification */
  fps_hint?: number;
  /** Whether to autoplay animations */
  autoplay?: boolean;
  /** Whether animations loop */
  loop?: boolean;
  /**
   * The states of an interactive element — a run of frames per `GDF` frame
   * number. Present on `resource` tiles only.
   */
  states?: TileState[];
  animations: Record<
    string,
    AtlasManifest & {
      file: string;
    }
  >;
}

/**
 * Atlas manifest format (atlas.json)
 */
export interface AtlasManifest {
  version: number;
  animation: string;
  width: number;
  height: number;
  /** Positioning offset for placing the sprite in the game world */
  offsetX: number;
  offsetY: number;
  frames: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    /** Trim offset within the frame (viewBox origin) */
    offsetX: number;
    offsetY: number;
    /** For multi-page atlases: index into pages[]. Absent = page 0. */
    page?: number;
  }>;
  frameOrder: string[];
  duplicates: Record<string, string>;
  fps: number;
  /** Base frame for base/delta splitting (shared static elements) */
  baseFrame?: {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
    page?: number;
  };
  /** Whether the base renders "above" or "below" the delta */
  baseZOrder?: "above" | "below";
  /** Multi-page atlas page files + dimensions. Absent = single-page atlas. */
  pages?: Array<{ file: string; width: number; height: number }>;
}

/**
 * Per-animation uniform canvas + anchor at 1x resolution, fetched from Vello
 * once at asset load. Scales linearly with zoom at render time — avoids a
 * path-walk on every tile draw.
 */
export interface TileRenderMeta {
  /** Canvas width in SVG units (multiply by zoom for texture px). */
  width: number;
  /** Canvas height in SVG units. */
  height: number;
  /** Flash registration point X within the canvas (SVG units). */
  anchorX: number;
  /** Flash registration point Y within the canvas (SVG units). */
  anchorY: number;
}

/**
 * Cached tile data
 */
export interface CachedTileData {
  manifest: SpritesheetManifest;
  atlas: AtlasManifest;
  /** Vello's authoritative canvas + anchor, queried once per tile on load. */
  renderMeta: TileRenderMeta;
  /** Base textures keyed by zoom level. Array has one entry per page (single-page = [texture]). */
  baseTextures: Map<number, Texture[]>;
}

/**
 * LRU cache entry with texture and approximate memory size
 */
interface LRUCacheEntry {
  texture: Texture;
  memoryBytes: number;
}

/**
 * LRU cache configuration
 */
const LRU_CACHE_CONFIG = {
  /** Maximum memory in bytes (200MB) */
  maxMemoryBytes: 200 * 1024 * 1024,
  /** Bytes per pixel (RGBA = 4 bytes) */
  bytesPerPixel: 4,
};

export class AtlasCache {
  private frameCache = new Map<string, LRUCacheEntry>();
  private frameCacheMemoryBytes = 0;
  private tileDataCache = new Map<string, CachedTileData>();
  private tileManifestCache = new Map<string, TileManifest>();
  /** Track PixiJS Assets cache aliases for proper cleanup */
  private loadedAssetAliases = new Set<string>();

  /**
   * Estimate memory usage for a texture in bytes
   */
  estimateTextureMemory(texture: Texture): number {
    const width = texture.frame?.width ?? texture.width ?? 0;
    const height = texture.frame?.height ?? texture.height ?? 0;
    return width * height * LRU_CACHE_CONFIG.bytesPerPixel;
  }

  /**
   * Add entry to LRU frame cache, evicting old entries if needed
   */
  addToFrameCache(key: string, texture: Texture): void {
    const memoryBytes = this.estimateTextureMemory(texture);

    // Evict old entries if cache is too large
    while (
      this.frameCacheMemoryBytes + memoryBytes >
        LRU_CACHE_CONFIG.maxMemoryBytes &&
      this.frameCache.size > 0
    ) {
      this.evictOldestFrame();
    }

    // Add new entry (Map insertion order = LRU order)
    this.frameCache.set(key, { texture, memoryBytes });
    this.frameCacheMemoryBytes += memoryBytes;
  }

  /**
   * Get texture from LRU cache, updating access order
   */
  getFromFrameCache(key: string): Texture | null {
    const entry = this.frameCache.get(key);

    if (!entry) {
      return null;
    }

    // Move to end of Map iteration order (most recently used) — O(1)
    this.frameCache.delete(key);
    this.frameCache.set(key, entry);

    return entry.texture;
  }

  /**
   * Evict the least recently used frame from cache
   * Does NOT destroy textures - just removes from cache and lets GC handle cleanup
   * This prevents WebGPU errors from destroying textures still in use by the GPU
   */
  private evictOldestFrame(): void {
    // Map iterates in insertion order — first key is the oldest (LRU)
    const oldest = this.frameCache.entries().next();

    if (oldest.done) {
      return;
    }

    const [oldestKey, entry] = oldest.value;
    this.frameCacheMemoryBytes -= entry.memoryBytes;
    this.frameCache.delete(oldestKey);
    // Don't destroy texture - let GC handle it to avoid GPU conflicts
  }

  /**
   * Get tile data from cache
   */
  getTileData(tileKey: string): CachedTileData | undefined {
    return this.tileDataCache.get(tileKey);
  }

  /**
   * Store tile data in cache
   */
  setTileData(tileKey: string, data: CachedTileData): void {
    this.tileDataCache.set(tileKey, data);
  }

  /**
   * Check if tile data is cached
   */
  hasTileData(tileKey: string): boolean {
    return this.tileDataCache.has(tileKey);
  }

  /**
   * Get tile manifest from cache
   */
  getTileManifest(tileKey: string): TileManifest | undefined {
    return this.tileManifestCache.get(tileKey);
  }

  /**
   * Store tile manifest in cache
   */
  setTileManifest(tileKey: string, manifest: TileManifest): void {
    this.tileManifestCache.set(tileKey, manifest);
  }

  /**
   * Check if tile manifest is cached
   */
  hasTileManifest(tileKey: string): boolean {
    return this.tileManifestCache.has(tileKey);
  }

  /**
   * Register an asset alias for cleanup tracking
   */
  registerAssetAlias(alias: string): void {
    this.loadedAssetAliases.add(alias);
  }

  /**
   * Clear frame cache
   */
  clearFrameCache(): void {
    // Just clear references - let GC handle texture cleanup to avoid GPU conflicts
    this.frameCache.clear();
    this.frameCacheMemoryBytes = 0;
  }

  /**
   * Get current frame cache memory usage in bytes
   */
  getFrameCacheMemoryBytes(): number {
    return this.frameCacheMemoryBytes;
  }

  /**
   * Get current frame cache entry count
   */
  getFrameCacheEntryCount(): number {
    return this.frameCache.size;
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    this.clearFrameCache();

    // Clear base texture references - let GC handle cleanup
    for (const data of this.tileDataCache.values()) {
      data.baseTextures.clear();
    }

    // Unload from PixiJS Assets cache
    for (const alias of this.loadedAssetAliases) {
      Assets.unload(alias);
    }

    this.loadedAssetAliases.clear();

    this.tileDataCache.clear();
    this.tileManifestCache.clear();
  }

  /**
   * Clear textures for a specific zoom level
   * Does NOT destroy textures - lets GC handle cleanup to avoid GPU conflicts
   */
  clearZoomLevel(zoom: number): void {
    const zoomKey = Math.round(zoom * 100) / 100;

    // Clear frame cache entries for this zoom
    for (const [key, entry] of this.frameCache.entries()) {
      if (key.includes(`:${zoomKey}:`)) {
        this.frameCacheMemoryBytes -= entry.memoryBytes;
        this.frameCache.delete(key);
      }
    }

    // Clear base textures for this zoom - let GC handle cleanup
    for (const data of this.tileDataCache.values()) {
      data.baseTextures.delete(zoomKey);
    }
  }
}
