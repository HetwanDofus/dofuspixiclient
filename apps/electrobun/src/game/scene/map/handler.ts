import {
  type AnimatedSprite,
  Container,
  type Renderer,
  type Sprite,
  type Ticker,
} from "pixi.js";

import type { AtlasLoader } from "@/game/render/atlas-loader";
import { TileResolver } from "@/game/render/tile-resolver";
import {
  type LayeredTilePlacement,
  TileSpriteRenderer,
} from "@/game/render/tile-sprite-renderer";
import {
  buildBaseMapPlacements,
  pushPlacementByKey,
} from "@/game/scene/map/placements";
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
/**
 * Tile rendered on cells the player simply cannot stand on (walls,
 * obstacle cells with `movement <= 1`). Canonical AS2 uses the
 * hardcoded `10002` tile id (Cell.as:191); we reuse the same
 * "blocked" visual we ship for LOS-blocked cells because no
 * `100002` asset was extracted into `public/assets/dofassets/gfx/tactic/`
 * — falling through to id 0 (previous behaviour) left a gap on the
 * tactic grid wherever there's a wall or hole, which is what the
 * user reports as "doesn't display all the cells".
 */
const TACTIC_LAYER1_NON_WALKABLE = 100012;
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
interface LangMapEntry {
  /** Subarea id — keys into `MA.sa[<subareaId>]` for theme + colours. */
  sa?: number;
}
interface LangMapsCache {
  sa: Record<string, LangSubarea>;
  m: Record<string, LangMapEntry>;
}
let tacticLangCache: LangMapsCache | null = null;
let tacticLangPending: Promise<LangMapsCache | null> | null = null;
async function loadTacticLangData(): Promise<LangMapsCache | null> {
  if (tacticLangCache) return tacticLangCache;
  if (tacticLangPending) return tacticLangPending;
  tacticLangPending = (async () => {
    try {
      // Theme strings + map subarea mapping are both locale-agnostic;
      // any locale's `maps.json` yields the same `MA.sa` themes and
      // `MA.m.<id>.sa` subarea references. Fetch `fr` since it ships
      // by default with the asset pack.
      const res = await fetch("/assets/langs/fr/maps.json");
      if (!res.ok) return null;
      const json = (await res.json()) as {
        data?: {
          MA?: {
            sa?: Record<string, LangSubarea>;
            m?: Record<string, LangMapEntry>;
          };
        };
      };
      const sa = json.data?.MA?.sa ?? null;
      const m = json.data?.MA?.m ?? null;
      if (sa && m) {
        tacticLangCache = { sa, m };
        return tacticLangCache;
      }
      return null;
    } catch {
      return null;
    } finally {
      tacticLangPending = null;
    }
  })();
  return tacticLangPending;
}
async function loadTacticLangSubareas(): Promise<Record<
  string,
  LangSubarea
> | null> {
  const data = await loadTacticLangData();
  return data?.sa ?? null;
}
async function loadMapSubareaId(mapId: number): Promise<number> {
  const data = await loadTacticLangData();
  if (!data) return 0;
  const entry = data.m[String(mapId)];
  return entry?.sa ?? 0;
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
  /**
   * Tactic-mode extra placements that travel through the same
   * `TileSpriteRenderer` pipeline as cells: an optional wide-area
   * background placement plus the per-LOS-cell theme decor sprites.
   *
   * Theme decor lives in `gfx/tactic.swf` as multi-frame symbols named
   * by theme (`arene`, `foret`, `cimetiere`, ...) with 3 frames each —
   * NOT as separate `arene_0/_1/_2` exports. Each decor placement
   * therefore shares the same tile key `tactic_<theme>` and varies the
   * frame via `staticFrame`, which round-robins 0/1/2 across selected
   * cells (matches AS `gotoAndStop(counter % 3 + 1)`).
   *
   * The canonical tactic background (`backgroundNum = 631/632`) is a
   * standalone `tiles/grounds/631.swf` / `632.swf` in vanilla 1.29; our
   * extraction pipeline does not include those clips, so `bgTileKey`
   * stays null until they're added and only the gridded cells + decor
   * render. (Skipping the bg gracefully leaves the original map
   * background visible through the tactic grid — acceptable until the
   * assets land.)
   *
   * Null when not in tactic mode.
   */
  private tacticExtras: {
    bgTileKey: string | null;
    decor: Array<{
      tileKey: string;
      frame: number;
      cellId: number;
      basePos: { x: number; y: number };
      groundSlope: number;
    }>;
  } | null = null;

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
   * Push the contain-fit transform into each of the four layer
   * containers. Maps larger than the canonical 15×17 viewport need
   * `mapScale.scale < 1` + an offset to fit inside `742 × 432`; we
   * apply that once at the layer-container level so every descendant
   * (tile sprites, players, spell VFX) is positioned correctly
   * without each renderer having to know about mapScale.
   */
  private applyMapScaleToLayers(mapScale: MapScale): void {
    for (const layer of [
      this.backgroundLayer,
      this.groundLayer,
      this.objectLayer1,
      this.objectLayer2,
    ]) {
      layer.scale.set(mapScale.scale);
      layer.x = mapScale.offsetX;
      layer.y = mapScale.offsetY;
    }
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
   * Placements carry raw logical-pixel cell positions (no mapScale
   * baked in). The "contain"-fit transform for bigger-than-default
   * maps is applied once at the layer-container level (see
   * `applyMapScaleToLayers`) so every child — tile sprites, players in
   * `objectLayer2`, etc. — inherits the same scale + offset.
   */
  private buildPlacements(
    mapData: MapData,
    prefixOverride: Map<number, TilePrefixOverride> | null
  ): LayeredTilePlacement[] {
    // Base layers (background + ground/object1/object2) are shared with
    // the neighbour-map bakes — see `scene/map/placements.ts`. Layer
    // ordering inside the array is irrelevant; `TileSpriteRenderer`
    // assigns each sprite a zIndex from its cell position and the layer
    // routing gives the canonical painter's order.
    const out = buildBaseMapPlacements(
      mapData,
      this.tileResolver,
      prefixOverride
    );

    // Tactic background — `backgroundNum` on tacticMapData is 0
    // (canonical AS suppresses the normal bg path on enter), so the
    // base builder pushed nothing; emit the tactic bg here instead.
    // Skipped entirely when the bg asset isn't available — leaving the
    // original map background visible behind the tactic grid.
    if (
      (!mapData.backgroundNum || mapData.backgroundNum <= 0) &&
      this.tacticExtras?.bgTileKey
    ) {
      pushPlacementByKey(
        out,
        this.tileResolver,
        this.tacticExtras.bgTileKey,
        0,
        {
          cellId: 0,
          cellX: 0,
          cellY: 0,
          rotation: 0,
          flip: false,
          groundSlope: 1,
          isBackground: true,
        }
      );
    }

    // Tactic decor — same painter's-order layer as object2 so the
    // theme sprites (clouds / leaves / etc.) sit above the cell tile
    // markers and below fighters (which live in objectLayer2 too via
    // the world-actors renderer, at higher per-cell zIndex offsets).
    // Canonical AS `MapHandler.addTacticAdditionnalDecor` walks every
    // Nth LOS-blocking cell + `gotoAndStop(counter % 3 + 1)` to cycle
    // the three frames of the theme sprite. We mirror that with the
    // `staticFrameOverride` so each decor placement renders the right
    // frame (theme exports are multi-frame symbols, not 3 separate
    // exports — that was the previous bug).
    if (this.tacticExtras) {
      for (const d of this.tacticExtras.decor) {
        pushPlacementByKey(out, this.tileResolver, d.tileKey, 2, {
          cellId: d.cellId,
          cellX: d.basePos.x,
          cellY: d.basePos.y,
          rotation: 0,
          flip: false,
          groundSlope: d.groundSlope,
          staticFrameOverride: d.frame,
        });
      }
    }

    return out;
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

    // Bake the "contain"-fit transform for bigger-than-default maps
    // into the four layer containers. Tile sprites + players + spell
    // VFX (all children of these layers) inherit the scale + offset;
    // grid / debug / world-cell-tints overlays sit elsewhere in
    // mapContainer and already apply mapScale per-cell themselves so
    // they're unaffected.
    this.applyMapScaleToLayers(mapScale);

    // Snapshot for ticker-driven re-renders (zoom, tactic toggle, etc).
    this.currentMapData = mapData;
    this.currentMapScale = mapScale;
    this.currentPrefixOverride = null; // restored below by tactic mode

    if (this.tileSpriteRenderer) {
      // mapContainer.scale = zoom propagates to the layer containers
      // and into each tile sprite. The tile renderer also bumps its
      // own rasterization density so non-bg tiles get crisp Vello
      // textures at the new user zoom; backgrounds keep their pinned
      // BG_RESOLUTION texture (see `setTileResolution` docs).
      this.tileSpriteRenderer.setTileResolution(zoom);
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
    zoom: number,
    _mapData?: MapData,
    _viewport?: Viewport | null
  ): Promise<boolean> {
    if (!this.tileSpriteRenderer) {
      return false;
    }
    // Bump non-bg tile density so the new zoom level oversamples
    // crisply, then re-walk placements so any structural changes
    // land. Backgrounds skip the density bump inside
    // `setTileResolution` — they keep their pinned-BG_RESOLUTION
    // texture for the session.
    this.tileSpriteRenderer.setTileResolution(zoom);
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
  /**
   * Returns `true` when the renderer has live tile sprites the
   * zoom path can update in-place. The new TileSpriteRenderer
   * pipeline ALWAYS qualifies once `renderMap` has run — `setPlacements`
   * is incremental, so `updateTexturesForZoom` re-rasterizes each
   * sprite's texture at the new density without tearing down its
   * animation state (`currentFrame`, `accumMs`). The legacy
   * layerBuilder fallback is kept for tactic-mode decor; we OR both
   * so `BattlefieldZoom` takes the fast path regardless of which
   * pipeline produced the visible tiles.
   *
   * Returning `false` here was the canonical "animated tiles reset
   * to frame 0 on every zoom step" symptom — the slow path calls
   * `clearCache()` + `renderMap()`, which destroys every tile state
   * and re-creates them with `currentFrame = 0`.
   */
  hasSpriteRefs(): boolean {
    return (
      this.tileSpriteRenderer !== null ||
      this.layerBuilder.getSpriteRefs().length > 0
    );
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
        // LOS-blocked: opaque "wall" tint that explicitly signals
        // "spells can't pass through here". Canonical `getTacticGfx(s, 0)`.
        tacticLayer1 = TACTIC_LAYER1_LOS_BLOCKED;
      } else if (movement <= 1) {
        // Non-walkable but visible (movement 0 or 1 — walls,
        // obstacles). Canonical Cell.as:191 paints these too —
        // dropping them to 0 left holes in the tactic grid. Reuse
        // the LOS-blocked sprite as a stand-in until we extract
        // canonical `10002` separately.
        tacticLayer1 = TACTIC_LAYER1_NON_WALKABLE;
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

    // Theme lookup drives the per-LOS-cell decor sprites. Subarea 0
    // means "unknown" → decor is skipped (the gridded cells still
    // render; only the cosmetic clouds/leaves go away).
    //
    // Canonical AS `gotoAndStop(counter % 3 + 1)` cycles the three
    // frames of the theme symbol — they're frames of ONE multi-frame
    // sprite (`arene`, `foret`, ...) inside `gfx/tactic.swf`, not
    // three sibling exports `arene_0/_1/_2`. The tile key stays
    // `tactic_<theme>`; the frame is selected per placement via
    // `staticFrameOverride`.
    //
    // `mapData.subareaId` is currently never populated by the map
    // loader (subarea lives in `lang/maps.json:MA.m[mapId].sa`, not in
    // the per-map SWF blob), so we fall back to that lookup here.
    let subareaId = mapData.subareaId ?? 0;
    if (subareaId === 0) {
      subareaId = await loadMapSubareaId(mapData.id);
    }
    const themeTileKey =
      subareaId > 0 ? await this.resolveTacticThemeTileKey(subareaId) : null;

    // Prefetch the theme symbol so its bundle entries are registered
    // before the next `TileResolver.resolve` pass. Backgrounds are
    // intentionally NOT prefetched here — `631.swf`/`632.swf` live as
    // standalone streaming SWFs in vanilla 1.29 and aren't bundled in
    // our extraction, so we skip the bg entirely until the assets land.
    if (themeTileKey) {
      await this.atlasLoader.prefetchTiles([themeTileKey], 1);
    }

    const decorPlacements = themeTileKey
      ? this.computeTacticDecorPlacements(
          mapData,
          themeTileKey,
          TACTIC_DECOR_FRAME_COUNT
        )
      : [];

    this.tacticExtras = {
      bgTileKey: null,
      decor: decorPlacements,
    };

    const tacticMapData: MapData = {
      ...mapData,
      cells: tacticCells,
      backgroundNum: 0,
    };

    await this.renderMap(tacticMapData, mapContainer, zoom, viewport, {
      preserveWorldActors: true,
    });

    // `renderMap` resets `currentPrefixOverride` to null (it's the
    // canonical "fresh map" path), so we install the tactic prefix
    // AFTER it and re-walk placements — otherwise the tactic tile ids
    // (e.g. `tactic_100012`) get composed as `objects_100012` and the
    // TileResolver fails every cell with "Tile objects_100012 not
    // found in any SWF bundle". The decor lives in `tacticExtras`
    // (still set across the renderMap call), so this single
    // rebuildTilePlacements emits cells + decor at once.
    this.currentPrefixOverride = prefixes;
    this.rebuildTilePlacements();
  }

  /**
   * Compute the per-LOS-cell decor placements for tactic mode — the
   * pure-data half of canonical `MapHandler.addTacticAdditionnalDecor`.
   * Edge filter skips the top 3 rows + even-row map edges so decor
   * sprites never clip at the border. Round-robins the theme symbol's
   * frames 0..frameCount-1 across the selected cells (matches AS
   * `gotoAndStop(counter % _nTacticDecorTotalAsset + 1)`).
   */
  private computeTacticDecorPlacements(
    mapData: MapData,
    themeTileKey: string,
    frameCount: number
  ): Array<{
    tileKey: string;
    frame: number;
    cellId: number;
    basePos: { x: number; y: number };
    groundSlope: number;
  }> {
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
    const out: Array<{
      tileKey: string;
      frame: number;
      cellId: number;
      basePos: { x: number; y: number };
      groundSlope: number;
    }> = [];
    let frameCounter = 0;
    for (let i = 0; i < losCells.length; i += frequency) {
      const cell = losCells[i]!;
      out.push({
        tileKey: themeTileKey,
        frame: frameCounter % frameCount,
        cellId: cell.id,
        basePos: getCellPosition(cell.id, width, cell.groundLevel),
        groundSlope: cell.groundSlope ?? 1,
      });
      frameCounter++;
    }
    return out;
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
    this.tacticExtras = null;
    this.layerBuilder.setTilePrefixOverride(null);
    await this.renderMap(mapData, mapContainer, zoom, viewport, {
      preserveWorldActors: true,
    });
  }

  isTacticMode(): boolean {
    return this.tacticBackup !== null;
  }

  /**
   * Drop internal tactic-mode state (backup + prefix override + bg/
   * decor extras) without re-rendering. Used by the battlefield when
   * loading a new map while tactic mode was active — the normal
   * {@link renderMap} pass then runs unadorned, and the caller
   * re-applies {@link enterTacticMode} on the fresh map afterwards.
   */
  clearTacticState(): void {
    this.tacticBackup = null;
    this.tacticExtras = null;
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

  getTileSpriteRenderer(): TileSpriteRenderer | null {
    return this.tileSpriteRenderer;
  }

  getAtlasLoader(): AtlasLoader {
    return this.atlasLoader;
  }
}
