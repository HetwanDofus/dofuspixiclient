export const Direction = {
  EAST: 0,
  SOUTH_EAST: 1,
  SOUTH: 2,
  SOUTH_WEST: 3,
  WEST: 4,
  NORTH_WEST: 5,
  NORTH: 6,
  NORTH_EAST: 7,
} as const;

export type DirectionValue = (typeof Direction)[keyof typeof Direction];

export const DIR_COSTS = [1.5, 1, 1.5, 1, 1.5, 1, 1.5, 1] as const;

export const DIR_CHANGE_PENALTY = 0.5;

export function getDirOffsets(mapWidth: number): number[] {
  const stride = 2 * mapWidth - 1;

  return [
    1, // 0: EAST
    mapWidth, // 1: SOUTH_EAST
    stride, // 2: SOUTH
    mapWidth - 1, // 3: SOUTH_WEST
    -1, // 4: WEST
    -mapWidth, // 5: NORTH_WEST
    -stride, // 6: NORTH
    -(mapWidth - 1), // 7: NORTH_EAST
  ];
}

/**
 * Get the direction (0-7) between two cells.
 *
 * For adjacent cells (cellId difference matches one of the 8 unit
 * offsets), returns any of 0-7 (axis-aligned OR diagonal).
 *
 * For non-adjacent cells, returns one of the four diagonals 1/3/5/7
 * by quadrant of the iso-coord delta — mirrors canonical 1.29
 * `Pathfinding.getDirectionFromCoordinates(..., bAllDirections=false)`:
 * ```
 * var a = Math.atan2(y2 - y1, x2 - x1);
 * if (a >=  0          && a <  Math.PI/2)    return 1; // SE
 * if (a >=  Math.PI/2  && a <= Math.PI)      return 3; // SW
 * if (a >= -Math.PI    && a <  -Math.PI/2)   return 5; // NW
 *                                            return 7; // NE
 * ```
 *
 * Earlier the fallback returned `dx > 0 ? 1 : 5`, ignoring `dy` — so
 * a target NE of the caster (dx > 0, dy < 0) wrongly resolved to 1
 * (SE) and ranged spells like Attaque Naturelle made the caster face
 * the wrong diagonal at long range.
 */
export function getDirection(
  fromCellId: number,
  toCellId: number,
  mapWidth: number
): number {
  const diff = toCellId - fromCellId;
  const W = mapWidth;
  const stride = 2 * W - 1;
  const offsets = [1, W, stride, W - 1, -1, -W, -stride, -(W - 1)];

  for (let dir = 7; dir >= 0; dir--) {
    if (offsets[dir] === diff) {
      return dir;
    }
  }

  const line1 = Math.floor(fromCellId / stride);
  const col1 = fromCellId - line1 * stride;
  const y1 = line1 - (col1 % W);
  const x1 = Math.round((fromCellId - (W - 1) * y1) / W);

  const line2 = Math.floor(toCellId / stride);
  const col2 = toCellId - line2 * stride;
  const y2 = line2 - (col2 % W);
  const x2 = Math.round((toCellId - (W - 1) * y2) / W);

  const dx = x2 - x1;
  const dy = y2 - y1;
  const angle = Math.atan2(dy, dx);
  const halfPi = Math.PI / 2;

  if (angle >= 0 && angle < halfPi) {
    return 1; // SE
  }
  if (angle >= halfPi && angle <= Math.PI) {
    return 3; // SW
  }
  if (angle >= -Math.PI && angle < -halfPi) {
    return 5; // NW
  }
  return 7; // NE (-π/2 ≤ angle < 0)
}

/**
 * Combat only recognises the four isometric-cardinal facings
 * (1=SE, 3=SW, 5=NW, 7=NE). An even (axis-aligned) direction coming
 * from `getDirection` gets snapped UP to the next odd index — the
 * diamond-adjacent diagonal that keeps the sprite in the same
 * screen-quadrant:
 *   0 (E)  → 1 (SE)
 *   2 (S)  → 3 (SW)
 *   4 (W)  → 5 (NW)
 *   6 (N)  → 7 (NE)
 * Odd inputs pass through unchanged.
 *
 * Mirrors canonical Dofus 1.29
 * `ank.battlefield.utils.Pathfinding.convertHeightToFourDirection`:
 * ```
 * static function convertHeightToFourDirection(nDirection) {
 *   return nDirection | 1;
 * }
 * ```
 *
 * The earlier hand-coded mapping (0→1, 2→1, 4→3, 6→5) was wrong:
 * casting a melee spell on a target due-south of the caster sent the
 * sprite to face SE instead of SW, so "Coup de poing" looked like the
 * fighter punched the wrong diagonal.
 *
 * Used by both the client renderer (PlayerRenderer.setDirection) and
 * the server's fight-turn handler so the equality check
 * `if (facing !== caster.direction)` stays coherent — the server can
 * never store an 8-way value the client clamps away, otherwise an
 * incoming `directionChange` is silently suppressed even though the
 * rendered sprite is on a different diagonal.
 */
export function clampFightDirection(dir: number): number {
  return dir | 1;
}
