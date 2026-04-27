import type { CachedMap } from "@modules/maps/maps.cache.service";
import type { PathStep } from "@modules/maps/maps.path-codec";
import { directionOffsets } from "@modules/maps/maps.edge";

export const MAX_PATH_LENGTH = 64;

export class InvalidPathError extends Error {
  constructor(
    readonly reason:
      | "empty"
      | "too_long"
      | "off_grid"
      | "not_adjacent"
      | "bad_direction"
      | "unwalkable",
    readonly stepIndex?: number,
    detail?: string
  ) {
    super(
      detail
        ? `validate-path: ${reason}${stepIndex !== undefined ? ` at step ${stepIndex}` : ""}: ${detail}`
        : `validate-path: ${reason}${stepIndex !== undefined ? ` at step ${stepIndex}` : ""}`
    );
    this.name = "InvalidPathError";
  }
}

export interface ValidatedPath {
  cells: number[];
  endCell: number;
  endDirection: number;
  truncated: boolean;
}

export interface ValidatePathOptions {
  // Exploration mode (default): truncate the path at the first unwalkable
  // step, letting the client animate as far as possible. Combat should pass
  // `false` so an illegal path is rejected outright.
  stopOnUnwalkable?: boolean;
}

// Matches apps/gameserver/pkg/exploration/application/movement/validator.go:
//   1. Path not empty, under MAX_PATH_LENGTH.
//   2. Each step's declared direction must land on step.cell when applied
//      to the previous cell (anti-cheat: client can't teleport via spoofed
//      direction).
//   3. Each step's cell must be in-bounds and walkable.
//   4. Exploration: first unwalkable step truncates the path (returns the
//      prefix that WAS walkable). Combat: throw unwalkable.

export function validatePath(
  startCell: number,
  rawPath: PathStep[],
  map: CachedMap,
  options: ValidatePathOptions = {}
): ValidatedPath {
  const stopOnUnwalkable = options.stopOnUnwalkable ?? true;

  if (rawPath.length === 0) {
    throw new InvalidPathError("empty");
  }

  if (rawPath.length > MAX_PATH_LENGTH) {
    throw new InvalidPathError(
      "too_long",
      undefined,
      `${rawPath.length} > ${MAX_PATH_LENGTH}`
    );
  }

  const offsets = directionOffsets(map.width);
  const cellCount = map.cells.length;
  const cells: number[] = [];

  let prev = startCell;
  let endDirection = 0;
  let truncated = false;

  for (let i = 0; i < rawPath.length; i++) {
    const step = rawPath[i];

    if (!step) {
      continue;
    }

    if (step.direction < 0 || step.direction > 7) {
      throw new InvalidPathError(
        "bad_direction",
        i,
        `direction ${step.direction}`
      );
    }

    const delta = offsets[step.direction];

    if (delta === undefined) {
      throw new InvalidPathError("bad_direction", i);
    }

    const expected = prev + delta;

    if (expected < 0 || expected >= cellCount) {
      throw new InvalidPathError("off_grid", i, `expected ${expected}`);
    }

    if (expected !== step.cell) {
      throw new InvalidPathError(
        "not_adjacent",
        i,
        `direction ${step.direction} from ${prev} expects ${expected}, got ${step.cell}`
      );
    }

    const cellData = map.cells[step.cell];

    if (!cellData?.walkable) {
      if (stopOnUnwalkable && cells.length > 0) {
        truncated = true;
        break;
      }

      throw new InvalidPathError("unwalkable", i, `cell ${step.cell}`);
    }

    cells.push(step.cell);
    prev = step.cell;
    endDirection = step.direction;
  }

  return { cells, endCell: prev, endDirection, truncated };
}
