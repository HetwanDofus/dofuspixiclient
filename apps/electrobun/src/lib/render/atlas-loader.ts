import { Assets, Rectangle, type Renderer, Texture } from "pixi.js";

import type { FrameInfo, TileManifest } from "@/types";

import { registerSvgStrokeLoader } from "./svg-stroke-loader";

// Register the custom SVG loader on module load
registerSvgStrokeLoader();

/**
 * Spritesheet manifest format (per-tile manifest.json)
 */
interface SpritesheetManifest {
  version: number;
  spriteId: string;
  generatedAt: string;
  totalAnimations: number;
  totalFrames: number;
  uniqueFrames: number;
  animations: Record<
    string,
    {
      frameCount: number;
      uniqueFrames: number;
      atlasWidth: number;
      atlasHeight: number;
      file: string;
      manifestFile: string;
    }
  >;
}

/**
 * Atlas manifest format (atlas.json)
 */
interface AtlasManifest {
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
  }>;
  frameOrder: string[];
  duplicates: Record<string, string>;
  fps: number;
}

/**
 * Cached tile data
 */
interface CachedTileData {
  manifest: SpritesheetManifest;
  atlas: AtlasManifest;
  /** Base textures keyed by scale */
  baseTextures: Map<number, Texture>;
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

export class AtlasLoader {
  private frameCache = new Map<string, LRUCacheEntry>();
  private frameCacheOrder: string[] = [];
  private frameCacheMemoryBytes = 0;
  private tileDataCache = new Map<string, CachedTileData>();
  private tileManifestCache = new Map<string, TileManifest>();
  private pendingTileDataLoads = new Map<
    string,
    Promise<CachedTileData | null>
  >();
  private pendingBaseTextureLoads = new Map<string, Promise<Texture | null>>();
  private basePath: string;
  private currentZoom = 1;
  /** Track PixiJS Assets cache aliases for proper cleanup */
  private loadedAssetAliases = new Set<string>();

  constructor(_renderer: Renderer, basePath = "/assets/spritesheets") {
    this.basePath = basePath;
  }

  /**
   * Set the current zoom level for SVG rasterization.
   * This determines the resolution at which SVGs are rendered.
   */
  setZoom(zoom: number): void {
    this.currentZoom = zoom;
  }

  /**
   * Get the current zoom level
   */
  getZoom(): number {
    return this.currentZoom;
  }

  /**
   * Estimate memory usage for a texture in bytes
   */
  private estimateTextureMemory(texture: Texture): number {
    const width = texture.frame?.width ?? texture.width ?? 0;
    const height = texture.frame?.height ?? texture.height ?? 0;
    return width * height * LRU_CACHE_CONFIG.bytesPerPixel;
  }

  /**
   * Add entry to LRU frame cache, evicting old entries if needed
   */
  private addToFrameCache(key: string, texture: Texture): void {
    const memoryBytes = this.estimateTextureMemory(texture);

    // Evict old entries if cache is too large
    while (
      this.frameCacheMemoryBytes + memoryBytes >
        LRU_CACHE_CONFIG.maxMemoryBytes &&
      this.frameCacheOrder.length > 0
    ) {
      this.evictOldestFrame();
    }

    // Add new entry
    this.frameCache.set(key, { texture, memoryBytes });
    this.frameCacheOrder.push(key);
    this.frameCacheMemoryBytes += memoryBytes;
  }

  /**
   * Get texture from LRU cache, updating access order
   */
  private getFromFrameCache(key: string): Texture | null {
    const entry = this.frameCache.get(key);

    if (!entry) {
      return null;
    }

    // Move to end of order (most recently used)
    const index = this.frameCacheOrder.indexOf(key);

    if (index > -1) {
      this.frameCacheOrder.splice(index, 1);
      this.frameCacheOrder.push(key);
    }

    return entry.texture;
  }

  /**
   * Evict the least recently used frame from cache
   */
  private evictOldestFrame(): void {
    const oldestKey = this.frameCacheOrder.shift();

    if (!oldestKey) {
      return;
    }

    const entry = this.frameCache.get(oldestKey);

    if (entry) {
      this.frameCacheMemoryBytes -= entry.memoryBytes;
      if (!entry.texture.destroyed) {
        entry.texture.destroy(false);
      }
      this.frameCache.delete(oldestKey);
    }
  }

  /**
   * Load tile data (manifest + atlas) for a tile
   * Uses request deduplication to prevent multiple concurrent fetches for the same tile
   */
  private async loadTileData(tileKey: string): Promise<CachedTileData | null> {
    // Return from cache if available
    if (this.tileDataCache.has(tileKey)) {
      return this.tileDataCache.get(tileKey)!;
    }

    // Return pending promise if request is already in-flight
    if (this.pendingTileDataLoads.has(tileKey)) {
      return this.pendingTileDataLoads.get(tileKey)!;
    }

    // Create and cache the loading promise
    const loadPromise = this.doLoadTileData(tileKey);
    this.pendingTileDataLoads.set(tileKey, loadPromise);

    try {
      return await loadPromise;
    } finally {
      this.pendingTileDataLoads.delete(tileKey);
    }
  }

  /**
   * Internal implementation of tile data loading
   */
  private async doLoadTileData(
    tileKey: string
  ): Promise<CachedTileData | null> {
    const [type, idStr] = tileKey.split("_");
    const tilePath = `${this.basePath}/tiles/${type}/${idStr}`;

    try {
      const [manifestRes, atlasRes] = await Promise.all([
        fetch(`${tilePath}/manifest.json`),
        fetch(`${tilePath}/atlas.json`),
      ]);

      if (!manifestRes.ok || !atlasRes.ok) {
        return null;
      }

      const manifest: SpritesheetManifest = await manifestRes.json();
      const atlas: AtlasManifest = await atlasRes.json();

      const data: CachedTileData = {
        manifest,
        atlas,
        baseTextures: new Map(),
      };

      this.tileDataCache.set(tileKey, data);
      return data;
    } catch (e) {
      console.warn(`[AtlasLoader] Failed to load tile data for ${tileKey}:`, e);
      return null;
    }
  }

  /**
   * Get the effective scale for SVG rasterization.
   * Rounds to 2 decimal places to prevent excessive cache entries.
   */
  private getEffectiveZoomKey(): number {
    return Math.round(this.currentZoom * 100) / 100;
  }

  /**
   * Load the base texture for a tile (SVG atlas)
   * Uses request deduplication to prevent multiple concurrent fetches
   * Note: The scale parameter is ignored; currentZoom is used instead for SVG rasterization
   */
  private async loadBaseTexture(
    tileKey: string,
    _scale: number
  ): Promise<Texture | null> {
    const data = await this.loadTileData(tileKey);

    if (!data) {
      return null;
    }

    // Use actual zoom level (rounded) as cache key for crisp SVG rendering at any zoom
    const zoomKey = this.getEffectiveZoomKey();

    // Check if we have a cached texture for this zoom level
    if (data.baseTextures.has(zoomKey)) {
      return data.baseTextures.get(zoomKey)!;
    }

    // Key includes zoom since SVG is rasterized at different zoom levels
    const cacheKey = `${tileKey}:${zoomKey}`;

    // Return pending promise if request is already in-flight
    if (this.pendingBaseTextureLoads.has(cacheKey)) {
      return this.pendingBaseTextureLoads.get(cacheKey)!;
    }

    // Create and cache the loading promise
    const loadPromise = this.doLoadBaseTexture(tileKey, zoomKey, data);
    this.pendingBaseTextureLoads.set(cacheKey, loadPromise);

    try {
      return await loadPromise;
    } finally {
      this.pendingBaseTextureLoads.delete(cacheKey);
    }
  }

  /**
   * Internal implementation of base texture loading
   * Uses the custom svgStrokeLoader to handle __RESOLUTION__ placeholder replacement
   */
  private async doLoadBaseTexture(
    tileKey: string,
    zoomKey: number,
    data: CachedTileData
  ): Promise<Texture | null> {
    // Use actual zoom level for pixel-perfect SVG rasterization
    const effectiveScale =
      Math.max(window.devicePixelRatio, 1.1) * this.currentZoom;
    const [type, idStr] = tileKey.split("_");

    // Add resolution as query param to bust PixiJS cache (it caches by src URL)
    const svgPath = `${this.basePath}/tiles/${type}/${idStr}/atlas.svg?r=${effectiveScale}`;

    // Use unique alias to prevent PixiJS cache conflicts between different scales
    const cacheAlias = `${tileKey}:svg:${effectiveScale}`;

    try {
      const texture = await Assets.load({
        alias: cacheAlias,
        src: svgPath,
        parser: "loadSvgStroke",
        data: {
          resolution: effectiveScale,
        },
      });

      // Track the alias for proper cleanup later
      this.loadedAssetAliases.add(cacheAlias);
      data.baseTextures.set(zoomKey, texture);

      return texture;
    } catch (e) {
      console.warn(`[AtlasLoader] Failed to load SVG for ${tileKey}:`, e);
      return null;
    }
  }

  async loadTileManifest(tileKey: string): Promise<TileManifest | null> {
    if (this.tileManifestCache.has(tileKey)) {
      return this.tileManifestCache.get(tileKey)!;
    }

    const data = await this.loadTileData(tileKey);

    if (!data) {
      return null;
    }

    const [type] = tileKey.split("_");
    const tileManifest = this.convertToTileManifest(
      data,
      type as "ground" | "objects"
    );
    this.tileManifestCache.set(tileKey, tileManifest);
    return tileManifest;
  }

  /**
   * Convert spritesheet format to TileManifest format
   */
  private convertToTileManifest(
    data: CachedTileData,
    type: "ground" | "objects"
  ): TileManifest {
    const { manifest, atlas } = data;

    let behavior: string | null = null;
    if (atlas.frames.length > 1) {
      behavior = "animated";
    }

    const firstFrame = atlas.frames[0];
    const spriteWidth = firstFrame?.width ?? atlas.width;
    const spriteHeight = firstFrame?.height ?? atlas.height;

    const frames: FrameInfo[] = atlas.frames.map((f, index) => ({
      frame: index,
      x: f.x,
      y: f.y,
      w: f.width,
      h: f.height,
      ox: f.offsetX,
      oy: f.offsetY,
    }));

    return {
      id: parseInt(manifest.spriteId, 10),
      type,
      behavior,
      fps: atlas.fps ?? null,
      autoplay: true,
      loop: true,
      frameCount: atlas.frames.length,
      width: spriteWidth,
      height: spriteHeight,
      offsetX: atlas.offsetX ?? 0,
      offsetY: atlas.offsetY ?? 0,
      frames,
    };
  }

  async loadFrame(
    tileKey: string,
    frameIndex: number,
    scale: number
  ): Promise<Texture | null> {
    // Use actual zoom level for cache key (not the discrete scale parameter)
    const zoomKey = this.getEffectiveZoomKey();
    const cacheKey = `${tileKey}:${zoomKey}:${frameIndex}`;

    // Check LRU cache first
    const cachedTexture = this.getFromFrameCache(cacheKey);

    if (cachedTexture) {
      return cachedTexture;
    }

    const data = await this.loadTileData(tileKey);

    if (!data) {
      return null;
    }

    const baseTexture = await this.loadBaseTexture(tileKey, scale);

    if (!baseTexture || !baseTexture.source) {
      return null;
    }

    const { atlas } = data;
    const frame = atlas.frames[frameIndex];

    if (!frame) {
      return null;
    }

    // Get source dimensions - these match atlas.json at 1x
    const sourceWidth = baseTexture.source.width;
    const sourceHeight = baseTexture.source.height;
    const actualScale = sourceWidth / atlas.width;

    // Scale frame coordinates to pixel space
    const frameX = Math.round(frame.x * actualScale);
    const frameY = Math.round(frame.y * actualScale);
    let frameW = Math.round(frame.width * actualScale);
    let frameH = Math.round(frame.height * actualScale);

    // Clamp to texture bounds
    if (frameX + frameW > sourceWidth) {
      frameW = Math.floor(sourceWidth - frameX);
    }
    if (frameY + frameH > sourceHeight) {
      frameH = Math.floor(sourceHeight - frameY);
    }

    if (frameW <= 0 || frameH <= 0) {
      return null;
    }

    const texture = new Texture({
      source: baseTexture.source,
      frame: new Rectangle(frameX, frameY, frameW, frameH),
    });

    // Add to LRU cache
    this.addToFrameCache(cacheKey, texture);
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

    // Load all frames in parallel for better performance
    const framePromises = Array.from({ length: tile.frameCount }, (_, i) =>
      this.loadFrame(tileKey, i, scale)
    );

    const frameResults = await Promise.all(framePromises);

    // Filter out null results while preserving order
    const textures: Texture[] = [];

    for (const texture of frameResults) {
      if (texture) {
        textures.push(texture);
      }
    }

    return textures;
  }

  getTileManifest(tileKey: string): TileManifest | undefined {
    return this.tileManifestCache.get(tileKey);
  }

  clearFrameCache(): void {
    // Use destroy(false) to not destroy the shared base texture source
    // The base texture will be destroyed separately when needed
    for (const entry of this.frameCache.values()) {
      if (!entry.texture.destroyed) {
        entry.texture.destroy(false);
      }
    }
    this.frameCache.clear();
    this.frameCacheOrder = [];
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

  clearCache(): void {
    this.clearFrameCache();

    for (const data of this.tileDataCache.values()) {
      for (const texture of data.baseTextures.values()) {
        if (!texture.destroyed) {
          texture.destroy(true);
        }
      }
      data.baseTextures.clear();
    }

    // Unload from PixiJS Assets cache to prevent stale references
    for (const alias of this.loadedAssetAliases) {
      Assets.unload(alias);
    }
    this.loadedAssetAliases.clear();

    this.tileDataCache.clear();
    this.tileManifestCache.clear();
  }

  /**
   * Clear only textures for a specific zoom level (useful when zoom changes)
   */
  clearZoomCache(zoom: number): void {
    const zoomKey = Math.round(zoom * 100) / 100;

    // Clear frame cache entries for this zoom
    for (const [key, entry] of this.frameCache.entries()) {
      if (key.includes(`:${zoomKey}:`)) {
        if (!entry.texture.destroyed) {
          entry.texture.destroy(false);
        }
        this.frameCacheMemoryBytes -= entry.memoryBytes;
        this.frameCache.delete(key);

        // Remove from order array
        const orderIndex = this.frameCacheOrder.indexOf(key);

        if (orderIndex > -1) {
          this.frameCacheOrder.splice(orderIndex, 1);
        }
      }
    }

    // Clear base textures for this zoom
    for (const data of this.tileDataCache.values()) {
      const texture = data.baseTextures.get(zoomKey);

      if (texture && !texture.destroyed) {
        texture.destroy(true);
        data.baseTextures.delete(zoomKey);
      }
    }
  }

  /**
   * @deprecated Use clearZoomCache instead
   */
  clearScaleCache(scale: number): void {
    this.clearZoomCache(scale);
  }
}
