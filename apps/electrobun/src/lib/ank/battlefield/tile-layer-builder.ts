import { AnimatedSprite, Container, Sprite, type Texture } from "pixi.js";

import type { AtlasLoader } from "@/render/atlas-loader";
import type { TileManifest } from "@/types";
import { createLogger } from "@/utils/logger";

import type { CellData } from "./datacenter/cell";
import type { MapScale } from "./datacenter/map";
import { getCellPosition } from "./datacenter";
import { normalizeRotation } from "./datacenter/sprite";

const log = createLogger("TileLayerBuilder");

/**
 * Tracks a rendered sprite for in-place texture swapping on zoom changes
 */
export interface SpriteRef {
  sprite: Sprite | AnimatedSprite;
  tileKey: string;
  frameIndex: number;
  isAnimated: boolean;
}

export class TileLayerBuilder {
  private atlasLoader: AtlasLoader;
  private interactiveGfxIds: Set<number>;
  private textureCache = new Map<string, Texture>();
  private animatedSprites: AnimatedSprite[] = [];
  private spriteRefs: SpriteRef[] = [];
  private onSpriteCreated?: (
    sprite: Sprite,
    tileId: number,
    cellId: number,
    layer: number,
    rotation: number,
    flip: boolean,
    groundSlope?: number
  ) => void;

  constructor(
    atlasLoader: AtlasLoader,
    interactiveGfxIds: Set<number> = new Set(),
    onSpriteCreated?: (
      sprite: Sprite,
      tileId: number,
      cellId: number,
      layer: number,
      rotation: number,
      flip: boolean,
      groundSlope?: number
    ) => void
  ) {
    this.atlasLoader = atlasLoader;
    this.interactiveGfxIds = interactiveGfxIds;
    this.onSpriteCreated = onSpriteCreated;
  }

  /**
   * Render background tile
   */
  renderBackground(
    backgroundNum: number,
    layer: Container,
    mapScale: MapScale
  ): void {
    const bgTileKey = `ground_${backgroundNum}`;
    const bgTile = this.atlasLoader.getTileManifestSync(bgTileKey);
    const bgSprite = this.createTileSpriteWithManifest(backgroundNum, bgTileKey, bgTile, 0);

    if (!bgSprite) {
      log.warn(`Failed to create background sprite for tile ${backgroundNum}`);
      return;
    }

    // Background uses same pivot approach: registration point at cell origin (0,0)
    const bgFrame = bgTile?.frames[0];
    const trimX = bgFrame?.ox ?? 0;
    const trimY = bgFrame?.oy ?? 0;

    bgSprite.pivot.set(
      -((bgTile?.offsetX ?? 0) + trimX),
      -((bgTile?.offsetY ?? 0) + trimY)
    );

    const bgScale = mapScale.scale;
    bgSprite.scale.set(bgScale, bgScale);

    // Background's registration point goes at map origin
    bgSprite.position.set(mapScale.offsetX, mapScale.offsetY);

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
   */
  renderCell(
    cell: CellData,
    mapWidth: number,
    mapScale: MapScale,
    groundLayer: Container,
    objectLayer1: Container,
    objectLayer2: Container
  ): void {
    const basePosition = getCellPosition(cell.id, mapWidth, cell.groundLevel);
    const groundSlope = cell.groundSlope ?? 1;

    if (cell.ground > 0) {
      const tileKey = `ground_${cell.ground}`;
      const tile = this.atlasLoader.getTileManifestSync(tileKey);

      const targetFrame = this.getFrameIndexFromManifest(tile, cell.id, groundSlope);

      let groundRot = cell.layerGroundRot;
      if (groundSlope !== 1) {
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
          mapScale,
          0,
          targetFrame
        );

        this.addSpriteWithBase(
          sprite, tile, tileKey, basePosition, groundRot,
          cell.layerGroundFlip, cell.id, mapScale, 0, groundLayer
        );

        this.onSpriteCreated?.(sprite, cell.ground, cell.id, 0, groundRot, cell.layerGroundFlip, groundSlope);

        this.spriteRefs.push({
          sprite,
          tileKey,
          frameIndex: targetFrame,
          isAnimated: false,
        });
      }
    }

    if (cell.layer1 > 0) {
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
          mapScale,
          1,
          targetFrame
        );
        this.addSpriteWithBase(
          sprite, tile, tileKey, basePosition, objRot,
          cell.layerObject1Flip, cell.id, mapScale, 1, objectLayer1
        );
        this.onSpriteCreated?.(sprite, cell.layer1, cell.id, 1, objRot, cell.layerObject1Flip);

        this.spriteRefs.push({
          sprite,
          tileKey,
          frameIndex: targetFrame,
          isAnimated: false,
        });
      }
    }

    if (cell.layer2 > 0) {
      const tileKey = `objects_${cell.layer2}`;
      const tile = this.atlasLoader.getTileManifestSync(tileKey);
      const isInteractive = this.interactiveGfxIds.has(cell.layer2);
      const isAnimated = !isInteractive && tile?.behavior === "animated" && (tile?.frameCount ?? 0) > 1;

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
            mapScale,
            2,
            0
          );
          this.addSpriteWithBase(
            animSprite, tile, tileKey, basePosition, 0,
            cell.layerObject2Flip, cell.id, mapScale, 2, objectLayer2
          );
          this.animatedSprites.push(animSprite);
          this.onSpriteCreated?.(animSprite, cell.layer2, cell.id, 2, 0, cell.layerObject2Flip);

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
            mapScale,
            2,
            targetFrame
          );
          this.addSpriteWithBase(
            sprite, tile, tileKey, basePosition, 0,
            cell.layerObject2Flip, cell.id, mapScale, 2, objectLayer2
          );
          this.onSpriteCreated?.(sprite, cell.layer2, cell.id, 2, 0, cell.layerObject2Flip);

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
   * Add a delta sprite to a layer, compositing with its base frame if present.
   */
  private addSpriteWithBase(
    deltaSprite: Sprite,
    tile: TileManifest | null,
    tileKey: string,
    position: { x: number; y: number },
    rotation: number,
    flip: boolean,
    cellId: number,
    mapScale: MapScale,
    layer: number,
    container: Container
  ): void {
    if (!tile?.baseFrame) {
      container.addChild(deltaSprite);
      return;
    }

    const baseSprite = this.createBaseFrameSprite(tileKey, tile);
    if (!baseSprite) {
      container.addChild(deltaSprite);
      return;
    }

    this.positionBaseFrameSprite(
      baseSprite, tile, position, rotation, flip, cellId, mapScale, layer
    );

    if (tile.baseZOrder === "below") {
      container.addChild(baseSprite);
      container.addChild(deltaSprite);
    } else {
      container.addChild(deltaSprite);
      container.addChild(baseSprite);
    }

    this.spriteRefs.push({
      sprite: baseSprite,
      tileKey,
      frameIndex: -1,
      isAnimated: false,
    });
  }

  /**
   * Create a sprite synchronously from cached tile data.
   */
  private createTileSpriteWithManifest(
    _tileId: number,
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

    this.textureCache.set(cacheKey, texture);
    return sprite;
  }

  /**
   * Create a sprite for the base frame of a base/delta split tile.
   */
  private createBaseFrameSprite(
    tileKey: string,
    tile: TileManifest
  ): Sprite | null {
    if (!tile.baseFrame) return null;

    const zoom = this.atlasLoader.getZoom();
    const cacheKey = `${tileKey}:${zoom}:base`;

    const cachedTexture = this.textureCache.get(cacheKey);
    if (cachedTexture) {
      const sprite = new Sprite(cachedTexture);
      sprite.anchor.set(0, 0);
      return sprite;
    }

    const texture = this.atlasLoader.loadBaseFrameSync(tileKey);
    if (!texture) return null;

    const sprite = new Sprite(texture);
    sprite.anchor.set(0, 0);
    this.textureCache.set(cacheKey, texture);
    return sprite;
  }

  /**
   * Position a base frame sprite.
   */
  private positionBaseFrameSprite(
    sprite: Sprite,
    tile: TileManifest,
    position: { x: number; y: number },
    rotation: number,
    flip: boolean,
    cellId: number,
    mapScale: MapScale,
    layer: number,
  ): void {
    const bf = tile.baseFrame;
    if (!bf) return;

    const r = normalizeRotation(rotation);

    sprite.pivot.set(
      -(tile.offsetX + bf.ox),
      -(tile.offsetY + bf.oy)
    );

    const globalScale = mapScale.scale;
    sprite.position.set(
      position.x * globalScale + mapScale.offsetX,
      position.y * globalScale + mapScale.offsetY
    );

    sprite.angle = r * 90;

    let scaleX = globalScale;
    let scaleY = globalScale;
    if (r === 1 || r === 3) {
      scaleX *= 51.85 / 100;
      scaleY *= 192.86 / 100;
    }
    if (flip) {
      scaleX *= -1;
    }
    sprite.scale.set(scaleX, scaleY);

    sprite.zIndex = layer === 2 ? cellId * 100 : cellId;
  }

  /**
   * Create an animated sprite synchronously from cached tile data.
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
   * Position a sprite using PixiJS pivot to match Flash's registration point behavior.
   */
  private positionSpriteWithManifest(
    sprite: Sprite,
    tile: TileManifest | null,
    position: { x: number; y: number },
    rotation: number,
    flip: boolean,
    cellId: number,
    mapScale: MapScale,
    layer: number,
    frameIndex = 0
  ): void {
    if (!tile) {
      return;
    }

    const r = normalizeRotation(rotation);

    const frame = tile.frames[frameIndex];
    const trimX = frame?.ox ?? 0;
    const trimY = frame?.oy ?? 0;

    sprite.pivot.set(
      -(tile.offsetX + trimX),
      -(tile.offsetY + trimY)
    );

    const globalScale = mapScale.scale;
    sprite.position.set(
      position.x * globalScale + mapScale.offsetX,
      position.y * globalScale + mapScale.offsetY
    );

    sprite.angle = r * 90;

    let scaleX = globalScale;
    let scaleY = globalScale;
    if (r === 1 || r === 3) {
      scaleX *= 51.85 / 100;
      scaleY *= 192.86 / 100;
    }
    if (flip) {
      scaleX *= -1;
    }
    sprite.scale.set(scaleX, scaleY);

    sprite.zIndex = layer === 2 ? cellId * 100 : cellId;
  }

  /**
   * Compute frame index from pre-resolved manifest.
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
   * Get sprite references for zoom texture swapping
   */
  getSpriteRefs(): SpriteRef[] {
    return this.spriteRefs;
  }

  /**
   * Get animated sprites
   */
  getAnimatedSprites(): AnimatedSprite[] {
    return this.animatedSprites;
  }

  /**
   * Clear animated sprites
   */
  clearAnimatedSprites(): void {
    for (const sprite of this.animatedSprites) {
      if (!sprite.destroyed) {
        sprite.stop();
        sprite.destroy();
      }
    }
    this.animatedSprites = [];
  }

  /**
   * Clear sprite refs and textures
   */
  clear(): void {
    this.textureCache.clear();
    this.clearAnimatedSprites();
    this.spriteRefs = [];
  }

  /**
   * Get texture cache
   */
  getTextureCache(): Map<string, Texture> {
    return this.textureCache;
  }
}
