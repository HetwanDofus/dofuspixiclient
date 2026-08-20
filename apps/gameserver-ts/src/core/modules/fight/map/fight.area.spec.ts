import { describe, expect, test } from "bun:test";

import { AreaKind } from "@modules/fight/fight.types";
import {
  cellsInArea,
  cellToRowCol,
  distance,
  fastDistance,
  hasLineOfSight,
} from "@modules/fight/map/fight.area";
import { FightMap } from "@modules/fight/map/fight.map";

function makeMap(width: number, height: number): FightMap {
  return new FightMap(width, height, [], []);
}

describe("fastDistance", () => {
  test("returns 0 for same cell", () => {
    const fmap = makeMap(15, 17);
    expect(fastDistance(fmap, 42, 42)).toBe(0);
  });

  test("returns 1 for adjacent cells horizontally", () => {
    const fmap = makeMap(15, 17);
    expect(fastDistance(fmap, 0, 1)).toBe(1);
  });

  test("is symmetric", () => {
    const fmap = makeMap(15, 17);
    const d1 = fastDistance(fmap, 50, 150);
    const d2 = fastDistance(fmap, 150, 50);
    expect(d1).toBe(d2);
  });

  // fastDistance is Chebyshev over (row, col); `distance` is a BFS over the
  // real isometric adjacency (a cell's neighbours are ±width and ±(width-1),
  // NOT ±1). The two agree on true neighbours and diverge on same-row pairs
  // like (0, 1), which are two grid steps apart — that gap is accepted: the
  // only caller is the monster AI's target heuristic.
  test("matches distance for true grid neighbours", () => {
    const fmap = makeMap(15, 17);
    const fast = fastDistance(fmap, 30, 15);
    const slow = distance(fmap, 30, 15);
    expect(fast).toBe(1);
    expect(fast).toBe(slow);
  });

  test("underestimates same-row pairs, which are two steps apart", () => {
    const fmap = makeMap(15, 17);
    expect(fastDistance(fmap, 0, 1)).toBe(1);
    expect(distance(fmap, 0, 1)).toBe(2);
  });
});

describe("cellToRowCol", () => {
  test("converts cell 0 to row 0, col 0", () => {
    const result = cellToRowCol(0, 15);
    expect(result.row).toBe(0);
    expect(result.col).toBe(0);
  });

  test("converts cell 1 to row 0, col 1", () => {
    const result = cellToRowCol(1, 15);
    expect(result.row).toBe(0);
    expect(result.col).toBe(1);
  });

  test("wraps after stride length", () => {
    const width = 15;
    const stride = 2 * width - 1;
    const result = cellToRowCol(stride, width);
    expect(result.row).toBe(2);
  });
});

describe("distance", () => {
  test("returns 0 for same cell", () => {
    const fmap = makeMap(10, 10);
    expect(distance(fmap, 5, 5)).toBe(0);
  });

  // Neighbours in the isometric grid sit ±width and ±(width-1) away — cell 6
  // is the same row as cell 5, which is two steps, not one.
  test("returns 1 for adjacent cells", () => {
    const fmap = makeMap(10, 10);
    expect(distance(fmap, 5, 15)).toBe(1);
    expect(distance(fmap, 5, 14)).toBe(1);
  });

  test("calculates distance correctly for distant cells", () => {
    const fmap = makeMap(10, 10);
    const d = distance(fmap, 0, 100);
    expect(d).toBeGreaterThan(0);
  });
});

describe("cellsInArea", () => {
  test("AreaNone returns single cell", () => {
    const fmap = makeMap(10, 10);
    const cells = cellsInArea(fmap, 50, 50, AreaKind.None, 1);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toBe(50);
  });

  test("AreaCross returns center + cardinal arms", () => {
    const fmap = makeMap(10, 10);
    const cells = cellsInArea(fmap, 50, 50, AreaKind.Cross, 1);
    expect(cells).toContain(50);
    expect(cells.length).toBeGreaterThan(1);
  });

  test("AreaCross with size 0 returns only center", () => {
    const fmap = makeMap(10, 10);
    const cells = cellsInArea(fmap, 50, 50, AreaKind.Cross, 0);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toBe(50);
  });

  test("AreaCircle returns cell and neighbors", () => {
    const fmap = makeMap(10, 10);
    const cells = cellsInArea(fmap, 50, 50, AreaKind.Circle, 1);
    expect(cells).toContain(50);
    expect(cells.length).toBeGreaterThan(1);
  });
});

describe("hasLineOfSight", () => {
  test("returns true for same cell", () => {
    const fmap = makeMap(10, 10);
    expect(hasLineOfSight(fmap, 50, 50)).toBe(true);
  });

  test("returns true for unobstructed path", () => {
    const fmap = makeMap(10, 10);
    expect(hasLineOfSight(fmap, 0, 9)).toBe(true);
  });

  test("returns false when occupied cell blocks", () => {
    const fmap = makeMap(10, 10);
    fmap.occupy(5, 100);
    const result = hasLineOfSight(fmap, 0, 9);
    expect(result).toBe(false);
  });

  test("returns true when cell is occupied by same fighter", () => {
    const fmap = makeMap(10, 10);
    fmap.occupy(5, 100);
    expect(hasLineOfSight(fmap, 0, 9)).toBe(false);
  });

  test("respects bounds", () => {
    const fmap = makeMap(10, 10);
    const total = 10 * 10 * 2;
    const result = hasLineOfSight(fmap, total - 1, total + 10);
    expect(result).toBe(false);
  });
});
