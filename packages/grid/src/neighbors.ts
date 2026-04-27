import { cellToRowCol } from "./cell.ts";
import { getDirOffsets } from "./directions.ts";

/**
 * Check if a direction move is valid from a given cell position.
 * Prevents wrap-around at row boundaries.
 */
export function isValidDirection(
  row: number,
  col: number,
  isLong: boolean,
  dir: number,
  mapWidth: number,
  totalRows: number
): boolean {
  const W = mapWidth;
  switch (dir) {
    case 0: // EAST — same row, next col
      return col < (isLong ? W - 1 : W - 2);
    case 1: // SE — to adjacent row below
      return isLong ? row < totalRows - 1 && col < W - 1 : row < totalRows - 1;
    case 2: // SOUTH — skip a row
      return row + 2 < totalRows;
    case 3: // SW — to adjacent row below
      return isLong ? row < totalRows - 1 && col > 0 : row < totalRows - 1;
    case 4: // WEST — same row, prev col
      return col > 0;
    case 5: // NW — to adjacent row above
      return isLong ? row > 0 && col > 0 : row > 0;
    case 6: // NORTH — skip a row
      return row >= 2;
    case 7: // NE — to adjacent row above
      return isLong ? row > 0 && col < W - 1 : row > 0;
    default:
      return false;
  }
}

/**
 * Get valid neighbor cell IDs for a given cell.
 */
export function getNeighbors(
  cellId: number,
  mapWidth: number,
  mapHeight: number
): number[] {
  const tRows = 2 * mapHeight - 1;
  const { row, col, isLong } = cellToRowCol(cellId, mapWidth);
  const offsets = getDirOffsets(mapWidth);
  const neighbors: number[] = [];
  for (let dir = 0; dir < 8; dir++) {
    if (isValidDirection(row, col, isLong, dir, mapWidth, tRows)) {
      neighbors.push(cellId + (offsets[dir] as number));
    }
  }
  return neighbors;
}
