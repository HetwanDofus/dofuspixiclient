import { match, P } from "ts-pattern";

// Dofus 1.29 alternating-row grid: long rows have `width` cells, short rows
// have `width - 1`. Stride (one long + one short) = 2*width - 1.
//
// Direction codes match the protocol: 0=E, 1=SE, 2=S, 3=SW, 4=W, 5=NW, 6=N,
// 7=NE. Exploration allows all 8; fights restrict to cardinals but that's a
// fight concern — every edge transition is 8-way.

export interface CellCoord {
  row: number;
  col: number;
  isLong: boolean;
}

// Cell-id delta for each of the 8 directions on an alternating-row grid of
// the given width. Index matches the protocol direction (0=E..7=NE).
export function directionOffsets(mapWidth: number): readonly number[] {
  const stride = 2 * mapWidth - 1;

  return [
    1,
    mapWidth,
    stride,
    mapWidth - 1,
    -1,
    -mapWidth,
    -stride,
    -(mapWidth - 1),
  ];
}

export function cellToRowCol(cellId: number, mapWidth: number): CellCoord {
  const stride = 2 * mapWidth - 1;
  const pair = Math.floor(cellId / stride);
  const offset = cellId - pair * stride;
  const isLong = offset < mapWidth;

  return {
    row: isLong ? pair * 2 : pair * 2 + 1,
    col: isLong ? offset : offset - mapWidth,
    isLong,
  };
}

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

// Returns the mirror cell on the target map's opposite edge for a player
// exiting through `direction`. Cardinals (E/S/W/N) preserve the
// perpendicular axis; diagonals (SE/SW/NW/NE) land at the opposite corner
// — retail Dofus doesn't interpolate across diagonal transitions.
export function oppositeEdgeCell(
  fromCellId: number,
  exitDirection: number,
  sourceWidth: number,
  targetWidth: number,
  targetHeight: number
): number | undefined {
  const { row, col } = cellToRowCol(fromCellId, sourceWidth);
  const lastLongRow = 2 * targetHeight - 2;
  const rightCol = targetWidth - 1;
  const clampCol = Math.min(Math.max(col, 0), rightCol);
  const clampRow = Math.min(Math.max(row, 0), lastLongRow);

  switch (exitDirection) {
    case 0:
      return rowColToCell(clampRow, 0, targetWidth);
    case 1:
      return rowColToCell(0, 0, targetWidth);
    case 2:
      return rowColToCell(0, clampCol, targetWidth);
    case 3:
      return rowColToCell(0, rightCol, targetWidth);
    case 4:
      return rowColToCell(clampRow, rightCol, targetWidth);
    case 5:
      return rowColToCell(lastLongRow, rightCol, targetWidth);
    case 6:
      return rowColToCell(lastLongRow, clampCol, targetWidth);
    case 7:
      return rowColToCell(lastLongRow, 0, targetWidth);
    default:
      return undefined;
  }
}

// Derives exit direction from a cell's position on an HxW grid. Corners
// take precedence over pure edges so cell (0, W-1) counts as NE, not N or
// E alone.
export function detectExitDirection(
  cellId: number,
  mapWidth: number,
  mapHeight: number
): number | undefined {
  const { row, col, isLong } = cellToRowCol(cellId, mapWidth);
  const lastRow = 2 * mapHeight - 1;

  const edge = {
    top: row === 0,
    bottom: row >= lastRow - 1,
    left: isLong && col === 0,
    right: isLong && col === mapWidth - 1,
  } as const;

  return match(edge)
    .with({ top: true, right: true }, () => 7)
    .with({ top: true, left: true }, () => 5)
    .with({ bottom: true, right: true }, () => 1)
    .with({ bottom: true, left: true }, () => 3)
    .with({ top: true }, () => 6)
    .with({ bottom: true }, () => 2)
    .with({ left: true }, () => 4)
    .with({ right: true }, () => 0)
    .with(P._, () => undefined)
    .exhaustive();
}
