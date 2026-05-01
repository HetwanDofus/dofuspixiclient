import { match } from "ts-pattern";

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
  return match(dir)
    // EAST — same row, next col
    .with(0, () => col < (isLong ? W - 1 : W - 2))
    // SE — to adjacent row below
    .with(1, () =>
      isLong ? row < totalRows - 1 && col < W - 1 : row < totalRows - 1
    )
    // SOUTH — skip a row
    .with(2, () => row + 2 < totalRows)
    // SW — to adjacent row below
    .with(3, () =>
      isLong ? row < totalRows - 1 && col > 0 : row < totalRows - 1
    )
    // WEST — same row, prev col
    .with(4, () => col > 0)
    // NW — to adjacent row above
    .with(5, () => (isLong ? row > 0 && col > 0 : row > 0))
    // NORTH — skip a row
    .with(6, () => row >= 2)
    // NE — to adjacent row above
    .with(7, () => (isLong ? row > 0 && col < W - 1 : row > 0))
    .otherwise(() => false);
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
