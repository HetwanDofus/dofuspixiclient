import {
  CELL_HALF_HEIGHT,
  CELL_HALF_WIDTH,
  CELL_WIDTH,
  LEVEL_HEIGHT,
} from "./constants.ts";

/**
 * O(1) cell position calculation. Replaces the O(n) loop from the original code.
 *
 * The Dofus isometric grid has alternating row widths:
 *   - Even rows (pair*2): W cells ("long rows")
 *   - Odd rows (pair*2+1): W-1 cells ("short rows")
 *   - Stride = 2*W - 1 (cells per pair of rows)
 *
 * Returns the base cell position (same as original MapHandler.as line 143-144).
 * Does NOT include slope offset — use getSlopeYOffset() for sprites/characters.
 */
export function getCellPosition(
  cellId: number,
  mapWidth: number,
  groundLevel: number
): { x: number; y: number } {
  const stride = 2 * mapWidth - 1;
  const pair = Math.floor(cellId / stride);
  const offset = cellId % stride;
  const isLong = offset < mapWidth;
  const row = pair * 2 + (isLong ? 0 : 1);
  const col = isLong ? offset : offset - mapWidth;
  const x = col * CELL_WIDTH + (isLong ? 0 : CELL_HALF_WIDTH);
  const y = row * CELL_HALF_HEIGHT - LEVEL_HEIGHT * (groundLevel - 7);

  return { x, y };
}

/**
 * Y offset for sprites/characters standing on sloped cells.
 * From original mc/Sprite.as: fractionalHeight = getCellHeight() - floor(getCellHeight())
 * When groundSlope != 1, getCellHeight adds 0.5, so fractionalHeight = 0.5.
 * Sprites are shifted up by 0.5 * LEVEL_HEIGHT = 10 pixels.
 */
export function getSlopeYOffset(groundSlope: number): number {
  return groundSlope !== 1 ? -LEVEL_HEIGHT * 0.5 : 0;
}

/**
 * Convert cell ID to (row, col) in the alternating grid.
 */
export function cellToRowCol(
  cellId: number,
  mapWidth: number
): { row: number; col: number; isLong: boolean } {
  const stride = 2 * mapWidth - 1;
  const pair = Math.floor(cellId / stride);
  const offset = cellId % stride;
  const isLong = offset < mapWidth;

  return {
    row: isLong ? 2 * pair : 2 * pair + 1,
    col: isLong ? offset : offset - mapWidth,
    isLong,
  };
}

/**
 * Convert (row, col) back to cell ID.
 */
export function rowColToCell(
  row: number,
  col: number,
  mapWidth: number
): number {
  const stride = 2 * mapWidth - 1;
  const pair = Math.floor(row / 2);
  const isLong = row % 2 === 0;

  return pair * stride + (isLong ? col : mapWidth + col);
}

/**
 * Convert cell ID to isometric (x, y) coordinates.
 * Based on ank/battlefield/utils/Pathfinding.as#getCaseCoordonnee.
 */
export function cellToCoord(
  cellId: number,
  mapWidth: number
): { x: number; y: number } {
  const stride = 2 * mapWidth - 1;
  const line = Math.floor(cellId / stride);
  const column = cellId - line * stride;
  const offset = column % mapWidth;
  const y = line - offset;
  const x = Math.round((cellId - (mapWidth - 1) * y) / mapWidth);

  return { x, y };
}

/**
 * Calculate total cells in a map.
 */
export function totalCells(mapWidth: number, mapHeight: number): number {
  return mapHeight * mapWidth + (mapHeight - 1) * (mapWidth - 1);
}

/**
 * Calculate total rows in a map.
 */
export function totalRows(mapHeight: number): number {
  return 2 * mapHeight - 1;
}
