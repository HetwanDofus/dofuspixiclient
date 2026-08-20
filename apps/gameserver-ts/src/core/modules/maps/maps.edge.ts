import type { DecodedCell } from "@modules/maps/maps.cells-codec";
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
//
// The outline of the diamond zigzags between long and short rows, so BOTH
// parities carry border cells: a long row ends at `mapWidth - 1`, a short one
// at `mapWidth - 2`, and the first/last two rows are the top/bottom lips.
// This matters because in real 1.29 map data the outermost long-row cells are
// blocked decoration and every walkable exit — the cell a player actually
// stands on to leave — is on a short row. Restricting to long rows recognised
// an exit on just 21 of 400 imported maps; counting both parities finds 141.
export function detectExitDirection(
  cellId: number,
  mapWidth: number,
  mapHeight: number
): number | undefined {
  const { row, col, isLong } = cellToRowCol(cellId, mapWidth);
  const lastRow = 2 * mapHeight - 2;

  const edge = {
    top: row <= 1,
    bottom: row >= lastRow - 1,
    left: col === 0,
    right: col === (isLong ? mapWidth - 1 : mapWidth - 2),
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

// Cardinal components of each direction — SE is south *and* east, etc. Used to
// test whether a cell sits on the edge a player arrives through.
const CARDINALS: Record<number, readonly number[]> = {
  0: [0],
  1: [2, 0],
  2: [2],
  3: [2, 4],
  4: [4],
  5: [6, 4],
  6: [6],
  7: [6, 0],
};

function onEdge(
  coord: CellCoord,
  mapWidth: number,
  mapHeight: number,
  direction: number
): boolean {
  const lastRow = 2 * mapHeight - 2;

  return (CARDINALS[direction] ?? []).some((cardinal) =>
    match(cardinal)
      .with(6, () => coord.row <= 1)
      .with(2, () => coord.row >= lastRow - 1)
      .with(4, () => coord.col === 0)
      .with(0, () => coord.col === (coord.isLong ? mapWidth - 1 : mapWidth - 2))
      .otherwise(() => false)
  );
}

/**
 * The cell a player actually lands on after leaving `fromCellId` through
 * `exitDirection`.
 *
 * `oppositeEdgeCell` gives the geometric mirror, but that cell is very often
 * unusable: the outermost long row of a 1.29 map is blocked decoration, so a
 * player crossing north was dropped onto a cell with no walkable neighbour at
 * all and could not move again. This picks the walkable cell on the arrival
 * edge closest to that mirror instead, and only gives up when the target map
 * has no walkable cell on that side.
 */
export function resolveLandingCell(
  target: { width: number; height: number; cells: readonly DecodedCell[] },
  fromCellId: number,
  exitDirection: number,
  sourceWidth: number
): number | undefined {
  const ideal = oppositeEdgeCell(
    fromCellId,
    exitDirection,
    sourceWidth,
    target.width,
    target.height
  );

  if (ideal === undefined) {
    return undefined;
  }

  const idealCoord = cellToRowCol(ideal, target.width);
  const arrival = (exitDirection + 4) % 8;

  let best: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const cell of target.cells) {
    if (!cell.active || !cell.walkable) {
      continue;
    }

    const coord = cellToRowCol(cell.id, target.width);

    if (!onEdge(coord, target.width, target.height, arrival)) {
      continue;
    }

    const distance =
      Math.abs(coord.row - idealCoord.row) +
      Math.abs(coord.col - idealCoord.col);

    if (distance < bestDistance) {
      bestDistance = distance;
      best = cell.id;
    }
  }

  return best;
}
