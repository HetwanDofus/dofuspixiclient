import { describe, expect, test } from "bun:test";

import {
  cellToRowCol,
  detectExitDirection,
  oppositeEdgeCell,
  rowColToCell,
} from "@modules/maps/maps.edge";

describe("cellToRowCol / rowColToCell", () => {
  test("round-trips cell id on a long row", () => {
    const coord = cellToRowCol(5, 10);

    expect(coord).toMatchObject({ row: 0, col: 5, isLong: true });
    expect(rowColToCell(coord.row, coord.col, 10)).toBe(5);
  });

  test("round-trips cell id on a short row", () => {
    const coord = cellToRowCol(10, 10);

    expect(coord).toMatchObject({ row: 1, col: 0, isLong: false });
    expect(rowColToCell(coord.row, coord.col, 10)).toBe(10);
  });

  test("last cell of short row 1 on width-10 map is cell 18", () => {
    const coord = cellToRowCol(18, 10);

    expect(coord).toMatchObject({ row: 1, col: 8, isLong: false });
  });

  test("cell 19 starts pair 1 (row 2, long)", () => {
    const coord = cellToRowCol(19, 10);

    expect(coord).toMatchObject({ row: 2, col: 0, isLong: true });
  });
});

describe("oppositeEdgeCell — cardinals", () => {
  test("E → W edge, same row", () => {
    expect(oppositeEdgeCell(9, 0, 10, 10, 10)).toBe(rowColToCell(0, 0, 10));
  });

  test("W → E edge, same row", () => {
    expect(oppositeEdgeCell(0, 4, 10, 10, 10)).toBe(rowColToCell(0, 9, 10));
  });

  test("S → N edge, same col", () => {
    expect(oppositeEdgeCell(3, 2, 10, 10, 10)).toBe(rowColToCell(0, 3, 10));
  });

  test("N → S edge, same col", () => {
    expect(oppositeEdgeCell(3, 6, 10, 10, 10)).toBe(rowColToCell(18, 3, 10));
  });
});

describe("oppositeEdgeCell — diagonals", () => {
  test("SE → NW corner of target", () => {
    expect(oppositeEdgeCell(9, 1, 10, 10, 10)).toBe(rowColToCell(0, 0, 10));
  });

  test("SW → NE corner", () => {
    expect(oppositeEdgeCell(0, 3, 10, 10, 10)).toBe(rowColToCell(0, 9, 10));
  });

  test("NW → SE corner", () => {
    expect(oppositeEdgeCell(0, 5, 10, 10, 10)).toBe(rowColToCell(18, 9, 10));
  });

  test("NE → SW corner", () => {
    expect(oppositeEdgeCell(9, 7, 10, 10, 10)).toBe(rowColToCell(18, 0, 10));
  });
});

describe("oppositeEdgeCell — differing target size", () => {
  test("clamps col when target is narrower", () => {
    const target = oppositeEdgeCell(8, 2, 10, 5, 5);

    expect(target).toBe(rowColToCell(0, 4, 5));
  });
});

describe("detectExitDirection", () => {
  test("cell 0 is NW corner", () => {
    expect(detectExitDirection(0, 10, 10)).toBe(5);
  });

  test("cell 9 is NE corner", () => {
    expect(detectExitDirection(9, 10, 10)).toBe(7);
  });

  test("row 2 col 0 (cell 19) returns W", () => {
    expect(detectExitDirection(19, 10, 10)).toBe(4);
  });

  test("interior cell returns undefined", () => {
    const cell = rowColToCell(4, 5, 10);

    expect(detectExitDirection(cell, 10, 10)).toBeUndefined();
  });

  test("last long row col 0 is SW corner", () => {
    const cell = rowColToCell(18, 0, 10);

    expect(detectExitDirection(cell, 10, 10)).toBe(3);
  });

  test("last long row col 9 is SE corner", () => {
    const cell = rowColToCell(18, 9, 10);

    expect(detectExitDirection(cell, 10, 10)).toBe(1);
  });
});
