import { Container, Graphics } from "pixi.js";

import {
  CELL_HALF_HEIGHT,
  CELL_HALF_WIDTH,
  CELL_HEIGHT,
  CELL_WIDTH,
  DEFAULT_GROUND_LEVEL,
  DEFAULT_MAP_WIDTH,
} from "@/constants/battlefield";

import { getCellPosition } from "./datacenter/cell";

/**
 * Highlight type for combat cells.
 */
export const HighlightType = {
  MOVEMENT: "movement",
  ATTACK: "attack",
  SPELL_RANGE: "spell-range",
  SPELL_ZONE: "spell-zone",
  PLACEMENT_ALLY: "placement-ally",
  PLACEMENT_ENEMY: "placement-enemy",
  SELECTED: "selected",
  HOVER: "hover",
} as const;

export type HighlightTypeValue =
  (typeof HighlightType)[keyof typeof HighlightType];

/**
 * Highlight colors by type.
 */
const HIGHLIGHT_COLORS: Record<HighlightTypeValue, number> = {
  [HighlightType.MOVEMENT]: 0x0066ff,
  [HighlightType.ATTACK]: 0xff3333,
  [HighlightType.SPELL_RANGE]: 0xff9900,
  [HighlightType.SPELL_ZONE]: 0xffff00,
  [HighlightType.PLACEMENT_ALLY]: 0x0099ff,
  [HighlightType.PLACEMENT_ENEMY]: 0xff6600,
  [HighlightType.SELECTED]: 0xffffff,
  [HighlightType.HOVER]: 0x66ff66,
};

/**
 * Highlight alpha by type.
 */
const HIGHLIGHT_ALPHA: Record<HighlightTypeValue, number> = {
  [HighlightType.MOVEMENT]: 0.35,
  [HighlightType.ATTACK]: 0.35,
  [HighlightType.SPELL_RANGE]: 0.35,
  [HighlightType.SPELL_ZONE]: 0.45,
  [HighlightType.PLACEMENT_ALLY]: 0.4,
  [HighlightType.PLACEMENT_ENEMY]: 0.4,
  [HighlightType.SELECTED]: 0.5,
  [HighlightType.HOVER]: 0.3,
};

/**
 * Cell highlight configuration.
 */
export interface CellHighlightConfig {
  mapWidth?: number;
  groundLevel?: number;
}

/**
 * Cell highlighter for combat visualization.
 * Renders colored overlays on map cells.
 */
export class CellHighlighter {
  private container: Container;
  private graphics: Graphics;
  private highlighted: Map<number, HighlightTypeValue> = new Map();
  private mapWidth: number;
  private groundLevel: number;

  constructor(parentContainer: Container, config: CellHighlightConfig = {}) {
    this.mapWidth = config.mapWidth ?? DEFAULT_MAP_WIDTH;
    this.groundLevel = config.groundLevel ?? DEFAULT_GROUND_LEVEL;

    this.container = new Container();
    this.container.label = "cell-highlighter";

    this.graphics = new Graphics();
    this.container.addChild(this.graphics);

    parentContainer.addChild(this.container);
  }

  /**
   * Highlight a set of cells with a specific type.
   */
  highlightCells(cellIds: number[], type: HighlightTypeValue): void {
    for (const cellId of cellIds) {
      this.highlighted.set(cellId, type);
    }

    this.redraw();
  }

  /**
   * Highlight a single cell.
   */
  highlightCell(cellId: number, type: HighlightTypeValue): void {
    this.highlighted.set(cellId, type);
    this.redraw();
  }

  /**
   * Clear highlights of a specific type.
   */
  clearHighlightType(type: HighlightTypeValue): void {
    for (const [cellId, cellType] of this.highlighted) {
      if (cellType === type) {
        this.highlighted.delete(cellId);
      }
    }

    this.redraw();
  }

  /**
   * Clear highlight from a specific cell.
   */
  clearCell(cellId: number): void {
    this.highlighted.delete(cellId);
    this.redraw();
  }

  /**
   * Clear all highlights.
   */
  clearAll(): void {
    this.highlighted.clear();
    this.redraw();
  }

  /**
   * Check if a cell is highlighted.
   */
  isHighlighted(cellId: number): boolean {
    return this.highlighted.has(cellId);
  }

  /**
   * Get highlight type for a cell.
   */
  getHighlightType(cellId: number): HighlightTypeValue | undefined {
    return this.highlighted.get(cellId);
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
   * Redraw all highlights.
   */
  private redraw(): void {
    this.graphics.clear();

    // Group cells by type for batch drawing
    const cellsByType = new Map<HighlightTypeValue, number[]>();

    for (const [cellId, type] of this.highlighted) {
      let cells = cellsByType.get(type);

      if (!cells) {
        cells = [];
        cellsByType.set(type, cells);
      }

      cells.push(cellId);
    }

    // Draw each type in order (background types first)
    const drawOrder: HighlightTypeValue[] = [
      HighlightType.PLACEMENT_ALLY,
      HighlightType.PLACEMENT_ENEMY,
      HighlightType.MOVEMENT,
      HighlightType.SPELL_RANGE,
      HighlightType.ATTACK,
      HighlightType.SPELL_ZONE,
      HighlightType.HOVER,
      HighlightType.SELECTED,
    ];

    for (const type of drawOrder) {
      const cells = cellsByType.get(type);

      if (!cells || cells.length === 0) {
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
   * Draw a single cell highlight.
   */
  private drawCellHighlight(
    cellId: number,
    color: number,
    alpha: number
  ): void {
    const pos = getCellPosition(cellId, this.mapWidth, this.groundLevel);

    // Diamond shape points for isometric cell
    const points = [
      pos.x + CELL_HALF_WIDTH,
      pos.y, // Top
      pos.x + CELL_WIDTH,
      pos.y + CELL_HALF_HEIGHT, // Right
      pos.x + CELL_HALF_WIDTH,
      pos.y + CELL_HEIGHT, // Bottom
      pos.x,
      pos.y + CELL_HALF_HEIGHT, // Left
    ];

    // Fill
    this.graphics.poly(points);
    this.graphics.fill({ color, alpha });

    // Border
    this.graphics.poly(points);
    this.graphics.stroke({ color, width: 1, alpha: alpha + 0.2 });
  }

  /**
   * Get container for adding to scene.
   */
  getContainer(): Container {
    return this.container;
  }

  /**
   * Get all highlighted cells.
   */
  getHighlightedCells(): Map<number, HighlightTypeValue> {
    return new Map(this.highlighted);
  }

  /**
   * Get cells of a specific type.
   */
  getCellsOfType(type: HighlightTypeValue): number[] {
    const cells: number[] = [];

    for (const [cellId, cellType] of this.highlighted) {
      if (cellType === type) {
        cells.push(cellId);
      }
    }

    return cells;
  }

  /**
   * Show/hide the highlighter.
   */
  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }

  /**
   * Destroy the highlighter.
   */
  destroy(): void {
    this.highlighted.clear();
    this.graphics.destroy();
    this.container.destroy();
  }
}
