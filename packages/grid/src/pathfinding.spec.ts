import { describe, expect, test } from "bun:test";

import { totalCells } from "./cell";
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
});
