import { describe, expect, test } from "bun:test";

import type { MonsterDropRow } from "@shared/db/schema";
import { rollLoot } from "@modules/fight/engine/fight.loot";

function drop(over: Partial<MonsterDropRow> = {}): MonsterDropRow {
  return {
    monsterId: 1,
    itemTemplateId: 100,
    rate: 50,
    minQuantity: 1,
    maxQuantity: 1,
    ...over,
  };
}

/** A generator returning the given values in order, then zero. */
function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[i++] ?? 0;
}

describe("rollLoot", () => {
  test("a rate of zero never drops, however much prospection is stacked", () => {
    const won = rollLoot(
      {
        drops: [drop({ rate: 0 })],
        prospection: 10_000,
        challengeBonusPct: 500,
      },
      // The lowest possible roll: if anything can drop this line, it does.
      () => 0
    );

    expect(won).toEqual([]);
  });

  test("a rate of 100 at baseline prospection always drops", () => {
    const won = rollLoot(
      { drops: [drop({ rate: 100 })], prospection: 100, challengeBonusPct: 0 },
      // The highest roll short of 1, i.e. 99.999…% — still below 100%.
      () => 0.99999
    );

    expect(won).toEqual([{ templateId: 100, quantity: 1 }]);
  });

  test("prospection scales the rate against the 100-point floor", () => {
    const input = {
      drops: [drop({ rate: 10 })],
      challengeBonusPct: 0,
    };

    // A 10% line, rolled at 15: refused at 100 prospection (10% chance),
    // granted at 200 (20%). Same roll, same line — only prospection moves.
    expect(rollLoot({ ...input, prospection: 100 }, () => 0.15)).toEqual([]);
    expect(rollLoot({ ...input, prospection: 200 }, () => 0.15)).toHaveLength(
      1
    );
  });

  test("the challenge bonus scales the rate too", () => {
    const input = { drops: [drop({ rate: 10 })], prospection: 100 };

    expect(rollLoot({ ...input, challengeBonusPct: 0 }, () => 0.15)).toEqual(
      []
    );
    expect(
      rollLoot({ ...input, challengeBonusPct: 100 }, () => 0.15)
    ).toHaveLength(1);
  });

  test("each drop line is an independent draw", () => {
    const won = rollLoot(
      {
        drops: [
          drop({ itemTemplateId: 1, rate: 50 }),
          drop({ itemTemplateId: 2, rate: 50 }),
          drop({ itemTemplateId: 3, rate: 50 }),
        ],
        prospection: 100,
        challengeBonusPct: 0,
      },
      // Two hits below 50%, one miss above it.
      sequence(0.1, 0.9, 0.2)
    );

    expect(won.map((w) => w.templateId)).toEqual([1, 3]);
  });

  test("quantity is drawn from the row's range, not hardcoded to one", () => {
    const won = rollLoot(
      {
        drops: [drop({ rate: 100, minQuantity: 2, maxQuantity: 5 })],
        prospection: 100,
        challengeBonusPct: 0,
      },
      // First value passes the rate gate, second picks the quantity: at
      // 0.99 of a 4-wide span that is the top of the range.
      sequence(0, 0.99)
    );

    expect(won).toEqual([{ templateId: 100, quantity: 5 }]);
  });

  test("a min quantity below one is clamped rather than granting nothing", () => {
    const won = rollLoot(
      {
        drops: [drop({ rate: 100, minQuantity: 0, maxQuantity: 0 })],
        prospection: 100,
        challengeBonusPct: 0,
      },
      () => 0
    );

    expect(won).toEqual([{ templateId: 100, quantity: 1 }]);
  });
});
