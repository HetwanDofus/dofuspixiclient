import { AnimatedSprite, Container, type Sprite } from "pixi.js";

import type { AtlasLoader } from "@/game/render/atlas-loader";
import { createLogger } from "@/utils/logger";

const log = createLogger("MapHandler");

import type { MapData, MapScale } from "@/game/datacenter/map";
import type { Scene } from "@/game/scene/scene";
import { computeMapScale } from "@/game/datacenter";
import { getCellPosition } from "@/game/datacenter/cell";
import { TileLayerBuilder } from "@/game/scene/tiles/layer-builder";

export interface MapHandlerConfig {
  atlasLoader: AtlasLoader;
  interactiveGfxIds?: Set<number>;
  onSpriteCreated?: (
    sprite: Sprite,
    tileId: number,
    cellId: number,
    layer: number,
    rotation: number,
    flip: boolean,
    groundSlope?: number
  ) => void;
  /** Optional Scene — when provided, every rendered tile is registered as a TileActor. */
  scene?: Scene;
}

/**
 * Viewport bounds for culling
 */
export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class MapHandler {
  private atlasLoader: AtlasLoader;
  private layerBuilder: TileLayerBuilder;

  // Opt #5: Persistent container layers — created once, reused across renders
  private backgroundLayer = new Container();
  private groundLayer = new Container();
  private objectLayer1 = new Container();
  private objectLayer2 = new Container();
  private layersInitialized = false;

  constructor(config: MapHandlerConfig) {
    this.atlasLoader = config.atlasLoader;
    const interactiveGfxIds = config.interactiveGfxIds ?? new Set();

    this.layerBuilder = new TileLayerBuilder(
      this.atlasLoader,
      interactiveGfxIds,
      config.onSpriteCreated,
      config.scene ?? null
    );

    // Opt #5: Configure sortable once
    this.groundLayer.sortableChildren = true;
    this.objectLayer1.sortableChildren = true;
    this.objectLayer2.sortableChildren = true;
  }

  /**
   * Check if a cell is within the viewport bounds (with margin)
   */
  private isCellInViewport(
    cellPosition: { x: number; y: number },
    viewport: Viewport | null,
    mapScale: MapScale,
    margin = 100
  ): boolean {
    // If no viewport, render all cells
    if (!viewport) {
      return true;
    }

    // Apply map scale offset to cell position
    const cellX = cellPosition.x * mapScale.scale + mapScale.offsetX;
    const cellY = cellPosition.y * mapScale.scale + mapScale.offsetY;

    // Check with margin to prevent popping at edges
    return (
      cellX >= viewport.x - margin &&
      cellX <= viewport.x + viewport.width + margin &&
      cellY >= viewport.y - margin &&
      cellY <= viewport.y + viewport.height + margin
    );
  }

  async renderMap(
    mapData: MapData,
    mapContainer: Container,
    zoom: number,
    viewport: Viewport | null = null
  ): Promise<void> {
    // Opt #5: Reuse persistent layers — just clear children
    this.backgroundLayer.removeChildren();
    this.groundLayer.removeChildren();
    this.objectLayer1.removeChildren();
    this.objectLayer2.removeChildren();
    this.layerBuilder.clearAnimatedSprites();

    const { width: mapWidth, height: mapHeight, backgroundNum } = mapData;
    const mapScale = computeMapScale(mapWidth, mapHeight);
    mapContainer.scale.set(zoom);

    // Opt #5: Add layers to parent only once
    if (!this.layersInitialized) {
      mapContainer.addChild(this.backgroundLayer);
      mapContainer.addChild(this.groundLayer);
      mapContainer.addChild(this.objectLayer1);
      mapContainer.addChild(this.objectLayer2);
      this.layersInitialized = true;
    } else if (this.backgroundLayer.parent !== mapContainer) {
      // Re-parent if mapContainer changed
      mapContainer.removeChildren();
      mapContainer.addChild(this.backgroundLayer);
      mapContainer.addChild(this.groundLayer);
      mapContainer.addChild(this.objectLayer1);
      mapContainer.addChild(this.objectLayer2);
    }

    // Use cells in sequential order (CellId sequential order IS the correct isometric front-to-back order)
    const { cells } = mapData;

    // Collect all unique tile keys including background for parallel prefetch
    const uniqueTileKeys = new Set<string>();

    if (backgroundNum && backgroundNum > 0) {
      uniqueTileKeys.add(`ground_${backgroundNum}`);
    }

    for (const cell of cells) {
      if (cell.ground > 0) {
        uniqueTileKeys.add(`ground_${cell.ground}`);
      }

      if (cell.layer1 > 0) {
        uniqueTileKeys.add(`objects_${cell.layer1}`);
      }

      if (cell.layer2 > 0) {
        uniqueTileKeys.add(`objects_${cell.layer2}`);
      }
    }

    // Prefetch all tile data and textures in parallel (the only async boundary)
    await this.atlasLoader.prefetchTiles([...uniqueTileKeys], 1);

    // After prefetch, everything is in cache — render synchronously to avoid
    // thousands of microtask queue bounces from unnecessary await calls

    if (backgroundNum && backgroundNum > 0) {
      this.layerBuilder.renderBackground(
        backgroundNum,
        this.backgroundLayer,
        mapScale
      );
    }

    let renderedCount = 0;
    let culledCount = 0;

    for (const cell of cells) {
      const cellPosition = getCellPosition(cell.id, mapWidth, cell.groundLevel);

      if (!this.isCellInViewport(cellPosition, viewport, mapScale)) {
        culledCount++;
        continue;
      }

      renderedCount++;
      this.layerBuilder.renderCell(
        cell,
        mapWidth,
        mapScale,
        this.groundLayer,
        this.objectLayer1,
        this.objectLayer2
      );
    }

    if (viewport) {
      log.debug(`Rendered ${renderedCount} cells, culled ${culledCount} cells`);
    }
  }

  /**
   * Swap textures in-place for all tracked sprites at a new zoom level.
   * Prefetches new textures, then swaps .texture on each existing sprite.
   * AnimatedSprites get their .textures array updated and playback position restored.
   *
   * Returns true if texture swap succeeded, false if a full rebuild is needed.
   */
  async updateTexturesForZoom(zoom: number): Promise<boolean> {
    const spriteRefs = this.layerBuilder.getSpriteRefs();

    if (spriteRefs.length === 0) {
      return false;
    }

    // Collect unique tile keys for prefetch
    const uniqueTileKeys = new Set<string>();

    for (const ref of spriteRefs) {
      uniqueTileKeys.add(ref.tileKey);
    }

    // Prefetch all new textures at the new zoom level
    this.atlasLoader.setZoom(zoom);
    await this.atlasLoader.prefetchTiles([...uniqueTileKeys], 1);

    // Clear the texture cache for the new zoom (we'll re-populate it)
    const newZoom = this.atlasLoader.getZoom();
    const textureCache = this.layerBuilder.getTextureCache();

    // Swap textures on each tracked sprite
    for (const ref of spriteRefs) {
      if (ref.sprite.destroyed) {
        continue;
      }

      if (ref.isAnimated && ref.sprite instanceof AnimatedSprite) {
        // For animated sprites: swap entire textures array, restore playback
        const animSprite = ref.sprite;
        const wasPlaying = animSprite.playing;
        const currentFrame = animSprite.currentFrame;

        const newTextures = this.atlasLoader.loadAnimationFramesSync(
          ref.tileKey,
          1
        );
        if (newTextures.length > 0) {
          animSprite.textures = newTextures;
          // Restore playback position
          if (currentFrame < newTextures.length) {
            animSprite.gotoAndStop(currentFrame);
          }

          if (wasPlaying) {
            animSprite.play();
          }
        }
      } else {
        // Static sprite: swap single texture
        const cacheKey = `${ref.tileKey}:${newZoom}:frame${ref.frameIndex}`;
        let newTexture = textureCache.get(cacheKey);

        if (!newTexture) {
          newTexture =
            this.atlasLoader.loadFrameSync(ref.tileKey, ref.frameIndex, 1) ??
            undefined;
          if (newTexture) {
            textureCache.set(cacheKey, newTexture);
          }
        }

        if (newTexture) {
          ref.sprite.texture = newTexture;
        }
      }
    }

    return true;
  }

  /**
   * Clear texture cache for a specific zoom level (call before rendering at new zoom)
   */
  clearZoomTextures(zoom: number): void {
    const textureCache = this.layerBuilder.getTextureCache();
    const zoomPrefix = `:${zoom}:`;
    const keysToDelete: string[] = [];

    for (const key of textureCache.keys()) {
      if (key.includes(zoomPrefix)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      textureCache.delete(key);
    }
  }

  /**
   * Clear all texture caches except for the current zoom level
   * This should be called after a new render completes to clean up old zoom textures
   */
  clearOtherZoomTextures(currentZoom: number): void {
    const textureCache = this.layerBuilder.getTextureCache();
    const currentZoomKey = `:${currentZoom}:`;
    const keysToDelete: string[] = [];

    for (const key of textureCache.keys()) {
      if (!key.includes(currentZoomKey)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      textureCache.delete(key);
    }
  }

  clearCache(): void {
    this.layerBuilder.clear();
  }

  getAnimatedSprites(): AnimatedSprite[] {
    return this.layerBuilder.getAnimatedSprites();
  }

  /**
   * Check if sprite refs are available for texture-swap zoom
   */
  hasSpriteRefs(): boolean {
    return this.layerBuilder.getSpriteRefs().length > 0;
  }

  getGroundLayer(): Container {
    return this.groundLayer;
  }

  getObjectLayer1(): Container {
    return this.objectLayer1;
  }

  getObjectLayer2(): Container {
    return this.objectLayer2;
  }
}
