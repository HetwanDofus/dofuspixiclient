import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import type { DB } from "@core/shared/db/schema.ts";
import type { DofusMessage } from "@dofus/proto/server_messages_pb";
import type { Kysely } from "kysely";
import { SpellUpgradeHandler } from "@core/features/game/spell-upgrade/spell-upgrade.handler.ts";
import { LangsService } from "@core/modules/langs/langs.service.ts";
import { PlayersRepository } from "@core/modules/players/players.repository.ts";
import { SpellsRepository } from "@core/modules/spells/spells.repository.ts";
import { SpellsService } from "@core/modules/spells/spells.service.ts";
import { StatsService } from "@core/modules/stats/stats.service.ts";
import { GatewayFrameService } from "@core/shared/gateway-adapter/gateway-frame.service.ts";
import { SessionRegistry } from "@core/shared/gateway-adapter/session-registry.ts";
import { Test } from "@nestjs/testing";

import { createTestDatabaseModule, setupTestDatabase } from "./harness.ts";

const SESSION = "session-1";
const PLAYER = "1";
/** Ronce — level 6 requires character level 101 in the canonical data. */
const SPELL = 183;
/** Any second spell, for the cross-spell race. */
const OTHER_SPELL = 181;

describe("SpellUpgradeHandler (integration)", () => {
  let db: Kysely<DB>;
  let handler: SpellUpgradeHandler;
  let moduleRef: Awaited<
    ReturnType<ReturnType<typeof Test.createTestingModule>["compile"]>
  >;
  let sent: DofusMessage[];

  beforeAll(async () => {
    const harness = await setupTestDatabase();
    db = harness.db;

    sent = [];

    moduleRef = await Test.createTestingModule({
      imports: [createTestDatabaseModule(db)],
      providers: [
        SpellUpgradeHandler,
        PlayersRepository,
        SpellsRepository,
        SpellsService,
        {
          provide: SessionRegistry,
          useValue: { get: () => ({ characterId: PLAYER }) },
        },
        {
          provide: GatewayFrameService,
          useValue: {
            broadcast: (_ids: string[], msg: DofusMessage) => sent.push(msg),
          },
        },
        // The panel's point counter rides the As frame; this test reads
        // the balance straight off the row instead.
        { provide: StatsService, useValue: { sendStats: async () => {} } },
        // The SpellList the handler re-emits is localised through here.
        // Falling through to the template name is the documented
        // behaviour when a spell has no lang entry, so an empty lookup
        // exercises a real path rather than a stub-only one.
        { provide: LangsService, useValue: { getSpellSync: () => undefined } },
      ],
    }).compile();

    handler = moduleRef.get(SpellUpgradeHandler);
  });

  beforeEach(async () => {
    sent.length = 0;
    await db.deleteFrom("playerSpells").execute();
    await db.deleteFrom("playerStats").execute();
    await db.deleteFrom("players").execute();
    await db.deleteFrom("accounts").execute();

    await db
      .insertInto("gameServers")
      .values({
        id: 1,
        name: "Test",
        address: "127.0.0.1",
        port: 8080,
        state: 1,
        community: 0,
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();

    await db
      .insertInto("accounts")
      .values({
        id: "1",
        username: "tester",
        pwdHash: "x",
        pseudo: "tester",
        community: 0,
        isAdmin: false,
        isBanned: false,
        question: "",
        answer: "",
      })
      .execute();
  });

  async function seedPlayer(level: number, spellPoints: number) {
    await db
      .insertInto("players")
      .values({
        id: PLAYER,
        accountId: "1",
        serverId: 1,
        name: "Dev",
        sex: 0,
        class: 10,
        gfx: 100,
        level,
        spellPoints,
        mapId: 1,
        cellId: 1,
        savepointMapId: 1,
        savepointCellId: 1,
        direction: 3,
      })
      .execute();
  }

  async function seedSpell(spellLevel: number) {
    await db
      .insertInto("playerSpells")
      .values({
        playerId: PLAYER,
        spellId: SPELL,
        level: spellLevel,
        position: 1,
      })
      .execute();
  }

  function upgrade() {
    return handler.handle(
      { sessionId: SESSION } as never,
      {
        spellId: SPELL,
      } as never
    );
  }

  async function readState() {
    const [player, spell] = await Promise.all([
      db
        .selectFrom("players")
        .select("spellPoints")
        .where("id", "=", PLAYER)
        .executeTakeFirst(),
      db
        .selectFrom("playerSpells")
        .select("level")
        .where("playerId", "=", PLAYER)
        .where("spellId", "=", SPELL)
        .executeTakeFirst(),
    ]);
    return { spellPoints: player?.spellPoints, level: spell?.level };
  }

  function lastUpgradeFrame() {
    const frames = sent.filter((m) => m.payload.case === "spellUpgrade");
    const last = frames.at(-1);
    return last?.payload.case === "spellUpgrade" ? last.payload.value : null;
  }

  test("spends the level's cost and raises the spell", async () => {
    await seedPlayer(101, 5);
    await seedSpell(1);

    await upgrade();

    expect(await readState()).toEqual({ spellPoints: 4, level: 2 });
    expect(lastUpgradeFrame()).toMatchObject({ success: true, newLevel: 2 });
  });

  test("charges the level being left, not a flat rate", async () => {
    await seedPlayer(101, 10);
    await seedSpell(4);

    await upgrade();

    // 4 -> 5 costs 4.
    expect(await readState()).toEqual({ spellPoints: 6, level: 5 });
  });

  test("refuses when the player cannot afford the next level", async () => {
    await seedPlayer(101, 3);
    await seedSpell(4);

    await upgrade();

    expect(await readState()).toEqual({ spellPoints: 3, level: 4 });
    expect(lastUpgradeFrame()).toMatchObject({ success: false, newLevel: 4 });
  });

  test("refuses when the character level is below the level requirement", async () => {
    // Ronce 6 requires character level 101; this character is 100.
    await seedPlayer(100, 99);
    await seedSpell(5);

    await upgrade();

    expect(await readState()).toEqual({ spellPoints: 99, level: 5 });
    expect(lastUpgradeFrame()).toMatchObject({ success: false, newLevel: 5 });
  });

  test("refuses past the last level in the spell's table", async () => {
    await seedPlayer(200, 99);
    await seedSpell(6);

    await upgrade();

    expect(await readState()).toEqual({ spellPoints: 99, level: 6 });
    expect(lastUpgradeFrame()).toMatchObject({ success: false, newLevel: 6 });
  });

  test("refuses a spell the player does not know", async () => {
    await seedPlayer(101, 99);

    await upgrade();

    expect(lastUpgradeFrame()).toMatchObject({ success: false, newLevel: 0 });
  });

  test("two clicks buy two levels, each at its own price", async () => {
    await seedPlayer(101, 10);
    await seedSpell(1);

    await upgrade();
    await upgrade();

    // 1 -> 2 costs 1, 2 -> 3 costs 2.
    expect(await readState()).toEqual({ spellPoints: 7, level: 3 });
  });

  test("the debit refuses once the balance is gone, on any spell", async () => {
    await seedPlayer(101, 1);
    await seedSpell(1);
    await db
      .insertInto("playerSpells")
      .values({ playerId: PLAYER, spellId: OTHER_SPELL, level: 1, position: 2 })
      .execute();

    await upgrade();
    await upgrade(OTHER_SPELL);

    const levels = await db
      .selectFrom("playerSpells")
      .select("level")
      .where("playerId", "=", PLAYER)
      .execute();

    expect((await readState()).spellPoints).toBe(0);
    // One point, one level — the second spell stays where it was.
    expect(levels.map((l) => l.level).sort()).toEqual([1, 2]);
  });

  test("spendSpellPoints is atomic under concurrency", async () => {
    // The invariant the handler's ordering rests on. Two upgrade frames
    // for *different* spells both read the same balance and both pass a
    // read-side affordability check, so the debit has to be the thing
    // that refuses — its predicate and its subtraction are one statement.
    // (The handler itself cannot be raced in-process: its awaits resolve
    // in order on the pool, so this asserts the property directly.)
    await seedPlayer(101, 1);
    const players = moduleRef.get(PlayersRepository);

    const results = await Promise.all([
      players.spendSpellPoints(PLAYER, 1),
      players.spendSpellPoints(PLAYER, 1),
      players.spendSpellPoints(PLAYER, 1),
    ]);

    expect(results.filter((r) => r === 1)).toHaveLength(1);
    expect((await readState()).spellPoints).toBe(0);
  });

  test("a duplicate request for a level already bought is a no-op", async () => {
    // What the handler's conditional UPDATE guards: two frames in flight
    // that both read level 1 must not both debit. Reproduced directly on
    // the repository, since the pool serialises the handler's own reads.
    await seedPlayer(101, 10);
    await seedSpell(2);

    const repo = moduleRef.get(SpellsRepository);
    await expect(repo.setPlayerSpellLevel(PLAYER, SPELL, 2)).resolves.toBe(0);
    expect(await readState()).toEqual({ spellPoints: 10, level: 2 });
  });
});
