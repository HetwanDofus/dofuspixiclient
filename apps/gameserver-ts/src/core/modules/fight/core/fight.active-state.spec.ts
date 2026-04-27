import { describe, expect, test } from "bun:test";

import { ActiveState } from "@modules/fight/core/fight.active-state";
import { Fight } from "@modules/fight/core/fight.entity";
import { Fighter } from "@modules/fight/core/fight.fighter";
import { FighterKind, FightType, TeamSide } from "@modules/fight/fight.types";
import { FightMap } from "@modules/fight/map/fight.map";

describe("ActiveState", () => {
  test("turnList is accessible before enter() with empty list", () => {
    const state = new ActiveState();
    expect(state.turnList).toBeDefined();
    expect(state.turnList.current()).toBeNull();
    expect(state.turnList.fighters()).toHaveLength(0);
  });

  test("enter() populates turnList from fight fighters", () => {
    const fmap = new FightMap(15, 17, [], []);
    const fight = new Fight(FightType.PvM, 1, fmap, [
      { side: TeamSide.Side0, leaderId: 1 },
      { side: TeamSide.Side1, leaderId: 2 },
    ]);
    const f1 = new Fighter(1, FighterKind.Player, "p1", 100, 6, 3, 3);
    const f2 = new Fighter(2, FighterKind.Monster, "m1", 50, 4, 2, 3);
    f1.player = {
      id: 1,
      name: "p1",
      level: 50,
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
    fight.teams[0].add(f1);
    fight.teams[1].add(f2);

    const state = new ActiveState();
    state.enter(fight);
    expect(state.turnList.fighters()).toHaveLength(2);
  });

  test("enter() marks state as started", () => {
    const fmap = new FightMap(15, 17, [], []);
    const fight = new Fight(FightType.PvM, 1, fmap, [
      { side: TeamSide.Side0, leaderId: 1 },
      { side: TeamSide.Side1, leaderId: 2 },
    ]);
    const f1 = new Fighter(1, FighterKind.Player, "p1", 100, 6, 3, 3);
    f1.player = {
      id: 1,
      name: "p1",
      level: 50,
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
    fight.teams[0].add(f1);

    const state = new ActiveState();
    expect(state.isStarted).toBe(false);
    state.enter(fight);
    expect(state.isStarted).toBe(true);
  });

  test("name property returns Active", () => {
    const state = new ActiveState();
    expect(state.name).toBe(3);
  });

  test("leave() is callable", () => {
    const state = new ActiveState();
    state.leave({});
    expect(true).toBe(true);
  });

  test("allowLeave returns true for non-Challenge fights", () => {
    const fmap = new FightMap(15, 17, [], []);
    const fight = new Fight(FightType.PvM, 1, fmap, [
      { side: TeamSide.Side0, leaderId: 1 },
      { side: TeamSide.Side1, leaderId: 2 },
    ]);
    const f1 = new Fighter(1, FighterKind.Player, "p1", 100, 6, 3, 3);
    fight.teams[0].add(f1);

    const state = new ActiveState();
    expect(state.allowLeave(fight, f1)).toBe(true);
  });

  test("allowLeave returns false for Challenge fights", () => {
    const fmap = new FightMap(15, 17, [], []);
    const fight = new Fight(FightType.Challenge, 1, fmap, [
      { side: TeamSide.Side0, leaderId: 1 },
      { side: TeamSide.Side1, leaderId: 2 },
    ]);
    const f1 = new Fighter(1, FighterKind.Player, "p1", 100, 6, 3, 3);
    fight.teams[0].add(f1);

    const state = new ActiveState();
    expect(state.allowLeave(fight, f1)).toBe(false);
  });
});
