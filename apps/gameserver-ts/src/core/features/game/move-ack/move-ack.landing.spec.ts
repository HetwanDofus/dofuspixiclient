import { describe, expect, test } from "bun:test";

import { resolveMoveLanding } from "@features/game/move-ack/move-ack.landing";

// The whole question this answers: after a walk, which cell does the
// character own? Getting it wrong either strands them where they are not
// (a plain ack on an interrupted walk) or hands them a teleport (an
// unchecked cancel).

const MOVE = {
  endCell: 300,
  endDirection: 3,
  steps: [
    { cell: 270, direction: 1 },
    { cell: 285, direction: 1 },
    { cell: 300, direction: 3 },
  ],
};

describe("resolveMoveLanding", () => {
  test("a plain ack lands on the validated destination", () => {
    const landing = resolveMoveLanding(MOVE, { isAck: true, cancelParams: "" });

    expect(landing).toEqual({ cell: 300, direction: 3, refusedClaim: null });
  });

  test("a cancel lands on the claimed cell, facing the way it was reached", () => {
    const landing = resolveMoveLanding(MOVE, {
      isAck: false,
      cancelParams: "285",
    });

    expect(landing).toEqual({ cell: 285, direction: 1, refusedClaim: null });
  });

  test("a cell that is not on the path is refused, not committed", () => {
    // The interesting case: a cancel naming an arbitrary cell would
    // otherwise be a free teleport anywhere on the map.
    const landing = resolveMoveLanding(MOVE, {
      isAck: false,
      cancelParams: "1",
    });

    expect(landing).toEqual({
      cell: 300,
      direction: 3,
      refusedClaim: "1",
    });
  });

  test("a malformed cancel falls back to the destination", () => {
    const landing = resolveMoveLanding(MOVE, {
      isAck: false,
      cancelParams: "",
    });

    expect(landing.cell).toBe(300);
    expect(landing.refusedClaim).toBe("");
  });

  test("a move restored without its steps can still be acked", () => {
    // Handoff snapshots taken before the path was recorded: the ack
    // path must not depend on it.
    const landing = resolveMoveLanding(
      { endCell: 300, endDirection: 3 },
      { isAck: true, cancelParams: "" }
    );

    expect(landing.cell).toBe(300);
  });
});
