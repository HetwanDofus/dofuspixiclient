import { beforeAll, describe, expect, test } from "bun:test";

import type { DB } from "@core/shared/db/schema.ts";
import type { Kysely } from "kysely";
import { LangsService } from "@core/modules/langs/langs.service.ts";
import { SpellsRepository } from "@core/modules/spells/spells.repository.ts";
import { SpellsService } from "@core/modules/spells/spells.service.ts";
import { Test } from "@nestjs/testing";

import { createTestDatabaseModule, setupTestDatabase } from "./harness.ts";

/**
 * Ronce (spell 183) at level 6, as the retail 1.29 spell book shows it —
 * the capture in `screenshot-ui/spells.png` is the oracle. This pins the
 * whole chain the detail panel depends on: migration 0039's level table,
 * 0045's level requirements, and the effect list the panel renders as
 * "Dommages : 11 à 18 (terre)".
 */
/** No such row — the panel can preview a spell the player has not learned. */
const UNKNOWN_PLAYER = "999999";

describe("SpellsService.buildSpellDetails (integration)", () => {
  let db: Kysely<DB>;
  let service: SpellsService;

  beforeAll(async () => {
    const harness = await setupTestDatabase();
    db = harness.db;

    const moduleRef = await Test.createTestingModule({
      imports: [createTestDatabaseModule(db)],
      providers: [
        SpellsService,
        SpellsRepository,
        { provide: LangsService, useValue: { getSpellSync: () => undefined } },
      ],
    }).compile();

    service = moduleRef.get(SpellsService);
  });

  test("returns every level of the spell", async () => {
    const details = await service.buildSpellDetails(UNKNOWN_PLAYER, 183);

    expect(details?.levels.map((l) => l.level)).toEqual([1, 2, 3, 4, 5, 6]);
    // The player is unknown, so the book shows the spell as unowned.
    expect(details?.playerLevel).toBe(0);
  });

  test("level 6 matches the retail spell book", async () => {
    const details = await service.buildSpellDetails(UNKNOWN_PLAYER, 183);
    const six = details?.levels.find((l) => l.level === 6);

    expect(six).toMatchObject({
      minPlayerLevel: 101,
      apCost: 3,
      rangeMin: 1,
      rangeMax: 8,
      criticalRate: 45,
      failureRate: 100,
      castPerTurn: 0,
      castPerTarget: 2,
      cooldown: 0,
      modifiableRange: true,
      lineOfSight: true,
      lineOnly: false,
      emptyCell: false,
      critFailureEndsTurn: false,
    });
  });

  test("level 6 carries the earth-damage effect the panel prints", async () => {
    const details = await service.buildSpellDetails(UNKNOWN_PLAYER, 183);
    const six = details?.levels.find((l) => l.level === 6);

    // Effect 97 is "Dommages : #1{~1~2 à }#2 (terre)".
    expect(six?.effects).toMatchObject([{ effectId: 97, min: 11, max: 18 }]);
    // Its critical variant is a fixed 22, which the formatter collapses
    // to "Dommages : 22 (terre)".
    expect(six?.criticalEffects).toMatchObject([
      { effectId: 97, min: 22, max: 22 },
    ]);
  });

  test("returns nothing for a spell with no level table", async () => {
    // The handler turns this into an empty SpellDetails rather than
    // staying silent — see spell-details.handler.ts.
    await expect(
      service.buildSpellDetails(UNKNOWN_PLAYER, 999_999)
    ).resolves.toBeUndefined();
  });
});
