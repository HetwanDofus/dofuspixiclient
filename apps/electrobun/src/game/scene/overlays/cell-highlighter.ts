import { Container, Graphics } from "pixi.js";

import { Direction, getDirOffsets } from "@dofus/grid";

import {
  CELL_HALF_HEIGHT,
  CELL_HALF_WIDTH,
  DEFAULT_GROUND_LEVEL,
  DEFAULT_MAP_WIDTH,
} from "@/game/constants/battlefield";
import { Z_CELL_HIGHLIGHTER } from "@/game/constants/z-index";
import { type CellData, getCellPosition } from "@/game/datacenter/cell";

import { Actor, type ActorId, freshActorId } from "../actor";
import { RENDERED, type Rendered } from "../capabilities";

/**
 * Highlight type for fight cells.
 *
 * Placement cells are keyed by absolute team index (TEAM_0 = 0,
 * TEAM_1 = 1) rather than ally/enemy — the original paints by team
 * number regardless of whose side we're on (MapHandler.as:1013,1022).
 */
export const HighlightType = {
  MOVEMENT: "movement",
  MOVEMENT_PATH: "movement-path",
  ATTACK: "attack",
  SPELL_RANGE: "spell-range",
  SPELL_ZONE: "spell-zone",
  SPELL_ZONE_INVALID: "spell-zone-invalid",
  PLACEMENT_TEAM_0: "placement-team-0",
  PLACEMENT_TEAM_1: "placement-team-1",
  SELECTED: "selected",
  HOVER: "hover",
  GLYPH: "glyph",
  TRAP: "trap",
} as const;

export type HighlightTypeValue =
  (typeof HighlightType)[keyof typeof HighlightType];

/**
 * Highlight colors by type.
 */
// Dofus 1.29 palette, 1:1 with assets/sources/client-code/dofus/Constants.as
// (decimal → hex):
//   CELL_MOVE_RANGE_COLOR   = 39168    → 0x009900 (green,  reachable range via drawZone)
//   CELL_SPELL_RANGE_COLOR  = 2385558  → 0x246696 (blue,   spell range)
//   CELL_PATH_COLOR         = 16737792 → 0xFF6600 (orange, hovered path & AoE preview)
//   CELL_PATH_OVER_COLOR    = 16737792 → 0xFF6600 (orange, hovered path — 1.29 uses
//                                                 this on rollover via gfx.select,
//                                                 see InteractionsManager.as:91)
//   CELL_PATH_SELECT_COLOR  = 2385558  → 0x246696 (blue,   on-release flash)
//   CELL_SPELL_EFFECT_COLOR = 16737792 → 0xFF6600 (orange, spell effect)
//   TEAMS_COLOR             = [16711680, 255] → [0xFF0000, 0x0000FF]
//                              team 0 = red, team 1 = blue
const HIGHLIGHT_COLORS: Record<HighlightTypeValue, number> = {
  [HighlightType.MOVEMENT]: 0x009900,
  [HighlightType.MOVEMENT_PATH]: 0xff6600,
  [HighlightType.ATTACK]: 0xff6600,
  [HighlightType.SPELL_RANGE]: 0x246696,
  [HighlightType.SPELL_ZONE]: 0xff6600,
  [HighlightType.SPELL_ZONE_INVALID]: 0xff0000,
  [HighlightType.PLACEMENT_TEAM_0]: 0xff0000,
  [HighlightType.PLACEMENT_TEAM_1]: 0x0000ff,
  [HighlightType.SELECTED]: 0x246696,
  [HighlightType.HOVER]: 0xffffff,
  // Glyphs are persistent ground markers placed by spells like Sadida's
  // Glyphe Aveuglant — Dofus 1.29 paints them in the spell's element
  // color; we use a default blue close to the original tint until the
  // server-supplied color is plumbed through.
  [HighlightType.GLYPH]: 0x3366ff,
  // Traps render in a distinct orange; visible to the caster's team
  // only in the original (server-side filtering is a follow-up).
  [HighlightType.TRAP]: 0xff8000,
};

// Alphas extracted from the original client's two rendering paths:
//   - `gfx.select(...)` — used for placement cells (MapHandler.as:1013,
//     1022), the hovered path (InteractionsManager.as:91), and the
//     SELECT layer in general. Flash default is `_alpha = 100` (i.e.
//     fully opaque) per SelectionHandler.as:99.
//   - `gfx.drawZone(...)` — used for the reachable-range ring and
//     spell range via Zone.as which always fills at
//     `Zone.ALPHA = 30` (= 0.30 after the 0–100 → 0–1 rescale).
const HIGHLIGHT_ALPHA: Record<HighlightTypeValue, number> = {
  [HighlightType.MOVEMENT]: 0.3,
  [HighlightType.MOVEMENT_PATH]: 1.0,
  [HighlightType.ATTACK]: 0.3,
  [HighlightType.SPELL_RANGE]: 0.3,
  [HighlightType.SPELL_ZONE]: 0.3,
  [HighlightType.SPELL_ZONE_INVALID]: 0.4,
  [HighlightType.PLACEMENT_TEAM_0]: 1.0,
  [HighlightType.PLACEMENT_TEAM_1]: 1.0,
  [HighlightType.SELECTED]: 1.0,
  [HighlightType.HOVER]: 0.3,
  // Glyphs & traps render exactly like the canonical Zone.as: 30%
  // alpha translucent fill across the WHOLE zone polygon (one fill
  // operation, never per-cell — per-cell would create banding
  // wherever cell diamonds overlap), with a 1px solid border on the
  // outer perimeter at full alpha. The 30% mirrors `Zone.ALPHA = 30`.
  [HighlightType.GLYPH]: 0.3,
  [HighlightType.TRAP]: 0.3,
};

// HighlightTypes that render with the canonical Zone.as path (uniform
// fill + outer perimeter border) instead of one polygon per cell. Used
// for persistent ground markers (glyphs / traps) that the original
// client paints via `ZoneHandler.drawZone` → `Zone.drawCircle`.
const ZONE_SHAPE_TYPES: ReadonlySet<HighlightTypeValue> = new Set([
  HighlightType.GLYPH,
  HighlightType.TRAP,
]);

/**
 * Cell highlight configuration.
 */
export interface CellHighlightConfig {
  mapWidth?: number;
  groundLevel?: number;
  cellDataMap?: Map<number, CellData>;
}

/**
 * Cell highlighter for fight visualization.
 * Renders colored overlays on map cells. Managed as a `Rendered` scene Actor
 * so disposal flows through Scene.clear().
 */
export class CellHighlighter extends Actor implements Rendered {
  readonly id: ActorId = freshActorId();
  readonly [RENDERED] = true as const;
  readonly container: Container;
  readonly zIndex = Z_CELL_HIGHLIGHTER;

  private graphics: Graphics;
  // One Set per highlight type — a single cell can be tinted by
  // multiple layers (e.g. the hovered cell of a movement path is also
  // inside the MOVEMENT reachable-tint), and we want both to render.
  private highlights: Map<HighlightTypeValue, Set<number>> = new Map();
  // Persistent ground zones (glyphs / traps). Tracked separately
  // because each instance carries its own color (server-supplied,
  // looked up from the spell's elemental tint) and lives until an
  // explicit GameZoneData REMOVE — multiple glyphs of different
  // elements can coexist on the same map.
  // Outer map keyed by HighlightType (GLYPH or TRAP).
  // Inner map keyed by the zone's center cell (the deploy cell).
  private zones: Map<
    HighlightTypeValue,
    Map<number, { cells: Set<number>; color: number }>
  > = new Map();
  private mapWidth: number;
  private groundLevel: number;
  private cellDataMap: Map<number, CellData>;

  constructor(parentContainer: Container, config: CellHighlightConfig = {}) {
    super();
    this.mapWidth = config.mapWidth ?? DEFAULT_MAP_WIDTH;
    this.groundLevel = config.groundLevel ?? DEFAULT_GROUND_LEVEL;
    this.cellDataMap = config.cellDataMap ?? new Map();

    this.container = new Container();
    this.container.label = "cell-highlighter";
    // Make the Pixi container's zIndex match the Actor's zIndex so
    // sortableChildren on the parent mapContainer places this layer
    // between Object1 and Object2, matching the original's Zone depth.
    this.container.zIndex = Z_CELL_HIGHLIGHTER;

    this.graphics = new Graphics();
    this.container.addChild(this.graphics);

    parentContainer.addChild(this.container);
  }

  /**
   * Highlight a set of cells with a specific type. Replaces any
   * previous highlight of the same type — callers that want to extend
   * a layer should read getCellsOfType first.
   */
  highlightCells(cellIds: number[], type: HighlightTypeValue): void {
    const set = new Set(cellIds);
    if (set.size === 0) {
      this.highlights.delete(type);
    } else {
      this.highlights.set(type, set);
    }
    this.redraw();
  }

  /**
   * Highlight a single cell (additive within its type).
   */
  highlightCell(cellId: number, type: HighlightTypeValue): void {
    let set = this.highlights.get(type);
    if (!set) {
      set = new Set();
      this.highlights.set(type, set);
    }
    set.add(cellId);
    this.redraw();
  }

  /**
   * Clear highlights of a specific type.
   */
  clearHighlightType(type: HighlightTypeValue): void {
    if (this.highlights.delete(type)) {
      this.redraw();
    }
  }

  /**
   * Remove a single cell from any type it belongs to.
   */
  clearCell(cellId: number): void {
    let dirty = false;
    for (const set of this.highlights.values()) {
      if (set.delete(cellId)) {
        dirty = true;
      }
    }
    if (dirty) {
      this.redraw();
    }
  }

  /**
   * Clear all highlights.
   */
  clearAll(): void {
    this.highlights.clear();
    this.zones.clear();
    this.redraw();
  }

  /**
   * Add a persistent ground zone (glyph / trap). Each zone carries
   * its own color so multiple glyphs of different elements can
   * coexist (e.g. fire glyph + water glyph on the same map). Mirrors
   * the canonical `ZoneHandler.drawZone(centerCell, …)` AS path:
   * the zone is keyed by its centre cell so a subsequent
   * `removeZone(centerCell, type)` clears exactly the right one.
   */
  addZone(
    centerCell: number,
    cells: number[],
    type: HighlightTypeValue,
    color: number
  ): void {
    let perType = this.zones.get(type);
    if (!perType) {
      perType = new Map();
      this.zones.set(type, perType);
    }
    perType.set(centerCell, { cells: new Set(cells), color });
    this.redraw();
  }

  /**
   * Remove a previously-added zone by its centre cell + type.
   */
  removeZone(centerCell: number, type: HighlightTypeValue): void {
    const perType = this.zones.get(type);
    if (!perType) {
      return;
    }
    if (perType.delete(centerCell)) {
      if (perType.size === 0) {
        this.zones.delete(type);
      }
      this.redraw();
    }
  }

  /**
   * Clear every active zone of a given type (e.g. on fight end).
   */
  clearZonesOfType(type: HighlightTypeValue): void {
    if (this.zones.delete(type)) {
      this.redraw();
    }
  }

  /**
   * Check if a cell is highlighted in any layer.
   */
  isHighlighted(cellId: number): boolean {
    for (const set of this.highlights.values()) {
      if (set.has(cellId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get cell position considering per-cell ground data.
   */
  private getCellPos(cellId: number): { x: number; y: number } {
    const cell = this.cellDataMap.get(cellId);
    const level = cell?.groundLevel ?? this.groundLevel;
    return getCellPosition(cellId, this.mapWidth, level);
  }

  /**
   * Set map dimensions.
   */
  setMapDimensions(width: number, groundLevel?: number): void {
    this.mapWidth = width;

    if (groundLevel !== undefined) {
      this.groundLevel = groundLevel;
    }

    this.redraw();
  }

  /**
   * Update container position for camera offset.
   */
  setOffset(x: number, y: number): void {
    this.container.x = x;
    this.container.y = y;
  }

  /**
   * Set container scale.
   */
  setScale(scale: number): void {
    this.container.scale.set(scale);
  }

  /**
   * Handle resize/zoom changes.
   */
  onResize(event: { zoom: number }): void {
    this.setScale(event.zoom);
  }

  /**
   * Redraw all highlights.
   */
  private redraw(): void {
    this.graphics.clear();

    // Draw each type in order (background types first). The *_PATH
    // and *_INVALID layers render on top of their base tint so a
    // hovered path is brighter than the reachable-range ring, and an
    // invalid AoE (out-of-LoS) overwrites the range tint in red.
    const drawOrder: HighlightTypeValue[] = [
      HighlightType.PLACEMENT_TEAM_0,
      HighlightType.PLACEMENT_TEAM_1,
      HighlightType.MOVEMENT,
      HighlightType.MOVEMENT_PATH,
      HighlightType.SPELL_RANGE,
      HighlightType.ATTACK,
      HighlightType.GLYPH,
      HighlightType.TRAP,
      HighlightType.SPELL_ZONE_INVALID,
      HighlightType.SPELL_ZONE,
      HighlightType.HOVER,
      HighlightType.SELECTED,
    ];

    for (const type of drawOrder) {
      // Persistent ground zones (glyphs / traps) render via the
      // canonical Zone.drawCircle path with their per-zone wire color.
      if (ZONE_SHAPE_TYPES.has(type)) {
        const perType = this.zones.get(type);
        if (perType) {
          const alpha = HIGHLIGHT_ALPHA[type];
          for (const zone of perType.values()) {
            this.drawZoneShape(zone.cells, zone.color, alpha);
          }
        }
        continue;
      }

      const cells = this.highlights.get(type);
      if (!cells || cells.size === 0) {
        continue;
      }

      const color = HIGHLIGHT_COLORS[type];
      const alpha = HIGHLIGHT_ALPHA[type];

      for (const cellId of cells) {
        this.drawCellHighlight(cellId, color, alpha);
      }
    }
  }

  /**
   * Canonical zone renderer matching `ank.battlefield.mc.Zone.drawCircle`:
   *
   *   1. ONE filled polygon covering every cell in the zone (a single
   *      `fill()` call → no internal banding from per-cell overlap that
   *      the previous per-cell tint produced as a checkerboard).
   *   2. ONE 1px solid border tracing the OUTER perimeter only. Each
   *      cell's 4 edges (NE, SE, SW, NW) are drawn as border lines if
   *      the diagonal neighbor in that direction is NOT in the zone —
   *      this leaves only the outer shape outlined, exactly like the
   *      original Zone.drawCircleBorder which traces a single perimeter.
   *
   * Works for ANY zone shape (Cb diamond, Cc square, Cross, Line) since
   * the boundary detection is based on cell-membership, not the shape
   * type. The fill alpha is `Zone.ALPHA = 30` (30%); the border is full
   * opacity, mirroring `lineStyle(1, color, 100)` in the AS source.
   */
  private drawZoneShape(
    cellIds: Set<number>,
    color: number,
    alpha: number
  ): void {
    if (cellIds.size === 0) {
      return;
    }

    // Trace the OUTER perimeter of the zone as a single closed
    // polygon, then draw it with ONE fill + ONE stroke. This is what
    // `ank.battlefield.mc.Zone.drawCircle(_loc6_.beginFill, drawCircleBorder,
    // _loc6_.endFill)` does in canonical Dofus 1.29 — a single big
    // outlined polygon, not 13 individual cell tints. Per-cell tints
    // (the previous approach) showed visible internal anti-aliased
    // seams between diamonds, reading as a "checker" pattern even
    // when the math was correct.
    const perimeter = this.tracePerimeter(cellIds);
    if (perimeter.length === 0) {
      return;
    }
    const flat: number[] = [];
    for (const p of perimeter) {
      flat.push(p.x, p.y);
    }
    this.graphics
      .poly(flat)
      .fill({ color, alpha })
      .stroke({ color, width: 1, alpha: 1 });
  }

  /**
   * Trace the outer perimeter of the union of cells as an ordered
   * list of corner points (closed polygon). Algorithm:
   *
   *   1. For each cell, look at its 4 diagonal neighbours (NE/SE/SW/
   *      NW — these correspond to the 4 edges of the cell's diamond
   *      since cells are diamond-tessellated). An edge is on the
   *      boundary iff that neighbour is NOT in the zone.
   *   2. Each boundary edge gets a directed (start→end) pair in
   *      clockwise order: NE = top→right, SE = right→bottom,
   *      SW = bottom→left, NW = left→top. This guarantees that
   *      consecutive boundary edges share an endpoint.
   *   3. Walk the edges by chaining each edge's `end` to the next
   *      edge's `start`, producing a closed polyline.
   *
   * Works for any non-overlapping set of cells (Cb / Cc / Cross /
   * Line / Ring). Disconnected regions emit only the first sub-loop
   * (acceptable for glyph/trap which are always one connected zone).
   */
  private tracePerimeter(
    cellIds: Set<number>
  ): { x: number; y: number }[] {
    const dirOffsets = getDirOffsets(this.mapWidth);
    const NE = dirOffsets[Direction.NORTH_EAST] ?? 0;
    const SE = dirOffsets[Direction.SOUTH_EAST] ?? 0;
    const SW = dirOffsets[Direction.SOUTH_WEST] ?? 0;
    const NW = dirOffsets[Direction.NORTH_WEST] ?? 0;

    // Boundary edges keyed by their start corner (rounded screen
    // coords serialised as "x|y" so two edges can lookup the next
    // segment cheaply without floating-point fuzziness).
    const edges = new Map<string, { startKey: string; endKey: string; start: { x: number; y: number }; end: { x: number; y: number } }>();
    const k = (p: { x: number; y: number }): string =>
      `${Math.round(p.x)}|${Math.round(p.y)}`;

    for (const cellId of cellIds) {
      const pos = this.getCellPos(cellId);
      const top = { x: pos.x, y: pos.y - CELL_HALF_HEIGHT };
      const right = { x: pos.x + CELL_HALF_WIDTH, y: pos.y };
      const bottom = { x: pos.x, y: pos.y + CELL_HALF_HEIGHT };
      const left = { x: pos.x - CELL_HALF_WIDTH, y: pos.y };

      if (!cellIds.has(cellId + NE)) {
        const sk = k(top);
        edges.set(sk, { startKey: sk, endKey: k(right), start: top, end: right });
      }
      if (!cellIds.has(cellId + SE)) {
        const sk = k(right);
        edges.set(sk, { startKey: sk, endKey: k(bottom), start: right, end: bottom });
      }
      if (!cellIds.has(cellId + SW)) {
        const sk = k(bottom);
        edges.set(sk, { startKey: sk, endKey: k(left), start: bottom, end: left });
      }
      if (!cellIds.has(cellId + NW)) {
        const sk = k(left);
        edges.set(sk, { startKey: sk, endKey: k(top), start: left, end: top });
      }
    }

    if (edges.size === 0) {
      return [];
    }

    // Walk: start from any edge, follow end → next start, until cycle.
    const firstEdge = edges.values().next().value;
    if (!firstEdge) return [];

    const polygon: { x: number; y: number }[] = [];
    let current = firstEdge;
    const visited = new Set<string>();
    // Cap iterations to edges.size to defend against pathological
    // inputs (disconnected zone, broken neighbour graph). Polygon size
    // for a glyph maxes out at ~20 edges — this loop is cheap.
    for (let i = 0; i <= edges.size; i++) {
      if (visited.has(current.startKey)) break;
      visited.add(current.startKey);
      polygon.push(current.start);
      const next = edges.get(current.endKey);
      if (!next) break;
      current = next;
    }
    return polygon;
  }

  /**
   * Draw a single cell highlight.
   */
  private drawCellHighlight(
    cellId: number,
    color: number,
    alpha: number
  ): void {
    const pos = this.getCellPos(cellId);

    // Diamond shape centered at pos (matching original AS CELL_COORD for groundSlope=1)
    const points = [
      pos.x,
      pos.y - CELL_HALF_HEIGHT, // Top
      pos.x + CELL_HALF_WIDTH,
      pos.y, // Right
      pos.x,
      pos.y + CELL_HALF_HEIGHT, // Bottom
      pos.x - CELL_HALF_WIDTH,
      pos.y, // Left
    ];

    // Fill only — the original's `s<slope>` library shapes from
    // clips/gfx/cell.swf are pure filled polygons with `stroke="none"`,
    // so we draw without a border to match.
    this.graphics.poly(points);
    this.graphics.fill({ color, alpha });
  }

  /**
   * Get container for adding to scene.
   */
  getContainer(): Container {
    return this.container;
  }

  /**
   * Get cells of a specific type.
   */
  getCellsOfType(type: HighlightTypeValue): number[] {
    const set = this.highlights.get(type);
    return set ? [...set] : [];
  }

  /**
   * Show/hide the highlighter.
   */
  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }

  /**
   * Destroy the highlighter. Prefer scene.remove(id); this is the legacy alias.
   */
  destroy(): void {
    this.dispose();
  }

  /** Scene calls this on remove(id) / clear(). Idempotent. */
  dispose(): void {
    this.highlights.clear();

    if (!this.graphics.destroyed) {
      this.graphics.destroy();
    }

    if (!this.container.destroyed) {
      this.container.destroy();
    }
  }
}
