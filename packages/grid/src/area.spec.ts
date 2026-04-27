import { describe, expect, it } from "bun:test";

import { AreaKind, cellsInArea, type FightMapDims } from "./area.ts";

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
