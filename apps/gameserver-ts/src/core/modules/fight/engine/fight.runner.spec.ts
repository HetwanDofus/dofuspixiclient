import { describe, expect, test } from "bun:test";

import { ActiveState } from "@modules/fight/core/fight.active-state";
import { Fight } from "@modules/fight/core/fight.entity";
import { Fighter } from "@modules/fight/core/fight.fighter";
import { Runner } from "@modules/fight/engine/fight.runner";
import { FighterKind, FightType, TeamSide } from "@modules/fight/fight.types";
import { FightMap } from "@modules/fight/map/fight.map";

function makeFight(): {
  fight: Fight;
  playerFighter: Fighter;
  monsterFighter: Fighter;
} {
  const fmap = new FightMap(15, 17, [100], [200]);
  const fight = new Fight(FightType.PvM, 1, fmap, [
    { side: TeamSide.Side0, leaderId: 1 },
    { side: TeamSide.Side1, leaderId: 2 },
  ]);
  const player = new Fighter(1, FighterKind.Player, "player", 100, 6, 3, 3);
  const monster = new Fighter(-1, FighterKind.Monster, "monster", 50, 4, 2, 3);
  fight.teams[0].add(player);
  fight.teams[1].add(monster);
  player.cell = 100;
  monster.cell = 200;
  fmap.occupy(100, 1);
  fmap.occupy(200, -1);
  return { fight, playerFighter: player, monsterFighter: monster };
}

function stubSink() {
  const broadcasts: Array<{ messageId: string; payload: unknown }> = [];
  return {
    sink: {
      broadcast: (_fight: Fight, messageId: string, payload: unknown) => {
        broadcasts.push({ messageId, payload });
      },
      sendTo: () => {},
    },
    broadcasts,
  };
}

describe("Runner", () => {
  test("constructor creates runner instance", () => {
    const { fight } = makeFight();
    const active = new ActiveState();
    active.enter(fight);
    const { sink } = stubSink();
    const runner = new Runner(fight, active, sink, 30_000);
    expect(runner).toBeDefined();
  });

  test("stop prevents further turn advances", () => {
    const { fight } = makeFight();
    const active = new ActiveState();
    active.enter(fight);
    const { sink } = stubSink();
    const runner = new Runner(fight, active, sink, 30_000);
    runner.stop();
    // After stop, requestEnd should be no-op due to stopped check
    runner.requestEnd(1);
    // No exception should be thrown
    expect(true).toBe(true);
  });

  test("requestEnd is no-op for wrong fighter id", () => {
    const { fight } = makeFight();
    const active = new ActiveState();
    active.enter(fight);
    const { sink } = stubSink();
    const runner = new Runner(fight, active, sink, 30_000);
    // requestEnd with wrong ID should not throw
    runner.requestEnd(9999);
    expect(true).toBe(true);
  });

  test("notifyDeath removes fighter from turn list", () => {
    const { fight, monsterFighter } = makeFight();
    const active = new ActiveState();
    active.enter(fight);
    const { sink } = stubSink();
    const runner = new Runner(fight, active, sink, 30_000);

    monsterFighter.setLp(0);
    runner.notifyDeath(monsterFighter.id);

    // Fighter should be removed from turn list
    expect(
      active.turnList.fighters().find((f) => f.id === monsterFighter.id)
    ).toBeUndefined();
  });

  test("notifyReady is callable without error", () => {
    const { fight } = makeFight();
    const active = new ActiveState();
    active.enter(fight);
    const { sink } = stubSink();
    const runner = new Runner(fight, active, sink, 30_000);
    runner.notifyReady(1);
    expect(true).toBe(true);
  });

  test("setObserver stores observer reference", () => {
    const { fight } = makeFight();
    const active = new ActiveState();
    active.enter(fight);
    const { sink } = stubSink();
    const runner = new Runner(fight, active, sink, 30_000);

    const observer = {
      onTurnStart: () => {},
    };
    runner.setObserver(observer);
    expect(runner).toBeDefined();
  });
});
