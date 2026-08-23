import "reflect-metadata";

import { beforeEach, describe, expect, test } from "bun:test";

import type { AccountStats } from "@dofus/proto/account_pb";
import type { DofusMessage } from "@dofus/proto/server_messages_pb";
import type { InventoryRepository } from "@modules/inventory/inventory.repository";
import type { ItemTemplateCacheService } from "@modules/inventory/item-template.cache";
import type { PlayersRepository } from "@modules/players/players.repository";
import type { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import {
  BASE_AP,
  BASE_DISCERNMENT,
  BASE_MP,
  maxLifePoints,
} from "@modules/stats/stats.constants";
import { StatsService } from "@modules/stats/stats.service";

// The As frame is the only thing the characteristics window reads, so
// these assert the fields it prints rather than the service's internals.

const SESSION = "s-1";
const CHARACTER = "42";

interface ItemEffect {
  id: number;
  min?: number;
  /** The shape the world import actually writes; param1 is the min roll. */
  param1?: number;
}

let player: Record<string, unknown>;
let equipped: { templateId: number }[];
let templates: Record<number, ItemEffect[]>;
let sent: DofusMessage[];
let service: StatsService;

function lastStats(): AccountStats {
  const frame = sent.at(-1);
  if (frame?.payload.case !== "accountStats") {
    throw new Error("no AccountStats frame was broadcast");
  }
  return frame.payload.value;
}

beforeEach(() => {
  player = {
    id: CHARACTER,
    level: 20,
    experience: "5000",
    kamas: "1234",
    statsPoints: 7,
    spellPoints: 2,
    life: 300,
    energy: 9000,
    class: 1,
    alignment: 1,
    alignmentValue: 333,
    alignmentGrade: 4,
    pvpEnabled: true,
  };
  equipped = [];
  templates = {};
  sent = [];

  const players = {
    findById: async () => player,
    findStats: async () => ({
      strength: 100,
      vitality: 200,
      wisdom: 30,
      chance: 40,
      agility: 50,
      intelligence: 60,
    }),
  } as unknown as PlayersRepository;

  const inventory = {
    findEquipped: async () => equipped,
  } as unknown as InventoryRepository;

  const templateCache = {
    load: async (templateId: number) => ({
      effects: templates[templateId] ?? [],
    }),
  } as unknown as ItemTemplateCacheService;

  const frames = {
    broadcast: (_ids: readonly string[], message: DofusMessage) => {
      sent.push(message);
    },
  } as unknown as GatewayFrameService;

  service = new StatsService(templateCache, inventory, players, frames);
});

describe("StatsService.sendStats", () => {
  test("carries the character's level so the panel does not fall back to 1", async () => {
    await service.sendStats(SESSION, CHARACTER);

    expect(lastStats().showedLevel).toBe(20);
  });

  test("derives max life rather than echoing the current-life column", async () => {
    await service.sendStats(SESSION, CHARACTER);

    const stats = lastStats();
    expect(stats.lpMax).toBe(maxLifePoints(20, 200));
    expect(stats.lp).toBe(300);
  });

  test("AP, MP, range and summons carry their equipment bonus separately", async () => {
    // 111 = +AP, 128 = +MP, 117 = +range, 182 = +summons.
    equipped = [{ templateId: 1 }];
    templates[1] = [
      { id: 111, min: 1 },
      { id: 128, min: 2 },
      { id: 117, min: 3 },
      { id: 182, min: 1 },
    ];

    await service.sendStats(SESSION, CHARACTER);

    const stats = lastStats();
    expect(stats.ap).toMatchObject({ base: BASE_AP, items: 1 });
    expect(stats.mp).toMatchObject({ base: BASE_MP, items: 2 });
    expect(stats.range).toMatchObject({ base: 0, items: 3 });
    expect(stats.maxSummons).toMatchObject({ base: 1, items: 1 });
  });

  test("reads the world import's own effect shape, not just min/value", async () => {
    // item_templates rows carry {id, param1, param2, param3} — reading
    // only `min`/`value` silently dropped every equipment bonus.
    equipped = [{ templateId: 1 }];
    templates[1] = [
      { id: 111, param1: 1 },
      { id: 117, param1: 1 },
    ];

    await service.sendStats(SESSION, CHARACTER);

    const stats = lastStats();
    expect(stats.ap).toMatchObject({ base: BASE_AP, items: 1 });
    expect(stats.range).toMatchObject({ base: 0, items: 1 });
  });

  test("prospection starts at the 1.29 floor and grows with chance", async () => {
    await service.sendStats(SESSION, CHARACTER);

    expect(lastStats().discernment).toBe(BASE_DISCERNMENT + 4);
  });

  test("alignment and capital reach the window", async () => {
    await service.sendStats(SESSION, CHARACTER);

    const stats = lastStats();
    expect(stats.bonusPoints).toBe(7);
    expect(stats.bonusPointsSpell).toBe(2);
    expect(stats.alignment).toMatchObject({
      alignment: 1,
      grade: 4,
      rankValue: 333,
      enabled: true,
    });
  });

  test("success points are 0 until an achievement system exists", async () => {
    await service.sendStats(SESSION, CHARACTER);

    expect(lastStats().successPoints).toBe(0);
  });

  test("the experience bar gets real bounds, not 0/0", async () => {
    await service.sendStats(SESSION, CHARACTER);

    const stats = lastStats();
    expect(Number(stats.xp)).toBe(5000);
    expect(Number(stats.xpLow)).toBeLessThan(Number(stats.xpHigh));
  });
});
