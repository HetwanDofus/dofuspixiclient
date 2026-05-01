import { match } from "ts-pattern";

import { cellToRowCol } from "./cell.ts";
import { Direction } from "./directions.ts";

/**
 * Determine the edge transition direction for a cell on the map boundary.
 * Returns null if the cell is not on an edge.
 */
export function getEdgeTransitionDir(
  cellId: number,
  mapWidth: number,
  mapHeight: number
): number | null {
  const totalRows = 2 * mapHeight - 1;
  const { row, col, isLong } = cellToRowCol(cellId, mapWidth);

  if (row === 0 && isLong) {
    return Direction.NORTH;
  }

  if (row === totalRows - 1) {
    return Direction.SOUTH;
  }

  if (col === 0 && isLong) {
    return Direction.WEST;
  }

  if (isLong && col === mapWidth - 1) {
    return Direction.EAST;
  }

  return null;
}

/**
 * Find the opposite edge cell for a map transition.
 * Given a cell on one edge, returns the corresponding cell on the opposite edge.
 */
export function findOppositeEdgeCell(
  cellId: number,
  dir: number,
  mapWidth: number,
  mapHeight: number
): number {
  const totalRows = 2 * mapHeight - 1;
  const { row, col } = cellToRowCol(cellId, mapWidth);
  const stride = 2 * mapWidth - 1;

  return match(dir)
    .with(Direction.NORTH, () => {
      const targetRow = totalRows - 1;
      const pair = Math.floor(targetRow / 2);
      const isLong = targetRow % 2 === 0;

      return (
        pair * stride +
        (isLong ? Math.min(col, mapWidth - 1) : Math.min(col, mapWidth - 2))
      );
    })
    .with(Direction.SOUTH, () => Math.min(col, mapWidth - 1))
    .with(Direction.WEST, () => {
      const pair = Math.floor(row / 2);
      const isLong = row % 2 === 0;
      const maxCol = isLong ? mapWidth - 1 : mapWidth - 2;

      return pair * stride + (isLong ? maxCol : mapWidth + maxCol);
    })
    .with(Direction.EAST, () => {
      const pair = Math.floor(row / 2);
      const isLong = row % 2 === 0;

      return pair * stride + (isLong ? 0 : mapWidth);
    })
    .otherwise(() => cellId);
}
