import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import type { DB } from "@core/shared/db/schema.ts";
import type { Kysely } from "kysely";
import { LoginRepository } from "@core/features/auth/login/login.repository.ts";
import { Test } from "@nestjs/testing";

import { createTestDatabaseModule, setupTestDatabase } from "./harness.ts";

describe("LoginRepository (integration)", () => {
  let db: Kysely<DB>;
  let repo: LoginRepository;

  beforeAll(async () => {
    const harness = await setupTestDatabase();
    db = harness.db;

    const moduleRef = await Test.createTestingModule({
      imports: [createTestDatabaseModule(db)],
      providers: [LoginRepository],
    }).compile();

    repo = moduleRef.get(LoginRepository);
  });

  beforeEach(async () => {
    await db.deleteFrom("accounts").execute();

    const hash = await Bun.password.hash("s3cret", "bcrypt");

    await db
      .insertInto("accounts")
      .values({
        username: "alice",
        pwdHash: hash,
        pseudo: "Alice",
        isBanned: false,
        community: 0,
        isAdmin: false,
        question: "",
        answer: "",
      })
      .execute();
  });

  test("findByUsername returns the row for a known user", async () => {
    const account = await repo.findByUsername("alice");

    expect(account).toBeDefined();
    expect(account?.isBanned).toBe(false);
    expect(account?.pwdHash).toMatch(/^\$2[aby]\$/);
  });

  test("findByUsername returns undefined for an unknown user", async () => {
    await expect(repo.findByUsername("nobody")).resolves.toBeUndefined();
  });

  test("markLoggedIn updates lastLoginAt + lastLoginIp atomically", async () => {
    const before = await repo.findByUsername("alice");

    if (!before) {
      throw new Error("fixture missing");
    }

    await repo.markLoggedIn(before.id, "198.51.100.7");

    const row = await db
      .selectFrom("accounts")
      .select(["lastLoginAt", "lastLoginIp"])
      .where("id", "=", before.id)
      .executeTakeFirstOrThrow();

    expect(row.lastLoginAt).toBeInstanceOf(Date);
    expect(String(row.lastLoginIp)).toBe("198.51.100.7");
  });
});
