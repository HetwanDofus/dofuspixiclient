import { AnimatedSprite, Container, Sprite } from "pixi.js";

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
 * Cache entry for pre-sorted cells
 */
interface SortedCellsCache {
  mapId: number;
  mapWidth: number;
  sortedCells: CellData[];
}

export class MapHandler {
  private atlasLoader: AtlasLoader;
  private textureCache = new Map<string, Sprite>();
  private animatedSprites: AnimatedSprite[] = [];
  private currentTileScale = 2;
  private sortedCellsCache: SortedCellsCache | null = null;
  private onSpriteCreated?: (
    sprite: Sprite,
    tileId: number,
    cellId: number,
    layer: number
  ) => void;

  constructor(config: MapHandlerConfig) {
    this.atlasLoader = config.atlasLoader;
    this.onSpriteCreated = config.onSpriteCreated;
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

  setTargetScale(scale: number): void {
    this.currentTileScale = scale;
  }

  getTargetScale(): number {
    return this.currentTileScale;
  }

  async renderMap(
    mapData: MapData,
    mapContainer: Container,
    zoom: number
  ): Promise<void> {
    mapContainer.removeChildren();
    this.clearAnimatedSprites();

    const {
      width: mapWidth,
      height: mapHeight,
      backgroundNum,
    } = mapData;
    const mapScale = computeMapScale(mapWidth, mapHeight);

    mapContainer.scale.set(zoom);

    const backgroundLayer = new Container();
    const groundLayer = new Container();
    const objectLayer1 = new Container();
    const objectLayer2 = new Container();
    const animatedLayer = new Container();

    groundLayer.sortableChildren = true;
    objectLayer1.sortableChildren = true;
    objectLayer2.sortableChildren = true;
    animatedLayer.sortableChildren = true;

    if (backgroundNum && backgroundNum > 0) {
      await this.renderBackground(
        backgroundNum,
        backgroundLayer,
        mapData,
        mapScale
      );
    }

    // Use pre-sorted cells (cached per map to avoid re-sorting on each render)
    const sortedCells = this.getSortedCells(mapData);

    for (const cell of sortedCells) {
      await this.renderCell(
        cell,
        mapWidth,
        mapScale,
        groundLayer,
        objectLayer1,
        objectLayer2,
        animatedLayer
      );
    }

    mapContainer.addChild(backgroundLayer);
    mapContainer.addChild(groundLayer);
    mapContainer.addChild(objectLayer1);
    mapContainer.addChild(objectLayer2);
    mapContainer.addChild(animatedLayer);
  }

  private async renderBackground(
    backgroundNum: number,
    layer: Container,
    mapData: MapData,
    mapScale: MapScale
  ): Promise<void> {
    const bgSprite = await this.createTileSprite(backgroundNum, "ground");

    if (!bgSprite) {
      console.warn(
        `[MapHandler] Failed to create background sprite for tile ${backgroundNum}`
      );
      return;
    }

    const bgTileKey = `ground_${backgroundNum}`;
    const bgTile = await this.atlasLoader.loadTileManifest(bgTileKey);

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
  }

  private async renderCell(
    cell: CellData,
    mapWidth: number,
    mapScale: MapScale,
    groundLayer: Container,
    objectLayer1: Container,
    objectLayer2: Container,
    animatedLayer: Container
  ): Promise<void> {
    const basePosition = getCellPosition(cell.id, mapWidth, cell.groundLevel);
    const groundSlope = cell.groundSlope ?? 1;

    if (cell.ground > 0) {
      const sprite = await this.createTileSprite(cell.ground, "ground");
      if (sprite) {
        const targetFrame = await this.getFrameIndexForTile(
          cell.ground,
          "ground",
          cell.id,
          groundSlope
        );
        const isSlope = await this.isSlopeTile(cell.ground, "ground");
        const groundRot =
          isSlope && groundSlope !== 1 ? 0 : cell.layerGroundRot;

        const finalSprite =
          targetFrame > 0
            ? await this.createTileSprite(cell.ground, "ground", targetFrame)
            : sprite;
        if (finalSprite) {
          await this.positionSprite(
            finalSprite,
            cell.ground,
            "ground",
            basePosition,
            groundRot,
            cell.layerGroundFlip,
            cell.id,
            mapScale
          );
          groundLayer.addChild(finalSprite);
          this.onSpriteCreated?.(finalSprite, cell.ground, cell.id, 0);
        }
      }
    }

    if (cell.layer1 > 0) {
      const objRot = groundSlope === 1 ? cell.layerObject1Rot : 0;
      const sprite = await this.createTileSprite(cell.layer1, "objects");
      if (sprite) {
        const targetFrame = await this.getFrameIndexForTile(
          cell.layer1,
          "objects",
          cell.id,
          groundSlope
        );
        const finalSprite =
          targetFrame > 0
            ? await this.createTileSprite(cell.layer1, "objects", targetFrame)
            : sprite;
        if (finalSprite) {
          await this.positionSprite(
            finalSprite,
            cell.layer1,
            "objects",
            basePosition,
            objRot,
            cell.layerObject1Flip,
            cell.id,
            mapScale
          );
          objectLayer1.addChild(finalSprite);
          this.onSpriteCreated?.(finalSprite, cell.layer1, cell.id, 1);
        }
      }
    }

    if (cell.layer2 > 0) {
      const sprite = await this.createTileSprite(cell.layer2, "objects");
      if (sprite) {
        if (await this.isAnimatedTile(cell.layer2, "objects")) {
          const animSprite = await this.createAnimatedTileSprite(
            cell.layer2,
            "objects"
          );
          if (animSprite) {
            await this.positionSprite(
              animSprite,
              cell.layer2,
              "objects",
              basePosition,
              0,
              cell.layerObject2Flip,
              cell.id,
              mapScale
            );
            animatedLayer.addChild(animSprite);
            this.animatedSprites.push(animSprite);
            this.onSpriteCreated?.(animSprite, cell.layer2, cell.id, 2);
          }
        } else {
          const targetFrame = await this.getFrameIndexForTile(
            cell.layer2,
            "objects",
            cell.id,
            groundSlope
          );
          const finalSprite =
            targetFrame > 0
              ? await this.createTileSprite(cell.layer2, "objects", targetFrame)
              : sprite;
          if (finalSprite) {
            await this.positionSprite(
              finalSprite,
              cell.layer2,
              "objects",
              basePosition,
              0,
              cell.layerObject2Flip,
              cell.id,
              mapScale
            );
            objectLayer2.addChild(finalSprite);
            this.onSpriteCreated?.(finalSprite, cell.layer2, cell.id, 2);
          }
        }
      }
    }
  }

  private async createTileSprite(
    tileId: number,
    type: "ground" | "objects",
    frameIndex = 0
  ): Promise<Sprite | null> {
    const tileKey = `${type}_${tileId}`;
    const cacheKey = `${type}:${tileId}:${this.currentTileScale}:frame${frameIndex}`;

    if (this.textureCache.has(cacheKey)) {
      const cachedTexture = this.textureCache.get(cacheKey)!.texture;
      const sprite = new Sprite(cachedTexture);
      sprite.anchor.set(0, 0);
      return sprite;
    }

    const texture = await this.atlasLoader.loadFrame(
      tileKey,
      frameIndex,
      this.currentTileScale
    );

    if (!texture) {
      return null;
    }

    const sprite = new Sprite(texture);
    sprite.anchor.set(0, 0);

    this.textureCache.set(cacheKey, sprite);

    return sprite;
  }

  private async createAnimatedTileSprite(
    tileId: number,
    type: "ground" | "objects"
  ): Promise<AnimatedSprite | null> {
    const tileKey = `${type}_${tileId}`;
    const tile = await this.atlasLoader.loadTileManifest(tileKey);

    if (!tile) {
      return null;
    }

    const textures = await this.atlasLoader.loadAnimationFrames(
      tileKey,
      this.currentTileScale
    );

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

  private async positionSprite(
    sprite: Sprite,
    tileId: number,
    type: "ground" | "objects",
    position: { x: number; y: number },
    rotation: number,
    flip: boolean,
    cellId: number,
    mapScale: MapScale
  ): Promise<void> {
    const tileKey = `${type}_${tileId}`;
    const tile = await this.atlasLoader.loadTileManifest(tileKey);

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

  private async getTileData(
    tileId: number,
    type: "ground" | "objects"
  ): Promise<TileManifest | null> {
    const tileKey = `${type}_${tileId}`;
    return this.atlasLoader.loadTileManifest(tileKey);
  }

  private async isSlopeTile(
    tileId: number,
    type: "ground" | "objects"
  ): Promise<boolean> {
    const tile = await this.getTileData(tileId, type);
    return tile?.behavior === "slope" && (tile?.frameCount ?? 0) > 1;
  }

  private async isAnimatedTile(
    tileId: number,
    type: "ground" | "objects"
  ): Promise<boolean> {
    const tile = await this.getTileData(tileId, type);
    return tile?.behavior === "animated" && (tile?.frameCount ?? 0) > 1;
  }

  private async getFrameIndexForTile(
    tileId: number,
    type: "ground" | "objects",
    cellId: number,
    groundSlope: number
  ): Promise<number> {
    const tile = await this.getTileData(tileId, type);
    if (!tile || (tile.frameCount ?? 0) <= 1) return 0;

    if (tile.behavior === "slope") {
      return groundSlope > 1 ? groundSlope - 1 : 0;
    }

    if (tile.behavior === "random") {
      return cellId % (tile.frameCount ?? 1);
    }

    return 0;
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

  clearCache(): void {
    // Destroy cached sprites (they're not in the container, just cached references)
    for (const sprite of this.textureCache.values()) {
      if (!sprite.destroyed) {
        sprite.destroy();
      }
    }
    this.textureCache.clear();
    this.clearAnimatedSprites();
    this.sortedCellsCache = null;
  }

  getAnimatedSprites(): AnimatedSprite[] {
    return this.animatedSprites;
  }
}
