import { Rectangle, type Renderer, Texture } from "pixi.js";

import type { FrameInfo, TileBehavior, TileManifest } from "@/types";
import { createLogger } from "@/utils/logger";

import { getLoadProgress } from "./load-progress";
import { AtlasCache, type AtlasManifest, type CachedTileData, type SpritesheetManifest } from "./atlas-cache";

const log = createLogger("AtlasLoader");
import { loadSvg } from "./load-svg";
import { registerSvgStrokeLoader } from "./svg-stroke-loader";

// Register the custom SVG loader on module load
registerSvgStrokeLoader();

export class AtlasLoader {
  private cache: AtlasCache;
  private pendingTileDataLoads = new Map<
    string,
    Promise<CachedTileData | null>
  >();
  private pendingBaseTextureLoads = new Map<string, Promise<Texture[] | null>>();
  private basePath: string;
  private currentZoom = 1;

  constructor(_renderer: Renderer, basePath = "/assets/spritesheets") {
    this.basePath = basePath;
    this.cache = new AtlasCache();
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
   * Load tile data (manifest + atlas) for a tile
   * Uses request deduplication to prevent multiple concurrent fetches for the same tile
   */
  private async loadTileData(tileKey: string): Promise<CachedTileData | null> {
    // Return from cache if available
    if (this.cache.hasTileData(tileKey)) {
      return this.cache.getTileData(tileKey)!;
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

      this.cache.setTileData(tileKey, data);
      return data;
    } catch (e) {
      log.warn(`Failed to load tile data for ${tileKey}:`, e);
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
   * Load the base texture(s) for a tile (SVG atlas).
   * Returns array of textures (one per page).
   * Uses request deduplication to prevent multiple concurrent fetches.
   */
  private async loadBaseTextures(
    tileKey: string,
    _scale: number
  ): Promise<Texture[] | null> {
    const data = await this.loadTileData(tileKey);

    if (!data) {
      return null;
    }

    // Use actual zoom level (rounded) as cache key for crisp SVG rendering at any zoom
    const zoomKey = this.getEffectiveZoomKey();

    // Check if we have cached textures for this zoom level
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
    const loadPromise = this.doLoadBaseTextures(tileKey, zoomKey, data);
    this.pendingBaseTextureLoads.set(cacheKey, loadPromise);

    try {
      return await loadPromise;
    } finally {
      this.pendingBaseTextureLoads.delete(cacheKey);
    }
  }

  /**
   * Internal implementation of base texture loading.
   * Loads all page SVGs (single or multi-page).
   */
  private async doLoadBaseTextures(
    tileKey: string,
    zoomKey: number,
    data: CachedTileData
  ): Promise<Texture[] | null> {
    // WebGPU max texture size (conservative - most GPUs support 8192, some 16384)
    const MAX_TEXTURE_SIZE = 8192;
    const [type, idStr] = tileKey.split("_");
    const rawScale = Math.max(window.devicePixelRatio, 1.1) * this.currentZoom;

    const pages = data.atlas.pages;

    try {
      let textures: Texture[];

      if (pages && pages.length > 1) {
        // Multi-page: load each page SVG in parallel
        textures = await Promise.all(
          pages.map(async (page, i) => {
            const pageDim = Math.max(page.width, page.height);
            const maxSafeScale = pageDim > 0 ? MAX_TEXTURE_SIZE / pageDim : 10;
            const effectiveScale = Math.min(rawScale, maxSafeScale);
            const alias = `${tileKey}:svg:${i}:${effectiveScale}`;
            const texture = await loadSvg(
              `${this.basePath}/tiles/${type}/${idStr}/${page.file}`,
              effectiveScale,
              alias,
            );
            this.cache.registerAssetAlias(alias);
            return texture;
          })
        );
      } else {
        // Single page
        const atlasWidth = data.atlas.width;
        const atlasHeight = data.atlas.height;
        const maxDimension = Math.max(atlasWidth, atlasHeight);
        const maxSafeScale = maxDimension > 0 ? MAX_TEXTURE_SIZE / maxDimension : 10;
        const effectiveScale = Math.min(rawScale, maxSafeScale);
        const cacheAlias = `${tileKey}:svg:${effectiveScale}`;

        const texture = await loadSvg(
          `${this.basePath}/tiles/${type}/${idStr}/atlas.svg`,
          effectiveScale,
          cacheAlias,
        );
        this.cache.registerAssetAlias(cacheAlias);
        textures = [texture];
      }

      data.baseTextures.set(zoomKey, textures);
      return textures;
    } catch (e) {
      log.warn(`Failed to load SVG for ${tileKey}:`, e);
      return null;
    }
  }

  async loadTileManifest(tileKey: string): Promise<TileManifest | null> {
    if (this.cache.hasTileManifest(tileKey)) {
      return this.cache.getTileManifest(tileKey)!;
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
    this.cache.setTileManifest(tileKey, tileManifest);
    return tileManifest;
  }

  /**
   * Convert spritesheet format to TileManifest format.
   *
   * Behavior is read from the manifest (embedded by the spritesheet compiler
   * from tile-classifications.json). Falls back to a safe heuristic if missing:
   * - 1 frame → static
   * - ground + multi-frame → slope
   * - objects + multi-frame → random (safe default, avoids flicker)
   */
  private convertToTileManifest(
    data: CachedTileData,
    type: "ground" | "objects"
  ): TileManifest {
    const { manifest, atlas } = data;

    // Use classified behavior from manifest if available
    let behavior: TileBehavior = "static";

    if (manifest.behavior) {
      behavior = manifest.behavior;
    } else if (atlas.frames.length > 1) {
      // Fallback heuristic: default objects to "random" (safe — no flicker)
      behavior = type === "ground" ? "slope" : "random";
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
      ...(f.page != null && f.page > 0 ? { page: f.page } : {}),
    }));

    // Convert base frame if present (base/delta splitting)
    let baseFrame: FrameInfo | undefined;
    if (atlas.baseFrame) {
      const bf = atlas.baseFrame;
      baseFrame = {
        frame: -1,
        x: bf.x,
        y: bf.y,
        w: bf.width,
        h: bf.height,
        ox: bf.offsetX,
        oy: bf.offsetY,
      };
    }

    return {
      id: parseInt(manifest.spriteId, 10),
      type,
      behavior,
      fps: manifest.fps_hint ?? atlas.fps ?? null,
      autoplay: manifest.autoplay ?? true,
      loop: manifest.loop ?? true,
      frameCount: atlas.frames.length,
      width: spriteWidth,
      height: spriteHeight,
      offsetX: atlas.offsetX ?? 0,
      offsetY: atlas.offsetY ?? 0,
      frames,
      baseFrame,
      baseZOrder: atlas.baseZOrder,
      pages: atlas.pages,
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
    const cachedTexture = this.cache.getFromFrameCache(cacheKey);

    if (cachedTexture) {
      return cachedTexture;
    }

    const data = await this.loadTileData(tileKey);

    if (!data) {
      return null;
    }

    const baseTextures = await this.loadBaseTextures(tileKey, scale);

    if (!baseTextures || baseTextures.length === 0) {
      return null;
    }

    const { atlas } = data;
    const frame = atlas.frames[frameIndex];

    if (!frame) {
      return null;
    }

    // Select the correct page texture
    const pageIndex = frame.page ?? 0;
    const baseTexture = baseTextures[pageIndex];
    if (!baseTexture?.source) return null;

    // Get page dimensions for scale calculation
    const pageInfo = atlas.pages?.[pageIndex];
    const pageWidth = pageInfo?.width ?? atlas.width;

    // Get source dimensions - these match atlas.json at 1x
    const sourceWidth = baseTexture.source.width;
    const sourceHeight = baseTexture.source.height;
    const actualScale = sourceWidth / pageWidth;

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
    return this.cache.getTileManifest(tileKey);
  }

  /**
   * Get tile manifest synchronously from cache.
   * Returns null if data not cached. Call prefetchTiles() first to populate.
   */
  getTileManifestSync(tileKey: string): TileManifest | null {
    if (this.cache.hasTileManifest(tileKey)) {
      return this.cache.getTileManifest(tileKey)!;
    }

    // Try to compute from tile data cache
    const data = this.cache.getTileData(tileKey);

    if (!data) {
      return null;
    }

    const [type] = tileKey.split("_");
    const tileManifest = this.convertToTileManifest(
      data,
      type as "ground" | "objects"
    );

    this.cache.setTileManifest(tileKey, tileManifest);
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
    const cachedTexture = this.cache.getFromFrameCache(cacheKey);

    if (cachedTexture) {
      return cachedTexture;
    }

    // Get from sync caches (populated by prefetchTiles)
    const data = this.cache.getTileData(tileKey);

    if (!data) {
      return null;
    }

    const baseTextures = data.baseTextures.get(zoomKey);

    if (!baseTextures || baseTextures.length === 0) {
      return null;
    }

    const { atlas } = data;
    const frame = atlas.frames[frameIndex];

    if (!frame) {
      return null;
    }

    // Select the correct page texture
    const pageIndex = frame.page ?? 0;
    const baseTexture = baseTextures[pageIndex];
    if (!baseTexture?.source) return null;

    // Get page dimensions for scale calculation
    const pageInfo = atlas.pages?.[pageIndex];
    const pageWidth = pageInfo?.width ?? atlas.width;

    // Scale frame coordinates to pixel space
    const sourceWidth = baseTexture.source.width;
    const sourceHeight = baseTexture.source.height;
    const actualScale = sourceWidth / pageWidth;

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
    this.cache.addToFrameCache(cacheKey, texture);
    return texture;
  }

  /**
   * Load the base frame texture for base/delta split tiles.
   * Returns null if the tile has no base frame or data isn't cached.
   */
  loadBaseFrameSync(tileKey: string): Texture | null {
    const zoomKey = this.getEffectiveZoomKey();
    const cacheKey = `${tileKey}:${zoomKey}:__base__`;

    const cachedTexture = this.cache.getFromFrameCache(cacheKey);
    if (cachedTexture) return cachedTexture;

    const data = this.cache.getTileData(tileKey);
    if (!data) return null;

    const bf = data.atlas.baseFrame;
    if (!bf) return null;

    const baseTextures = data.baseTextures.get(zoomKey);
    if (!baseTextures || baseTextures.length === 0) return null;

    // Select the correct page texture for the base frame
    const pageIndex = bf.page ?? 0;
    const baseTexture = baseTextures[pageIndex];
    if (!baseTexture?.source) return null;

    const pageInfo = data.atlas.pages?.[pageIndex];
    const pageWidth = pageInfo?.width ?? data.atlas.width;

    const sourceWidth = baseTexture.source.width;
    const sourceHeight = baseTexture.source.height;
    const actualScale = sourceWidth / pageWidth;

    const frameX = Math.round(bf.x * actualScale);
    const frameY = Math.round(bf.y * actualScale);
    let frameW = Math.round(bf.width * actualScale);
    let frameH = Math.round(bf.height * actualScale);

    if (frameX + frameW > sourceWidth) frameW = Math.floor(sourceWidth - frameX);
    if (frameY + frameH > sourceHeight) frameH = Math.floor(sourceHeight - frameY);
    if (frameW <= 0 || frameH <= 0) return null;

    const texture = new Texture({
      source: baseTexture.source,
      frame: new Rectangle(frameX, frameY, frameW, frameH),
    });

    this.cache.addToFrameCache(cacheKey, texture);
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
    const progress = getLoadProgress();
    const total = tileKeys.length;
    let loaded = 0;

    // Each tile loads its own JSON then immediately loads its SVG — all tiles in parallel.
    // This eliminates the waterfall where ALL JSON had to finish before ANY SVG could start.
    await Promise.all(
      tileKeys.map(async (key) => {
        await this.loadTileData(key);
        await this.loadBaseTextures(key, scale);
        this.getTileManifestSync(key);
        loaded++;
        progress.report("map-tiles", loaded, total);
      })
    );
  }

  clearFrameCache(): void {
    this.cache.clearFrameCache();
  }

  /**
   * Get current frame cache memory usage in bytes
   */
  getFrameCacheMemoryBytes(): number {
    return this.cache.getFrameCacheMemoryBytes();
  }

  /**
   * Get current frame cache entry count
   */
  getFrameCacheEntryCount(): number {
    return this.cache.getFrameCacheEntryCount();
  }

  clearCache(): void {
    this.cache.clearAll();
  }

  /**
   * Clear only textures for a specific zoom level (useful when zoom changes)
   * Does NOT destroy textures - lets GC handle cleanup to avoid GPU conflicts
   */
  clearZoomCache(zoom: number): void {
    this.cache.clearZoomLevel(zoom);
  }

  /**
   * @deprecated Use clearZoomCache instead
   */
  clearScaleCache(scale: number): void {
    this.clearZoomCache(scale);
  }
}
