import { Direction, getDirOffsets } from "@dofus/grid";

/**
 * `npc_template.path` is a `;`-separated list of `<letter><count>` steps —
 * `"G2;B1"`, `"B1;G3;D1;G2"`. The letters are French screen directions:
 * `H` haut, `B` bas, `G` gauche, `D` droite.
 *
 * On the Dofus grid those four are the *axis-aligned* directions, not the
 * diagonals: consecutive cell ids sit on the same visual row two steps apart,
 * so `+1` (EAST) is one full diamond to the right of the screen, and `±(2w-1)`
 * (SOUTH / NORTH) one diamond straight down or up. The diagonals 1/3/5/7 are
 * the half-steps between them.
 *
 * Only 57 templates carry a path and only 14 placements are flagged movable,
 * so this table has few witnesses; it is derived from the grid geometry rather
 * than from a StarLoco source. `Mon'Hawt'Wit'` on map 7412 (`path = "B2"`) is
 * the check: it must walk two cells straight down the screen and back.
 */
const LETTER_TO_DIRECTION: Readonly<Record<string, number>> = {
  H: Direction.NORTH,
  B: Direction.SOUTH,
  G: Direction.WEST,
  D: Direction.EAST,
};

export interface PatrolStep {
  direction: number;
  cells: number;
}

/** Parses a patrol route. Unparsable tokens are dropped, not guessed at. */
export function parsePatrol(path: string): PatrolStep[] {
  const steps: PatrolStep[] = [];

  for (const token of path.split(/[;,]/)) {
    const trimmed = token.trim().toUpperCase();
    if (trimmed === "") {
      continue;
    }

    const direction = LETTER_TO_DIRECTION[trimmed[0] ?? ""];
    const cells = Number.parseInt(trimmed.slice(1), 10);

    if (direction === undefined || !Number.isFinite(cells) || cells <= 0) {
      continue;
    }

    steps.push({ direction, cells });
  }

  return steps;
}

/**
 * Expands one patrol step into the cells it walks over, starting *after*
 * `fromCell`. Stops early — returning a shorter walk — as soon as the next
 * cell is off the map or not walkable, so a patrol can never push an NPC
 * into scenery even if the route in the dump is stale.
 */
export function walkStep(
  fromCell: number,
  step: PatrolStep,
  mapWidth: number,
  isWalkable: (cell: number) => boolean
): number[] {
  const offset = getDirOffsets(mapWidth)[step.direction];

  if (offset === undefined) {
    return [];
  }

  const cells: number[] = [];
  let cell = fromCell;

  for (let i = 0; i < step.cells; i++) {
    const next = cell + offset;
    if (!isWalkable(next)) {
      break;
    }
    cells.push(next);
    cell = next;
  }

  return cells;
}

/** The mirror of a direction — what walking a route backwards uses. */
export function reverseDirection(direction: number): number {
  return (direction + 4) % 8;
}
