import type { AnimatedSprite, Container, Sprite, Texture } from "pixi.js";

import type { CellData } from "@/game/datacenter/cell";
import type { MapScale } from "@/game/datacenter/map";
import type { AtlasLoader } from "@/game/render/atlas-loader";
import { getCellPosition } from "@/game/datacenter";
import { createLogger } from "@/utils/logger";

import type { Scene } from "../scene";
import { TileActor } from "./actor";
import { frameIndexForTile, TileSpriteFactory } from "./sprite-factory";

const log = createLogger("TileLayerBuilder");

/**
 * Tracks a rendered sprite for in-place texture swapping on zoom changes.
 * Holds a back-reference to the TileActor when scene ownership is enabled,
 * so clear() can drive scene.remove() for each tile.
 */
export interface SpriteRef {
  sprite: Sprite | AnimatedSprite;
  tileKey: string;
  frameIndex: number;
  isAnimated: boolean;
  /** Present when the builder was given a Scene at construction. */
  actor?: TileActor;
}

export class TileLayerBuilder {
  private atlasLoader: AtlasLoader;
  private interactiveGfxIds: Set<number>;
  private textureCache = new Map<string, Texture>();
  private animatedSprites: AnimatedSprite[] = [];
  private spriteRefs: SpriteRef[] = [];
  private scene: Scene | null;
  private readonly sprites: TileSpriteFactory;
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
    ) => void,
    scene: Scene | null = null
  ) {
    this.atlasLoader = atlasLoader;
    this.interactiveGfxIds = interactiveGfxIds;
    this.onSpriteCreated = onSpriteCreated;
    this.scene = scene;
    this.sprites = new TileSpriteFactory(atlasLoader, this.textureCache);
  }

  /**
   * Register a sprite as a TileActor with the scene (if a Scene was provided)
   * and push a SpriteRef. Internal helper — collapses boilerplate across the
   * ground / layer1 / layer2 branches.
   */
  private trackSprite(opts: {
    sprite: Sprite | AnimatedSprite;
    tileKey: string;
    frameIndex: number;
    isAnimated: boolean;
    cellId: number;
    basePosition: { x: number; y: number };
    mapScale: MapScale;
    layer: number;
  }): void {
    let actor: TileActor | undefined;

    if (this.scene) {
      actor = new TileActor({
        sprite: opts.sprite,
        tileKey: opts.tileKey,
        frameIndex: opts.frameIndex,
        isAnimated: opts.isAnimated,
        cellId: opts.cellId,
        x: opts.basePosition.x * opts.mapScale.scale + opts.mapScale.offsetX,
        y: opts.basePosition.y * opts.mapScale.scale + opts.mapScale.offsetY,
        layer: opts.layer,
      });
      this.scene.add(actor);
    }

    this.spriteRefs.push({
      sprite: opts.sprite,
      tileKey: opts.tileKey,
      frameIndex: opts.frameIndex,
      isAnimated: opts.isAnimated,
      actor,
    });
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
    const bgSprite = this.sprites.createStatic(bgTileKey, 0);

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

    this.trackSprite({
      sprite: bgSprite,
      tileKey: bgTileKey,
      frameIndex: 0,
      isAnimated: false,
      cellId: 0,
      basePosition: { x: 0, y: 0 },
      mapScale,
      layer: 0,
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

      const targetFrame = frameIndexForTile(tile, cell.id, groundSlope);

      let groundRot = cell.layerGroundRot;

      if (groundSlope !== 1) {
        groundRot = 0;
      }

      const sprite = this.sprites.createStatic(tileKey, targetFrame);

      if (sprite) {
        this.sprites.position(
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

        groundLayer.addChild(sprite);

        this.onSpriteCreated?.(
          sprite,
          cell.ground,
          cell.id,
          0,
          groundRot,
          cell.layerGroundFlip,
          groundSlope
        );

        this.trackSprite({
          sprite,
          tileKey,
          frameIndex: targetFrame,
          isAnimated: false,
          cellId: cell.id,
          basePosition,
          mapScale,
          layer: 0,
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

      const targetFrame = frameIndexForTile(tile, cell.id, groundSlope);
      const sprite = this.sprites.createStatic(tileKey, targetFrame);

      if (sprite) {
        this.sprites.position(
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
        objectLayer1.addChild(sprite);
        this.onSpriteCreated?.(
          sprite,
          cell.layer1,
          cell.id,
          1,
          objRot,
          cell.layerObject1Flip
        );

        this.trackSprite({
          sprite,
          tileKey,
          frameIndex: targetFrame,
          isAnimated: false,
          cellId: cell.id,
          basePosition,
          mapScale,
          layer: 1,
        });
      }
    }

    if (cell.layer2 > 0) {
      const tileKey = `objects_${cell.layer2}`;
      const tile = this.atlasLoader.getTileManifestSync(tileKey);
      const isInteractive = this.interactiveGfxIds.has(cell.layer2);
      const isAnimated =
        !isInteractive &&
        tile?.behavior === "animated" &&
        (tile?.frameCount ?? 0) > 1;

      if (isAnimated && tile) {
        const animSprite = this.sprites.createAnimated(tileKey, tile);

        if (animSprite) {
          this.sprites.position(
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
          objectLayer2.addChild(animSprite);
          this.animatedSprites.push(animSprite);
          this.onSpriteCreated?.(
            animSprite,
            cell.layer2,
            cell.id,
            2,
            0,
            cell.layerObject2Flip
          );

          this.trackSprite({
            sprite: animSprite,
            tileKey,
            frameIndex: 0,
            isAnimated: true,
            cellId: cell.id,
            basePosition,
            mapScale,
            layer: 2,
          });
        }
      } else {
        const targetFrame = frameIndexForTile(tile, cell.id, groundSlope);
        const sprite = this.sprites.createStatic(tileKey, targetFrame);

        if (sprite) {
          this.sprites.position(
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
          objectLayer2.addChild(sprite);
          this.onSpriteCreated?.(
            sprite,
            cell.layer2,
            cell.id,
            2,
            0,
            cell.layerObject2Flip
          );

          this.trackSprite({
            sprite,
            tileKey,
            frameIndex: targetFrame,
            isAnimated: false,
            cellId: cell.id,
            basePosition,
            mapScale,
            layer: 2,
          });
        }
      }
    }
  }

  /** Sprite references for zoom texture swapping. */
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
   * Clear sprite refs and textures. When a Scene is attached, remove every
   * tracked TileActor from it (which disposes the underlying sprite).
   */
  clear(): void {
    this.textureCache.clear();

    if (this.scene) {
      for (const ref of this.spriteRefs) {
        if (ref.actor && this.scene.has(ref.actor.id)) {
          this.scene.remove(ref.actor.id);
        }
      }
    }

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
