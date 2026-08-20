import { describe, expect, test } from "bun:test";

import type { DecodedCell } from "@modules/maps/maps.cells-codec";
import {
  cellToRowCol,
  detectExitDirection,
  oppositeEdgeCell,
  resolveLandingCell,
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

  // The map outline zigzags between long and short rows, and in real 1.29 map
  // data the walkable border cells — the ones a player can actually stand on
  // to leave — sit on the SHORT (odd) rows. Long-row extremes are decoration
  // and blocked. Measured over 400 imported maps, only 21 had any walkable
  // cell the long-row-only rule recognised, against 141 for these.
  describe("short rows carry the walkable border", () => {
    test("short row col 0 is W", () => {
      const cell = rowColToCell(3, 0, 10);

      expect(detectExitDirection(cell, 10, 10)).toBe(4);
    });

    test("short row last col (width - 2) is E", () => {
      const cell = rowColToCell(3, 8, 10);

      expect(detectExitDirection(cell, 10, 10)).toBe(0);
    });

    test("first short row is N", () => {
      const cell = rowColToCell(1, 4, 10);

      expect(detectExitDirection(cell, 10, 10)).toBe(6);
    });

    test("last short row is S", () => {
      const cell = rowColToCell(17, 4, 10);

      expect(detectExitDirection(cell, 10, 10)).toBe(2);
    });

    test("first short row col 0 is NW corner", () => {
      const cell = rowColToCell(1, 0, 10);

      expect(detectExitDirection(cell, 10, 10)).toBe(5);
    });

    test("a short-row cell one column in is still interior", () => {
      const cell = rowColToCell(9, 4, 10);

      expect(detectExitDirection(cell, 10, 10)).toBeUndefined();
    });
  });
});

describe("resolveLandingCell", () => {
  const WIDTH = 10;
  const HEIGHT = 10;
  const LAST_ROW = 2 * HEIGHT - 2;

  /** A map whose walkable cells are exactly the given ids. */
  function mapWith(walkable: number[]) {
    const cells: DecodedCell[] = [];

    for (let id = 0; id < (HEIGHT - 1) * (2 * WIDTH - 1) + WIDTH; id++) {
      cells.push({
        id,
        active: true,
        walkable: walkable.includes(id),
      } as DecodedCell);
    }

    return { width: WIDTH, height: HEIGHT, cells };
  }

  test("lands on the geometric mirror when it is walkable", () => {
    const mirror = rowColToCell(LAST_ROW, 4, WIDTH);
    const target = mapWith([mirror]);

    expect(resolveLandingCell(target, rowColToCell(1, 4, WIDTH), 6, WIDTH)).toBe(
      mirror
    );
  });

  // The regression: the outer long row is blocked decoration on real maps, so
  // the mirror cell is unwalkable and the player used to land there anyway,
  // stranded with no walkable neighbour.
  test("falls back to the nearest walkable cell on the arrival edge", () => {
    const nearby = rowColToCell(LAST_ROW - 1, 5, WIDTH);
    const target = mapWith([nearby]);

    expect(resolveLandingCell(target, rowColToCell(1, 4, WIDTH), 6, WIDTH)).toBe(
      nearby
    );
  });

  test("prefers the closest of several walkable arrival cells", () => {
    const far = rowColToCell(LAST_ROW - 1, 0, WIDTH);
    const near = rowColToCell(LAST_ROW - 1, 4, WIDTH);
    const target = mapWith([far, near]);

    expect(resolveLandingCell(target, rowColToCell(1, 4, WIDTH), 6, WIDTH)).toBe(
      near
    );
  });

  test("ignores walkable cells that are not on the arrival edge", () => {
    const interior = rowColToCell(8, 4, WIDTH);
    const target = mapWith([interior]);

    expect(
      resolveLandingCell(target, rowColToCell(1, 4, WIDTH), 6, WIDTH)
    ).toBeUndefined();
  });

  test("returns undefined when the arrival edge has nothing walkable", () => {
    expect(
      resolveLandingCell(mapWith([]), rowColToCell(1, 4, WIDTH), 6, WIDTH)
    ).toBeUndefined();
  });
});
