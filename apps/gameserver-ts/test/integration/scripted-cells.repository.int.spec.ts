import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import type { DB } from "@core/shared/db/schema.ts";
import type { Kysely } from "kysely";
import { ScriptedCellsRepository } from "@core/modules/scripted-cells/scripted-cells.repository.ts";
import { Test } from "@nestjs/testing";

import { createTestDatabaseModule, setupTestDatabase } from "./harness.ts";

describe("ScriptedCellsRepository (integration)", () => {
  let db: Kysely<DB>;
  let repo: ScriptedCellsRepository;

  beforeAll(async () => {
    const harness = await setupTestDatabase();
    db = harness.db;

    const moduleRef = await Test.createTestingModule({
      imports: [createTestDatabaseModule(db)],
      providers: [ScriptedCellsRepository],
    }).compile();

    repo = moduleRef.get(ScriptedCellsRepository);
  });

  beforeEach(async () => {
    await db.deleteFrom("scriptedCells").execute();

    await db
      .insertInto("scriptedCells")
      .values([
        {
          mapId: 10,
          cellId: 250,
          verb: "TP",
          actionsArgs: "11,100",
          conditions: "",
        },
        {
          mapId: 10,
          cellId: 251,
          verb: "MSG",
          actionsArgs: "hello",
          conditions: "",
        },
      ])
      .execute();
  });

  test("find returns the TP row", async () => {
    const row = await repo.find(10, 250);

    expect(row?.verb).toBe("TP");
    expect(row?.actionsArgs).toBe("11,100");
  });

  test("find returns undefined for unscripted cells", async () => {
    await expect(repo.find(10, 999)).resolves.toBeUndefined();
  });
});
