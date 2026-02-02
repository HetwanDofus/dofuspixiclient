import { CELL_WIDTH, CELL_HALF_WIDTH, CELL_HALF_HEIGHT, LEVEL_HEIGHT } from '@/constants/battlefield';

export interface CellData {
  id: number;
  ground: number;
  layer1: number;
  layer2: number;
  groundLevel: number;
  groundSlope?: number;
  layerGroundRot: number;
  layerGroundFlip: boolean;
  layerObject1Rot: number;
  layerObject1Flip: boolean;
  layerObject2Rot: number;
  layerObject2Flip: boolean;
}

export function getCellPosition(cellId: number, mapWidth: number, groundLevel: number): { x: number; y: number } {
  let loc14 = mapWidth - 1;
  let loc9 = -1;
  let loc10 = 0;
  let loc11 = 0;

  for (let id = 0; id <= cellId; id++) {
    if (loc9 === loc14) {
      loc9 = 0;
      loc10 += 1;
      if (loc11 === 0) {
        loc11 = CELL_HALF_WIDTH;
        loc14 -= 1;
      } else {
        loc11 = 0;
        loc14 += 1;
      }
    } else {
      loc9 += 1;
    }
  }

  const x = Math.floor(loc9 * CELL_WIDTH + loc11);
  const y = Math.floor(loc10 * CELL_HALF_HEIGHT - LEVEL_HEIGHT * (groundLevel - 7));

  return { x, y };
}

export function findCellAtPosition(
  mapX: number,
  mapY: number,
  cells: CellData[],
  mapWidth: number,
  mapScale: { scale: number; offsetX: number; offsetY: number }
): CellData | null {
  for (const cell of cells) {
    const pos = getCellPosition(cell.id, mapWidth, cell.groundLevel);
    const screenX = pos.x * mapScale.scale + mapScale.offsetX;
    const screenY = pos.y * mapScale.scale + mapScale.offsetY;

    const relX = mapX - screenX;
    const relY = mapY - screenY;

    const hw = CELL_HALF_WIDTH * mapScale.scale;
    const hh = CELL_HALF_HEIGHT * mapScale.scale;

    const cx = hw;
    const cy = hh;
    const dx = relX - cx;
    const dy = relY - cy;

    if (Math.abs(dx / hw) + Math.abs(dy / hh) <= 1) {
      return cell;
    }
  }
  return null;
}
