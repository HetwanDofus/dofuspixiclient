import { describe, expect, test } from "bun:test";

import { Fight } from "@modules/fight/core/fight.entity";
import { Fighter } from "@modules/fight/core/fight.fighter";
import { MonsterAI } from "@modules/fight/engine/fight.ai";
import { FighterKind, FightType, TeamSide } from "@modules/fight/fight.types";
import { FightMap } from "@modules/fight/map/fight.map";

function makeFight(): {
  fight: Fight;
  player: Fighter;
  monster: Fighter;
} {
  const fmap = new FightMap(15, 17, [100], [200]);
  const fight = new Fight(FightType.PvM, 1, fmap, [
    { side: TeamSide.Side0, leaderId: 1 },
    { side: TeamSide.Side1, leaderId: 2 },
  ]);
  const player = new Fighter(1, FighterKind.Player, "player", 100, 6, 3, 3);
  const monster = new Fighter(2, FighterKind.Monster, "monster", 50, 4, 2, 3);
  player.player = {
    id: 1,
    name: "player",
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
  fight.teams[0].add(player);
  fight.teams[1].add(monster);
  player.cell = 100;
  monster.cell = 200;
  fmap.occupy(100, 1);
  fmap.occupy(200, 2);
  return { fight, player, monster };
}

describe("MonsterAI", () => {
  test("constructor creates AI instance", () => {
    const requestEnd = (_id: number) => {};
    const ai = new MonsterAI(requestEnd);
    expect(ai).toBeDefined();
  });

  test("onTurnStart ignores player turns", () => {
    const { fight, player } = makeFight();
    let endCalled = false;
    const requestEnd = (_id: number) => {
      endCalled = true;
    };
    const ai = new MonsterAI(requestEnd);

    ai.onTurnStart(fight, player);
    expect(endCalled).toBe(false);
  });

  test("onTurnStart calls requestEnd for monster turn", async () => {
    const { fight, monster } = makeFight();
    let endCallId = 0;
    const requestEnd = (id: number) => {
      endCallId = id;
    };
    const ai = new MonsterAI(requestEnd);

    ai.onTurnStart(fight, monster);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(endCallId).toBe(monster.id);
  });

  test("onTurnStart ends turn when no enemies found", async () => {
    const { fight, monster } = makeFight();
    monster.team?.fighters().splice(0);
    let endCallId = 0;
    const requestEnd = (id: number) => {
      endCallId = id;
    };
    const ai = new MonsterAI(requestEnd);

    ai.onTurnStart(fight, monster);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(endCallId).toBe(monster.id);
  });

  test("constructor accepts cast callback", () => {
    const requestEnd = (_id: number) => {};
    const castFn = async () => {};
    const ai = new MonsterAI(requestEnd, castFn);
    expect(ai).toBeDefined();
  });
});
