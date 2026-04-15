import { Container, Graphics } from "pixi.js";

import type { CellData } from "@/game/datacenter/cell";
import { Z_GRID_OVERLAY } from "@/game/constants/z-index";
import { getCellPosition } from "@/game/datacenter/cell";
import { computeMapScale, type MapScale } from "@/game/datacenter/map";

import { Actor, type ActorId, freshActorId } from "../actor";
import { RENDERED, type Rendered } from "../capabilities";

// Index = groundSlope (1-15). Each entry = 4 corners [left, top, right, bottom] as [dx, dy].
const CELL_COORD = [
  [],
  [
    [-26.5, 0],
    [0, -13.5],
    [26.5, 0],
    [0, 13.5],
  ],
  [
    [-26.5, -20],
    [0, -13.5],
    [26.5, 0],
    [0, 13.5],
  ],
  [
    [-26.5, 0],
    [0, -33.5],
    [26.5, 0],
    [0, 13.5],
  ],
  [
    [-26.5, -20],
    [0, -33.5],
    [26.5, 0],
    [0, 13.5],
  ],
  [
    [-26.5, 0],
    [0, -13.5],
    [26.5, -20],
    [0, 13.5],
  ],
  [
    [-26.5, -20],
    [0, -13.5],
    [26.5, -20],
    [0, 13.5],
  ],
  [
    [-26.5, 0],
    [0, -33.5],
    [26.5, -20],
    [0, 13.5],
  ],
  [
    [-26.5, -20],
    [0, -33.5],
    [26.5, -20],
    [0, 13.5],
  ],
  [
    [-26.5, 0],
    [0, -13.5],
    [26.5, 0],
    [0, -6.5],
  ],
  [
    [-26.5, -20],
    [0, -13.5],
    [26.5, 0],
    [0, -6.5],
  ],
  [
    [-26.5, 0],
    [0, -33.5],
    [26.5, 0],
    [0, -6.5],
  ],
  [
    [-26.5, -20],
    [0, -33.5],
    [26.5, 0],
    [0, -6.5],
  ],
  [
    [-26.5, 0],
    [0, -13.5],
    [26.5, -20],
    [0, -6.5],
  ],
  [
    [-26.5, -20],
    [0, -13.5],
    [26.5, -20],
    [0, -6.5],
  ],
  [
    [-26.5, 0],
    [0, -33.5],
    [26.5, -20],
    [0, -6.5],
  ],
];

const GRID_COLOR = 0xffffff;
// Flash's 0-100 alpha scale; converted to 0-1 per stroke.
const GRID_ALPHA = 30;

export class GridOverlay extends Actor implements Rendered {
  readonly id: ActorId = freshActorId();
  readonly [RENDERED] = true as const;
  readonly container: Container;
  readonly zIndex = Z_GRID_OVERLAY;

  private graphics: Graphics;
  private visible = false;
  private mapWidth = 15;
  private mapScale: MapScale = { scale: 1, offsetX: 0, offsetY: 0 };
  private cells: CellData[] = [];

  constructor(parentContainer: Container) {
    super();
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
    _triggerCellIds: number[]
  ): void {
    this.cells = cells;
    this.mapWidth = mapWidth;
    this.mapScale = computeMapScale(mapWidth, mapHeight);
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

  private draw(): void {
    this.graphics.clear();

    const { scale, offsetX, offsetY } = this.mapScale;
    const nonGridCells: Record<number, CellData> = {};

    for (const cell of this.cells) {
      if (cell.active === false) {
        continue;
      }

      const pos = getCellPosition(cell.id, this.mapWidth, cell.groundLevel);
      const cellX = pos.x * scale + offsetX;
      const cellY = pos.y * scale + offsetY;

      const slope = cell.groundSlope ?? 1;
      const coords = CELL_COORD[slope >= 1 && slope <= 15 ? slope : 1];

      if (cell.movement !== 0 && cell.lineOfSight) {
        this.graphics.moveTo(
          coords[0][0] * scale + cellX,
          coords[0][1] * scale + cellY
        );
        this.graphics.lineTo(
          coords[1][0] * scale + cellX,
          coords[1][1] * scale + cellY
        );
        this.graphics.lineTo(
          coords[2][0] * scale + cellX,
          coords[2][1] * scale + cellY
        );
        this.graphics.stroke({
          width: 1,
          color: GRID_COLOR,
          alpha: GRID_ALPHA / 100,
        });
      } else {
        nonGridCells[cell.id] = cell;
      }
    }

    const neighborOffsets = [-this.mapWidth, -(this.mapWidth - 1)];
    const cellById = new Map<number, CellData>();

    for (const cell of this.cells) {
      cellById.set(cell.id, cell);
    }

    for (const cellIdStr in nonGridCells) {
      const cell = nonGridCells[cellIdStr];
      const pos = getCellPosition(cell.id, this.mapWidth, cell.groundLevel);
      const cellX = pos.x * scale + offsetX;
      const cellY = pos.y * scale + offsetY;

      const slope = cell.groundSlope ?? 1;
      const coords = CELL_COORD[slope >= 1 && slope <= 15 ? slope : 1];

      for (let i = 0; i < 2; i++) {
        const neighborId = cell.id + neighborOffsets[i];

        if (nonGridCells[neighborId] === undefined) {
          const neighbor = cellById.get(neighborId);

          if (neighbor && neighbor.active !== false) {
            const nextCorner = (i + 1) % 4;

            this.graphics.moveTo(
              coords[i][0] * scale + cellX,
              coords[i][1] * scale + cellY
            );
            this.graphics.lineTo(
              coords[nextCorner][0] * scale + cellX,
              coords[nextCorner][1] * scale + cellY
            );
            this.graphics.stroke({
              width: 1,
              color: GRID_COLOR,
              alpha: GRID_ALPHA / 100,
            });
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
    this.dispose();
  }

  dispose(): void {
    if (this.container.destroyed) {
      return;
    }

    this.graphics.clear();
    this.container.destroy({ children: true });
  }
}
