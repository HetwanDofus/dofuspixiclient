import "reflect-metadata";

import { beforeEach, describe, expect, test } from "bun:test";

import type { AccountStats } from "@dofus/proto/account_pb";
import type { InfoLifeRestoreTimer } from "@dofus/proto/chat_pb";
import type { DofusMessage } from "@dofus/proto/server_messages_pb";
import type { InventoryFramesService } from "@modules/inventory/inventory.frames.service";
import type { InventoryRepository } from "@modules/inventory/inventory.repository";
import type { ItemTemplateCacheService } from "@modules/inventory/item-template.cache";
import type { PlayersRepository } from "@modules/players/players.repository";
import type { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { REGEN_MS_PER_LIFE_STANDING } from "@modules/life-regen/life-regen";
import { LifeRegenService } from "@modules/life-regen/life-regen.service";
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
let equipped: { templateId: number; quantity: number }[];
let templates: Record<number, ItemEffect[]>;
let sent: DofusMessage[];
let service: StatsService;
let persistedLife: { life: number; at: Date } | null;

function lastStats(): AccountStats {
  // Searched rather than taken from the end: `sendStats` also emits the
  // `Ow` weight frame and the `IL` life-restore timer, and which one
  // lands last is not what these tests are about.
  for (let i = sent.length - 1; i >= 0; i--) {
    const frame = sent[i];
    if (frame?.payload.case === "accountStats") {
      return frame.payload.value;
    }
  }
  throw new Error("no AccountStats frame was broadcast");
}

function lastLifeRestoreTimer(): InfoLifeRestoreTimer {
  for (let i = sent.length - 1; i >= 0; i--) {
    const frame = sent[i];
    if (frame?.payload.case === "infoLifeRestoreTimer") {
      return frame.payload.value;
    }
  }
  throw new Error("no InfoLifeRestoreTimer frame was broadcast");
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
    lifeUpdatedAt: null,
  };
  equipped = [];
  templates = {};
  sent = [];
  persistedLife = null;

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
    // `sendStats` also sums the whole inventory for `ItemWeight` — the
    // equipped fixture doubles as "everything owned" here since no test
    // in this file asserts on weight.
    findByPlayer: async () => equipped,
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

  // A real LifeRegenService over a stub repository: the regeneration is
  // now part of what `sendStats` reports, so stubbing it out would hide
  // the very interaction these tests exist to pin down.
  const lifeRegen = new LifeRegenService({
    setLife: async (_id: string, life: number, at: Date) => {
      persistedLife = { life, at };
    },
  } as unknown as PlayersRepository);

  // `sendStats` also broadcasts `ItemWeight` through here; no test in
  // this file asserts on it, so the stub only needs to not throw.
  const inventoryFrames = {
    sendWeight: () => {},
  } as unknown as InventoryFramesService;

  service = new StatsService(
    templateCache,
    inventory,
    players,
    frames,
    lifeRegen,
    inventoryFrames
  );
});

describe("StatsService.sendStats", () => {
  test("carries the character's level so the panel does not fall back to 1", async () => {
    await service.sendStats(SESSION, CHARACTER);

    expect(lastStats().showedLevel).toBe(20);
  });

  test("regeneration owed since the last read reaches the frame", async () => {
    // 20 seconds at one point per two seconds: ten points owed.
    player.life = 300;
    player.lifeUpdatedAt = new Date(Date.now() - 20_000);

    await service.sendStats(SESSION, CHARACTER);

    expect(lastStats().lp).toBe(310);
    // And it is written back, not merely displayed: anything that reads
    // the column without resolving must see the same number.
    expect(persistedLife?.life).toBe(310);
  });

  test("a character at full life triggers no write", async () => {
    player.life = maxLifePoints(20, 200);
    player.lifeUpdatedAt = new Date(Date.now() - 3_600_000);

    await service.sendStats(SESSION, CHARACTER);

    expect(lastStats().lp).toBe(maxLifePoints(20, 200));
    expect(persistedLife).toBeNull();
  });

  test("a character below its cap is handed the regeneration clock", async () => {
    player.life = 300;
    player.lifeUpdatedAt = new Date();

    await service.sendStats(SESSION, CHARACTER);

    // Without this frame the client has no rate to count with, and the
    // heart sits frozen until something else asks for stats.
    expect(lastLifeRestoreTimer()).toMatchObject({
      started: true,
      rate: REGEN_MS_PER_LIFE_STANDING,
    });
  });

  test("a character at full life is told to stop counting", async () => {
    player.life = maxLifePoints(20, 200);
    player.lifeUpdatedAt = new Date();

    await service.sendStats(SESSION, CHARACTER);

    expect(lastLifeRestoreTimer().started).toBe(false);
  });

  test("derives max life rather than echoing the current-life column", async () => {
    await service.sendStats(SESSION, CHARACTER);

    const stats = lastStats();
    expect(stats.lpMax).toBe(maxLifePoints(20, 200));
    expect(stats.lp).toBe(300);
  });

  test("AP, MP, range and summons carry their equipment bonus separately", async () => {
    // 111 = +AP, 128 = +MP, 117 = +range, 182 = +summons.
    equipped = [{ templateId: 1, quantity: 1 }];
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
    equipped = [{ templateId: 1, quantity: 1 }];
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
