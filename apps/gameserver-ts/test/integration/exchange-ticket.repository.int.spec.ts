import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import type { DB } from "@core/shared/db/schema.ts";
import type { Kysely } from "kysely";
import { ExchangeTicketRepository } from "@core/features/game/exchange-ticket/exchange-ticket.repository.ts";
import { Test } from "@nestjs/testing";

import { createTestDatabaseModule, setupTestDatabase } from "./harness.ts";

describe("ExchangeTicketRepository (integration)", () => {
  let db: Kysely<DB>;
  let repo: ExchangeTicketRepository;
  let accountId: string;

  const SERVER_ID = 1;

  beforeAll(async () => {
    const harness = await setupTestDatabase();
    db = harness.db;

    const moduleRef = await Test.createTestingModule({
      imports: [createTestDatabaseModule(db)],
      providers: [ExchangeTicketRepository],
    }).compile();

    repo = moduleRef.get(ExchangeTicketRepository);
  });

  beforeEach(async () => {
    await db.deleteFrom("authTickets").execute();
    await db.deleteFrom("gameServers").execute();
    await db.deleteFrom("accounts").execute();

    await db
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
      .execute();

    const account = await db
      .selectFrom("accounts")
      .select("id")
      .where("username", "=", "tuser")
      .executeTakeFirstOrThrow();
    accountId = account.id;

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
  });

  async function insertTicket(
    ticket: string,
    opts: { expiresInMs?: number; used?: boolean; serverId?: number } = {}
  ) {
    const expiresInMs = opts.expiresInMs ?? 30_000;
    await db
      .insertInto("authTickets")
      .values({
        ticket,
        accountId,
        gameServerId: opts.serverId ?? SERVER_ID,
        expiresAt: new Date(Date.now() + expiresInMs),
        usedAt: opts.used ? new Date() : null,
      })
      .execute();
  }

  test("redeem returns the bound account id when ticket is valid", async () => {
    const ticket = crypto.randomUUID();
    await insertTicket(ticket);

    const result = await repo.redeem(ticket, SERVER_ID);

    expect(result?.accountId).toBe(accountId);
  });

  test("redeem twice returns undefined on the second call (used_at flipped)", async () => {
    const ticket = crypto.randomUUID();
    await insertTicket(ticket);

    const first = await repo.redeem(ticket, SERVER_ID);
    const second = await repo.redeem(ticket, SERVER_ID);

    expect(first?.accountId).toBe(accountId);
    expect(second).toBeUndefined();
  });

  test("redeem returns undefined when ticket is expired", async () => {
    const ticket = crypto.randomUUID();
    await insertTicket(ticket, { expiresInMs: -1_000 });

    await expect(repo.redeem(ticket, SERVER_ID)).resolves.toBeUndefined();
  });

  test("redeem returns undefined when serverId mismatches", async () => {
    const ticket = crypto.randomUUID();
    await insertTicket(ticket);

    await expect(repo.redeem(ticket, 999)).resolves.toBeUndefined();
  });

  test("concurrent redeems race but only one succeeds", async () => {
    const ticket = crypto.randomUUID();
    await insertTicket(ticket);

    const [a, b] = await Promise.all([
      repo.redeem(ticket, SERVER_ID),
      repo.redeem(ticket, SERVER_ID),
    ]);

    const winners = [a, b].filter((r) => r !== undefined);
    expect(winners).toHaveLength(1);
  });
});
