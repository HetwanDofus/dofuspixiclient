import { Container, Graphics } from "pixi.js";

import {
  CELL_HALF_HEIGHT,
  CELL_HALF_WIDTH,
} from "@/constants/battlefield";

import type { CellData } from "./datacenter/cell";
import { getCellPosition } from "./datacenter/cell";
import { computeMapScale, type MapScale } from "./datacenter/map";

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
    this.container.zIndex = 5000;
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

  private draw(): void {
    this.graphics.clear();

    const { scale, offsetX, offsetY } = this.mapScale;
    const hw = CELL_HALF_WIDTH * scale;
    const hh = CELL_HALF_HEIGHT * scale;

    for (const cell of this.cells) {
      const pos = getCellPosition(cell.id, this.mapWidth, cell.groundLevel);

      const cx = pos.x * scale + offsetX;
      const cy = pos.y * scale + offsetY;

      const isTrigger = this.triggerCellIds.has(cell.id);
      const isWalkable = cell.walkable === true;

      // Draw diamond
      const points = [cx, cy - hh, cx + hw, cy, cx, cy + hh, cx - hw, cy];
      if (isTrigger) {
        this.graphics.poly(points);
        this.graphics.fill({ color: 0xff0000, alpha: 0.35 });
        this.graphics.stroke({ width: 1.5, color: 0xff0000, alpha: 0.9 });
      } else if (isWalkable) {
        this.graphics.poly(points);
        this.graphics.stroke({ width: 0.5, color: 0x00ff00, alpha: 0.25 });
      } else {
        this.graphics.poly(points);
        this.graphics.stroke({ width: 0.5, color: 0x666666, alpha: 0.15 });
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
