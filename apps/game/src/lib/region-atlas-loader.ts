import { Assets, RenderTexture, Texture, Container, Sprite, Rectangle, type Renderer } from 'pixi.js';

/** Region reference within a frame */
export interface FrameRegionRef {
  rx: number; // Region grid X
  ry: number; // Region grid Y
  ax: number; // Atlas X position
  ay: number; // Atlas Y position
  aw: number; // Atlas content width
  ah: number; // Atlas content height
  ox: number; // Offset X within region
  oy: number; // Offset Y within region
  atlas?: number; // Atlas index if multiple
}

/** Frame info in the manifest */
export interface WebpFrameInfo {
  frame: number;
  w: number;
  h: number;
  rs: number; // Region size
  dup?: number; // Duplicate of frame index
  regions?: FrameRegionRef[];
}

/** Atlas data per scale */
export interface WebpAtlasData {
  width: number;
  height: number;
  file: string;
  files?: string[];
  frames: WebpFrameInfo[];
}

/** Tile data in manifest */
export interface WebpTileData {
  id: number;
  type: 'ground' | 'objects';
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  frameCount: number;
  behavior: string | null;
  fps: number | null;
  autoplay: boolean | null;
  loop: boolean | null;
  atlases: Record<string, WebpAtlasData>;
}

/** Full manifest */
export interface WebpManifest {
  version: 2;
  format: 'webp-regions';
  scales: number[];
  tiles: Record<string, WebpTileData>;
}

/**
 * Efficient loader for region-based WebP atlases.
 * Reconstructs frames from deduplicated regions stored in atlases.
 */
export class RegionAtlasLoader {
  private atlasCache = new Map<string, Texture>();
  private frameCache = new Map<string, Texture>();
  private renderer: Renderer;
  private basePath: string;

  constructor(renderer: Renderer, basePath = '/assets/maps/tilesv4') {
    this.renderer = renderer;
    this.basePath = basePath;
  }

  /**
   * Load a specific frame of a tile.
   */
  async loadFrame(
    manifest: WebpManifest,
    tileKey: string,
    frameIndex: number,
    scale: number,
  ): Promise<Texture | null> {
    const cacheKey = `${tileKey}:${scale}:${frameIndex}`;
    if (this.frameCache.has(cacheKey)) {
      return this.frameCache.get(cacheKey)!;
    }

    const tile = manifest.tiles[tileKey];
    if (!tile) return null;

    const atlas = tile.atlases[String(scale)];
    if (!atlas) return null;

    const frameInfo = atlas.frames.find((f) => f.frame === frameIndex);
    if (!frameInfo) return null;

    // Handle duplicate frames - reuse the original
    if (frameInfo.dup !== undefined) {
      return this.loadFrame(manifest, tileKey, frameInfo.dup, scale);
    }

    // Special case for tile 120 - use simpler reconstruction method
    if (tileKey === 'objects_120') {
      const texture = await this.reconstructFrameSimple(atlas, frameInfo);
      if (texture) {
        (texture as any)._scale = scale;
        this.frameCache.set(cacheKey, texture);
      }
      return texture;
    }

    const texture = await this.reconstructFrame(atlas, frameInfo);
    if (texture) {
      (texture as any)._scale = scale;
      this.frameCache.set(cacheKey, texture);
    }
    return texture;
  }

  /**
   * Load all frames for an animated tile.
   */
  async loadAnimationFrames(
    manifest: WebpManifest,
    tileKey: string,
    scale: number,
  ): Promise<Texture[]> {
    const tile = manifest.tiles[tileKey];
    if (!tile) return [];

    const textures: Texture[] = [];
    for (let i = 0; i < tile.frameCount; i++) {
      const texture = await this.loadFrame(manifest, tileKey, i, scale);
      if (texture) textures.push(texture);
    }
    return textures;
  }

  private async reconstructFrame(atlas: WebpAtlasData, frameInfo: WebpFrameInfo): Promise<Texture | null> {
    if (!frameInfo.regions || frameInfo.regions.length === 0) {
      return null;
    }

    // Load atlas texture(s)
    const atlasTextures = await this.loadAtlasTextures(atlas);
    if (atlasTextures.length === 0) return null;

    // Create container to composite regions
    const container = new Container();

    for (const region of frameInfo.regions) {
      const atlasTexture = atlasTextures[region.atlas ?? 0];
      if (!atlasTexture) continue;

      // Calculate inner content dimensions (remove border padding)
      const innerX = region.ax + region.ox;
      const innerY = region.ay + region.oy;
      const innerW = region.aw - region.ox * 2;
      const innerH = region.ah - region.oy * 2;

      // Skip invalid regions
      if (innerW <= 0 || innerH <= 0) continue;

      const regionTexture = new Texture({
        source: atlasTexture.source,
        frame: new Rectangle(innerX, innerY, innerW, innerH),
      });

      // Position in final frame
      const sprite = new Sprite(regionTexture);
      sprite.roundPixels = true;
      sprite.x = region.rx * frameInfo.rs;
      sprite.y = region.ry * frameInfo.rs;
      container.addChild(sprite);
    }

    // Render to texture with no anti-aliasing
    const renderTexture = RenderTexture.create({
      width: frameInfo.w,
      height: frameInfo.h,
      antialias: false,
    });
    this.renderer.render({ container, target: renderTexture, clearColor: [0, 0, 0, 0] });

    // Clean up container (textures are views, not destroyed)
    container.destroy({ children: true, texture: false });

    return renderTexture;
  }

  /**
   * Simplified frame reconstruction - extract full regions with padding instead of trimming.
   * Used for tiles that have issues with the standard reconstruction.
   */
  private async reconstructFrameSimple(atlas: WebpAtlasData, frameInfo: WebpFrameInfo): Promise<Texture | null> {
    if (!frameInfo.regions || frameInfo.regions.length === 0) {
      return null;
    }

    // Load atlas texture(s)
    const atlasTextures = await this.loadAtlasTextures(atlas);
    if (atlasTextures.length === 0) return null;

    // Create container to composite regions
    const container = new Container();

    for (const region of frameInfo.regions) {
      const atlasTexture = atlasTextures[region.atlas ?? 0];
      if (!atlasTexture) continue;

      // Extract the FULL region WITH padding
      const regionTexture = new Texture({
        source: atlasTexture.source,
        frame: new Rectangle(region.ax, region.ay, region.aw, region.ah),
      });

      // Position in final frame at grid coordinates
      // Include the padding offset since we're extracting the full region with padding
      const sprite = new Sprite(regionTexture);
      sprite.roundPixels = true;
      sprite.blendMode = 'normal';
      sprite.x = region.rx * frameInfo.rs;
      sprite.y = region.ry * frameInfo.rs;
      container.addChild(sprite);
    }

    // Render to texture with proper alpha handling
    const renderTexture = RenderTexture.create({
      width: frameInfo.w,
      height: frameInfo.h,
      antialias: false,
      resolution: 1,
    });
    this.renderer.render({
      container,
      target: renderTexture,
      clearColor: { r: 0, g: 0, b: 0, a: 0 }
    });

    // Clean up container (textures are views, not destroyed)
    container.destroy({ children: true, texture: false });

    return renderTexture;
  }

  /**
   * Load frame directly from atlas without region reconstruction.
   * Used for tiles that have issues with region extraction.
   */
  private async loadDirectFrame(atlas: WebpAtlasData, frameInfo: WebpFrameInfo): Promise<Texture | null> {
    const atlasTextures = await this.loadAtlasTextures(atlas);
    if (atlasTextures.length === 0) return null;

    const atlasTexture = atlasTextures[0];

    // Create a texture from the full frame bounds in the atlas
    const texture = new Texture({
      source: atlasTexture.source,
      frame: new Rectangle(0, 0, frameInfo.w, frameInfo.h),
    });

    return texture;
  }

  private async loadAtlasTextures(atlas: WebpAtlasData): Promise<Texture[]> {
    const files = atlas.files ?? [atlas.file];
    const textures: Texture[] = [];

    for (const file of files) {
      const cacheKey = `atlas:${file}`;
      if (this.atlasCache.has(cacheKey)) {
        textures.push(this.atlasCache.get(cacheKey)!);
        continue;
      }

      try {
        const texture = await Assets.load(`${this.basePath}/${file}`);
        // Ensure nearest neighbor filtering to avoid bleeding
        texture.source.scaleMode = 'nearest';
        this.atlasCache.set(cacheKey, texture);
        textures.push(texture);
      } catch (err) {
        console.warn(`Failed to load atlas: ${file}`, err);
      }
    }

    return textures;
  }

  /** Clear frame cache to free memory (keeps atlas textures). */
  clearFrameCache(): void {
    for (const texture of this.frameCache.values()) {
      texture.destroy(true);
    }
    this.frameCache.clear();
  }

  /** Clear all caches. */
  clearCache(): void {
    this.clearFrameCache();
    this.atlasCache.clear();
  }
}

