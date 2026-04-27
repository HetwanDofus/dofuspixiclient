import type { FightMap } from "@modules/fight/map/fight.map";
import {
  type AreaKind,
  cellsInArea as cellsInAreaCore,
  fightDistance,
  hasLineOfSight as hasLineOfSightCore,
} from "@dofus/grid";

export { AreaKind } from "@dofus/grid";

// Thin adapters over the shared @dofus/grid primitives. `FightMap`
// structurally satisfies the grid's FightMapLos interface (width,
// height, occupantOf), so these just forward through.

export function cellsInArea(
  fmap: FightMap,
  from: number,
  origin: number,
  kind: AreaKind,
  size: number
): number[] {
  return cellsInAreaCore(fmap, from, origin, kind, size);
}

export function hasLineOfSight(
  fmap: FightMap,
  from: number,
  to: number
): boolean {
  return hasLineOfSightCore(fmap, from, to);
}

export function distance(fmap: FightMap, a: number, b: number): number {
  return fightDistance(fmap, a, b);
}

export function cellToRowCol(
  cell: number,
  width: number
): { row: number; col: number } {
  const stride = 2 * width - 1;
  const pair = Math.floor(cell / stride);
  const offset = cell % stride;
  if (offset < width) {
    return { row: pair * 2, col: offset };
  }
  return { row: pair * 2 + 1, col: offset - width };
}

export function fastDistance(fmap: FightMap, a: number, b: number): number {
  if (a === b) {
    return 0;
  }
  const ca = cellToRowCol(a, fmap.width);
  const cb = cellToRowCol(b, fmap.width);
  const dr = Math.abs(ca.row - cb.row);
  const dc = Math.abs(ca.col - cb.col);
  return Math.max(dr, dc);
}
