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
  private getFromFrameCache(key: string): Texture | null {
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
      const res = await fetch(`${tilePath}/manifest.json`);
      if (!res.ok) return null;

      const manifest: SpritesheetManifest = await res.json();
      const animName = Object.keys(manifest.animations)[0];
      const atlas = manifest.animations[animName] as AtlasManifest;

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
    // WebGPU max texture size (conservative - most GPUs support 8192, some 16384)
    const MAX_TEXTURE_SIZE = 8192;

    // Calculate max safe scale based on atlas dimensions
    const atlasWidth = data.atlas.width;
    const atlasHeight = data.atlas.height;
    const maxDimension = Math.max(atlasWidth, atlasHeight);
    const maxSafeScale = maxDimension > 0 ? MAX_TEXTURE_SIZE / maxDimension : 10;

    // Use actual zoom level for pixel-perfect SVG rasterization
    // Cap to prevent exceeding WebGPU texture size limits
    const rawScale = Math.max(window.devicePixelRatio, 1.1) * this.currentZoom;
    const effectiveScale = Math.min(rawScale, maxSafeScale);
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

  /**
   * Get tile manifest synchronously from cache.
   * Returns null if data not cached. Call prefetchTiles() first to populate.
   */
  getTileManifestSync(tileKey: string): TileManifest | null {
    if (this.tileManifestCache.has(tileKey)) {
      return this.tileManifestCache.get(tileKey)!;
    }

    // Try to compute from tile data cache
    const data = this.tileDataCache.get(tileKey);

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
   * Load a frame texture synchronously from cache.
   * Returns null if base texture not cached. Call prefetchTiles() first.
   */
  loadFrameSync(
    tileKey: string,
    frameIndex: number,
    _scale: number
  ): Texture | null {
    const zoomKey = this.getEffectiveZoomKey();
    const cacheKey = `${tileKey}:${zoomKey}:${frameIndex}`;

    // Check LRU cache first
    const cachedTexture = this.getFromFrameCache(cacheKey);

    if (cachedTexture) {
      return cachedTexture;
    }

    // Get from sync caches (populated by prefetchTiles)
    const data = this.tileDataCache.get(tileKey);

    if (!data) {
      return null;
    }

    const baseTexture = data.baseTextures.get(zoomKey);

    if (!baseTexture || !baseTexture.source) {
      return null;
    }

    const { atlas } = data;
    const frame = atlas.frames[frameIndex];

    if (!frame) {
      return null;
    }

    // Scale frame coordinates to pixel space
    const sourceWidth = baseTexture.source.width;
    const sourceHeight = baseTexture.source.height;
    const actualScale = sourceWidth / atlas.width;

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

  /**
   * Load animation frames synchronously from cache.
   * Returns empty array if not cached. Call prefetchTiles() first.
   */
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
   * Prefetch tile data and base textures for multiple tiles in parallel.
   * Call before rendering to avoid sequential loading waterfalls.
   * After prefetch, use sync methods (loadFrameSync, getTileManifestSync) for zero-overhead access.
   */
  async prefetchTiles(tileKeys: string[], scale: number): Promise<void> {
    // Each tile loads its own JSON then immediately loads its SVG — all tiles in parallel.
    // This eliminates the waterfall where ALL JSON had to finish before ANY SVG could start.
    await Promise.all(
      tileKeys.map(async (key) => {
        await this.loadTileData(key);
        await this.loadBaseTexture(key, scale);
        this.getTileManifestSync(key);
      })
    );
  }

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

  clearCache(): void {
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
   * Clear only textures for a specific zoom level (useful when zoom changes)
   * Does NOT destroy textures - lets GC handle cleanup to avoid GPU conflicts
   */
  clearZoomCache(zoom: number): void {
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

  /**
   * @deprecated Use clearZoomCache instead
   */
  clearScaleCache(scale: number): void {
    this.clearZoomCache(scale);
  }
}
