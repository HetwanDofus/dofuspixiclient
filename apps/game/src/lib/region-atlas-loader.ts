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

	// Common
	w: number;
	h: number;
	dup?: number; // Duplicate of frame index

	// Region-based (legacy "webp-regions" format)
	rs?: number; // Region size
	regions?: FrameRegionRef[];

	// Frame-based ("webp-frames" format)
	x?: number;
	y?: number;
	ow?: number;
	oh?: number;
	ox?: number;
	oy?: number;
	atlas?: number; // Atlas index when multiple atlases are used
}

/** Atlas data per scale */
export interface WebpAtlasData {
  width: number;
  height: number;
  file: string;
  files?: string[];
  frames: WebpFrameInfo[];
  supersample?: number;
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
	format: 'webp-regions' | 'webp-frames' | 'individual';
  scales: number[];
  tiles: Record<string, WebpTileData>;
}

/**
 * Efficient loader for WebP atlases from unified manifest.
 * Loads frames from deduplicated WebP atlases based on manifest metadata.
 */
export class RegionAtlasLoader {
  private atlasCache = new Map<string, Texture>();
  private frameCache = new Map<string, Texture>();
  private renderer: Renderer;
  private basePath: string;

  constructor(renderer: Renderer, basePath = '/assets/maps/tiles') {
    this.renderer = renderer;
    this.basePath = basePath;
  }

  /**
   * Load a specific frame of a tile from the unified manifest.
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

	    // Debug: trace which scale is actually used when loading frames.
	    // This only logs on first load per tile/scale/frame, so it shouldn't
	    // spam too much but will confirm that 1.5x / 2x / 3x atlases are used
	    // as expected when zooming.
	    console.log(`[RegionAtlasLoader] loadFrame tile=${tileKey} scale=${scale} frame=${frameIndex}`);

    const tile = manifest.tiles[tileKey];

    if (!tile) {
      console.warn(`Tile not found: ${tileKey}`);
      return null;
    }

    const atlas = tile.atlases[String(scale)];
    if (!atlas) {
      // Try finding the best available scale
      const availableScales = Object.keys(tile.atlases).map(Number).sort((a, b) => a - b);
      console.log(`Scale ${scale} not found for ${tileKey}, available scales:`, availableScales);
      const bestScale = availableScales.find(s => s >= scale) || availableScales[availableScales.length - 1];
      if (bestScale) {
        const bestAtlas = tile.atlases[String(bestScale)];
        if (bestAtlas) {
          console.log(`Using scale ${bestScale} instead of ${scale} for ${tileKey}, supersample=${bestAtlas.supersample}`);
          return this.loadFrameFromAtlas(bestAtlas, frameIndex, scale, cacheKey, manifest);
        }
      }
      console.error(`No atlas found for ${tileKey} at any scale!`);
      return null;
    }

    return this.loadFrameFromAtlas(atlas, frameIndex, scale, cacheKey, manifest);
  }

  /**
   * Load a frame from an atlas (extracted for reuse)
   */
  private async loadFrameFromAtlas(
    atlas: WebpAtlasData,
    frameIndex: number,
    scale: number,
    cacheKey: string,
    manifest: WebpManifest | null,
  ): Promise<Texture | null> {
    const frameInfo = atlas.frames.find((f) => f.frame === frameIndex);
    if (!frameInfo) return null;

    // Handle duplicate frames - reuse the original
    if (frameInfo.dup !== undefined) {
      // For individual manifests, we need to generate a new cache key
      const dupCacheKey = cacheKey.replace(`:${frameIndex}`, `:${frameInfo.dup}`);
      if (this.frameCache.has(dupCacheKey)) {
        return this.frameCache.get(dupCacheKey)!;
      }
      return this.loadFrameFromAtlas(atlas, frameInfo.dup, scale, dupCacheKey, manifest);
    }

		// Frame-based pipeline: direct cropping from WebP atlas (no region slicing)
		// This is used for individual tile manifests or unified manifests with webp-frames format
		if (manifest?.format === 'webp-frames' || manifest?.format === 'individual' || !manifest) {
			const texture = await this.loadAtlasFrame(atlas, frameInfo);
			if (texture) {
				// The supersample factor tells us how many texture pixels = 1 logical unit
				// After PHP fix: texture dimensions = metadata dimensions = logical * supersample
				// So _scale = supersample (not scale * supersample!)
				const supersample = atlas.supersample || 1;
				(texture as any)._scale = supersample;
				console.log(`Set texture._scale = ${supersample} for ${cacheKey}, texture size: ${texture.width}x${texture.height}`);
				this.frameCache.set(cacheKey, texture);
			}
			return texture;
		}

		// Use simpler reconstruction for large tiles (backgrounds, special objects)
		// to avoid gaps from padding removal
		const texture = await this.reconstructFrame(atlas, frameInfo);
    if (texture) {
      (texture as any)._scale = scale;
      this.frameCache.set(cacheKey, texture);
    }
    return texture;
  }

	/**
	 * Load a frame from a standard frame-based atlas (webp-frames format).
	 */
	private async loadAtlasFrame(atlas: WebpAtlasData, frameInfo: WebpFrameInfo): Promise<Texture | null> {
		const atlasTextures = await this.loadAtlasTextures(atlas);
		if (atlasTextures.length === 0) return null;

		const atlasIndex = frameInfo.atlas ?? 0;
		const atlasTexture = atlasTextures[atlasIndex] ?? atlasTextures[0];

		const x = frameInfo.x ?? 0;
		const y = frameInfo.y ?? 0;
		const w = frameInfo.w;
		const h = frameInfo.h;

		// Simple texture without trim - we'll handle offset manually in renderer
		const texture = new Texture({
			source: atlasTexture.source,
			frame: new Rectangle(x, y, w, h),
		});

		// Store trim metadata for manual handling
		(texture as any)._origW = frameInfo.ow ?? w;
		(texture as any)._origH = frameInfo.oh ?? h;
		(texture as any)._trimX = frameInfo.ox ?? 0;
		(texture as any)._trimY = frameInfo.oy ?? 0;

		// Store supersample for proper scaling
		if (atlas.supersample) {
			(texture as any)._supersample = atlas.supersample;
		}

		return texture;
	}

  /**
   * Load all frames for an animated tile from the unified manifest.
   */
  async loadAnimationFrames(
    manifest: WebpManifest,
    tileKey: string,
    scale: number,
  ): Promise<Texture[]> {
    const tile = manifest.tiles[tileKey];

    if (!tile) {
      console.warn(`Tile not found for animation: ${tileKey}`);
      return [];
    }

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
      // Force integer positions to prevent sub-pixel gaps
      sprite.x = Math.round(region.rx * frameInfo.rs);
      sprite.y = Math.round(region.ry * frameInfo.rs);
      container.addChild(sprite);
    }

    // Render to texture with no anti-aliasing
    const renderTexture = RenderTexture.create({
      width: frameInfo.w,
      height: frameInfo.h,
      antialias: false,
    });
	    // Ensure pixel-perfect sampling when this reconstructed texture is scaled
	    // in the main renderer.
	    (renderTexture as any).source.scaleMode = 'nearest';
    this.renderer.render({ container, target: renderTexture, clearColor: [0, 0, 0, 0] });

    // Clean up container (textures are views, not destroyed)
    container.destroy({ children: true, texture: false });

    return renderTexture;
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

