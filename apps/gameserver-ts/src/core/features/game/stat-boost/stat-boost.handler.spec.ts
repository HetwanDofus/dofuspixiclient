import "reflect-metadata";

import { beforeEach, describe, expect, test } from "bun:test";

import type { PlayersRepository } from "@modules/players/players.repository";
import type { BoostableStat } from "@modules/stats/boost-cost";
import type { StatsService } from "@modules/stats/stats.service";
import { create } from "@bufbuild/protobuf";
import { AccountUseBoostSchema } from "@dofus/proto/account_pb";
import { StatBoostHandler } from "@features/game/stat-boost/stat-boost.handler";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

// Féca (breed 1) prices Force at 2 capital below 50 and 3 from 50 up —
// the cheapest way to show that the cost is derived, not taken from the
// frame. The wire numbers Force 10 and Vitalité 11.
const FECA = 1;
const WIRE_STRENGTH = 10;
const SESSION = "s-1";
const CHARACTER = "42";

interface FakePlayer {
  class: number;
  statsPoints: number;
}

let registry: SessionRegistry;
let player: FakePlayer;
let stats: Record<BoostableStat, number>;
let statsSent: number;
let handler: StatBoostHandler;

function boost(statId: number) {
  return create(AccountUseBoostSchema, { statId, quantity: 1 });
}

beforeEach(() => {
  registry = new SessionRegistry(new EventEmitter2());
  registry.open({
    sessionId: SESSION,
    accountId: "acc-1",
    characterId: "",
    remoteAddr: "10.0.0.1",
  });
  registry.attachCharacter(SESSION, CHARACTER);

  player = { class: FECA, statsPoints: 10 };
  stats = {
    strength: 0,
    vitality: 0,
    wisdom: 0,
    chance: 0,
    agility: 0,
    intelligence: 0,
  };
  statsSent = 0;

  const players = {
    findById: async () => player,
    // The real repository hands back a row snapshot, so a later
    // boostStat must not be visible through it.
    findStats: async () => ({ ...stats }),
    spendStatPoints: async (_id: string, cost: number) => {
      // Mirrors the repository's conditional UPDATE: the predicate and
      // the debit are one step, so a racing caller sees 0.
      if (player.statsPoints < cost) {
        return 0;
      }
      player.statsPoints -= cost;
      return 1;
    },
    refundStatPoints: async (_id: string, cost: number) => {
      player.statsPoints += cost;
    },
    boostStat: async (_id: string, stat: BoostableStat, amount: number) => {
      stats[stat] += amount;
      return 1;
    },
  } as unknown as PlayersRepository;

  const statsService = {
    sendStats: async () => {
      statsSent += 1;
    },
  } as unknown as StatsService;

  handler = new StatBoostHandler(registry, players, statsService);
});

describe("StatBoostHandler", () => {
  test("charges the breed's price, not the quantity the client sent", async () => {
    await handler.handle({ sessionId: SESSION }, boost(WIRE_STRENGTH));

    expect(stats.strength).toBe(1);
    // Féca Force below 50 costs 2, even though the frame said quantity 1.
    expect(player.statsPoints).toBe(8);
    expect(statsSent).toBe(1);
  });

  test("re-prices as the characteristic crosses a threshold", async () => {
    stats.strength = 49;
    await handler.handle({ sessionId: SESSION }, boost(WIRE_STRENGTH));
    expect(player.statsPoints).toBe(8); // 49 → still the 2-point tier

    stats.strength = 50;
    await handler.handle({ sessionId: SESSION }, boost(WIRE_STRENGTH));
    expect(player.statsPoints).toBe(5); // 50 → the 3-point tier
  });

  test("refuses a boost the player cannot afford", async () => {
    player.statsPoints = 1;

    await handler.handle({ sessionId: SESSION }, boost(WIRE_STRENGTH));

    expect(stats.strength).toBe(0);
    expect(player.statsPoints).toBe(1);
    expect(statsSent).toBe(0);
  });

  test("concurrent boosts cannot overdraw the capital", async () => {
    player.statsPoints = 2;

    await Promise.all([
      handler.handle({ sessionId: SESSION }, boost(WIRE_STRENGTH)),
      handler.handle({ sessionId: SESSION }, boost(WIRE_STRENGTH)),
    ]);

    expect(player.statsPoints).toBe(0);
    expect(stats.strength).toBe(1);
  });

  test("ignores a stat id that is not one of the six", async () => {
    await handler.handle({ sessionId: SESSION }, boost(99));

    expect(player.statsPoints).toBe(10);
    expect(statsSent).toBe(0);
  });

  test("ignores a session with no character attached", async () => {
    registry.open({
      sessionId: "s-2",
      accountId: "acc-2",
      characterId: "",
      remoteAddr: "10.0.0.2",
    });

    await handler.handle({ sessionId: "s-2" }, boost(WIRE_STRENGTH));

    expect(player.statsPoints).toBe(10);
    expect(statsSent).toBe(0);
  });
});
