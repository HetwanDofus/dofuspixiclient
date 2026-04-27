import { describe, expect, test } from "bun:test";

import type { CastContext } from "@modules/fight/effects/fight.buff.types";
import { BlitzkriegChallenge } from "@modules/fight/challenges/types/blitzkrieg.challenge";
import { CleanHandsChallenge } from "@modules/fight/challenges/types/clean-hands.challenge";
import { ElementaryChallenge } from "@modules/fight/challenges/types/elementary.challenge";
import { KeepMovingChallenge } from "@modules/fight/challenges/types/keep-moving.challenge";
import { Fight } from "@modules/fight/core/fight.entity";
import { Fighter } from "@modules/fight/core/fight.fighter";
import { FighterKind, FightType, TeamSide } from "@modules/fight/fight.types";
import { FightMap } from "@modules/fight/map/fight.map";

function makeFight(): {
  fight: Fight;
  player: Fighter;
  enemy: Fighter;
} {
  const fmap = new FightMap(15, 17, [100], [200]);
  const fight = new Fight(FightType.Challenge, 1, fmap, [
    { side: TeamSide.Side0, leaderId: 1 },
    { side: TeamSide.Side1, leaderId: 2 },
  ]);
  const player = new Fighter(1, FighterKind.Player, "player", 100, 6, 3, 3);
  const enemy = new Fighter(2, FighterKind.Monster, "enemy", 50, 4, 2, 3);
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
  fight.teams[1].add(enemy);
  player.cell = 100;
  enemy.cell = 200;
  fmap.occupy(100, 1);
  fmap.occupy(200, 2);
  return { fight, player, enemy };
}

function makeCastContext(
  _fight: Fight,
  caster: Fighter,
  target: Fighter,
  effectIds: number[] = [100]
): CastContext {
  return {
    caster,
    target,
    targetCell: target.cell,
    spell: {
      spellId: 1,
      level: 1,
      effects: effectIds.map((id) => ({
        id,
        min: 10,
        max: 10,
        special: 0,
        duration: 0,
        probability: 100,
        areaKind: 0,
        areaSize: 0,
        targetMask: 0,
      })),
      criticalEffects: [],
      apCost: 3,
      rangeMin: 1,
      rangeMax: 5,
      criticalRate: 0,
      failureRate: 0,
      lineOfSight: true,
      emptyCell: false,
      modifiableRange: false,
      castPerTurn: 0,
      castPerTarget: 0,
      cooldown: 0,
      lineOnly: false,
      visualGfxId: 0,
    },
    critical: false,
  };
}

describe("ElementaryChallenge", () => {
  test("fails when different elements are used", () => {
    const { fight, player, enemy } = makeFight();
    const challenge = new ElementaryChallenge();

    const waterSpell = makeCastContext(fight, player, enemy, [96]);
    challenge.onCastApplied(fight, waterSpell);
    expect(challenge.alive).toBe(true);

    const fireSpell = makeCastContext(fight, player, enemy, [99]);
    challenge.onCastApplied(fight, fireSpell);
    expect(challenge.alive).toBe(false);
  });

  test("succeeds when same element is used consistently", () => {
    const { fight, player, enemy } = makeFight();
    const challenge = new ElementaryChallenge();

    const waterSpell1 = makeCastContext(fight, player, enemy, [96]);
    challenge.onCastApplied(fight, waterSpell1);
    expect(challenge.alive).toBe(true);

    const waterSpell2 = makeCastContext(fight, player, enemy, [96]);
    challenge.onCastApplied(fight, waterSpell2);
    expect(challenge.alive).toBe(true);
  });

  test("ignores non-player caster attacks", () => {
    const { fight, player, enemy } = makeFight();
    const challenge = new ElementaryChallenge();

    const waterSpell = makeCastContext(fight, enemy, player, [96]);
    challenge.onCastApplied(fight, waterSpell);
    expect(challenge.alive).toBe(true);
  });
});

describe("BlitzkriegChallenge", () => {
  test("fails when enemy takes turn after being attacked", () => {
    const { fight, player, enemy } = makeFight();
    const challenge = new BlitzkriegChallenge();

    challenge.onFighterAttacked(fight, player, enemy);
    expect(challenge.alive).toBe(true);

    challenge.onTurnStart(fight, enemy);
    expect(challenge.alive).toBe(false);
  });

  test("succeeds when enemy never gets a turn", () => {
    const { fight, player, enemy } = makeFight();
    const challenge = new BlitzkriegChallenge();

    challenge.onFighterAttacked(fight, player, enemy);
    expect(challenge.alive).toBe(true);

    enemy.setLp(0);
    challenge.onFighterDied(fight, enemy);
    expect(challenge.alive).toBe(true);
  });

  test("ignores attacks from enemies", () => {
    const { fight, player, enemy } = makeFight();
    const challenge = new BlitzkriegChallenge();

    challenge.onFighterAttacked(fight, enemy, player);
    expect(challenge.alive).toBe(true);

    challenge.onTurnStart(fight, enemy);
    expect(challenge.alive).toBe(true);
  });
});

describe("CleanHandsChallenge", () => {
  test("fails when player attacks directly", () => {
    const { fight, player, enemy } = makeFight();
    const challenge = new CleanHandsChallenge();

    challenge.onFighterAttacked(fight, player, enemy);
    expect(challenge.alive).toBe(false);
  });

  test("succeeds when invocation attacks", () => {
    const { fight, enemy } = makeFight();
    const challenge = new CleanHandsChallenge();

    const invocation = new Fighter(
      3,
      FighterKind.Invocation,
      "invocation",
      50,
      4,
      2,
      3
    );
    fight.teams[0].add(invocation);
    invocation.invocatorId = 1;

    challenge.onFighterAttacked(fight, invocation, enemy);
    expect(challenge.alive).toBe(true);
  });

  test("ignores attacks on friendly targets", () => {
    const { fight, player } = makeFight();
    const challenge = new CleanHandsChallenge();
    const friendly = new Fighter(3, FighterKind.Player, "friend", 100, 6, 3, 3);
    fight.teams[0].add(friendly);

    challenge.onFighterAttacked(fight, player, friendly);
    expect(challenge.alive).toBe(true);
  });
});

describe("KeepMovingChallenge", () => {
  test("fails when MP removal spell is cast on enemy", () => {
    const { fight, player, enemy } = makeFight();
    const challenge = new KeepMovingChallenge();

    const mpRemovalSpell = makeCastContext(fight, player, enemy, [77]);
    challenge.onCastApplied(fight, mpRemovalSpell);
    expect(challenge.alive).toBe(false);
  });

  test("fails with effect 127 (alternate MP removal)", () => {
    const { fight, player, enemy } = makeFight();
    const challenge = new KeepMovingChallenge();

    const mpRemovalSpell = makeCastContext(fight, player, enemy, [127]);
    challenge.onCastApplied(fight, mpRemovalSpell);
    expect(challenge.alive).toBe(false);
  });

  test("succeeds when non-MP-removal spell is cast", () => {
    const { fight, player, enemy } = makeFight();
    const challenge = new KeepMovingChallenge();

    const damageSpell = makeCastContext(fight, player, enemy, [100]);
    challenge.onCastApplied(fight, damageSpell);
    expect(challenge.alive).toBe(true);
  });

  test("ignores casts from enemies", () => {
    const { fight, player, enemy } = makeFight();
    const challenge = new KeepMovingChallenge();

    const mpRemovalSpell = makeCastContext(fight, enemy, player, [77]);
    challenge.onCastApplied(fight, mpRemovalSpell);
    expect(challenge.alive).toBe(true);
  });

  test("ignores casts on friendly targets", () => {
    const { fight, player } = makeFight();
    const challenge = new KeepMovingChallenge();
    const friendly = new Fighter(3, FighterKind.Player, "friend", 100, 6, 3, 3);
    fight.teams[0].add(friendly);

    const mpRemovalSpell = makeCastContext(fight, player, friendly, [77]);
    challenge.onCastApplied(fight, mpRemovalSpell);
    expect(challenge.alive).toBe(true);
  });
});
