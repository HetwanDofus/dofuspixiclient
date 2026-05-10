import {
  type AnimatedSprite,
  Container,
  type Renderer,
  type Sprite,
  type Ticker,
} from "pixi.js";

import type { AtlasLoader } from "@/game/render/atlas-loader";
import {
  type LayeredTilePlacement,
  TileSpriteRenderer,
} from "@/game/render/tile-sprite-renderer";
import { TileResolver } from "@/game/render/tile-resolver";
import { frameIndexForTile } from "@/game/scene/tiles/sprite-factory";
import { createLogger } from "@/utils/logger";

const log = createLogger("MapHandler");

import { cellToCoord } from "@dofus/grid";

import type { CellData } from "@/game/datacenter/cell";
import type { MapData, MapScale } from "@/game/datacenter/map";
import type { Scene } from "@/game/scene/scene";
import { DISPLAY_HEIGHT, DISPLAY_WIDTH } from "@/game/constants/battlefield";
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
  /**
   * Pixi renderer for the new per-tile sprite path. When provided
   * alongside `ticker`, ground + object1 tiles render as Pixi sprites
   * mounted in `groundLayer` / `object1Layer` via `TileSpriteRenderer`
   * (one `renderSwfFrame` per animated-tile advance, retired with
   * `freeRenderTexture` after a 2-tick settle). Replaces the prior
   * `tileSurfaceId`-driven `TileLayerRenderer` (Vello surface) path.
   */
  pixiRenderer?: Renderer;
  ticker?: Ticker;
  /**
   * Unified L3 World layer. When provided, foreground (layer 2) tile
   * placements route to it so they interleave with chars + spells in
   * the canonical Object2 depth band. Layer 0 (ground) + Layer 1
   * (decorations) render through `TileSpriteRenderer`.
   */
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
let tacticLangPending: Promise<Record<string, LangSubarea> | null> | null =
  null;
async function loadTacticLangSubareas(): Promise<Record<
  string,
  LangSubarea
> | null> {
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

  // Persistent layer containers — kept for getXxxLayer() consumers
  // (grid overlay, fight container, etc.) even though no per-cell tile
  // sprites are added to them anymore. The new pipeline owns tile
  // rendering via a single texture overlay at z=350.
  private backgroundLayer = new Container();
  private groundLayer = new Container();
  private objectLayer1 = new Container();
  private objectLayer2 = new Container();

  private tacticBackup: TacticBackup | null = null;

  /**
   * Per-tile Pixi sprite renderer for ground + object1 layers.
   * Constructed when the host provides a `pixiRenderer` + `ticker`.
   * Replaces the legacy `TileLayerRenderer` (Vello surface) path.
   */
  private tileSpriteRenderer: TileSpriteRenderer | null = null;
  private tileResolver = new TileResolver();
  private ticker: Ticker | null = null;
  private tickerCallback: ((t: Ticker) => void) | null = null;
  /** Live view of the current map's mapData/mapScale/zoom for ticker rebuilds. */
  private currentMapData: MapData | null = null;
  private currentMapScale: MapScale | null = null;
  /** Cell prefix override snapshot for tactic-mode tile-key routing. */
  private currentPrefixOverride: Map<number, TilePrefixOverride> | null = null;

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

    if (config.pixiRenderer && config.ticker) {
      this.tileSpriteRenderer = new TileSpriteRenderer(
        config.pixiRenderer,
        this.groundLayer,
        this.objectLayer1,
        this.objectLayer2
      );
      this.ticker = config.ticker;
      this.attachTickerIfNeeded();
    }
  }

  private attachTickerIfNeeded(): void {
    if (!this.ticker || this.tickerCallback) return;
    this.tickerCallback = (t: Ticker) => {
      // `Ticker.deltaMS` is the elapsed wall-clock since last tick.
      this.tileSpriteRenderer?.tick(t.deltaMS);
    };
    this.ticker.add(this.tickerCallback);
  }

  private detachTicker(): void {
    if (this.ticker && this.tickerCallback) {
      this.ticker.remove(this.tickerCallback);
    }
    this.tickerCallback = null;
  }

  /**
   * Rebuild the placement list from the current map data + tactic
   * prefix overrides and hand it to the tile renderer. Triggered on
   * `renderMap`, zoom changes, and tactic-mode toggles.
   */
  private rebuildTilePlacements(): void {
    if (
      !this.tileSpriteRenderer ||
      !this.currentMapData ||
      !this.currentMapScale
    ) {
      return;
    }
    const placements = this.buildPlacements(
      this.currentMapData,
      this.currentPrefixOverride
    );
    this.tileSpriteRenderer.setPlacements(placements);
  }

  /**
   * Walk the map's cells + emit one TilePlacement per (cell, layer)
   * with a non-zero tile id. Honors the active tactic-mode prefix
   * override map (so `cellId → { ground|layer1|layer2: { prefix, idOverride }
   * }` reroutes the bundle/exportName lookup).
   *
   * Background tiles render as a single placement at cell pos (0, 0)
   * — the renderer's matrix takes care of map-scale + offset.
   */
  private buildPlacements(
    mapData: MapData,
    prefixOverride: Map<number, TilePrefixOverride> | null
  ): LayeredTilePlacement[] {
    const out: LayeredTilePlacement[] = [];

    // Layer ordering matters — Pixi sortable-children sorts by zIndex
    // within each layer container; the layer ROUTING (groundLayer
    // vs object1Layer) gives us the canonical painter's order
    // (background z=100 → ground z=200 → object1 z=300).
    if (mapData.backgroundNum && mapData.backgroundNum > 0) {
      this.pushPlacementByKey(out, `ground_${mapData.backgroundNum}`, 0, {
        cellId: 0,
        cellX: 0,
        cellY: 0,
        rotation: 0,
        flip: false,
        groundSlope: 1,
      });
    }

    // Layer 0: ground.
    for (const cell of mapData.cells) {
      if (cell.ground <= 0) continue;
      const basePos = getCellPosition(cell.id, mapData.width, cell.groundLevel);
      const groundSlope = cell.groundSlope ?? 1;
      const tileKey = this.tileKeyFor(cell.id, 0, cell.ground, prefixOverride);
      let groundRot = cell.layerGroundRot;
      if (groundSlope !== 1) groundRot = 0;
      this.pushPlacementByKey(out, tileKey, 0, {
        cellId: cell.id,
        cellX: basePos.x,
        cellY: basePos.y,
        rotation: groundRot,
        flip: cell.layerGroundFlip,
        groundSlope,
      });
    }

    // Layer 1: walkable-tile decorations.
    for (const cell of mapData.cells) {
      if (cell.layer1 <= 0) continue;
      const basePos = getCellPosition(cell.id, mapData.width, cell.groundLevel);
      const groundSlope = cell.groundSlope ?? 1;
      const tileKey = this.tileKeyFor(cell.id, 1, cell.layer1, prefixOverride);
      const objRot = groundSlope === 1 ? cell.layerObject1Rot : 0;
      this.pushPlacementByKey(out, tileKey, 1, {
        cellId: cell.id,
        cellX: basePos.x,
        cellY: basePos.y,
        rotation: objRot,
        flip: cell.layerObject1Flip,
        groundSlope,
      });
    }

    // Layer 2: foreground objects (buildings, walls, decor). Mounted
    // in object2Layer so Pixi `sortableChildren` interleaves them
    // with char + spell sprites at canonical Object2 sub-offsets.
    for (const cell of mapData.cells) {
      if (cell.layer2 <= 0) continue;
      const basePos = getCellPosition(cell.id, mapData.width, cell.groundLevel);
      const groundSlope = cell.groundSlope ?? 1;
      const tileKey = this.tileKeyFor(cell.id, 2, cell.layer2, prefixOverride);
      this.pushPlacementByKey(out, tileKey, 2, {
        cellId: cell.id,
        cellX: basePos.x,
        cellY: basePos.y,
        rotation: 0, // canonical AS never rotates layer 2
        flip: cell.layerObject2Flip,
        groundSlope,
      });
    }

    return out;
  }

  private pushPlacementByKey(
    out: LayeredTilePlacement[],
    tileKey: string,
    layer: 0 | 1 | 2,
    cell: {
      cellId: number;
      cellX: number;
      cellY: number;
      rotation: number;
      flip: boolean;
      groundSlope: number;
    }
  ): void {
    const resolved = this.tileResolver.resolve(tileKey);
    if (!resolved) return;
    const isAnimated = resolved.kind === "animated" && resolved.frameCount > 1;
    const behavior = resolved.kind === "" ? "static" : resolved.kind;
    const staticFrame = isAnimated
      ? 0
      : frameIndexForTile(
          {
            frameCount: resolved.frameCount,
            behavior,
          } as Parameters<typeof frameIndexForTile>[0],
          cell.cellId,
          cell.groundSlope
        );
    out.push({
      tileKey,
      bundle: resolved.bundle,
      exportName: resolved.exportName,
      cellX: cell.cellX,
      cellY: cell.cellY,
      rotation: cell.rotation & 3,
      flip: cell.flip,
      frameCount: resolved.frameCount,
      isAnimated,
      fps: resolved.fps,
      staticFrame,
      layer,
    });
  }

  private tileKeyFor(
    cellId: number,
    layer: 0 | 1 | 2,
    id: number,
    prefixOverride: Map<number, TilePrefixOverride> | null
  ): string {
    const override = prefixOverride?.get(cellId);
    const layerOverride =
      layer === 0
        ? override?.ground
        : layer === 1
          ? override?.layer1
          : override?.layer2;
    if (layerOverride) {
      return `${layerOverride.prefix}_${layerOverride.idOverride ?? id}`;
    }
    return `${layer === 0 ? "ground" : "objects"}_${id}`;
  }

  async renderMap(
    mapData: MapData,
    mapContainer: Container,
    zoom: number,
    _viewport: Viewport | null = null,
    _opts: { preserveWorldActors?: boolean } = {}
  ): Promise<void> {
    const { width: mapWidth, height: mapHeight } = mapData;
    const mapScale = computeMapScale(mapWidth, mapHeight);
    mapContainer.scale.set(zoom);

    // Re-attach the persistent layer containers to the (possibly new)
    // map container. They no longer hold tile sprites — those are
    // baked into the tile-pipeline overlay — but world-actors uses
    // `objectLayer2` as its parent for player + fighter sprites, and
    // grid overlay / fight container also live in this hierarchy.
    if (this.backgroundLayer.parent !== mapContainer) {
      mapContainer.addChild(this.backgroundLayer);
      mapContainer.addChild(this.groundLayer);
      mapContainer.addChild(this.objectLayer1);
      mapContainer.addChild(this.objectLayer2);
    }

    // Snapshot for ticker-driven re-renders (zoom, tactic toggle, etc).
    this.currentMapData = mapData;
    this.currentMapScale = mapScale;
    this.currentPrefixOverride = null; // restored below by tactic mode

    if (this.tileSpriteRenderer) {
      // mapContainer.scale = zoom propagates to the layer containers
      // and into each tile sprite — no per-sprite resolution rebuild
      // needed when zoom changes (the texture stays at MAP_BG_ZOOM
      // density, so up-/down-scaling stays sharp within MAX_DENSITY).
      this.rebuildTilePlacements();
    } else {
      log.warn(
        "renderMap: no tileSpriteRenderer (host didn't provide pixiRenderer + ticker?)"
      );
    }
    void zoom; // kept for the deprecated viewport call signature
    void DISPLAY_WIDTH;
    void DISPLAY_HEIGHT;
  }

  /**
   * Re-render at a new zoom level. The new pipeline simply re-encodes
   * placement matrices at the new zoom + re-rasterizes — no raster
   * invalidation, no priority queues, no chunked strip rebuilds.
   * Returns true so the BattlefieldZoom fast path proceeds.
   */
  async updateTexturesForZoom(
    _zoom: number,
    _mapData?: MapData,
    _viewport?: Viewport | null
  ): Promise<boolean> {
    if (!this.tileSpriteRenderer) {
      return false;
    }
    // Container scale propagates zoom to all sprites; rebuild only
    // touches per-tile state (which is zoom-independent at the
    // texture level — MAP_BG_ZOOM is the rasterization density).
    this.rebuildTilePlacements();
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
    if (this.tileSpriteRenderer) {
      // Drop the placement list — next renderMap will rebuild it. The
      // diff inside `setPlacements([])` retires every sprite via the
      // 2-tick freeRenderTexture pattern.
      this.tileSpriteRenderer.setPlacements([]);
    }
  }

  /**
   * Tear down the tile pipeline (called on battlefield teardown).
   * Frees the renderer's GPU textures + removes the ticker callback.
   */
  destroy(): void {
    this.detachTicker();
    if (this.tileSpriteRenderer) {
      this.tileSpriteRenderer.destroy();
      this.tileSpriteRenderer = null;
    }
    this.currentMapData = null;
    this.currentMapScale = null;
    this.currentPrefixOverride = null;
  }

  getAnimatedSprites(): AnimatedSprite[] {
    return this.layerBuilder.getAnimatedSprites();
  }

  /**
   * Per-frame Vello tile-pass diagnostics (avg ms, dispatches/sec) for
   * the render watchdog HUD. Returns null when the pipeline isn't
   * active — caller should treat null as "no data yet".
   */
  getTileLayerStats(): {
    avgMs: number;
    lastMs: number;
    dispatchesPerSec: number;
  } | null {
    // Sprite path doesn't dispatch a single tile-pass — stats
    // unavailable. Returns null so the watchdog HUD shows a dash.
    return null;
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
    this.currentPrefixOverride = prefixes;

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
      subareaId > 0 ? await this.resolveTacticThemeTileKey(subareaId) : null;

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
      const basePosition = getCellPosition(cell.id, width, cell.groundLevel);
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
    this.currentPrefixOverride = null;
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

