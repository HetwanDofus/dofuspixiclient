import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import type { DB } from "@core/shared/db/schema.ts";
import type { Kysely } from "kysely";
import { ContainerKamasRepository } from "@core/modules/items/container-kamas.repository.ts";
import { ItemLedgerRepository } from "@core/modules/items/item-ledger.repository.ts";
import { playerOwner } from "@core/modules/items/item-owner.ts";
import { ItemTransferService } from "@core/modules/items/item-transfer.service.ts";
import { ItemsRepository } from "@core/modules/items/items.repository.ts";
import { KamasTransferService } from "@core/modules/items/kamas-transfer.service.ts";
import { PlayersRepository } from "@core/modules/players/players.repository.ts";
import { Test } from "@nestjs/testing";
import { TransactionHost } from "@nestjs-cls/transactional";

import { createTestDatabaseModule, setupTestDatabase } from "./harness.ts";

/**
 * The two-sided commit, against a real database.
 *
 * The unit tests around `TradeFlow` run `withTransaction` inline, so
 * they can prove the *loop* stops on a refusal but not that the writes
 * before it are undone. That is the property that matters here: a trade
 * hands over four or five stacks and two purses, and half of that
 * happening is worse than none of it.
 *
 * This exercises the commit's exact shape — the two transfer services
 * composed inside one `withTransaction`, with any refusal throwing —
 * rather than the flow object, because the flow's other half is frames
 * and registries that a database cannot check.
 */
describe("trade commit (integration)", () => {
  let db: Kysely<DB>;
  let transfer: ItemTransferService;
  let kamas: KamasTransferService;
  let items: ItemsRepository;
  let txHost: TransactionHost;

  const SERVER_ID = 1;
  const SWORD = 39;
  const BREAD = 40;

  let alice: string;
  let bob: string;

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
    txHost = moduleRef.get(TransactionHost);
  });

  beforeEach(async () => {
    await db.deleteFrom("itemLedger").execute();
    await db.deleteFrom("items").execute();
    await db.deleteFrom("containerKamas").execute();
    await db.deleteFrom("players").execute();
    await db.deleteFrom("accounts").execute();
    await db.deleteFrom("gameServers").execute();
    await db.deleteFrom("itemTemplates").execute();

    for (const id of [SWORD, BREAD]) {
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

    [alice, bob] = (await Promise.all(
      ["Alice", "Bob"].map(async (name) => {
        const row = await db
          .insertInto("players")
          .values({
            accountId: account.id,
            serverId: SERVER_ID,
            name,
            sex: 0,
            class: 1,
            gfx: 10,
            kamas: "1000",
          })
          .returning("id")
          .executeTakeFirstOrThrow();

        return row.id;
      })
    )) as [string, string];
  });

  /** A stack in someone's bag. Returns its id. */
  async function give(
    owner: string,
    templateId: number,
    quantity: number
  ): Promise<string> {
    const row = await items.give({
      owner: playerOwner(owner),
      templateId,
      quantity,
      effects: [],
    });

    return row.id;
  }

  function purse(playerId: string): Promise<bigint> {
    return db
      .selectFrom("players")
      .select("kamas")
      .where("id", "=", playerId)
      .executeTakeFirstOrThrow()
      .then((r) => BigInt(r.kamas));
  }

  function bag(playerId: string) {
    return items.findByOwner(playerOwner(playerId));
  }

  /**
   * The commit, exactly as `TradeFlow.commit` composes it: one
   * transaction, and any refusal thrown rather than tested and skipped.
   */
  function commit(
    lines: {
      from: string;
      to: string;
      itemId?: string;
      quantity?: number;
      kamas?: bigint;
    }[]
  ): Promise<void> {
    return txHost.withTransaction(async () => {
      for (const line of lines) {
        if (line.kamas !== undefined) {
          const result = await kamas.transfer({
            from: playerOwner(line.from),
            to: playerOwner(line.to),
            amount: line.kamas,
            actorCharacterId: line.from,
          });

          if (!result.ok) {
            throw new Error(`kamas: ${result.reason}`);
          }

          continue;
        }

        const result = await transfer.transfer({
          from: playerOwner(line.from),
          to: playerOwner(line.to),
          itemId: line.itemId as string,
          quantity: line.quantity as number,
          actorCharacterId: line.from,
        });

        if (!result.ok) {
          throw new Error(`item: ${result.reason}`);
        }
      }
    });
  }

  test("both sides change hands, in one transaction", async () => {
    const sword = await give(alice, SWORD, 1);
    const bread = await give(bob, BREAD, 10);

    await commit([
      { from: alice, to: bob, itemId: sword, quantity: 1 },
      { from: alice, to: bob, kamas: 250n },
      { from: bob, to: alice, itemId: bread, quantity: 4 },
    ]);

    const [aliceBag, bobBag] = await Promise.all([bag(alice), bag(bob)]);

    expect(aliceBag.map((i) => [i.templateId, i.quantity])).toEqual([
      [BREAD, 4],
    ]);
    expect(
      bobBag
        .map((i) => [i.templateId, i.quantity])
        .sort((a, b) => (a[0] as number) - (b[0] as number))
    ).toEqual([
      [SWORD, 1],
      [BREAD, 6],
    ]);
    expect(await purse(alice)).toBe(750n);
    expect(await purse(bob)).toBe(1250n);
  });

  test("a refusal partway leaves both inventories exactly as they were", async () => {
    const sword = await give(alice, SWORD, 1);
    const bread = await give(bob, BREAD, 10);

    // Bob offers more bread than he owns — the sort of thing that
    // happens when he eats some between validating and the commit.
    await expect(
      commit([
        { from: alice, to: bob, itemId: sword, quantity: 1 },
        { from: alice, to: bob, kamas: 250n },
        { from: bob, to: alice, itemId: bread, quantity: 99 },
      ])
    ).rejects.toThrow();

    const [aliceBag, bobBag] = await Promise.all([bag(alice), bag(bob)]);

    // The sword never left, the kamas never moved. Half a trade is the
    // one outcome a two-sided exchange must never produce.
    expect(aliceBag.map((i) => [i.id, i.templateId, i.quantity])).toEqual([
      [sword, SWORD, 1],
    ]);
    expect(bobBag.map((i) => [i.id, i.templateId, i.quantity])).toEqual([
      [bread, BREAD, 10],
    ]);
    expect(await purse(alice)).toBe(1000n);
    expect(await purse(bob)).toBe(1000n);
  });

  test("an unaffordable kamas offer takes the whole trade down with it", async () => {
    const sword = await give(alice, SWORD, 1);

    await expect(
      commit([
        { from: alice, to: bob, itemId: sword, quantity: 1 },
        { from: alice, to: bob, kamas: 5000n },
      ])
    ).rejects.toThrow();

    expect((await bag(alice)).map((i) => i.id)).toEqual([sword]);
    expect((await bag(bob)).length).toBe(0);
    expect(await purse(alice)).toBe(1000n);
  });

  test("two simultaneous commits of the same stack: one wins, nothing is duplicated", async () => {
    const sword = await give(alice, SWORD, 1);

    const results = await Promise.allSettled([
      commit([{ from: alice, to: bob, itemId: sword, quantity: 1 }]),
      commit([{ from: alice, to: bob, itemId: sword, quantity: 1 }]),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    const all = await db.selectFrom("items").selectAll().execute();
    const swords = all.filter((i) => i.templateId === SWORD);

    // One sword existed before; one sword exists after, in one bag.
    expect(swords).toHaveLength(1);
    expect(swords[0]?.ownerId).toBe(bob);
    expect(swords[0]?.quantity).toBe(1);
  });

  test("stacks merge into what the receiver already carries", async () => {
    await give(alice, BREAD, 3);
    const offered = await give(bob, BREAD, 5);

    await commit([{ from: bob, to: alice, itemId: offered, quantity: 5 }]);

    const aliceBag = await bag(alice);

    // The whole point of the single `items` table and its partial unique
    // index: a trade cannot leave the receiver with two piles of bread.
    expect(aliceBag).toHaveLength(1);
    expect(aliceBag[0]?.quantity).toBe(8);
  });
});
