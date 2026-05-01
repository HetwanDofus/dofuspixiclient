import { match } from "ts-pattern";

import { cellToCoord } from "./cell.ts";

export const AreaKind = {
  None: 0,
  Cross: 1,
  PerpCross: 2,
  Line: 3,
  DiagonalLine: 4,
  Ring: 5,
  Square: 6,
  Circle: 7,
  Sector: 8,
} as const;
export type AreaKind = (typeof AreaKind)[keyof typeof AreaKind];

export interface FightMapDims {
  readonly width: number;
  readonly height: number;
}

export interface FightMapLos extends FightMapDims {
  occupantOf(cell: number): unknown | undefined;
  /**
   * Optional per-cell line-of-sight gate. Return `true` when the cell
   * blocks LoS (walls, decorations, glass cells with `lineOfSight=false`
   * in the original 1.29 map data). Defaults to "all cells transparent"
   * when omitted, so existing call sites that only care about fighters
   * keep working.
   */
  losBlocked?(cell: number): boolean;
}

function directionDelta(dir: number, width: number): number {
  const stride = 2 * width - 1;

  return match(dir)
    .with(0, () => 1)
    .with(1, () => width)
    .with(2, () => stride)
    .with(3, () => width - 1)
    .with(4, () => -1)
    .with(5, () => -width)
    .with(6, () => -stride)
    .with(7, () => -(width - 1))
    .otherwise(() => 0);
}

const ALL_DIRECTIONS = [0, 1, 2, 3, 4, 5, 6, 7] as const;
// In Dofus 1.29 the iso grid is rotated 45° so the "true cardinals"
// for movement and zone expansion (the four directions where each
// step lands on a directly-adjacent diamond cell) are SE/SW/NW/NE in
// screen-pixel terms — direction indices 1/3/5/7 in our enum.
// Indices 0/2/4/6 (E/S/W/N) are 2-step jumps on the iso grid that
// SKIP the adjacent diamond cell, producing a sparse "every-other-
// cell" pattern that reads as a checkerboard. The canonical AS
// `convertHeightToFourDirection` reflects this by ORing 1 into any
// 4-direction index, mapping {E,S,W,N}→{SE,SW,NW,NE}.
const CARDINAL_DIRECTIONS = [1, 3, 5, 7] as const;
// The other set: 2-cell jumps along the screen-aligned X/Y axes.
// Used by Cross zones (Pa) which produce a + shape on screen rather
// than an × shape.
const STRAIGHT_DIRECTIONS = [0, 2, 4, 6] as const;

function inBounds(fmap: FightMapDims, cell: number): boolean {
  const total = fmap.width * fmap.height * 2;
  return cell >= 0 && cell < total;
}

function projectLine(
  fmap: FightMapDims,
  origin: number,
  dir: number,
  steps: number
): number[] {
  const out: number[] = [];
  let cell = origin;
  const delta = directionDelta(dir, fmap.width);

  for (let i = 0; i < steps; i++) {
    cell += delta;

    if (!inBounds(fmap, cell)) {
      break;
    }

    out.push(cell);
  }

  return out;
}

function dominantDirection(
  fmap: FightMapDims,
  from: number,
  target: number,
  diagonal: boolean
): number {
  const delta = target - from;
  if (delta === 0) {
    return 0;
  }
  // L (Line) zones extend along a visually screen-aligned axis
  // (N/E/S/W in pixels = STRAIGHT_DIRECTIONS in cellId terms).
  // D (DiagonalLine) zones extend along a screen-diagonal axis
  // (NE/SE/SW/NW = CARDINAL_DIRECTIONS in cellId terms).
  const candidates = diagonal ? CARDINAL_DIRECTIONS : STRAIGHT_DIRECTIONS;
  let best: number = candidates[0] ?? 0;
  let bestScore = -1;

  for (const dir of candidates) {
    const off = directionDelta(dir, fmap.width);

    if (off === 0) {
      continue;
    }

    const q = Math.trunc(delta / off);
    let r = delta - q * off;

    if (r < 0) {
      r = -r;
    }

    const score = Math.abs(q) - r;

    if (score > bestScore) {
      bestScore = score;
      best = dir;
    }
  }
  return best;
}

export function cellsInArea(
  fmap: FightMapDims,
  from: number,
  origin: number,
  kind: AreaKind,
  size: number
): number[] {
  return match(kind)
    .with(AreaKind.None, () => [origin])
    .with(AreaKind.Cross, () => crossCells(fmap, origin, size))
    .with(AreaKind.Circle, () => circleCells(fmap, origin, size))
    .with(AreaKind.Square, () => squareCells(fmap, origin, size))
    .with(AreaKind.Ring, () => ringCells(fmap, origin, size))
    .with(AreaKind.Line, () => lineCells(fmap, from, origin, size, false))
    .with(AreaKind.DiagonalLine, () =>
      lineCells(fmap, from, origin, size, true)
    )
    .with(AreaKind.PerpCross, () => perpCrossCells(fmap, origin, size))
    .with(AreaKind.Sector, () => [origin])
    .exhaustive();
}

function crossCells(
  fmap: FightMapDims,
  origin: number,
  size: number
): number[] {
  // X zones (Xa, Xb, …) draw a "+" on screen: 4 lines extending
  // visually N / E / S / W. Those visual axes correspond to the
  // 2-cell-jump directions on the iso grid (cellId offsets ±1, ±stride).
  const out = [origin];
  for (const dir of STRAIGHT_DIRECTIONS) {
    out.push(...projectLine(fmap, origin, dir, size));
  }
  return out;
}

function perpCrossCells(
  fmap: FightMapDims,
  origin: number,
  size: number
): number[] {
  // "+" / T zones draw a "×" on screen: 4 lines extending visually
  // NE / SE / SW / NW (the iso-screen diagonals). Those map to the
  // adjacent-cell directions on the iso grid (cellId offsets ±W, ±(W-1)).
  const out = [origin];
  for (const dir of CARDINAL_DIRECTIONS) {
    out.push(...projectLine(fmap, origin, dir, size));
  }
  return out;
}

function lineCells(
  fmap: FightMapDims,
  from: number,
  origin: number,
  size: number,
  diagonal: boolean
): number[] {
  const dir = dominantDirection(fmap, from, origin, diagonal);
  return [origin, ...projectLine(fmap, origin, dir, size)];
}

// Dofus "Circle" zones (Cb, Cc, …) are diamonds in cell-grid terms —
// Manhattan distance over the 4 cardinal-iso directions. A `Cb`
// (radius 2) covers 13 cells (1 + 4 + 8), not 25.
function circleCells(
  fmap: FightMapDims,
  origin: number,
  radius: number
): number[] {
  return bfsCells(fmap, origin, radius, CARDINAL_DIRECTIONS);
}

// Dofus "Square" zones (R*) are Chebyshev distance — 8-way BFS,
// producing a true square in cell coords. `Rb` covers 25 cells (5×5).
function squareCells(
  fmap: FightMapDims,
  origin: number,
  radius: number
): number[] {
  return bfsCells(fmap, origin, radius, ALL_DIRECTIONS);
}

function bfsCells(
  fmap: FightMapDims,
  origin: number,
  radius: number,
  directions: readonly number[]
): number[] {
  const seen = new Set<number>([origin]);
  const queue = [origin];
  const dist = new Map<number, number>([[origin, 0]]);

  let head = 0;

  while (head < queue.length) {
    const cell = queue[head] ?? 0;
    const d = dist.get(cell) ?? 0;

    head++;

    if (d >= radius) {
      continue;
    }

    for (const dir of directions) {
      const n = cell + directionDelta(dir, fmap.width);

      if (!inBounds(fmap, n) || seen.has(n)) {
        continue;
      }

      seen.add(n);
      dist.set(n, d + 1);
      queue.push(n);
    }
  }

  return [...seen];
}

function ringCells(
  fmap: FightMapDims,
  origin: number,
  radius: number
): number[] {
  const inner = new Set<number>();

  if (radius > 0) {
    for (const c of circleCells(fmap, origin, radius - 1)) {
      inner.add(c);
    }
  }

  return circleCells(fmap, origin, radius).filter((c) => !inner.has(c));
}

/**
 * Bresenham line-of-sight in Dofus 1.29 isometric grid coordinates.
 *
 * The original AS algorithm (Pathfinding.as / MapHandler.as) walks a
 * straight line in iso-cell-space (the `(x, y)` returned by
 * `cellToCoord`, which is the same space the server uses in its own
 * checkSight). For each intermediate cell along that line, LoS is
 * blocked by:
 *   1. The cell being out of map bounds.
 *   2. The cell carrying `lineOfSight = false` (walls, decorations).
 *   3. A living fighter occupying the cell (caller-supplied via
 *      `occupantOf`; the caller is responsible for filtering out dead
 *      fighters and the caster/target endpoints if they should be
 *      transparent — endpoints ARE transparent here, see below).
 *
 * The endpoints (`from` and `to`) are intentionally exempt from the
 * blocking checks so the caster never blocks themselves and the target
 * cell does not need to be unoccupied (you obviously want to target
 * the enemy who's standing on the cell). The previous implementation
 * walked the dominant direction only, which broke any non-axial line
 * of sight (the loop could fall through with `return true` after 128
 * steps without ever reaching the target, or block on a fighter who
 * happened to lie on the swept axis but not on the actual line). The
 * Bresenham walk handles diagonals correctly.
 */
export function hasLineOfSight(
  fmap: FightMapLos,
  from: number,
  to: number
): boolean {
  if (from === to) {
    return true;
  }

  const a = cellToCoord(from, fmap.width);
  const b = cellToCoord(to, fmap.width);

  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - x);
  const dy = Math.abs(b.y - y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx - dy;

  // Hard cap to avoid runaway loops on degenerate input. Max iso-line
  // length on a Dofus map is ~ width + height; 1024 leaves plenty of
  // headroom while still terminating in pathological cases.
  for (let guard = 0; guard < 1024; guard++) {
    const e2 = 2 * err;

    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }

    if (e2 < dx) {
      err += dx;
      y += sy;
    }

    if (x === b.x && y === b.y) {
      return true;
    }

    const cellId = x * fmap.width + (fmap.width - 1) * y;

    if (cellId < 0 || cellId >= fmap.width * fmap.height * 2) {
      return false;
    }

    if (fmap.losBlocked?.(cellId)) {
      return false;
    }

    if (fmap.occupantOf(cellId) !== undefined) {
      return false;
    }
  }

  return false;
}

export function fightDistance(
  fmap: FightMapDims,
  a: number,
  b: number
): number {
  if (a === b) {
    return 0;
  }

  const total = fmap.width * fmap.height * 2;

  if (a < 0 || a >= total || b < 0 || b >= total) {
    return 1 << 20;
  }

  const visited = new Map<number, number>([[a, 0]]);
  const queue = [a];

  let head = 0;

  while (head < queue.length) {
    const cell = queue[head] ?? 0;
    const d = visited.get(cell) ?? 0;

    head++;

    if (d > 128) {
      break;
    }
    // Canonical Dofus 1.29 spell + fight distance uses 4-way Manhattan
    // BFS over the diamond-adjacent cells (SE/SW/NW/NE = direction
    // indices 1/3/5/7), NOT the 8-way Chebyshev distance over all
    // diagonals. The 8-way variant would let cells diagonally 2 cells
    // away count as distance 2 (Chebyshev), shrinking large ranges
    // dramatically and producing a SQUARE preview shape instead of
    // the canonical diamond.
    for (const dir of CARDINAL_DIRECTIONS) {
      const n = cell + directionDelta(dir, fmap.width);

      if (n < 0 || n >= total || visited.has(n)) {
        continue;
      }

      visited.set(n, d + 1);

      if (n === b) {
        return d + 1;
      }

      queue.push(n);
    }
  }

  return 1 << 20;
}
