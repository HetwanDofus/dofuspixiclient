import { AnimatedSprite, Container, Sprite, type Texture } from "pixi.js";

import type { AtlasLoader } from "@/render/atlas-loader";
import type { TileManifest } from "@/types";

import type { CellData } from "./datacenter/cell";
import type { MapData, MapScale } from "./datacenter/map";
import { computeMapScale, getCellPosition } from "./datacenter";
import {
  computePhpLikeOffsets,
  computeTransformedMin,
  normalizeRotation,
} from "./datacenter/sprite";

export interface MapHandlerConfig {
  atlasLoader: AtlasLoader;
  onSpriteCreated?: (
    sprite: Sprite,
    tileId: number,
    cellId: number,
    layer: number
  ) => void;
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

/**
 * Cache entry for pre-sorted cells
 */
interface SortedCellsCache {
  mapId: number;
  mapWidth: number;
  sortedCells: CellData[];
}

/**
 * Tracks a rendered sprite for in-place texture swapping on zoom changes
 */
interface SpriteRef {
  sprite: Sprite | AnimatedSprite;
  tileKey: string;
  frameIndex: number;
  isAnimated: boolean;
}

export class MapHandler {
  private atlasLoader: AtlasLoader;
  // Opt #2: Cache Texture directly instead of Sprite wrapper
  private textureCache = new Map<string, Texture>();
  private animatedSprites: AnimatedSprite[] = [];
  private sortedCellsCache: SortedCellsCache | null = null;
  private onSpriteCreated?: (
    sprite: Sprite,
    tileId: number,
    cellId: number,
    layer: number
  ) => void;

  // Opt #5: Persistent container layers — created once, reused across renders
  private backgroundLayer = new Container();
  private groundLayer = new Container();
  private objectLayer1 = new Container();
  private objectLayer2 = new Container();
  private animatedLayer = new Container();
  private layersInitialized = false;

  // Opt #7: Track sprite→tileKey mappings for texture-swap on zoom
  private spriteRefs: SpriteRef[] = [];
  private lastMapScale: MapScale | null = null;

  constructor(config: MapHandlerConfig) {
    this.atlasLoader = config.atlasLoader;
    this.onSpriteCreated = config.onSpriteCreated;

    // Opt #5: Configure sortable once
    this.groundLayer.sortableChildren = true;
    this.objectLayer1.sortableChildren = true;
    this.objectLayer2.sortableChildren = true;
    this.animatedLayer.sortableChildren = true;
  }

  /**
   * Get pre-sorted cells for a map, using cache when possible
   * Sorting is done once per map and cached for subsequent renders
   */
  private getSortedCells(mapData: MapData): CellData[] {
    const { id: mapId, width: mapWidth, cells } = mapData;

    // Return cached sorted cells if same map
    if (
      this.sortedCellsCache &&
      this.sortedCellsCache.mapId === mapId &&
      this.sortedCellsCache.mapWidth === mapWidth
    ) {
      return this.sortedCellsCache.sortedCells;
    }

    // Sort cells by isometric depth (y + x determines draw order)
    const sortedCells = [...cells].sort((a, b) => {
      const posA = getCellPosition(a.id, mapWidth, a.groundLevel);
      const posB = getCellPosition(b.id, mapWidth, b.groundLevel);
      return posA.y + posA.x - (posB.y + posB.x);
    });

    // Cache the sorted result
    this.sortedCellsCache = {
      mapId,
      mapWidth,
      sortedCells,
    };

    return sortedCells;
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
    this.animatedLayer.removeChildren();
    this.clearAnimatedSprites();

    // Opt #7: Reset sprite refs for this render pass
    this.spriteRefs = [];

    const {
      width: mapWidth,
      height: mapHeight,
      backgroundNum,
    } = mapData;
    const mapScale = computeMapScale(mapWidth, mapHeight);
    this.lastMapScale = mapScale;

    mapContainer.scale.set(zoom);

    // Opt #5: Add layers to parent only once
    if (!this.layersInitialized) {
      mapContainer.addChild(this.backgroundLayer);
      mapContainer.addChild(this.groundLayer);
      mapContainer.addChild(this.objectLayer1);
      mapContainer.addChild(this.objectLayer2);
      mapContainer.addChild(this.animatedLayer);
      this.layersInitialized = true;
    } else if (this.backgroundLayer.parent !== mapContainer) {
      // Re-parent if mapContainer changed
      mapContainer.removeChildren();
      mapContainer.addChild(this.backgroundLayer);
      mapContainer.addChild(this.groundLayer);
      mapContainer.addChild(this.objectLayer1);
      mapContainer.addChild(this.objectLayer2);
      mapContainer.addChild(this.animatedLayer);
    }

    // Use pre-sorted cells (cached per map to avoid re-sorting on each render)
    const sortedCells = this.getSortedCells(mapData);

    // Collect all unique tile keys including background for parallel prefetch
    const uniqueTileKeys = new Set<string>();

    if (backgroundNum && backgroundNum > 0) {
      uniqueTileKeys.add(`ground_${backgroundNum}`);
    }

    for (const cell of sortedCells) {
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
      this.renderBackground(backgroundNum, this.backgroundLayer, mapScale);
    }

    let renderedCount = 0;
    let culledCount = 0;

    for (const cell of sortedCells) {
      const cellPosition = getCellPosition(cell.id, mapWidth, cell.groundLevel);

      if (!this.isCellInViewport(cellPosition, viewport, mapScale)) {
        culledCount++;
        continue;
      }

      renderedCount++;
      this.renderCell(
        cell,
        mapWidth,
        mapScale,
        this.groundLayer,
        this.objectLayer1,
        this.objectLayer2,
        this.animatedLayer
      );
    }

    if (viewport) {
      console.log(
        `[MapHandler] Rendered ${renderedCount} cells, culled ${culledCount} cells`
      );
    }
  }

  private renderBackground(
    backgroundNum: number,
    layer: Container,
    mapScale: MapScale
  ): void {
    const bgTileKey = `ground_${backgroundNum}`;
    const bgTile = this.atlasLoader.getTileManifestSync(bgTileKey);
    const bgSprite = this.createTileSpriteWithManifest(backgroundNum, bgTileKey, bgTile, 0);

    if (!bgSprite) {
      console.warn(
        `[MapHandler] Failed to create background sprite for tile ${backgroundNum}`
      );
      return;
    }

    const bgBaseX = bgTile?.offsetX ?? 0;
    const bgBaseY = bgTile?.offsetY ?? 0;

    const bgScale = mapScale.scale;
    bgSprite.scale.set(bgScale, bgScale);
    bgSprite.anchor.set(0, 0);

    const bgTopLeftX = bgBaseX * bgScale + mapScale.offsetX;
    const bgTopLeftY = bgBaseY * bgScale + mapScale.offsetY;

    bgSprite.x = bgTopLeftX;
    bgSprite.y = bgTopLeftY;

    layer.addChild(bgSprite);

    // Track for zoom texture swap
    this.spriteRefs.push({
      sprite: bgSprite,
      tileKey: bgTileKey,
      frameIndex: 0,
      isAnimated: false,
    });
  }

  /**
   * Render a single cell synchronously.
   * All tile data must be prefetched before calling this method.
   * Opt #4: Manifest is looked up once per layer and passed through.
   */
  private renderCell(
    cell: CellData,
    mapWidth: number,
    mapScale: MapScale,
    groundLayer: Container,
    objectLayer1: Container,
    objectLayer2: Container,
    animatedLayer: Container
  ): void {
    const basePosition = getCellPosition(cell.id, mapWidth, cell.groundLevel);
    const groundSlope = cell.groundSlope ?? 1;

    if (cell.ground > 0) {
      // Opt #4: Single manifest lookup for the entire ground layer block
      const tileKey = `ground_${cell.ground}`;
      const tile = this.atlasLoader.getTileManifestSync(tileKey);

      const targetFrame = this.getFrameIndexFromManifest(tile, cell.id, groundSlope);
      const isSlope = tile?.behavior === "slope" && (tile?.frameCount ?? 0) > 1;

      let groundRot = cell.layerGroundRot;
      if (isSlope && groundSlope !== 1) {
        groundRot = 0;
      }

      const sprite = this.createTileSpriteWithManifest(cell.ground, tileKey, tile, targetFrame);

      if (sprite) {
        this.positionSpriteWithManifest(
          sprite,
          tile,
          basePosition,
          groundRot,
          cell.layerGroundFlip,
          cell.id,
          mapScale
        );
        groundLayer.addChild(sprite);
        this.onSpriteCreated?.(sprite, cell.ground, cell.id, 0);

        // Opt #7: Track for texture swap
        this.spriteRefs.push({
          sprite,
          tileKey,
          frameIndex: targetFrame,
          isAnimated: false,
        });
      }
    }

    if (cell.layer1 > 0) {
      // Opt #4: Single manifest lookup for layer1
      const tileKey = `objects_${cell.layer1}`;
      const tile = this.atlasLoader.getTileManifestSync(tileKey);

      let objRot = 0;
      if (groundSlope === 1) {
        objRot = cell.layerObject1Rot;
      }

      const targetFrame = this.getFrameIndexFromManifest(tile, cell.id, groundSlope);
      const sprite = this.createTileSpriteWithManifest(cell.layer1, tileKey, tile, targetFrame);

      if (sprite) {
        this.positionSpriteWithManifest(
          sprite,
          tile,
          basePosition,
          objRot,
          cell.layerObject1Flip,
          cell.id,
          mapScale
        );
        objectLayer1.addChild(sprite);
        this.onSpriteCreated?.(sprite, cell.layer1, cell.id, 1);

        // Opt #7: Track for texture swap
        this.spriteRefs.push({
          sprite,
          tileKey,
          frameIndex: targetFrame,
          isAnimated: false,
        });
      }
    }

    if (cell.layer2 > 0) {
      // Opt #4: Single manifest lookup for layer2
      const tileKey = `objects_${cell.layer2}`;
      const tile = this.atlasLoader.getTileManifestSync(tileKey);
      const isAnimated = tile?.behavior === "animated" && (tile?.frameCount ?? 0) > 1;

      if (isAnimated) {
        const animSprite = this.createAnimatedTileSpriteWithManifest(
          tileKey,
          tile!
        );

        if (animSprite) {
          this.positionSpriteWithManifest(
            animSprite,
            tile,
            basePosition,
            0,
            cell.layerObject2Flip,
            cell.id,
            mapScale
          );
          animatedLayer.addChild(animSprite);
          this.animatedSprites.push(animSprite);
          this.onSpriteCreated?.(animSprite, cell.layer2, cell.id, 2);

          // Opt #7: Track animated sprite for texture swap
          this.spriteRefs.push({
            sprite: animSprite,
            tileKey,
            frameIndex: 0,
            isAnimated: true,
          });
        }
      } else {
        const targetFrame = this.getFrameIndexFromManifest(tile, cell.id, groundSlope);
        const sprite = this.createTileSpriteWithManifest(cell.layer2, tileKey, tile, targetFrame);

        if (sprite) {
          this.positionSpriteWithManifest(
            sprite,
            tile,
            basePosition,
            0,
            cell.layerObject2Flip,
            cell.id,
            mapScale
          );
          objectLayer2.addChild(sprite);
          this.onSpriteCreated?.(sprite, cell.layer2, cell.id, 2);

          // Opt #7: Track for texture swap
          this.spriteRefs.push({
            sprite,
            tileKey,
            frameIndex: targetFrame,
            isAnimated: false,
          });
        }
      }
    }
  }

  /**
   * Create a sprite synchronously from cached tile data.
   * Opt #2: textureCache stores Texture directly, not Sprite.
   * Opt #4: Accepts pre-resolved tileKey and manifest to avoid redundant lookups.
   */
  private createTileSpriteWithManifest(
    tileId: number,
    tileKey: string,
    _tile: TileManifest | null,
    frameIndex: number
  ): Sprite | null {
    const zoom = this.atlasLoader.getZoom();
    const cacheKey = `${tileKey}:${zoom}:frame${frameIndex}`;

    const cachedTexture = this.textureCache.get(cacheKey);
    if (cachedTexture) {
      const sprite = new Sprite(cachedTexture);
      sprite.anchor.set(0, 0);
      return sprite;
    }

    const texture = this.atlasLoader.loadFrameSync(tileKey, frameIndex, 1);

    if (!texture) {
      return null;
    }

    const sprite = new Sprite(texture);
    sprite.anchor.set(0, 0);

    // Opt #2: Store Texture, not Sprite
    this.textureCache.set(cacheKey, texture);
    return sprite;
  }

  /**
   * Create an animated sprite synchronously from cached tile data.
   * Opt #4: Accepts pre-resolved manifest to avoid redundant lookup.
   */
  private createAnimatedTileSpriteWithManifest(
    tileKey: string,
    tile: TileManifest
  ): AnimatedSprite | null {
    const textures = this.atlasLoader.loadAnimationFramesSync(tileKey, 1);

    if (textures.length === 0) {
      return null;
    }

    const animSprite = new AnimatedSprite(textures);
    animSprite.anchor.set(0, 0);
    animSprite.animationSpeed = 1;
    animSprite.loop = tile.loop !== false;

    if (tile.autoplay !== false) {
      animSprite.play();
    }

    return animSprite;
  }

  /**
   * Position a sprite synchronously using pre-resolved tile manifest.
   * Opt #4: Accepts manifest directly to avoid redundant Map lookup.
   */
  private positionSpriteWithManifest(
    sprite: Sprite,
    tile: TileManifest | null,
    position: { x: number; y: number },
    rotation: number,
    flip: boolean,
    cellId: number,
    mapScale: MapScale
  ): void {
    if (!tile) {
      return;
    }

    const r = normalizeRotation(rotation);

    const baseWidth = tile.width;
    const baseHeight = tile.height;

    const { offsetX, offsetY } = computePhpLikeOffsets(
      {
        width: baseWidth,
        height: baseHeight,
        offsetX: tile.offsetX,
        offsetY: tile.offsetY,
      },
      r,
      flip
    );

    const ROT_SCALE_X = 51.85 / 100;
    const ROT_SCALE_Y = 192.86 / 100;

    let scaleX = 1;
    let scaleY = 1;

    if (r === 1 || r === 3) {
      scaleX = ROT_SCALE_X;
      scaleY = ROT_SCALE_Y;
    }

    if (flip) {
      scaleX *= -1;
    }

    const globalScale = mapScale.scale;
    const finalScaleX = scaleX * globalScale;
    const finalScaleY = scaleY * globalScale;

    const { minX, minY } = computeTransformedMin(
      baseWidth,
      baseHeight,
      r,
      finalScaleX,
      finalScaleY
    );

    sprite.angle = r * 90;
    sprite.scale.set(finalScaleX, finalScaleY);

    const topLeftBaseX = position.x + offsetX;
    const topLeftBaseY = position.y + offsetY;

    const topLeftScaledX = topLeftBaseX * globalScale + mapScale.offsetX;
    const topLeftScaledY = topLeftBaseY * globalScale + mapScale.offsetY;

    sprite.x = Math.round(topLeftScaledX - minX);
    sprite.y = Math.round(topLeftScaledY - minY);
    sprite.zIndex = cellId;
  }

  /**
   * Opt #4: Compute frame index from pre-resolved manifest.
   */
  private getFrameIndexFromManifest(
    tile: TileManifest | null,
    cellId: number,
    groundSlope: number
  ): number {
    if (!tile || (tile.frameCount ?? 0) <= 1) {
      return 0;
    }

    if (tile.behavior === "slope") {
      if (groundSlope > 1) {
        return groundSlope - 1;
      }
      return 0;
    }

    if (tile.behavior === "random") {
      return cellId % (tile.frameCount ?? 1);
    }

    return 0;
  }

  /**
   * Opt #7: Swap textures in-place for all tracked sprites at a new zoom level.
   * Prefetches new textures, then swaps .texture on each existing sprite.
   * AnimatedSprites get their .textures array updated and playback position restored.
   *
   * Returns true if texture swap succeeded, false if a full rebuild is needed.
   */
  async updateTexturesForZoom(zoom: number): Promise<boolean> {
    if (this.spriteRefs.length === 0) {
      return false;
    }

    // Collect unique tile keys for prefetch
    const uniqueTileKeys = new Set<string>();
    for (const ref of this.spriteRefs) {
      uniqueTileKeys.add(ref.tileKey);
    }

    // Prefetch all new textures at the new zoom level
    this.atlasLoader.setZoom(zoom);
    await this.atlasLoader.prefetchTiles([...uniqueTileKeys], 1);

    // Clear the texture cache for the new zoom (we'll re-populate it)
    const newZoom = this.atlasLoader.getZoom();

    // Swap textures on each tracked sprite
    for (const ref of this.spriteRefs) {
      if (ref.sprite.destroyed) {
        continue;
      }

      if (ref.isAnimated && ref.sprite instanceof AnimatedSprite) {
        // For animated sprites: swap entire textures array, restore playback
        const animSprite = ref.sprite;
        const wasPlaying = animSprite.playing;
        const currentFrame = animSprite.currentFrame;

        const newTextures = this.atlasLoader.loadAnimationFramesSync(ref.tileKey, 1);
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
        let newTexture = this.textureCache.get(cacheKey);

        if (!newTexture) {
          newTexture = this.atlasLoader.loadFrameSync(ref.tileKey, ref.frameIndex, 1) ?? undefined;
          if (newTexture) {
            this.textureCache.set(cacheKey, newTexture);
          }
        }

        if (newTexture) {
          ref.sprite.texture = newTexture;
        }
      }
    }

    return true;
  }

  private clearAnimatedSprites(): void {
    for (const sprite of this.animatedSprites) {
      if (!sprite.destroyed) {
        sprite.stop();
        sprite.destroy();
      }
    }
    this.animatedSprites = [];
  }

  /**
   * Clear texture cache for a specific zoom level (call before rendering at new zoom)
   */
  clearZoomTextures(zoom: number): void {
    const zoomPrefix = `:${zoom}:`;
    const keysToDelete: string[] = [];

    for (const key of this.textureCache.keys()) {
      if (key.includes(zoomPrefix)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.textureCache.delete(key);
    }
  }

  /**
   * Clear all texture caches except for the current zoom level
   * This should be called after a new render completes to clean up old zoom textures
   */
  clearOtherZoomTextures(currentZoom: number): void {
    const currentZoomKey = `:${currentZoom}:`;
    const keysToDelete: string[] = [];

    for (const key of this.textureCache.keys()) {
      if (!key.includes(currentZoomKey)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.textureCache.delete(key);
    }
  }

  clearCache(): void {
    // Just clear references - don't destroy textures as they're managed by atlas loader
    this.textureCache.clear();
    this.clearAnimatedSprites();
    this.sortedCellsCache = null;
    this.spriteRefs = [];
  }

  getAnimatedSprites(): AnimatedSprite[] {
    return this.animatedSprites;
  }

  /**
   * Check if sprite refs are available for texture-swap zoom
   */
  hasSpriteRefs(): boolean {
    return this.spriteRefs.length > 0;
  }
}
