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
  /** 0 = ground, 1 = object1, 2 = object2. */
  layer: 0 | 1 | 2;
  /** Present when the builder was given a Scene at construction. */
  actor?: TileActor;
}

/**
 * Per-cell tile override used by tactic mode. Each layer can route to a
 * different atlas (e.g. `tactic_`, `cell_`) and optionally swap the raw
 * numeric id for a string token — `cell_s1`, `tactic_arene` — that isn't
 * representable as a CellData number.
 */
export interface TileLayerOverride {
  prefix: string;
  idOverride?: string | number;
}

export interface TilePrefixOverride {
  ground?: TileLayerOverride;
  layer1?: TileLayerOverride;
  layer2?: TileLayerOverride;
}

export class TileLayerBuilder {
  private atlasLoader: AtlasLoader;
  private interactiveGfxIds: Set<number>;
  private textureCache = new Map<string, Texture>();
  private animatedSprites: AnimatedSprite[] = [];
  private spriteRefs: SpriteRef[] = [];
  private scene: Scene | null;
  private readonly sprites: TileSpriteFactory;
  /** Per-cell prefix override (tactic mode). null when no override active. */
  private tilePrefixOverride: Map<number, TilePrefixOverride> | null = null;
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
   * Replace the per-cell prefix override map. Null (or omit) to clear.
   * Consulted by {@link renderCell} when composing tileKeys.
   */
  setTilePrefixOverride(map: Map<number, TilePrefixOverride> | null): void {
    this.tilePrefixOverride = map;
  }

  private layerOverrideFor(
    cellId: number,
    layer: 0 | 1 | 2
  ): TileLayerOverride | undefined {
    const override = this.tilePrefixOverride?.get(cellId);
    if (!override) return undefined;
    if (layer === 0) return override.ground;
    if (layer === 1) return override.layer1;
    return override.layer2;
  }

  /**
   * Compose a tileKey for (cell, layer) honouring any active prefix override.
   * Public so callers that need to prefetch tiles (e.g. MapHandler.renderMap)
   * get the same routing as the eventual render.
   */
  tileKeyFor(cellId: number, layer: 0 | 1 | 2, id: number): string {
    const override = this.layerOverrideFor(cellId, layer);
    if (override) {
      return `${override.prefix}_${override.idOverride ?? id}`;
    }
    return `${layer === 0 ? "ground" : "objects"}_${id}`;
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
      layer: opts.layer as 0 | 1 | 2,
      actor,
    });
  }

  /**
   * Detach and forget every tile sprite in the given layer without touching
   * any other child of its parent Container. Used by tactic mode to wipe
   * layer-2 foreground tiles while preserving world-actor sprites that
   * share `objectLayer2` with them.
   */
  dropLayerSprites(layer: 0 | 1 | 2): void {
    const kept: SpriteRef[] = [];
    for (const ref of this.spriteRefs) {
      if (ref.layer !== layer) {
        kept.push(ref);
        continue;
      }
      // Prefer scene.remove so the TileActor's dispose() hook runs
      // (it stops animated sprites + destroys them). When no actor
      // (e.g. the builder was constructed without a scene), do the
      // manual teardown.
      if (ref.actor && this.scene?.has(ref.actor.id)) {
        this.scene.remove(ref.actor.id);
      } else if (!ref.sprite.destroyed) {
        if (ref.isAnimated && "stop" in ref.sprite) {
          ref.sprite.stop();
        }
        ref.sprite.parent?.removeChild(ref.sprite);
        ref.sprite.destroy();
      }
    }
    this.spriteRefs = kept;
    this.animatedSprites = this.animatedSprites.filter((s) => !s.destroyed);
  }

  /** Render background tile by numeric id (routes to `ground_<num>`). */
  renderBackground(
    backgroundNum: number,
    layer: Container,
    mapScale: MapScale
  ): void {
    this.renderBackgroundByTileKey(
      `ground_${backgroundNum}`,
      layer,
      mapScale,
      String(backgroundNum)
    );
  }

  /**
   * Render a background tile by explicit tileKey — used by tactic mode to
   * drop a themed `tactic_<theme>` asset in the background slot without
   * needing a numeric id in `MapData.backgroundNum`.
   */
  renderBackgroundByTileKey(
    tileKey: string,
    layer: Container,
    mapScale: MapScale,
    logLabel: string = tileKey
  ): void {
    const bgTile = this.atlasLoader.getTileManifestSync(tileKey);
    const bgSprite = this.sprites.createStatic(tileKey, 0);

    if (!bgSprite) {
      log.warn(`Failed to create background sprite for tile ${logLabel}`);
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
      tileKey,
      frameIndex: 0,
      isAnimated: false,
      cellId: 0,
      basePosition: { x: 0, y: 0 },
      mapScale,
      layer: 0,
    });
  }

  /**
   * Attach a sparse decor sprite on layer-2 above the regular cell tile.
   * Mirrors AS `MapHandler.addTacticAdditionnalDecor` — the theme sprite
   * (arene/foret/…) gets stamped onto a subset of line-of-sight-blocking
   * cells. We track it via spriteRefs (layer 2) so it's wiped on tactic
   * exit by the same `dropLayerSprites(2)` path that removes regular
   * object2 tiles.
   */
  renderTacticDecor(
    tileKey: string,
    cellId: number,
    basePosition: { x: number; y: number },
    mapScale: MapScale,
    parent: Container
  ): void {
    const tile = this.atlasLoader.getTileManifestSync(tileKey);
    const sprite = this.sprites.createStatic(tileKey, 0);
    if (!sprite) return;

    const frame = tile?.frames[0];
    const trimX = frame?.ox ?? 0;
    const trimY = frame?.oy ?? 0;
    sprite.pivot.set(
      -((tile?.offsetX ?? 0) + trimX),
      -((tile?.offsetY ?? 0) + trimY)
    );

    const scale = mapScale.scale;
    sprite.scale.set(scale, scale);
    sprite.position.set(
      basePosition.x * scale + mapScale.offsetX,
      basePosition.y * scale + mapScale.offsetY
    );
    // Above the per-cell layer2 tile (= cellId * Z_OBJECT2_LAYER) so decor
    // draws on top of the cell's ground/walkable marker but below fighters
    // (which live at cellId * Z_OBJECT2_LAYER + Z_PLAYER_OFFSET).
    sprite.zIndex = cellId * 100 + 10;
    parent.addChild(sprite);

    this.trackSprite({
      sprite,
      tileKey,
      frameIndex: 0,
      isAnimated: false,
      cellId,
      basePosition,
      mapScale,
      layer: 2,
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
      const tileKey = this.tileKeyFor(cell.id, 0, cell.ground);
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
      const tileKey = this.tileKeyFor(cell.id, 1, cell.layer1);
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
      const tileKey = this.tileKeyFor(cell.id, 2, cell.layer2);
      const tile = this.atlasLoader.getTileManifestSync(tileKey);
      // An element sits on frame 0 until it is used; a decorative copy of the
      // same gfx keeps animating, so the cell's own interactive bit has to
      // agree before the animation is suppressed.
      const isInteractive =
        cell.layerObject2Interactive === true &&
        this.interactiveGfxIds.has(cell.layer2);
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
