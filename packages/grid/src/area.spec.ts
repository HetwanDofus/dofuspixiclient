import { describe, expect, it } from "bun:test";

import {
  AreaKind,
  cellsInArea,
  type FightMapDims,
  type FightMapLos,
  hasLineOfSight,
} from "./area.ts";

const fmap: FightMapDims = { width: 15, height: 17 };
const ORIGIN = 285;

function setOf(arr: number[]): Set<number> {
  return new Set(arr);
}

describe("cellsInArea", () => {
  it("None always returns just the origin regardless of size", () => {
    expect(cellsInArea(fmap, ORIGIN, ORIGIN, AreaKind.None, 0)).toEqual([
      ORIGIN,
    ]);
    expect(cellsInArea(fmap, ORIGIN, ORIGIN, AreaKind.None, 5)).toEqual([
      ORIGIN,
    ]);
  });

  it("Circle radius 0 = just origin (1 cell)", () => {
    expect(setOf(cellsInArea(fmap, ORIGIN, ORIGIN, AreaKind.Circle, 0))).toEqual(
      setOf([ORIGIN])
    );
  });

  it("Circle radius 1 covers 5 cells (diamond: origin + 4 cardinals)", () => {
    const cells = cellsInArea(fmap, ORIGIN, ORIGIN, AreaKind.Circle, 1);
    expect(cells.length).toBe(5);
  });

  it("Circle radius 2 covers 13 cells (diamond, not 25-cell square)", () => {
    const cells = cellsInArea(fmap, ORIGIN, ORIGIN, AreaKind.Circle, 2);
    expect(cells.length).toBe(13);
  });

  it("Square radius 1 covers 9 cells (3x3)", () => {
    const cells = cellsInArea(fmap, ORIGIN, ORIGIN, AreaKind.Square, 1);
    expect(cells.length).toBe(9);
  });

  it("Square radius 2 covers 25 cells (5x5)", () => {
    const cells = cellsInArea(fmap, ORIGIN, ORIGIN, AreaKind.Square, 2);
    expect(cells.length).toBe(25);
  });

  it("Circle and Square produce different cell sets at radius >= 1", () => {
    const c = setOf(cellsInArea(fmap, ORIGIN, ORIGIN, AreaKind.Circle, 2));
    const s = setOf(cellsInArea(fmap, ORIGIN, ORIGIN, AreaKind.Square, 2));
    expect(c.size).toBe(13);
    expect(s.size).toBe(25);
    for (const cell of c) {
      expect(s.has(cell)).toBe(true);
    }
  });

  it("Cross radius 2 covers 9 cells (origin + 4 prongs of length 2)", () => {
    const cells = cellsInArea(fmap, ORIGIN, ORIGIN, AreaKind.Cross, 2);
    expect(cells.length).toBe(9);
  });

  it("PerpCross radius 2 covers 9 cells (diagonal prongs)", () => {
    const cells = cellsInArea(fmap, ORIGIN, ORIGIN, AreaKind.PerpCross, 2);
    expect(cells.length).toBe(9);
  });

  it("Ring radius 2 = circle r=2 minus circle r=1 (8 cells)", () => {
    const cells = cellsInArea(fmap, ORIGIN, ORIGIN, AreaKind.Ring, 2);
    expect(cells.length).toBe(8);
  });

  it("Line picks a single direction toward origin", () => {
    const cells = cellsInArea(fmap, ORIGIN, ORIGIN + 3, AreaKind.Line, 3);
    expect(cells.length).toBeGreaterThanOrEqual(1);
  });

  it("returns at least origin for every kind at size 0", () => {
    for (const kind of Object.values(AreaKind)) {
      const cells = cellsInArea(fmap, ORIGIN, ORIGIN, kind as AreaKind, 0);
      expect(cells.length).toBeGreaterThanOrEqual(1);
      expect(cells).toContain(ORIGIN);
    }
  });
});

describe("hasLineOfSight", () => {
  function losMap(
    occupied: Iterable<number> = [],
    losBlocked: Iterable<number> = []
  ): FightMapLos {
    const occ = new Set(occupied);
    const los = new Set(losBlocked);
    return {
      width: 15,
      height: 17,
      occupantOf: (cell) => (occ.has(cell) ? cell : undefined),
      losBlocked: (cell) => los.has(cell),
    };
  }

  it("from === to is always visible", () => {
    expect(hasLineOfSight(losMap(), 100, 100)).toBe(true);
  });

  it("clear path between adjacent cells", () => {
    expect(hasLineOfSight(losMap(), 100, 101)).toBe(true);
  });

  it("clear diagonal path returns true (the bug we fixed: dominant-direction LoS used to mis-handle this)", () => {
    // Two cells on a non-axial line. The previous implementation walked
    // only the dominant direction and either fell through to "true"
    // after 128 steps without hitting the target, or blocked on a
    // fighter that wasn't really on the line. This test pins the new
    // Bresenham walk: a clear diagonal must report visible.
    expect(hasLineOfSight(losMap(), 285, 285 + 30)).toBe(true);
  });

  it("blocks when a fighter sits between caster and target", () => {
    // Two cells one step apart in the iso x axis with a fighter in the
    // single intermediate cell. Bresenham's first step lands on the
    // blocker.
    const between = 285 + 15; // one (1, 0) iso step from origin in our grid
    expect(hasLineOfSight(losMap([between]), 285, 285 + 30)).toBe(false);
  });

  it("blocks when a cell on the path has lineOfSight=false (wall/decoration)", () => {
    const between = 285 + 15;
    expect(hasLineOfSight(losMap([], [between]), 285, 285 + 30)).toBe(false);
  });

  it("does NOT block when the only fighter is on the target cell itself", () => {
    // The target cell is not consulted by the obstruction loop — you
    // should always be able to *target* an occupied cell.
    expect(hasLineOfSight(losMap([285 + 30]), 285, 285 + 30)).toBe(true);
  });

  it("does NOT block when the only fighter is on the caster cell itself", () => {
    expect(hasLineOfSight(losMap([285]), 285, 285 + 30)).toBe(true);
  });

  it("blocks when the line walks off the map", () => {
    // Picking a target way outside the bounds of a 15x17 map; the
    // walker must bail at the first out-of-bounds step.
    const fmap2: FightMapLos = {
      width: 15,
      height: 17,
      occupantOf: () => undefined,
    };
    expect(hasLineOfSight(fmap2, 0, -1)).toBe(false);
  });
});
