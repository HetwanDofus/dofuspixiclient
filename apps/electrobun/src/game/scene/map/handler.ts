import { AnimatedSprite, Container, type Sprite } from "pixi.js";

import type { AtlasLoader } from "@/game/render/atlas-loader";
import { createLogger } from "@/utils/logger";

const log = createLogger("MapHandler");

import { cellToCoord } from "@dofus/grid";

import type { CellData } from "@/game/datacenter/cell";
import type { MapData, MapScale } from "@/game/datacenter/map";
import type { Scene } from "@/game/scene/scene";
import {
  Z_BACKGROUND_LAYER,
  Z_GROUND_LAYER,
  Z_OBJECT1_LAYER,
  Z_OBJECT2_LAYER_ROOT,
} from "@/game/constants/z-index";
import { computeMapScale } from "@/game/datacenter";
import { getCellPosition } from "@/game/datacenter/cell";
import {
  TileLayerBuilder,
  type TilePrefixOverride,
} from "@/game/scene/tiles/layer-builder";

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

/**
 * Decoded from the latest loader.swf (`Cell.method_1263` + `MapHandler.method_261`):
 *
 *   !lineOfSight        → layer1 = 100012          (fixed LOS-blocked marker)
 *   movement <= 1       → layer1 = 0                (empty — tactic bg shows through)
 *   walkable + LOS      → layer1 = "100" + pad2(subarea) + (parity ? "1" : "3")
 *
 *   layer2 == 25        → preserved (sand pit)
 *   !lineOfSight        → layer2 = 100010          (fixed LOS-blocked decoration)
 *   isTrigger           → layer2 = 1030
 *   else                → layer2 = 0
 *
 *   ground always cleared to 0
 *
 * Parity: `abs(x) % 2 == abs(y) % 2` where (x,y) come from the Dofus diagonal
 * grid coordinate function `getCaseCoordonnee(mapHandler, num)`.
 *
 * NOTE: in our current cell decoder the 4 bits at `d4 >> 2` land in
 * `cellData.groundSlope` but actually encode the subarea (the AS field
 * `name_255`). The real `groundSlope` was dropped from the new cell format —
 * per-cell elevation is no longer carried here.
 */
const TACTIC_LAYER1_LOS_BLOCKED = 100012;
const TACTIC_LAYER2_LOS_BLOCKED = 100010;
const TRIGGER_LAYER2_ID = 1030;
const SAND_PIT_LAYER2_ID = 25;

/**
 * Count of decor frames we publish per theme (`tactic_<theme>_0..2`). Matches
 * AS `MapHandler._nTacticDecorTotalAsset = 3` — every gfx.tactic theme
 * sprite ships exactly three frames, cycled round-robin by the decor pass.
 */
const TACTIC_DECOR_FRAME_COUNT = 3;

/**
 * `Map.set lineOfSightCells` (loader.swf) derives the decor stride as:
 *   Math.max(Math.floor(losCells.length / 9), 3)
 * — sparser on large open maps, capped at every-3rd cell minimum.
 */
function tacticDecorFrequency(losCellCount: number): number {
  return Math.max(Math.floor(losCellCount / 9), 3);
}

/**
 * Lazy lang.MA.sa loader. The maps lang bundle is published per locale but
 * `tt` (theme name) is locale-agnostic — any locale's bundle yields the same
 * theme strings, so we always fetch `fr`.
 */
interface LangSubarea {
  tt?: string;
  tc?: string[];
}
let tacticLangCache: Record<string, LangSubarea> | null = null;
let tacticLangPending: Promise<Record<string, LangSubarea> | null> | null = null;
async function loadTacticLangSubareas(): Promise<
  Record<string, LangSubarea> | null
> {
  if (tacticLangCache) return tacticLangCache;
  if (tacticLangPending) return tacticLangPending;
  tacticLangPending = (async () => {
    try {
      const res = await fetch("/assets/langs/fr/maps.json");
      if (!res.ok) return null;
      const json = (await res.json()) as {
        data?: { MA?: { sa?: Record<string, LangSubarea> } };
      };
      const sa = json.data?.MA?.sa ?? null;
      if (sa) tacticLangCache = sa;
      return sa;
    } catch {
      return null;
    } finally {
      tacticLangPending = null;
    }
  })();
  return tacticLangPending;
}

function tacticWalkableTileId(
  subareaIndex: number,
  parityMatch: boolean
): number {
  const sub = Math.max(1, Math.min(15, subareaIndex));
  const subPad = sub < 10 ? `0${sub}` : String(sub);
  return Number(`100${subPad}${parityMatch ? "1" : "3"}`);
}


interface TacticCellBackup {
  ground: number;
  layer1: number;
  layer2: number;
}

interface TacticBackup {
  cells: Map<number, TacticCellBackup>;
  backgroundNum: number | undefined;
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

  private tacticBackup: TacticBackup | null = null;

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

    // mapContainer (our eventual parent) sorts its children by zIndex.
    // Set each root layer's zIndex so the stacking order is explicit
    // and independent of add-child call order — otherwise later-added
    // children (fight-container, grid overlay) would always sit on top.
    this.backgroundLayer.zIndex = Z_BACKGROUND_LAYER;
    this.groundLayer.zIndex = Z_GROUND_LAYER;
    this.objectLayer1.zIndex = Z_OBJECT1_LAYER;
    this.objectLayer2.zIndex = Z_OBJECT2_LAYER_ROOT;
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
    viewport: Viewport | null = null,
    opts: { preserveWorldActors?: boolean } = {}
  ): Promise<void> {
    // Opt #5: Reuse persistent layers — just clear children
    this.backgroundLayer.removeChildren();
    this.groundLayer.removeChildren();
    this.objectLayer1.removeChildren();
    if (opts.preserveWorldActors) {
      // Tactic mode: objectLayer2 hosts both foreground tiles AND fighter
      // containers from PlayerRenderer. We can't blanket-remove or the
      // fighters vanish. Drop only the tile-builder-owned sprites (tracked
      // via spriteRefs) and leave everything else attached.
      this.layerBuilder.dropLayerSprites(2);
    } else {
      this.objectLayer2.removeChildren();
    }
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
        uniqueTileKeys.add(this.layerBuilder.tileKeyFor(cell.id, 0, cell.ground));
      }

      if (cell.layer1 > 0) {
        uniqueTileKeys.add(this.layerBuilder.tileKeyFor(cell.id, 1, cell.layer1));
      }

      if (cell.layer2 > 0) {
        uniqueTileKeys.add(this.layerBuilder.tileKeyFor(cell.id, 2, cell.layer2));
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

  /**
   * Swap the map to the tactic-view port of `MapHandler.tacticMode(true)`.
   *
   * Per-cell rewrite mirrors `ank.battlefield.datacenter.Cell.turnTactic`:
   * walkable cells get a blue checkered pattern (parity A/B), walkable cells
   * that block line of sight get a red "LOS-blocked" marker, non-walkable
   * cells get a "blocked" marker. Background and ground are cleared so the
   * tactic sprites land on the canvas clear colour. Non-flat cells
   * (`groundSlope !== 1`) keep their original art, as the AS guard does.
   *
   * Safe to call while already active (no-op). State is restored by
   * {@link exitTacticMode} or automatically on the next call with
   * `replayInPlace=true` (used when a new map loads mid-tactic-mode).
   */
  async enterTacticMode(
    mapData: MapData,
    mapContainer: Container,
    zoom: number,
    viewport: Viewport | null
  ): Promise<void> {
    if (this.tacticBackup) {
      this.tacticBackup = null;
    }

    const backup = new Map<number, TacticCellBackup>();
    const prefixes = new Map<number, TilePrefixOverride>();
    const tacticCells: CellData[] = [];

    for (const cell of mapData.cells) {
      backup.set(cell.id, {
        ground: cell.ground,
        layer1: cell.layer1,
        layer2: cell.layer2,
      });

      if (!cell.active) {
        tacticCells.push(cell);
        continue;
      }

      // `cell.groundSlope` in our decoder carries what the AS2 source calls
      // `name_255` — the per-cell subarea (1..15). Naming is historical;
      // don't rename without updating the codec.
      const subareaIndex = cell.groundSlope ?? 1;
      const { x, y } = cellToCoord(cell.id, mapData.width);
      const parityMatch = Math.abs(x) % 2 === Math.abs(y) % 2;
      const movement = cell.movement ?? 0;
      const los = cell.lineOfSight !== false;
      const isTrigger = cell.layer2 === TRIGGER_LAYER2_ID;

      let tacticLayer1: number;
      const layer1Prefix: TilePrefixOverride["layer1"] = { prefix: "tactic" };
      if (!los) {
        tacticLayer1 = TACTIC_LAYER1_LOS_BLOCKED;
      } else if (movement <= 1) {
        tacticLayer1 = 0;
      } else {
        tacticLayer1 = tacticWalkableTileId(subareaIndex, parityMatch);
      }

      let tacticLayer2: number;
      let layer2Prefix: TilePrefixOverride["layer2"] | undefined;
      if (cell.layer2 === SAND_PIT_LAYER2_ID) {
        tacticLayer2 = SAND_PIT_LAYER2_ID;
      } else if (!los) {
        tacticLayer2 = TACTIC_LAYER2_LOS_BLOCKED;
        layer2Prefix = { prefix: "tactic" };
      } else if (isTrigger) {
        tacticLayer2 = TRIGGER_LAYER2_ID;
      } else {
        tacticLayer2 = 0;
      }

      const prefixEntry: TilePrefixOverride = {};
      if (tacticLayer1 > 0) prefixEntry.layer1 = layer1Prefix;
      if (layer2Prefix) prefixEntry.layer2 = layer2Prefix;
      if (Object.keys(prefixEntry).length > 0) {
        prefixes.set(cell.id, prefixEntry);
      }

      tacticCells.push({
        ...cell,
        // AS `turnTactic` resets these three and clears ground.
        layerObject1Rot: 0,
        layerObject1Flip: false,
        layerObject2Flip: false,
        ground: 0,
        layer1: tacticLayer1,
        layer2: tacticLayer2,
      });
    }

    this.tacticBackup = {
      cells: backup,
      backgroundNum: mapData.backgroundNum,
    };
    this.layerBuilder.setTilePrefixOverride(prefixes);

    // AS MapHandler.method_260 sets backgroundNum = 631 on enter, falls
    // back to 632 when the map had no original background. Both tiles ship
    // under tiles/objects/ (not tiles/ground/) because they come from the
    // o*.swf atlases in the Dofus asset pack — Flash's attachMovie looks
    // up symbols by name regardless of tile category, so the original
    // client didn't care. Our atlas loader splits grounds and objects, so
    // we suppress the generic renderBackground path and paint the tactic
    // background explicitly from the objects atlas.
    const tacticMapData: MapData = {
      ...mapData,
      cells: tacticCells,
      backgroundNum: 0,
    };

    await this.renderMap(tacticMapData, mapContainer, zoom, viewport, {
      preserveWorldActors: true,
    });

    const tacticBgId =
      mapData.backgroundNum && mapData.backgroundNum > 0 ? 631 : 632;
    const tacticBgTileKey = `objects_${tacticBgId}`;
    const mapScale = computeMapScale(mapData.width, mapData.height);

    // Theme lookup drives both decor sprite selection and the eventual
    // theme-coloured overlay (not wired yet — stubbed). Subarea 0 means
    // "unknown" so decor is skipped; the tactic background still renders.
    const subareaId = mapData.subareaId ?? 0;
    const themeTileKey =
      subareaId > 0
        ? await this.resolveTacticThemeTileKey(subareaId)
        : null;

    const prefetchKeys = [tacticBgTileKey];
    const themeFrameKeys: string[] = [];
    if (themeTileKey) {
      for (let f = 0; f < TACTIC_DECOR_FRAME_COUNT; f++) {
        themeFrameKeys.push(`${themeTileKey}_${f}`);
      }
      prefetchKeys.push(...themeFrameKeys);
    }
    await this.atlasLoader.prefetchTiles(prefetchKeys, 1);

    this.layerBuilder.renderBackgroundByTileKey(
      tacticBgTileKey,
      this.backgroundLayer,
      mapScale,
      String(tacticBgId)
    );

    if (themeFrameKeys.length > 0) {
      this.renderTacticDecor(mapData, themeFrameKeys, mapScale);
    }
  }

  /**
   * Resolve a subareaId → `tactic_<theme>` tileKey via the published lang
   * bundle. Returns null when the lang row is missing a `tt` field or the
   * compiled theme dofasset isn't present.
   */
  private async resolveTacticThemeTileKey(
    subareaId: number
  ): Promise<string | null> {
    const sa = await loadTacticLangSubareas();
    const theme = sa?.[String(subareaId)]?.tt;
    if (!theme) return null;
    return `tactic_${theme}`;
  }

  /**
   * Port of AS `MapHandler.addTacticAdditionnalDecor` — step through the
   * line-of-sight-blocking cells at `tacticDecorFrequency` intervals and
   * stamp a theme decor sprite on objectLayer2 at each sampled cell,
   * cycling through the 3 theme frames round-robin (matches AS
   * `gotoAndStop(counter % _nTacticDecorTotalAsset + 1)`). Filter matches
   * `Cell.method_2506` (skip top 3 rows + even-row edges so decor never
   * clips at the map border).
   */
  private renderTacticDecor(
    mapData: MapData,
    themeFrameKeys: string[],
    mapScale: MapScale
  ): void {
    const width = mapData.width;
    const stride = 2 * width - 1;
    const losCells: CellData[] = [];
    for (const cell of mapData.cells) {
      if (!cell.active) continue;
      if (cell.lineOfSight !== false) continue;
      if (cell.id <= width * 3) continue;
      const rem = cell.id % stride;
      if (rem === 0 || rem === width - 1) continue;
      losCells.push(cell);
    }

    const frequency = tacticDecorFrequency(losCells.length);
    const frameCount = themeFrameKeys.length;
    let frameCounter = 0;

    for (let i = 0; i < losCells.length; i += frequency) {
      const cell = losCells[i]!;
      const tileKey = themeFrameKeys[frameCounter % frameCount]!;
      frameCounter++;
      const basePosition = getCellPosition(
        cell.id,
        width,
        cell.groundLevel
      );
      this.layerBuilder.renderTacticDecor(
        tileKey,
        cell.id,
        basePosition,
        mapScale,
        this.objectLayer2
      );
    }
  }

  /**
   * Reverse {@link enterTacticMode}: clear the prefix override map and
   * re-render using the original MapData so the normal terrain comes back.
   * No-op when tactic mode isn't active.
   */
  async exitTacticMode(
    mapData: MapData,
    mapContainer: Container,
    zoom: number,
    viewport: Viewport | null
  ): Promise<void> {
    if (!this.tacticBackup) {
      return;
    }
    this.tacticBackup = null;
    this.layerBuilder.setTilePrefixOverride(null);
    await this.renderMap(mapData, mapContainer, zoom, viewport, {
      preserveWorldActors: true,
    });
  }

  isTacticMode(): boolean {
    return this.tacticBackup !== null;
  }

  /**
   * Drop internal tactic-mode state (backup + prefix override) without
   * re-rendering. Used by the battlefield when loading a new map while
   * tactic mode was active — the normal {@link renderMap} pass then runs
   * unadorned, and the caller re-applies {@link enterTacticMode} on the
   * fresh map afterwards.
   */
  clearTacticState(): void {
    this.tacticBackup = null;
    this.layerBuilder.setTilePrefixOverride(null);
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
