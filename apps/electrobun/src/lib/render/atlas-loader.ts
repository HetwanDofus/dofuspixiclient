import { Assets, Rectangle, type Renderer, Texture } from "pixi.js";

import type { FrameInfo, TileManifest } from "@/types";

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

export class AtlasLoader {
  private frameCache = new Map<string, Texture>();
  private tileDataCache = new Map<string, CachedTileData>();
  private tileManifestCache = new Map<string, TileManifest>();
  private basePath: string;
  private currentScale = 2;

  constructor(_renderer: Renderer, basePath = "/assets/spritesheets") {
    this.basePath = basePath;
  }

  /**
   * Load tile data (manifest + atlas) for a tile
   */
  private async loadTileData(tileKey: string): Promise<CachedTileData | null> {
    if (this.tileDataCache.has(tileKey)) {
      return this.tileDataCache.get(tileKey)!;
    }

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
   * Load the base texture for a tile (SVG atlas)
   */
  private async loadBaseTexture(
    tileKey: string,
    scale: number
  ): Promise<Texture | null> {
    const data = await this.loadTileData(tileKey);

    if (!data) {
      return null;
    }

    // Check if we have a cached texture for this scale
    if (data.baseTextures.has(scale)) {
      return data.baseTextures.get(scale)!;
    }

    const [type, idStr] = tileKey.split("_");
    const svgPath = `${this.basePath}/tiles/${type}/${idStr}/atlas.svg`;
    const svgUrl = `${svgPath}?strokeScale=${scale}`;

    try {
      const texture = await Assets.load({
        src: svgUrl,
        data: { resolution: scale },
      });
      data.baseTextures.set(scale, texture);
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
    const cacheKey = `${tileKey}:${scale}:${frameIndex}`;

    if (this.frameCache.has(cacheKey)) {
      return this.frameCache.get(cacheKey)!;
    }

    const data = await this.loadTileData(tileKey);

    if (!data) {
      return null;
    }

    const baseTexture = await this.loadBaseTexture(tileKey, scale);

    if (!baseTexture) {
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

    this.frameCache.set(cacheKey, texture);
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

    const textures: Texture[] = [];

    for (let i = 0; i < tile.frameCount; i++) {
      const texture = await this.loadFrame(tileKey, i, scale);

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
    for (const texture of this.frameCache.values()) {
      if (!texture.destroyed) {
        texture.destroy(false);
      }
    }
    this.frameCache.clear();
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

    this.tileDataCache.clear();
    this.tileManifestCache.clear();
  }

  /**
   * Clear only textures for a specific scale (useful when scale changes)
   */
  clearScaleCache(scale: number): void {
    // Clear frame cache entries for this scale
    for (const [key, texture] of this.frameCache.entries()) {
      if (key.includes(`:${scale}:`)) {
        if (!texture.destroyed) {
          texture.destroy(false);
        }
        this.frameCache.delete(key);
      }
    }

    // Clear base textures for this scale
    for (const data of this.tileDataCache.values()) {
      const texture = data.baseTextures.get(scale);
      if (texture && !texture.destroyed) {
        texture.destroy(true);
        data.baseTextures.delete(scale);
      }
    }
  }
}
