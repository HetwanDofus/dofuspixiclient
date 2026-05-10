/**
 * WorldCellTints — per-cell fill highlights rendered as Pixi Graphics
 * diamonds in a dedicated container above object1 + below object2.
 *
 * Replaces the previous worldLayer-routed `CellTint` placement path
 * (Vello surface dispatch). With Vello+Pixi sharing the same WebGPU
 * device after Phase 2, simple solid-color cell tints are cheaper as
 * Pixi Graphics — one container, one polyfill batch.
 *
 * **Layering**: the container is mounted in `mapContainer` at zIndex
 * between Object1 (300) and Object2 (600+) so tints overlay
 * foreground tiles but pass under chars — canonical Dofus 1.29
 * ordering (Object2 sub-offset +2).
 *
 * **Layer keys**: callers identify a logical layer (`"movement"`,
 * `"hover"`, `"selected"`, etc.). Each layer is a Container so a
 * layer-clear is a single removeChildren — no per-cell traversal.
 */

import { Container, Graphics } from "pixi.js";

import {
  CELL_HEIGHT,
  CELL_WIDTH,
  DEFAULT_GROUND_LEVEL,
  DEFAULT_MAP_WIDTH,
} from "@/game/constants/battlefield";
import { type CellData, getCellPosition } from "@/game/datacenter/cell";
import type { MapScale } from "@/game/datacenter/map";

export interface WorldCellTintsConfig {
  /**
   * Parent container — typically `mapContainer`. The class owns a
   * single child Container per logical layer key, mounted under the
   * parent at the canonical Object2-sub-offset zIndex.
   */
  parent: Container;
  mapWidth?: number;
  groundLevel?: number;
  cellDataMap?: Map<number, CellData>;
}

const DIAMOND_VERTICES = [
  -CELL_WIDTH / 2,
  0,
  0,
  -CELL_HEIGHT / 2,
  CELL_WIDTH / 2,
  0,
  0,
  CELL_HEIGHT / 2,
];

/**
 * Z-index between Object1 (300) and per-cell sprites (300+) — sits
 * above ground/object1 tiles, below characters.
 */
const CELL_TINT_Z_INDEX = 350;

interface LayerEntry {
  container: Container;
  /** cellId → graphics so we can re-paint without rebuilding the world. */
  cells: Map<number, Graphics>;
  /** Last (color, alpha) used so re-issue with same args is a fast no-op. */
  color: number;
  alpha: number;
}

export class WorldCellTints {
  private readonly parent: Container;
  private mapWidth: number;
  private groundLevel: number;
  private cellDataMap: Map<number, CellData>;
  private readonly layers = new Map<string, LayerEntry>();

  constructor(config: WorldCellTintsConfig) {
    this.parent = config.parent;
    this.mapWidth = config.mapWidth ?? DEFAULT_MAP_WIDTH;
    this.groundLevel = config.groundLevel ?? DEFAULT_GROUND_LEVEL;
    this.cellDataMap = config.cellDataMap ?? new Map();
  }

  /**
   * Kept for API compatibility with the prior worldLayer-routed
   * implementation. Tints now live in mapContainer and inherit
   * its scale/position; per-tint matrix doesn't depend on mapScale.
   * Dimensions changes propagate via {@link setMapDimensions}.
   */
  setMapScale(_mapScale: MapScale): void {
    // No-op — see comment.
  }

  setMapDimensions(mapWidth: number, groundLevel?: number): void {
    if (mapWidth !== this.mapWidth) {
      this.mapWidth = mapWidth;
    }
    if (groundLevel !== undefined) {
      this.groundLevel = groundLevel;
    }
  }

  setCellDataMap(cellDataMap: Map<number, CellData>): void {
    this.cellDataMap = cellDataMap;
  }

  /**
   * Replace the set of cells for `layerKey` with `cellIds` tinted
   * `(color, alpha)`. Idempotent at the diff level — cells already
   * drawn with the same color/alpha are not rebuilt.
   */
  setLayer(
    layerKey: string,
    cellIds: ReadonlyArray<number> | ReadonlySet<number>,
    color: number,
    alpha: number
  ): void {
    const incoming =
      cellIds instanceof Set
        ? cellIds
        : new Set<number>(cellIds as ReadonlyArray<number>);

    if (incoming.size === 0) {
      this.clearLayer(layerKey);
      return;
    }

    let layer = this.layers.get(layerKey);
    const colorChanged =
      layer != null && (layer.color !== color || layer.alpha !== alpha);

    if (!layer) {
      const container = new Container();
      container.zIndex = CELL_TINT_Z_INDEX;
      container.eventMode = "none";
      this.parent.addChild(container);
      layer = {
        container,
        cells: new Map<number, Graphics>(),
        color,
        alpha,
      };
      this.layers.set(layerKey, layer);
    } else if (colorChanged) {
      layer.color = color;
      layer.alpha = alpha;
      // Repaint every cell at the new color.
      for (const g of layer.cells.values()) {
        this.paintDiamond(g, color, alpha);
      }
    }

    // Add new cells.
    for (const cell of incoming) {
      if (layer.cells.has(cell)) {
        continue;
      }
      const g = new Graphics();
      this.paintDiamond(g, color, alpha);
      const { x, y } = this.cellPosition(cell);
      g.x = x;
      g.y = y;
      layer.container.addChild(g);
      layer.cells.set(cell, g);
    }

    // Remove cells that were dropped.
    for (const [cellId, g] of layer.cells) {
      if (incoming.has(cellId)) {
        continue;
      }
      layer.container.removeChild(g);
      g.destroy();
      layer.cells.delete(cellId);
    }
  }

  clearLayer(layerKey: string): void {
    this.disposeLayer(layerKey);
  }

  clearAll(): void {
    for (const key of [...this.layers.keys()]) {
      this.disposeLayer(key);
    }
  }

  private disposeLayer(layerKey: string): void {
    const layer = this.layers.get(layerKey);
    if (!layer) {
      return;
    }
    for (const g of layer.cells.values()) {
      layer.container.removeChild(g);
      g.destroy();
    }
    layer.cells.clear();
    this.parent.removeChild(layer.container);
    layer.container.destroy({ children: true });
    this.layers.delete(layerKey);
  }

  private paintDiamond(g: Graphics, color: number, alpha: number): void {
    g.clear();
    g.poly(DIAMOND_VERTICES);
    g.fill({ color: color & 0xffffff, alpha });
  }

  private cellPosition(cellId: number): { x: number; y: number } {
    const cellData = this.cellDataMap.get(cellId);
    const level = cellData?.groundLevel ?? this.groundLevel;
    const { x, y } = getCellPosition(cellId, this.mapWidth, level);
    // Cell-pixel space directly — matches PlayerRenderer +
    // TileSpriteRenderer + canonical AS `mc._x = col * CELL_WIDTH +
    // parityOffset`. mapContainer position/scale handles user pan +
    // zoom; mapScale lives on `findCellAtPosition` for picking but
    // isn't applied here.
    return { x, y };
  }
}
