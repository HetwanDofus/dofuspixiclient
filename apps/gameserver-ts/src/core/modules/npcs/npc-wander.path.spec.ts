import { describe, expect, it } from "bun:test";

import { Direction } from "@dofus/grid";
import {
  parsePatrol,
  reverseDirection,
  walkStep,
} from "@modules/npcs/npc-wander.path";

const MAP_WIDTH = 15;
const ALL_WALKABLE = () => true;

describe("parsePatrol", () => {
  it("reads the four screen directions", () => {
    // `Uneul Nak` on map 7329, the longest route in the dump.
    expect(parsePatrol("G2;B1;B2;B1;D2;D3")).toEqual([
      { direction: Direction.WEST, cells: 2 },
      { direction: Direction.SOUTH, cells: 1 },
      { direction: Direction.SOUTH, cells: 2 },
      { direction: Direction.SOUTH, cells: 1 },
      { direction: Direction.EAST, cells: 2 },
      { direction: Direction.EAST, cells: 3 },
    ]);
  });

  it("accepts a comma as a separator, which one route uses", () => {
    // `Rok Elreuss` on map 7427: "G3,B3;G2;B2".
    expect(parsePatrol("G3,B3;G2;B2")).toHaveLength(4);
  });

  it("drops a token it cannot read rather than guessing a direction", () => {
    expect(parsePatrol("X2;H1;;B0")).toEqual([
      { direction: Direction.NORTH, cells: 1 },
    ]);
  });

  it("is empty for an empty route", () => {
    expect(parsePatrol("")).toEqual([]);
  });
});

describe("walkStep", () => {
  it("walks the whole step when every cell is free", () => {
    // SOUTH is ±(2w-1) — one diamond straight down the screen.
    const stride = 2 * MAP_WIDTH - 1;
    expect(
      walkStep(
        200,
        { direction: Direction.SOUTH, cells: 2 },
        MAP_WIDTH,
        ALL_WALKABLE
      )
    ).toEqual([200 + stride, 200 + 2 * stride]);
  });

  it("stops at the last free cell rather than walking into scenery", () => {
    const stride = 2 * MAP_WIDTH - 1;
    const blocked = 200 + 2 * stride;
    expect(
      walkStep(
        200,
        { direction: Direction.SOUTH, cells: 3 },
        MAP_WIDTH,
        (cell) => cell !== blocked
      )
    ).toEqual([200 + stride]);
  });

  it("returns nothing when the very first cell is blocked", () => {
    expect(
      walkStep(
        200,
        { direction: Direction.EAST, cells: 2 },
        MAP_WIDTH,
        () => false
      )
    ).toEqual([]);
  });
});

describe("reverseDirection", () => {
  it("mirrors each screen direction onto its opposite", () => {
    expect(reverseDirection(Direction.NORTH)).toBe(Direction.SOUTH);
    expect(reverseDirection(Direction.SOUTH)).toBe(Direction.NORTH);
    expect(reverseDirection(Direction.EAST)).toBe(Direction.WEST);
    expect(reverseDirection(Direction.WEST)).toBe(Direction.EAST);
  });
});
