import { Container, Graphics } from "pixi.js";

import type { CellData } from "./datacenter/cell";
import { getCellPosition } from "./datacenter/cell";
import { computeMapScale, type MapScale } from "./datacenter/map";

/**
 * CELL_COORD from Constants.as line 18 — copied verbatim.
 * Index = groundSlope (1-15). Each entry = 4 corners [left, top, right, bottom] as [dx, dy].
 */
const CELL_COORD = [
  [],
  [[-26.5,0],[0,-13.5],[26.5,0],[0,13.5]],
  [[-26.5,-20],[0,-13.5],[26.5,0],[0,13.5]],
  [[-26.5,0],[0,-33.5],[26.5,0],[0,13.5]],
  [[-26.5,-20],[0,-33.5],[26.5,0],[0,13.5]],
  [[-26.5,0],[0,-13.5],[26.5,-20],[0,13.5]],
  [[-26.5,-20],[0,-13.5],[26.5,-20],[0,13.5]],
  [[-26.5,0],[0,-33.5],[26.5,-20],[0,13.5]],
  [[-26.5,-20],[0,-33.5],[26.5,-20],[0,13.5]],
  [[-26.5,0],[0,-13.5],[26.5,0],[0,-6.5]],
  [[-26.5,-20],[0,-13.5],[26.5,0],[0,-6.5]],
  [[-26.5,0],[0,-33.5],[26.5,0],[0,-6.5]],
  [[-26.5,-20],[0,-33.5],[26.5,0],[0,-6.5]],
  [[-26.5,0],[0,-13.5],[26.5,-20],[0,-6.5]],
  [[-26.5,-20],[0,-13.5],[26.5,-20],[0,-6.5]],
  [[-26.5,0],[0,-33.5],[26.5,-20],[0,-6.5]],
];

// Constants.as line 26-27
const GRID_COLOR = 0xffffff;
const GRID_ALPHA = 30; // Flash 0-100 scale → 0.30 in PixiJS 0-1 scale

/**
 * 1:1 translation of ank.battlefield.GridHandler from GridHandler.as
 */
export class GridOverlay {
  private container: Container;
  private graphics: Graphics;
  private visible = false;
  private mapWidth = 15;
  private mapScale: MapScale = { scale: 1, offsetX: 0, offsetY: 0 };
  private triggerCellIds = new Set<number>();
  private cells: CellData[] = [];

  constructor(parentContainer: Container) {
    this.container = new Container();
    this.container.label = "grid-overlay";
    this.container.visible = false;
    parentContainer.addChild(this.container);

    this.graphics = new Graphics();
    this.container.addChild(this.graphics);
  }

  setMapData(
    cells: CellData[],
    mapWidth: number,
    mapHeight: number,
    triggerCellIds: number[]
  ): void {
    this.cells = cells;
    this.mapWidth = mapWidth;
    this.mapScale = computeMapScale(mapWidth, mapHeight);
    this.triggerCellIds = new Set(triggerCellIds);
    if (this.visible) {
      this.draw();
    }
  }

  toggle(): boolean {
    this.visible = !this.visible;
    this.container.visible = this.visible;
    if (this.visible) {
      this.draw();
    } else {
      this.graphics.clear();
    }
    return this.visible;
  }

  isEnabled(): boolean {
    return this.visible;
  }

  /**
   * Direct translation of GridHandler.as draw(bAll) with bAll=false.
   *
   * Original code (GridHandler.as lines 16-66):
   *   lineStyle(1, GRID_COLOR, GRID_ALPHA)
   *   for each cell:
   *     if cell.active:
   *       if cell.movement != 0 && cell.lineOfSight:
   *         moveTo(CELL_COORD[groundSlope][0] + cell.x/y)
   *         lineTo(CELL_COORD[groundSlope][1] + cell.x/y)
   *         lineTo(CELL_COORD[groundSlope][2] + cell.x/y)
   *       else:
   *         add to nonGridCells
   *   for each nonGridCell:
   *     for neighbor offsets [-mapWidth, -(mapWidth-1)]:
   *       if neighbor not in nonGridCells and neighbor.active:
   *         draw edge segment
   */
  private draw(): void {
    this.graphics.clear();

    const { scale, offsetX, offsetY } = this.mapScale;

    // _loc3_ = this._oDatacenter.Map.data
    const data = this.cells;

    // _loc4_ = ank.battlefield.Constants.CELL_COORD
    const cellCoord = CELL_COORD;

    // _loc6_ = {} — non-grid cells for Pass 2
    const nonGridCells: Record<number, CellData> = {};

    // lineStyle(1, GRID_COLOR, GRID_ALPHA)
    // Applied per-stroke in PixiJS

    // Pass 1: for(var k in _loc3_)
    for (const cell of data) {
      // if(!(!_loc5_.active && !bAll)) — skip inactive (bAll=false)
      if (cell.active === false) continue;

      // Cell pixel position (original: _loc5_.x, _loc5_.y)
      const pos = getCellPosition(cell.id, this.mapWidth, cell.groundLevel);
      const cellX = pos.x * scale + offsetX;
      const cellY = pos.y * scale + offsetY;

      const slope = cell.groundSlope ?? 1;
      const coords = cellCoord[slope >= 1 && slope <= 15 ? slope : 1];

      // if(_loc5_.movement != 0 && _loc5_.lineOfSight || bAll)
      if (cell.movement !== 0 && cell.lineOfSight) {
        // moveTo(CELL_COORD[groundSlope][0][0] + x, CELL_COORD[groundSlope][0][1] + y)
        this.graphics.moveTo(
          coords[0][0] * scale + cellX,
          coords[0][1] * scale + cellY
        );
        // lineTo(CELL_COORD[groundSlope][1][0] + x, CELL_COORD[groundSlope][1][1] + y)
        this.graphics.lineTo(
          coords[1][0] * scale + cellX,
          coords[1][1] * scale + cellY
        );
        // lineTo(CELL_COORD[groundSlope][2][0] + x, CELL_COORD[groundSlope][2][1] + y)
        this.graphics.lineTo(
          coords[2][0] * scale + cellX,
          coords[2][1] * scale + cellY
        );
        this.graphics.stroke({ width: 1, color: GRID_COLOR, alpha: GRID_ALPHA / 100 });
      } else {
        // _loc6_[k] = _loc5_
        nonGridCells[cell.id] = cell;
      }
    }

    // Pass 2: border edges (GridHandler.as lines 41-64)
    // _loc7_ = mapWidth
    // _loc8_ = [-mapWidth, -(mapWidth - 1)]
    const neighborOffsets = [-this.mapWidth, -(this.mapWidth - 1)];

    // Build cell lookup for neighbor active check
    const cellById = new Map<number, CellData>();
    for (const cell of data) {
      cellById.set(cell.id, cell);
    }

    // for(var k in _loc6_)
    for (const cellIdStr in nonGridCells) {
      const cell = nonGridCells[cellIdStr];
      const pos = getCellPosition(cell.id, this.mapWidth, cell.groundLevel);
      const cellX = pos.x * scale + offsetX;
      const cellY = pos.y * scale + offsetY;

      const slope = cell.groundSlope ?? 1;
      const coords = cellCoord[slope >= 1 && slope <= 15 ? slope : 1];

      // _loc9_ = 0; while(_loc9_ < 2)
      for (let i = 0; i < 2; i++) {
        // _loc10_ = Number(k) + _loc8_[_loc9_]
        const neighborId = cell.id + neighborOffsets[i];

        // if(_loc6_[_loc10_] == undefined)
        if (nonGridCells[neighborId] === undefined) {
          const neighbor = cellById.get(neighborId);

          // if(!(!_loc3_[_loc10_].active && !bAll))
          if (neighbor && neighbor.active !== false) {
            // _loc11_ = (_loc9_ + 1) % 4
            const nextCorner = (i + 1) % 4;

            // moveTo(CELL_COORD[groundSlope][_loc9_] + x, y)
            this.graphics.moveTo(
              coords[i][0] * scale + cellX,
              coords[i][1] * scale + cellY
            );
            // lineTo(CELL_COORD[groundSlope][_loc11_] + x, y)
            this.graphics.lineTo(
              coords[nextCorner][0] * scale + cellX,
              coords[nextCorner][1] * scale + cellY
            );
            this.graphics.stroke({ width: 1, color: GRID_COLOR, alpha: GRID_ALPHA / 100 });
          }
        }
      }
    }
  }

  onResize(_event: { zoom: number }): void {
    if (this.visible) {
      this.draw();
    }
  }

  getContainer(): Container {
    return this.container;
  }

  clear(): void {
    this.graphics.clear();
  }

  destroy(): void {
    this.graphics.clear();
    this.container.destroy({ children: true });
  }
}
