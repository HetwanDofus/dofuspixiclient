import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import type { DB } from "@core/shared/db/schema.ts";
import type { Kysely } from "kysely";
import { ContainerKamasRepository } from "@core/modules/items/container-kamas.repository.ts";
import { ItemLedgerRepository } from "@core/modules/items/item-ledger.repository.ts";
import {
  bankOwner,
  type ItemOwner,
  OwnerKind,
  playerOwner,
} from "@core/modules/items/item-owner.ts";
import { ItemTransferService } from "@core/modules/items/item-transfer.service.ts";
import { ItemsRepository } from "@core/modules/items/items.repository.ts";
import { KamasTransferService } from "@core/modules/items/kamas-transfer.service.ts";
import { PlayersRepository } from "@core/modules/players/players.repository.ts";
import { Test } from "@nestjs/testing";

import { createTestDatabaseModule, setupTestDatabase } from "./harness.ts";

/**
 * The duplication tests.
 *
 * Nothing between the socket and a handler serialises a client's frames:
 * `GatewayFrameService.onFrame` dispatches without awaiting, and the
 * gateway neither rate-limits nor de-duplicates (QA-064, QA-045). A
 * double-click therefore arrives as two genuinely concurrent moves, and
 * every one of these cases is that situation reduced to two `Promise.all`
 * calls against a real Postgres.
 *
 * What is being tested is not the service's arithmetic — it is that the
 * *database* refuses to hold two answers at once. Hence the assertions
 * on conservation ("how many of this item exist in the world") rather
 * than on return values alone.
 */
describe("item transfer under concurrency (integration)", () => {
  let db: Kysely<DB>;
  let transfer: ItemTransferService;
  let kamas: KamasTransferService;
  let items: ItemsRepository;
  let containerKamas: ContainerKamasRepository;

  const SERVER_ID = 1;
  const TEMPLATE = 39;
  const OTHER_TEMPLATE = 40;

  let accountId: string;
  let playerId: string;
  let player: ItemOwner;
  let bank: ItemOwner;

  beforeAll(async () => {
    const harness = await setupTestDatabase();
    db = harness.db;

    const moduleRef = await Test.createTestingModule({
      imports: [createTestDatabaseModule(db)],
      providers: [
        ItemsRepository,
        ItemLedgerRepository,
        ContainerKamasRepository,
        PlayersRepository,
        ItemTransferService,
        KamasTransferService,
      ],
    }).compile();

    transfer = moduleRef.get(ItemTransferService);
    kamas = moduleRef.get(KamasTransferService);
    items = moduleRef.get(ItemsRepository);
    containerKamas = moduleRef.get(ContainerKamasRepository);
  });

  beforeEach(async () => {
    await db.deleteFrom("itemLedger").execute();
    await db.deleteFrom("items").execute();
    await db.deleteFrom("containerKamas").execute();
    await db.deleteFrom("players").execute();
    await db.deleteFrom("accounts").execute();
    await db.deleteFrom("gameServers").execute();
    await db.deleteFrom("itemTemplates").execute();

    for (const id of [TEMPLATE, OTHER_TEMPLATE]) {
      await db
        .insertInto("itemTemplates")
        .values({
          id,
          name: `template-${id}`,
          type: 1,
          level: 1,
          weight: 10,
          gfxId: id,
          effects: JSON.stringify([]),
          criteria: "",
          twoHanded: false,
          itemSetId: -1,
          usable: false,
          targetable: false,
          price: 1,
          superType: 1,
          category: 0,
          sellPrice: 1,
          maxPerTarget: 0,
          description: "",
        })
        .execute();
    }

    const account = await db
      .insertInto("accounts")
      .values({
        username: "tuser",
        pwdHash: "x",
        pseudo: "T",
        community: 0,
        isAdmin: false,
        isBanned: false,
        question: "",
        answer: "",
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    accountId = account.id;

    // `game_servers.id` is assigned, not generated — a server's id is
    // part of its identity across deployments.
    await db
      .insertInto("gameServers")
      .values({
        id: SERVER_ID,
        name: "int-srv",
        address: "127.0.0.1",
        port: 5555,
        state: 1,
      })
      .execute();

    const created = await db
      .insertInto("players")
      .values({
        accountId,
        serverId: SERVER_ID,
        name: "Tester",
        sex: 0,
        class: 1,
        gfx: 10,
        kamas: "1000",
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    playerId = created.id;
    player = playerOwner(playerId);
    bank = bankOwner(accountId);
  });

  async function giveToPlayer(
    quantity: number,
    templateId = TEMPLATE,
    effects: unknown[] = []
  ): Promise<string> {
    const row = await db
      .insertInto("items")
      .values({
        ownerKind: OwnerKind.Player,
        ownerId: playerId,
        templateId,
        quantity,
        position: -1,
        effects: JSON.stringify(effects),
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return row.id;
  }

  /** Every unit of `templateId` in existence, wherever it is. */
  async function totalInWorld(templateId = TEMPLATE): Promise<number> {
    const rows = await db
      .selectFrom("items")
      .select("quantity")
      .where("templateId", "=", templateId)
      .execute();

    return rows.reduce((sum, row) => sum + row.quantity, 0);
  }

  test("two concurrent moves of the same whole stack: one wins", async () => {
    const itemId = await giveToPlayer(10);

    const [a, b] = await Promise.all([
      transfer.transfer({
        from: player,
        to: bank,
        itemId,
        quantity: 10,
        actorCharacterId: playerId,
      }),
      transfer.transfer({
        from: player,
        to: bank,
        itemId,
        quantity: 10,
        actorCharacterId: playerId,
      }),
    ]);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await totalInWorld()).toBe(10);

    const inBank = await items.findByOwner(bank);
    expect(inBank).toHaveLength(1);
    expect(inBank[0]?.quantity).toBe(10);
    expect(await items.findByOwner(player)).toHaveLength(0);
  });

  test("a whole-stack move keeps the item's id", async () => {
    const itemId = await giveToPlayer(10);

    const result = await transfer.transfer({
      from: player,
      to: bank,
      itemId,
      quantity: 10,
      actorCharacterId: playerId,
    });

    if (!result.ok) {
      throw new Error(`expected the move to succeed, got ${result.reason}`);
    }

    expect(result.move.keptIdentity).toBe(true);
    expect(result.move.destination.id).toBe(itemId);
  });

  test("two withdrawals of 5 from a stack of 8: only one passes", async () => {
    const itemId = await giveToPlayer(8);

    const [a, b] = await Promise.all([
      transfer.transfer({
        from: player,
        to: bank,
        itemId,
        quantity: 5,
        actorCharacterId: playerId,
      }),
      transfer.transfer({
        from: player,
        to: bank,
        itemId,
        quantity: 5,
        actorCharacterId: playerId,
      }),
    ]);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await totalInWorld()).toBe(8);
  });

  test("concurrent deposits of identical stacks merge into one row", async () => {
    const first = await giveToPlayer(3);

    // A second, separate stack of the same template and effects can only
    // exist outside the player's bag — `items_stack` forbids two of them
    // in one container, which is precisely the invariant under test.
    const second = await db
      .insertInto("items")
      .values({
        ownerKind: OwnerKind.House,
        ownerId: playerId,
        templateId: TEMPLATE,
        quantity: 4,
        position: -1,
        effects: JSON.stringify([]),
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    const [a, b] = await Promise.all([
      transfer.transfer({
        from: player,
        to: bank,
        itemId: first,
        quantity: 3,
        actorCharacterId: playerId,
      }),
      transfer.transfer({
        from: { kind: OwnerKind.House, id: playerId },
        to: bank,
        itemId: second.id,
        quantity: 4,
        actorCharacterId: playerId,
      }),
    ]);

    // One may lose the race on the unique index; whichever survive, the
    // bank must never end up holding two stacks of the same thing, and
    // no unit may be conjured or lost.
    const inBank = await items.findByOwner(bank);
    expect(inBank.length).toBeLessThanOrEqual(1);
    expect(await totalInWorld()).toBe(7);

    const succeeded = [a, b].filter((r) => r.ok).length;
    const conflicted = [a, b].filter(
      (r) => !r.ok && r.reason === "conflict"
    ).length;
    expect(succeeded + conflicted).toBe(2);
  });

  test("a stack taken back merges into the one left behind", async () => {
    const itemId = await giveToPlayer(10);

    await transfer.transfer({
      from: player,
      to: bank,
      itemId,
      quantity: 6,
      actorCharacterId: playerId,
    });

    const banked = await items.findByOwner(bank);
    expect(banked).toHaveLength(1);

    await transfer.transfer({
      from: bank,
      to: player,
      itemId: banked[0]?.id ?? "",
      quantity: 6,
      actorCharacterId: playerId,
    });

    // The round trip has to end where it started: one stack of ten. Two
    // rows here is the bug a player sees as their iron splitting in two
    // every time they use the chest, and `items_stack` only prevents it
    // when both rows hash their effects the same way.
    const back = await items.findByOwner(player);
    expect(back).toHaveLength(1);
    expect(back[0]?.quantity).toBe(10);
    expect(await items.findByOwner(bank)).toHaveLength(0);
  });

  test("rolled effects survive a split move unchanged", async () => {
    // The empty-effects case above only proves the hash matched. An item
    // with real jets proves the effects themselves make the round trip:
    // a JS array handed straight to a `jsonb` parameter is encoded as a
    // Postgres array literal, which turns `[]` into `{}` and makes a
    // populated list a hard error.
    const rolled = [
      { id: 100, param1: 7, param2: 7, param3: "1d7+0" },
      { id: 118, param1: 1, param2: 0, param3: "0d0+1" },
    ];
    const itemId = await giveToPlayer(4, OTHER_TEMPLATE, rolled);

    const result = await transfer.transfer({
      from: player,
      to: bank,
      itemId,
      quantity: 2,
      actorCharacterId: playerId,
    });

    expect(result.ok).toBe(true);

    const banked = await items.findByOwner(bank);
    expect(banked[0]?.effects).toEqual(rolled);
  });

  test("a stack drained to nothing leaves no zero-quantity row", async () => {
    const itemId = await giveToPlayer(4);

    await transfer.transfer({
      from: player,
      to: bank,
      itemId,
      quantity: 4,
      actorCharacterId: playerId,
    });

    const zeroes = await db
      .selectFrom("items")
      .selectAll()
      .where("quantity", "<=", 0)
      .execute();

    expect(zeroes).toHaveLength(0);
  });

  test("equipped gear cannot be moved out of the bag", async () => {
    const row = await db
      .insertInto("items")
      .values({
        ownerKind: OwnerKind.Player,
        ownerId: playerId,
        templateId: TEMPLATE,
        quantity: 1,
        position: 1,
        effects: JSON.stringify([]),
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    const result = await transfer.transfer({
      from: player,
      to: bank,
      itemId: row.id,
      quantity: 1,
      actorCharacterId: playerId,
    });

    expect(result).toEqual({ ok: false, reason: "equipped" });
  });

  test("an item that is not yours cannot be moved", async () => {
    const itemId = await giveToPlayer(5);

    const result = await transfer.transfer({
      from: bank,
      to: player,
      itemId,
      quantity: 5,
      actorCharacterId: playerId,
    });

    expect(result).toEqual({ ok: false, reason: "not-found" });
    expect(await totalInWorld()).toBe(5);
  });

  test("every committed move leaves exactly one ledger line", async () => {
    const itemId = await giveToPlayer(10);

    await transfer.transfer({
      from: player,
      to: bank,
      itemId,
      quantity: 4,
      actorCharacterId: playerId,
    });

    const lines = await db.selectFrom("itemLedger").selectAll().execute();

    expect(lines).toHaveLength(1);
    expect(lines[0]?.fromKind).toBe(OwnerKind.Player);
    expect(lines[0]?.toKind).toBe(OwnerKind.Bank);
    expect(lines[0]?.quantity).toBe(4);
    expect(lines[0]?.actorCharacterId).toBe(playerId);
  });

  test("a refused move leaves no ledger line", async () => {
    const itemId = await giveToPlayer(2);

    await transfer.transfer({
      from: player,
      to: bank,
      itemId,
      quantity: 99,
      actorCharacterId: playerId,
    });

    expect(await db.selectFrom("itemLedger").selectAll().execute()).toEqual([]);
  });

  describe("kamas", () => {
    test("two concurrent deposits cannot overdraw the purse", async () => {
      const [a, b] = await Promise.all([
        kamas.transfer({
          from: player,
          to: bank,
          amount: 600n,
          actorCharacterId: playerId,
        }),
        kamas.transfer({
          from: player,
          to: bank,
          amount: 600n,
          actorCharacterId: playerId,
        }),
      ]);

      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);

      const purse = await db
        .selectFrom("players")
        .select("kamas")
        .where("id", "=", playerId)
        .executeTakeFirstOrThrow();
      const held = await db
        .selectFrom("containerKamas")
        .select("kamas")
        .where("ownerKind", "=", OwnerKind.Bank)
        .where("ownerId", "=", accountId)
        .executeTakeFirstOrThrow();

      expect(BigInt(purse.kamas) + BigInt(held.kamas)).toBe(1000n);
      expect(BigInt(purse.kamas)).toBe(400n);
    });

    test("a deposit opens the bank account on first use", async () => {
      const result = await kamas.transfer({
        from: player,
        to: bank,
        amount: 250n,
        actorCharacterId: playerId,
      });

      expect(result.ok).toBe(true);
      expect(await containerKamas.balance(bank)).toBe(250n);
    });

    test("a house chest holds kamas too", async () => {
      // The case that shipped broken: the storage window was opened on a
      // chest rather than a bank, and the only holders the service knew
      // were the player and the bank, so both buttons did nothing.
      const chest = { kind: OwnerKind.House, id: "711" };

      const deposit = await kamas.transfer({
        from: player,
        to: chest,
        amount: 300n,
        actorCharacterId: playerId,
      });

      expect(deposit).toEqual({ ok: true });
      expect(await containerKamas.balance(chest)).toBe(300n);

      const back = await kamas.transfer({
        from: chest,
        to: player,
        amount: 300n,
        actorCharacterId: playerId,
      });

      expect(back).toEqual({ ok: true });
      expect(await containerKamas.balance(chest)).toBe(0n);
    });

    test("withdrawing more than the bank holds is refused", async () => {
      await kamas.transfer({
        from: player,
        to: bank,
        amount: 100n,
        actorCharacterId: playerId,
      });

      const result = await kamas.transfer({
        from: bank,
        to: player,
        amount: 500n,
        actorCharacterId: playerId,
      });

      expect(result).toEqual({ ok: false, reason: "not-enough" });

      const purse = await db
        .selectFrom("players")
        .select("kamas")
        .where("id", "=", playerId)
        .executeTakeFirstOrThrow();

      expect(BigInt(purse.kamas)).toBe(900n);
    });
  });
});
