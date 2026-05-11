import {
  AnimatedSprite,
  type Container,
  Sprite,
  type Texture,
} from "pixi.js";

import type { CellData } from "@/game/datacenter/cell";
import type { MapScale } from "@/game/datacenter/map";
import type { AtlasLoader } from "@/game/render/atlas-loader";
import { getCellPosition } from "@/game/datacenter";
import { createLogger } from "@/utils/logger";

import type { Scene } from "../scene";
import { TileActor } from "./actor";
import { frameIndexForTile, TileSpriteFactory } from "./sprite-factory";

/** Per-chunk frame budget; mirrors `MAX_STRIP_FRAMES` in atlas-loader. */
const CHUNK_FRAMES = 8;
/**
 * Number of frames before a chunk boundary at which we trigger
 * the next chunk's render. Gives the GPU dispatch + cache update a
 * buffer to land before the AnimatedSprite needs that frame, so the
 * playback never visibly stalls at a seam.
 */
const CHUNK_PREFETCH_LEAD = 5;

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
  /**
   * True when this Sprite is the "static base" composited under an
   * animated cell's AnimatedSprite — its texture comes from
   * `atlasLoader.getStaticBaseTexture(tileKey)` rather than the
   * per-frame strip cache. Distinguishing these matters for zoom
   * texture swaps + chunk-landing refresh paths.
   */
  isStaticBase?: boolean;
  /** Cell that owns this sprite; used to dedupe `renderCell` retries
   *  triggered by a deferred-tile-ready notification. */
  cellId: number;
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

  /**
   * Unsub handle for the atlas loader's "new strip chunk landed"
   * notifications. Called from `clear()` so a fresh layer builder
   * doesn't get callbacks routed at destroyed sprites.
   */
  private unsubscribeAnimationFrames: (() => void) | null = null;
  /** Unsub for the atlas loader's "zoom invalidated these tiles" event. */
  private unsubscribeAnimationsInvalidated: (() => void) | null = null;
  /**
   * Per-tileKey list of "I couldn't render this cell-layer because the
   * animated tile's chunk 0 hasn't landed yet — try again when it does"
   * closures. Keyed by tileKey so the chunk-0-landed callback can find
   * matches in O(1). The closure captures cell + layer + container
   * refs so retry doesn't need to re-traverse cell data.
   */
  private deferredCellRenders = new Map<string, Array<() => void>>();

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
    // Hook up the deferred-strip notification path. On chunk-0 land
    // for a tileKey: (a) drain any cells we deferred during the
    // synchronous renderCell pass (they had no tile data because
    // animated-tile rendering is fully deferred to background); then
    // (b) refresh every existing AnimatedSprite for the tile so its
    // textures array picks up the newly cached frames. (a) must run
    // before (b) since deferred cells will themselves create new
    // AnimatedSprites that immediately have full chunk-0 textures.
    this.unsubscribeAnimationFrames =
      this.atlasLoader.onAnimationFramesAvailable((tileKey) => {
        this.drainDeferredCellRenders(tileKey);
        this.refreshAnimatedSprites(tileKey);
      });
    // On zoom: hide animated + static-base sprites for invalidated tiles
    // so Pixi doesn't draw the stale physical bitmap at the new
    // resolution. They'll be re-shown by `refreshAnimatedSprites` once
    // the background pass produces fresh textures at the new zoom.
    this.unsubscribeAnimationsInvalidated =
      this.atlasLoader.onAnimationsInvalidated((tileKeys) => {
        this.hideStaleAnimatedSprites(tileKeys);
      });
  }

  /**
   * Hide animated AnimatedSprites + their static-base Sprites for the
   * given tile keys. Static (non-animated) sprite refs get a fresh
   * texture swap inside `MapHandler.updateTexturesForZoom` so they stay
   * visible across the zoom transition.
   */
  private hideStaleAnimatedSprites(tileKeys: string[]): void {
    if (tileKeys.length === 0) return;
    const set = new Set(tileKeys);
    for (const ref of this.spriteRefs) {
      if (!set.has(ref.tileKey)) continue;
      if (ref.sprite.destroyed) continue;
      if (ref.isAnimated || ref.isStaticBase) {
        ref.sprite.visible = false;
      }
    }
  }

  /**
   * Run every deferred renderCell-layer closure for the given tileKey.
   * Called when chunk 0 (or any future chunk) of an animated tile's
   * strip lands and the tile's manifest + frame-0 texture become
   * available — we couldn't render those cells synchronously because
   * the manifest was null. Closures are one-shot; we delete the bucket
   * after firing so a subsequent chunk landing doesn't re-run them.
   */
  private drainDeferredCellRenders(tileKey: string): void {
    const list = this.deferredCellRenders.get(tileKey);
    if (!list || list.length === 0) {
      return;
    }
    this.deferredCellRenders.delete(tileKey);
    for (const fn of list) {
      try {
        fn();
      } catch (err) {
        log.warn(`deferred renderCell closure threw: ${String(err)}`);
      }
    }
  }

  /** Push a deferred render closure for `tileKey`. */
  private deferCellRender(tileKey: string, fn: () => void): void {
    let list = this.deferredCellRenders.get(tileKey);
    if (!list) {
      list = [];
      this.deferredCellRenders.set(tileKey, list);
    }
    list.push(fn);
  }

  /**
   * Refresh `sprite.textures` on every AnimatedSprite for `tileKey`
   * after a new strip chunk landed in the atlas-loader's frame cache.
   * Also re-applies the pivot (the strip's per-cell anchor differs
   * from the bundle batch's frame-0 anchor, so content would otherwise
   * jump on the swap) and rewires the chunk-prefetch frame-change
   * listener so the next boundary triggers `ensureAnimationChunk(N+1)`.
   */
  private refreshAnimatedSprites(tileKey: string): void {
    const tile = this.atlasLoader.getTileManifestSync(tileKey);
    if (!tile) {
      return;
    }
    const newTextures = this.atlasLoader.loadAnimationFramesSync(tileKey, 1);
    const staticTex = this.atlasLoader.getStaticBaseTexture(tileKey);
    if (newTextures.length === 0 && !staticTex) {
      return;
    }
    // The manifest's offsetX/Y are the negated anchor — sprite-factory's
    // `position()` writes `pivot = -(tile.offsetX + frame.ox) = anchor`.
    // After a chunk-0 swap, anchor changed (strip union vs bundle-batch
    // tight bounds), so apply the new pivot directly.
    const newPivotX = -tile.offsetX;
    const newPivotY = -tile.offsetY;
    for (const ref of this.spriteRefs) {
      if (ref.tileKey !== tileKey) {
        continue;
      }
      const sprite = ref.sprite;
      if (sprite.destroyed) {
        continue;
      }
      if (ref.isStaticBase) {
        // Static-base Sprite — refresh its texture (e.g. after zoom
        // change re-rendered the base).
        if (staticTex) {
          sprite.texture = staticTex;
          sprite.pivot.set(newPivotX, newPivotY);
          sprite.visible = true;
        }
        continue;
      }
      if (!ref.isAnimated || !(sprite instanceof AnimatedSprite)) {
        continue;
      }
      if (newTextures.length === 0) {
        continue;
      }
      const wasPlaying = sprite.playing;
      const prevFrame = sprite.currentFrame;
      // Setting textures resets internal state; preserve frame +
      // playback so the cycle continues seamlessly across the swap.
      sprite.textures = newTextures;
      sprite.pivot.set(newPivotX, newPivotY);
      if (prevFrame < newTextures.length) {
        sprite.gotoAndStop(prevFrame);
      }
      if (wasPlaying) {
        sprite.play();
      }
      sprite.visible = true;
      this.attachChunkPrefetch(sprite, tileKey);
    }
  }

  /**
   * Attach an `onFrameChange` listener that requests the next chunk
   * (`ensureAnimationChunk(N+1)`) shortly before the AnimatedSprite
   * runs out of currently-rendered frames. Replaces any prior
   * listener on the sprite so re-attachment after a chunk-landing
   * refresh is idempotent.
   */
  private attachChunkPrefetch(sprite: AnimatedSprite, tileKey: string): void {
    const totalFrames =
      this.atlasLoader.getAnimationTotalFrameCount(tileKey) ||
      sprite.textures.length;
    if (totalFrames <= sprite.textures.length) {
      sprite.onFrameChange = undefined;
      return;
    }
    const renderedFrames = sprite.textures.length;
    const triggerFrame = Math.max(0, renderedFrames - CHUNK_PREFETCH_LEAD);
    const nextChunkIndex = Math.floor(renderedFrames / CHUNK_FRAMES);
    let kicked = false;
    sprite.onFrameChange = (frame: number) => {
      if (kicked || frame < triggerFrame) {
        return;
      }
      kicked = true;
      void this.atlasLoader.ensureAnimationChunk(tileKey, nextChunkIndex);
    };
  }

  /**
   * Replace the per-cell prefix override map. Null (or omit) to clear.
   * Consulted by {@link renderCell} when composing tileKeys.
   */
  setTilePrefixOverride(
    map: Map<number, TilePrefixOverride> | null
  ): void {
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
    isStaticBase?: boolean;
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
      isStaticBase: opts.isStaticBase ?? false,
      cellId: opts.cellId,
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
   * Render a single cell synchronously where possible. Cells that
   * reference an animated tile (whose strip is still being rendered in
   * the background) defer their per-layer render via
   * `deferCellRender(tileKey, fn)`; the closure fires once chunk 0
   * lands. Static / slope / random / filter tiles always render here.
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
      this.renderGroundLayer(cell, mapScale, basePosition, groundSlope, groundLayer);
    }
    if (cell.layer1 > 0) {
      this.renderObject1Layer(cell, mapScale, basePosition, groundSlope, objectLayer1);
    }
    if (cell.layer2 > 0) {
      this.renderObject2Layer(cell, mapScale, basePosition, groundSlope, objectLayer2);
    }
  }

  private renderGroundLayer(
    cell: CellData,
    mapScale: MapScale,
    basePosition: { x: number; y: number },
    groundSlope: number,
    groundLayer: Container
  ): void {
    const tileKey = this.tileKeyFor(cell.id, 0, cell.ground);
    const tile = this.atlasLoader.getTileManifestSync(tileKey);
    if (!tile) {
      // Animated tiles are deferred — re-enqueue the render so the
      // chunk-0 landing notification triggers it. No-op for tiles that
      // genuinely don't exist (the deferral set is just GC'd later).
      this.deferCellRender(tileKey, () =>
        this.renderGroundLayer(cell, mapScale, basePosition, groundSlope, groundLayer)
      );
      return;
    }
    const targetFrame = frameIndexForTile(tile, cell.id, groundSlope);
    let groundRot = cell.layerGroundRot;
    if (groundSlope !== 1) {
      groundRot = 0;
    }
    const sprite = this.sprites.createStatic(tileKey, targetFrame);
    if (!sprite) {
      this.deferCellRender(tileKey, () =>
        this.renderGroundLayer(cell, mapScale, basePosition, groundSlope, groundLayer)
      );
      return;
    }
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

  private renderObject1Layer(
    cell: CellData,
    mapScale: MapScale,
    basePosition: { x: number; y: number },
    groundSlope: number,
    objectLayer1: Container
  ): void {
    const tileKey = this.tileKeyFor(cell.id, 1, cell.layer1);
    const tile = this.atlasLoader.getTileManifestSync(tileKey);
    if (!tile) {
      this.deferCellRender(tileKey, () =>
        this.renderObject1Layer(cell, mapScale, basePosition, groundSlope, objectLayer1)
      );
      return;
    }
    let objRot = 0;
    if (groundSlope === 1) {
      objRot = cell.layerObject1Rot;
    }
    const targetFrame = frameIndexForTile(tile, cell.id, groundSlope);
    const sprite = this.sprites.createStatic(tileKey, targetFrame);
    if (!sprite) {
      this.deferCellRender(tileKey, () =>
        this.renderObject1Layer(cell, mapScale, basePosition, groundSlope, objectLayer1)
      );
      return;
    }
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

  private renderObject2Layer(
    cell: CellData,
    mapScale: MapScale,
    basePosition: { x: number; y: number },
    groundSlope: number,
    objectLayer2: Container
  ): void {
    const tileKey = this.tileKeyFor(cell.id, 2, cell.layer2);
    const tile = this.atlasLoader.getTileManifestSync(tileKey);
    if (!tile) {
      // Animated tile not yet rendered. Defer the WHOLE layer-2
      // decision (animated vs static fallback) since both branches
      // need the manifest.
      this.deferCellRender(tileKey, () =>
        this.renderObject2Layer(cell, mapScale, basePosition, groundSlope, objectLayer2)
      );
      return;
    }
    const isInteractive = this.interactiveGfxIds.has(cell.layer2);
    const isAnimated =
      !isInteractive &&
      tile.behavior === "animated" &&
      (tile.frameCount ?? 0) > 1;

    if (isAnimated) {
      const animSprite = this.sprites.createAnimated(tileKey, tile);
      if (!animSprite) {
        // No textures cached yet — defer.
        this.deferCellRender(tileKey, () =>
          this.renderObject2Layer(cell, mapScale, basePosition, groundSlope, objectLayer2)
        );
        return;
      }
      // Static base layer: building geometry that doesn't change
      // frame-to-frame, rendered once per (tile, zoom) and shared
      // across every cell that references this tile. Going under the
      // AnimatedSprite means we composite at the Pixi level instead of
      // re-encoding the static shapes 210× into a single Vello scene
      // (which is what was overflowing the encoder before).
      const staticTex = this.atlasLoader.getStaticBaseTexture(tileKey);
      if (staticTex) {
        const staticSprite = new Sprite(staticTex);
        staticSprite.anchor.set(0, 0);
        this.sprites.position(
          staticSprite,
          tile,
          basePosition,
          0,
          cell.layerObject2Flip,
          cell.id,
          mapScale,
          2,
          0
        );
        objectLayer2.addChild(staticSprite);
        this.trackSprite({
          sprite: staticSprite,
          tileKey,
          frameIndex: 0,
          isAnimated: false,
          isStaticBase: true,
          cellId: cell.id,
          basePosition,
          mapScale,
          layer: 2,
        });
      }
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
      // Wire the chunk-prefetch listener so chunks 1+ render lazily as
      // the AnimatedSprite plays past their boundaries.
      this.attachChunkPrefetch(animSprite, tileKey);
      return;
    }

    const targetFrame = frameIndexForTile(tile, cell.id, groundSlope);
    const sprite = this.sprites.createStatic(tileKey, targetFrame);
    if (!sprite) {
      this.deferCellRender(tileKey, () =>
        this.renderObject2Layer(cell, mapScale, basePosition, groundSlope, objectLayer2)
      );
      return;
    }
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
    // Drop any deferred renders from the previous map — they capture
    // container refs that are about to be torn down.
    this.deferredCellRenders.clear();
  }

  /**
   * Unsubscribe from atlas-loader notifications. Call when this builder
   * is permanently torn down (not on map change — `clear()` keeps the
   * subscription so tiles loaded for the next map still get refreshed).
   */
  destroy(): void {
    this.unsubscribeAnimationFrames?.();
    this.unsubscribeAnimationFrames = null;
    this.unsubscribeAnimationsInvalidated?.();
    this.unsubscribeAnimationsInvalidated = null;
    this.clear();
  }

  /**
   * Get texture cache
   */
  getTextureCache(): Map<string, Texture> {
    return this.textureCache;
  }
}
