import {
  CELL_HALF_HEIGHT,
  CELL_HALF_WIDTH,
  getCellPosition,
  getSlopeYOffset,
} from "@dofus/grid";

export { getCellPosition, getSlopeYOffset };

export interface CellData {
  id: number;
  active?: boolean;
  ground: number;
  layer1: number;
  layer2: number;
  groundLevel: number;
  groundSlope?: number;
  walkable?: boolean;
  movement?: number;
  lineOfSight?: boolean;
  layerGroundRot: number;
  layerGroundFlip: boolean;
  layerObject1Rot: number;
  layerObject1Flip: boolean;
  layerObject2Rot: number;
  layerObject2Flip: boolean;
  /**
   * The 1.29 `layerObject2Interactive` bit. The same gfx is decoration on one
   * cell and a usable element on the next, so this — not the gfx id — decides
   * whether the sprite is clickable.
   */
  layerObject2Interactive?: boolean;
}

export function findCellAtPosition(
  mapX: number,
  mapY: number,
  cells: CellData[],
  mapWidth: number,
  mapScale: { scale: number; offsetX: number; offsetY: number }
): CellData | null {
  const hw = CELL_HALF_WIDTH * mapScale.scale;
  const hh = CELL_HALF_HEIGHT * mapScale.scale;

  for (const cell of cells) {
    const pos = getCellPosition(cell.id, mapWidth, cell.groundLevel);
    const cx = pos.x * mapScale.scale + mapScale.offsetX;
    const cy = pos.y * mapScale.scale + mapScale.offsetY;

    const dx = mapX - cx;
    const dy = mapY - cy;

    if (Math.abs(dx / hw) + Math.abs(dy / hh) <= 1) {
      return cell;
    }
  }

  return null;
}
