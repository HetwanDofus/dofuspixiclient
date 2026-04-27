import { describe, expect, test } from "bun:test";

import { Fighter } from "@modules/fight/core/fight.fighter";
import { initiativeOf, TurnList } from "@modules/fight/core/fight.turn";
import { FighterKind } from "@modules/fight/fight.types";

function makeFighter(id: number, level: number): Fighter {
  const f = new Fighter(id, FighterKind.Player, `f${id}`, 100, 6, 3, 3);
  f.player = {
    id,
    name: `f${id}`,
    level,
    life: 100,
    sex: 0,
    gfx: 10,
    direction: 3,
    stats: {
      strength: 0,
      vitality: 0,
      wisdom: 0,
      intelligence: 0,
      chance: 0,
      agility: 0,
    },
  };
  return f;
}

function makeMonster(id: number): Fighter {
  return new Fighter(id, FighterKind.Monster, `m${id}`, 50, 4, 2, 3);
}

describe("initiativeOf", () => {
  test("returns level*2 for players", () => {
    expect(initiativeOf(makeFighter(1, 10))).toBe(20);
  });

  test("returns 0 for monsters", () => {
    expect(initiativeOf(makeMonster(-1))).toBe(0);
  });
});

describe("TurnList", () => {
  test("sorts by initiative desc, id asc for tiebreaks", () => {
    const f1 = makeFighter(1, 5);
    const f2 = makeFighter(2, 10);
    const f3 = makeFighter(3, 10);
    const tl = new TurnList([f1, f2, f3]);
    const order = tl.fighters();
    expect(order[0]?.id).toBe(2);
    expect(order[1]?.id).toBe(3);
    expect(order[2]?.id).toBe(1);
  });

  test("current returns null before first advance", () => {
    const tl = new TurnList([makeFighter(1, 5)]);
    expect(tl.current()).toBeNull();
  });

  test("advance cycles through fighters", () => {
    const f1 = makeFighter(1, 10);
    const f2 = makeFighter(2, 5);
    const tl = new TurnList([f1, f2]);
    const r1 = tl.advance();
    expect(r1.next?.id).toBe(1);
    const r2 = tl.advance();
    expect(r2.next?.id).toBe(2);
  });

  test("advance skips dead fighters", () => {
    const f1 = makeFighter(1, 10);
    const f2 = makeFighter(2, 5);
    f1.setLp(0);
    const tl = new TurnList([f1, f2]);
    const r = tl.advance();
    expect(r.next?.id).toBe(2);
  });

  test("advance returns null when all dead", () => {
    const f1 = makeFighter(1, 10);
    f1.setLp(0);
    const tl = new TurnList([f1]);
    const r = tl.advance();
    expect(r.next).toBeNull();
  });

  test("advance increments round on wrap", () => {
    const tl = new TurnList([makeFighter(1, 10), makeFighter(2, 5)]);
    tl.advance();
    tl.advance();
    const r = tl.advance();
    expect(r.rounded).toBe(true);
    expect(tl.round).toBe(1);
  });

  test("remove adjusts current index", () => {
    const f1 = makeFighter(1, 10);
    const f2 = makeFighter(2, 5);
    const tl = new TurnList([f1, f2]);
    tl.advance();
    tl.remove(1);
    expect(tl.fighters()).toHaveLength(1);
  });
});
