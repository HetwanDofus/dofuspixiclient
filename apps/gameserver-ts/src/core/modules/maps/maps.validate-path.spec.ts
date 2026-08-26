import { describe, expect, test } from "bun:test";

import type { CachedMap } from "@modules/maps/maps.cache.service";
import type { DecodedCell } from "@modules/maps/maps.cells-codec";
import {
  InvalidPathError,
  MAX_PATH_LENGTH,
  validatePath,
} from "@modules/maps/maps.validate-path";

function cell(id: number, overrides: Partial<DecodedCell> = {}): DecodedCell {
  return {
    id,
    active: true,
    ground: 0,
    layer1: 0,
    layer2: 0,
    groundLevel: 0,
    groundSlope: 0,
    walkable: true,
    movement: 1,
    lineOfSight: true,
    layerGroundRot: 0,
    layerGroundFlip: false,
    layerObject1Rot: 0,
    layerObject1Flip: false,
    layerObject2Rot: 0,
    layerObject2Flip: false,
    layerObject2Interactive: false,
    ...overrides,
  };
}

function makeMap(
  width: number,
  height: number,
  blocked: number[] = []
): CachedMap {
  const blockedSet = new Set(blocked);
  const total = width * height;
  const cells: DecodedCell[] = [];

  for (let i = 0; i < total; i++) {
    cells.push(cell(i, { walkable: !blockedSet.has(i) }));
  }

  return { id: 1, width, height, cells };
}

describe("validatePath — basic invariants", () => {
  test("rejects an empty path", () => {
    const map = makeMap(10, 10);

    expect(() => validatePath(0, [], map)).toThrow(InvalidPathError);
  });

  test("rejects paths longer than MAX_PATH_LENGTH", () => {
    const map = makeMap(100, 100);
    const path = Array.from({ length: MAX_PATH_LENGTH + 1 }, (_, i) => ({
      direction: 0,
      cell: i + 1,
    }));

    expect(() => validatePath(0, path, map)).toThrow(/too_long/);
  });

  test("accepts a one-step EAST move", () => {
    const map = makeMap(10, 10);

    const result = validatePath(0, [{ direction: 0, cell: 1 }], map);

    expect(result.cells).toEqual([1]);
    expect(result.endCell).toBe(1);
    expect(result.endDirection).toBe(0);
    expect(result.truncated).toBe(false);
  });
});

describe("validatePath — strict declared-direction check", () => {
  test("rejects when declared direction's delta does not land on the step cell", () => {
    const map = makeMap(10, 10);

    // Direction 0 (E) expects prev+1; passing cell=2 is spoofed.
    expect(() => validatePath(0, [{ direction: 0, cell: 2 }], map)).toThrow(
      /not_adjacent/
    );
  });

  test("rejects directions outside 0..7", () => {
    const map = makeMap(10, 10);

    expect(() => validatePath(0, [{ direction: 9, cell: 1 }], map)).toThrow(
      /bad_direction/
    );
  });

  test("rejects off-grid expected cells", () => {
    const map = makeMap(3, 3);

    // Direction 4 (W) from cell 0 → expected -1.
    expect(() => validatePath(0, [{ direction: 4, cell: -1 }], map)).toThrow(
      /off_grid/
    );
  });
});

describe("validatePath — unwalkable handling", () => {
  test("rejects the first step into an unwalkable cell when stopOnUnwalkable is false", () => {
    const map = makeMap(10, 10, [1]);

    expect(() =>
      validatePath(0, [{ direction: 0, cell: 1 }], map, {
        stopOnUnwalkable: false,
      })
    ).toThrow(/unwalkable/);
  });

  test("always rejects when the very first step is unwalkable, even in truncate mode", () => {
    const map = makeMap(10, 10, [1]);

    expect(() => validatePath(0, [{ direction: 0, cell: 1 }], map)).toThrow(
      /unwalkable/
    );
  });

  test("truncates when an intermediate step is unwalkable (exploration default)", () => {
    // Path 0 → 1 (walkable) → 2 (blocked). Exploration should return prefix [1].
    const map = makeMap(10, 10, [2]);

    const result = validatePath(
      0,
      [
        { direction: 0, cell: 1 },
        { direction: 0, cell: 2 },
      ],
      map
    );

    expect(result.cells).toEqual([1]);
    expect(result.endCell).toBe(1);
    expect(result.truncated).toBe(true);
  });
});
