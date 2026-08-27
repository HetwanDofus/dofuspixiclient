import { describe, expect, test } from "bun:test";

import type { PlayerMovementDeps } from "@/game/scene/player/movement";
import type { ActivePlayer } from "@/game/scene/player/types";
import { PlayerMovement } from "@/game/scene/player/movement";

// `interrupt` is the whole of "click somewhere else while walking": it
// decides where the sprite is allowed to stop, and that cell is what the
// server is then told to commit.

function walking(path: number[], pathIndex: number): ActivePlayer {
  return { moving: true, path, pathIndex } as unknown as ActivePlayer;
}

// `interrupt` reads and writes movement state only — it never reaches
// for map geometry, the renderer or the sprite loader.
const movement = new PlayerMovement({} as unknown as PlayerMovementDeps);

describe("PlayerMovement.interrupt", () => {
  test("stops on the cell being entered and drops the rest of the path", () => {
    const player = walking([100, 115, 130, 145], 1);

    expect(movement.interrupt(player)).toBe(130);
    // The anchor and the destination of the segment in flight survive,
    // so the sprite finishes the step it started instead of sliding
    // back or stopping between two cells.
    expect(player.path).toEqual([100, 115, 130]);
  });

  test("a walk that just started stops on its first step", () => {
    const player = walking([100, 115, 130], 0);

    expect(movement.interrupt(player)).toBe(115);
    expect(player.path).toEqual([100, 115]);
  });

  test("the last segment is left alone — it already ends where it ends", () => {
    const player = walking([100, 115, 130], 1);

    expect(movement.interrupt(player)).toBe(130);
    expect(player.path).toEqual([100, 115, 130]);
  });

  test("a standing player interrupts nothing", () => {
    const player = {
      moving: false,
      path: [],
      pathIndex: 0,
    } as unknown as ActivePlayer;

    expect(movement.interrupt(player)).toBeNull();
  });
});
