import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import type { DB } from "@core/shared/db/schema.ts";
import type { Kysely } from "kysely";
import {
  derivePasswordKey,
  isCanonicalPasswordKey,
} from "@core/features/auth/password-key.ts";
import {
  fingerprintRequest,
  parseProvisionAccountRequest,
} from "@core/features/auth/provision-account/provision-account.contract.ts";
import { isProvisionError } from "@core/features/auth/provision-account/provision-account.errors.ts";
import { AccountProvisioningService } from "@core/features/auth/provision-account/provision-account.service.ts";

import { setupTestDatabase } from "./harness.ts";

const SERVER_ID = 1;
const SPAWN_MAP_ID = 10_300;

/**
 * A 15x17 grid of flat, walkable, art-less cells, in the HASH_CELL
 * encoding `maps.cells-codec.ts` decodes — the same placeholder the dev
 * seed inserts. Provisioning must find a walkable cell in it.
 */
const HASH_CELL =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
const BLANK_WALKABLE_CELL = `${HASH_CELL[33]}${HASH_CELL[7]}${HASH_CELL[32]}${"a".repeat(7)}`;
const MAP_WIDTH = 15;
const MAP_HEIGHT = 17;

/** The three spells a level 1 Féca (class 1) knows. */
const CLASS_ID = 1;

describe("AccountProvisioningService (integration)", () => {
  let db: Kysely<DB>;
  let service: AccountProvisioningService;

  const request = (over: Record<string, unknown> = {}) =>
    parseProvisionAccountRequest({
      username: "bot-astrub-01",
      passwordKey: Buffer.alloc(32, 7).toString("base64"),
      pseudo: "Bot Astrub 01",
      serverId: SERVER_ID,
      character: { name: "BotAstrub", breedId: CLASS_ID, sex: 1 },
      ...over,
    });

  beforeAll(async () => {
    const harness = await setupTestDatabase();
    db = harness.db;
    service = new AccountProvisioningService(db, {
      spawnMapId: SPAWN_MAP_ID,
    });
  });

  beforeEach(async () => {
    await db.deleteFrom("provisioningRequests").execute();
    await db.deleteFrom("players").execute();
    await db.deleteFrom("accounts").execute();
    await db.deleteFrom("gameServers").execute();
    await db.deleteFrom("maps").where("id", "=", SPAWN_MAP_ID).execute();
    await db.deleteFrom("subareas").where("id", "=", 1).execute();

    await db
      .insertInto("gameServers")
      .values({
        id: SERVER_ID,
        name: "int-srv",
        address: "127.0.0.1",
        port: 5555,
        state: 1,
        community: 0,
        maxPlayers: 2000,
        onlinePlayers: 0,
        acceptsMigration: false,
      })
      .execute();

    await db
      .insertInto("subareas")
      .values({
        id: 1,
        areaId: 0,
        name: "int",
        conquestable: false,
        alignment: 0,
      })
      .execute();

    await db
      .insertInto("maps")
      .values({
        id: SPAWN_MAP_ID,
        date: "0",
        key: "",
        width: MAP_WIDTH,
        height: MAP_HEIGHT,
        cells: Buffer.from(
          BLANK_WALKABLE_CELL.repeat(MAP_WIDTH * MAP_HEIGHT * 2),
          "utf8"
        ),
        subareaId: 1,
        x: 0,
        y: 0,
        superarea: 0,
        background: 0,
        outdoor: null,
        musicId: null,
        ambianceId: null,
        mapData: "",
        capabilities: 0,
        numgroup: 0,
        mobSizeMin: 0,
        mobSizeMax: 0,
        mobFixSize: 0,
        forbidden: "",
        monstersRaw: "",
      })
      .execute();
  });

  async function counts() {
    const rows = await Promise.all(
      (["accounts", "players", "provisioningRequests"] as const).map((table) =>
        db
          .selectFrom(table)
          .select((eb) => eb.fn.countAll<string>().as("n"))
          .executeTakeFirstOrThrow()
      )
    );

    return rows.map((r) => Number(r.n));
  }

  async function expectRefusal(
    promise: Promise<unknown>,
    code: string
  ): Promise<void> {
    try {
      await promise;
    } catch (err) {
      expect(isProvisionError(err) && err.code).toBe(code);

      return;
    }

    throw new Error(`expected ${code}`);
  }

  test("provisions an account and a character that /auth can then use", async () => {
    const password = "hunter2";
    const passwordKey = await derivePasswordKey(password, "bot-astrub-01");

    expect(isCanonicalPasswordKey(passwordKey)).toBe(true);

    const result = await service.provision(
      crypto.randomUUID(),
      request({ passwordKey })
    );

    expect(result.created).toBe(true);

    // Exactly the query `LoginRepository.findByUsername` runs, followed by
    // the check `LoginHandler` makes on it: the account is not merely in
    // the table, the password the operator chose actually opens it.
    const account = await db
      .selectFrom("accounts")
      .select(["id", "pwdHash", "isBanned"])
      .where("username", "=", "bot-astrub-01")
      .executeTakeFirstOrThrow();

    expect(account.id).toBe(result.account.id);
    expect(account.isBanned).toBe(false);
    expect(await Bun.password.verify(passwordKey, account.pwdHash)).toBe(true);
    expect(account.pwdHash).not.toContain(passwordKey);

    // `ServerListRepository.listForAccount` — the server-select screen.
    const servers = await db
      .selectFrom("gameServers")
      .leftJoin("accountServers", (join) =>
        join
          .onRef("accountServers.serverId", "=", "gameServers.id")
          .on("accountServers.accountId", "=", account.id)
      )
      .select(["gameServers.id as serverId", "accountServers.characterCount"])
      .execute();

    expect(servers).toEqual([{ serverId: SERVER_ID, characterCount: 1 }]);

    // `CharacterListRepository.listForAccount` — the character-select screen.
    const characters = await db
      .selectFrom("players")
      .leftJoin("playerColors", "playerColors.playerId", "players.id")
      .where("players.accountId", "=", account.id)
      .where("players.serverId", "=", SERVER_ID)
      .where("players.deletedAt", "is", null)
      .select([
        "players.id",
        "players.name",
        "players.level",
        "players.gfx",
        "playerColors.color1",
      ])
      .execute();

    expect(characters).toEqual([
      {
        id: result.character.id,
        name: "BotAstrub",
        level: 1,
        gfx: 11,
        color1: -1,
      },
    ]);
  });

  test("gives the character the rows that make it selectable and playable", async () => {
    const result = await service.provision(crypto.randomUUID(), request());

    const stats = await db
      .selectFrom("playerStats")
      .selectAll()
      .where("playerId", "=", result.character.id)
      .executeTakeFirst();

    expect(stats).toBeDefined();

    const player = await db
      .selectFrom("players")
      .select(["mapId", "cellId", "savepointMapId", "savepointCellId", "class"])
      .where("id", "=", result.character.id)
      .executeTakeFirstOrThrow();

    expect(player.class).toBe(CLASS_ID);
    expect(player.mapId).toBe(SPAWN_MAP_ID);
    expect(player.savepointMapId).toBe(SPAWN_MAP_ID);
    expect(player.savepointCellId).toBe(player.cellId);

    // The schema's default cell (319) is not walkable on this map shape;
    // a spawn read out of `maps.cells` is the whole point.
    expect(player.cellId).not.toBe(319);

    const expected = await db
      .selectFrom("classSpells")
      .select("spellId")
      .where("classId", "=", CLASS_ID)
      .where("learnLevel", "<=", 1)
      .execute();

    const granted = await db
      .selectFrom("playerSpells")
      .select("spellId")
      .where("playerId", "=", result.character.id)
      .execute();

    expect(granted.length).toBe(expected.length);
    expect(granted.length).toBeGreaterThan(0);
  });

  test("picks the only online server when serverId is omitted", async () => {
    const result = await service.provision(
      crypto.randomUUID(),
      request({ serverId: undefined })
    );

    const player = await db
      .selectFrom("players")
      .select("serverId")
      .where("id", "=", result.character.id)
      .executeTakeFirstOrThrow();

    expect(player.serverId).toBe(SERVER_ID);
  });

  test("refuses to guess when several servers are online", async () => {
    await db
      .insertInto("gameServers")
      .values({
        id: 2,
        name: "int-srv-2",
        address: "127.0.0.1",
        port: 5556,
        state: 1,
        community: 0,
        maxPlayers: 2000,
        onlinePlayers: 0,
        acceptsMigration: false,
      })
      .execute();

    await expectRefusal(
      service.provision(crypto.randomUUID(), request({ serverId: undefined })),
      "server_required"
    );

    expect(await counts()).toEqual([0, 0, 0]);
  });

  test("refuses an unknown server without leaving anything behind", async () => {
    await expectRefusal(
      service.provision(crypto.randomUUID(), request({ serverId: 99 })),
      "unknown_server"
    );

    expect(await counts()).toEqual([0, 0, 0]);
  });

  test("replaying the same key and body returns the same result, once", async () => {
    const key = crypto.randomUUID();

    const first = await service.provision(key, request());
    const second = await service.provision(key, request());

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.account).toEqual(first.account);
    expect(second.character).toEqual(first.character);
    expect(await counts()).toEqual([1, 1, 1]);
  });

  test("two concurrent calls on one key produce one account", async () => {
    const key = crypto.randomUUID();

    const [a, b] = await Promise.all([
      service.provision(key, request()),
      service.provision(key, request()),
    ]);

    expect(a.account.id).toBe(b.account.id);
    expect(a.character.id).toBe(b.character.id);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    expect(await counts()).toEqual([1, 1, 1]);
  });

  test("the same key with a different body is refused and mutates nothing", async () => {
    const key = crypto.randomUUID();

    const first = await service.provision(key, request());

    await expectRefusal(
      service.provision(key, request({ pseudo: "Someone Else" })),
      "idempotency_key_reuse"
    );

    expect(await counts()).toEqual([1, 1, 1]);

    const stored = await db
      .selectFrom("provisioningRequests")
      .select(["requestHash", "accountId"])
      .where("idempotencyKey", "=", key)
      .executeTakeFirstOrThrow();

    expect(stored.accountId).toBe(first.account.id);
    expect(stored.requestHash).toBe(fingerprintRequest(request()));
  });

  test.each([
    [
      "a username already taken",
      { pseudo: "Another Pseudo" },
      "username_taken",
    ],
    ["a pseudo already taken", { username: "bot-astrub-02" }, "pseudo_taken"],
  ])("refuses %s with no partial rows", async (_label, over, code) => {
    await service.provision(crypto.randomUUID(), request());

    await expectRefusal(
      service.provision(
        crypto.randomUUID(),
        request({
          ...over,
          character: { name: "OtherBot", breedId: CLASS_ID, sex: 0 },
        })
      ),
      code
    );

    // One account, one character, and the failed attempt's claim row is
    // gone with its transaction.
    expect(await counts()).toEqual([1, 1, 1]);
  });

  test("refuses a character name already on the server, rolling the account back", async () => {
    await service.provision(crypto.randomUUID(), request());

    await expectRefusal(
      service.provision(
        crypto.randomUUID(),
        request({ username: "bot-astrub-02", pseudo: "Bot Astrub 02" })
      ),
      "character_name_taken"
    );

    // The second account was inserted before the character was — if the
    // transaction did not cover both, it would still be here.
    expect(await counts()).toEqual([1, 1, 1]);
  });

  test("refuses when the spawn map has not been imported", async () => {
    const orphan = new AccountProvisioningService(db, { spawnMapId: 999_999 });

    await expectRefusal(
      orphan.provision(crypto.randomUUID(), request()),
      "spawn_map_missing"
    );

    expect(await counts()).toEqual([0, 0, 0]);
  });

  test("stores a fingerprint of the body, never the password key", async () => {
    const passwordKey = Buffer.alloc(32, 9).toString("base64");
    const key = crypto.randomUUID();

    await service.provision(key, request({ passwordKey }));

    const row = await db
      .selectFrom("provisioningRequests")
      .selectAll()
      .where("idempotencyKey", "=", key)
      .executeTakeFirstOrThrow();

    expect(JSON.stringify(row)).not.toContain(passwordKey);
    expect(row.requestHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
