import { describe, expect, test } from "bun:test";

import { totalCells } from "./cell";
import { isMapChangeCell } from "./edge";
import { getNeighbors } from "./neighbors";
import { DofusPathfinding } from "./pathfinding";

const WIDTH = 15;
const HEIGHT = 17;
const WALKABLE = Array.from({ length: totalCells(WIDTH, HEIGHT) }, (_, i) => i);

describe("DofusPathfinding.findAdjacentPath", () => {
  test("ends beside an interactive cell, never on top of it", () => {
    const pathfinding = new DofusPathfinding(WIDTH, HEIGHT, WALKABLE);
    const target = 200;

    const path = pathfinding.findAdjacentPath(0, target);

    expect(path).not.toBeNull();
    expect(path?.at(-1)).not.toBe(target);
    expect(getNeighbors(target, WIDTH, HEIGHT)).toContain(
      path?.at(-1) as number
    );
  });

  test("does not move a character that is already beside the resource", () => {
    const pathfinding = new DofusPathfinding(WIDTH, HEIGHT, WALKABLE);
    const target = 200;
    const start = getNeighbors(target, WIDTH, HEIGHT)[0] as number;

    expect(pathfinding.findAdjacentPath(start, target)).toEqual([start]);
  });

  test("never stops on a cell that would change map", () => {
    const pathfinding = new DofusPathfinding(WIDTH, HEIGHT, WALKABLE);
    // A resource one row above the bottom edge: its closest neighbours are
    // the border cells the server reads as an exit.
    const target = totalCells(WIDTH, HEIGHT) - WIDTH - 2;

    expect(
      getNeighbors(target, WIDTH, HEIGHT).some((cell) =>
        isMapChangeCell(cell, WIDTH, HEIGHT)
      )
    ).toBe(true);

    const path = pathfinding.findAdjacentPath(0, target);

    expect(path).not.toBeNull();
    expect(isMapChangeCell(path?.at(-1) as number, WIDTH, HEIGHT)).toBe(false);
  });

  test("acts from where the character stands, edge cell or not", () => {
    const pathfinding = new DofusPathfinding(WIDTH, HEIGHT, WALKABLE);
    const target = totalCells(WIDTH, HEIGHT) - WIDTH - 2;
    const start = getNeighbors(target, WIDTH, HEIGHT).find((cell) =>
      isMapChangeCell(cell, WIDTH, HEIGHT)
    ) as number;

    expect(pathfinding.findAdjacentPath(start, target)).toEqual([start]);
  });
});
