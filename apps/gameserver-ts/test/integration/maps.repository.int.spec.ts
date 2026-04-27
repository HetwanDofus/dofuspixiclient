import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import type { DB } from "@core/shared/db/schema.ts";
import type { Kysely } from "kysely";
import { MapsRepository } from "@core/modules/maps/maps.repository.ts";
import { Test } from "@nestjs/testing";

import { createTestDatabaseModule, setupTestDatabase } from "./harness.ts";

describe("MapsRepository (integration)", () => {
  let db: Kysely<DB>;
  let repo: MapsRepository;

  beforeAll(async () => {
    const harness = await setupTestDatabase();
    db = harness.db;

    const moduleRef = await Test.createTestingModule({
      imports: [createTestDatabaseModule(db)],
      providers: [MapsRepository],
    }).compile();

    repo = moduleRef.get(MapsRepository);
  });

  beforeEach(async () => {
    await db.deleteFrom("mapNeighbors").execute();
    await db.deleteFrom("maps").execute();

    const cells = Buffer.from("aaaaaaaaaa", "utf-8");

    await db
      .insertInto("maps")
      .values([
        {
          id: 1,
          width: 15,
          height: 17,
          cells,
          x: 0,
          y: 0,
          superarea: 0,
          background: 0,
        },
        {
          id: 2,
          width: 15,
          height: 17,
          cells,
          x: 1,
          y: 0,
          superarea: 0,
          background: 0,
        },
      ])
      .execute();

    await db
      .insertInto("mapNeighbors")
      .values([
        { mapId: 1, direction: 0, neighborMapId: 2 },
        { mapId: 2, direction: 4, neighborMapId: 1 },
      ])
      .execute();
  });

  test("findById returns the row with the decoded cells Buffer", async () => {
    const map = await repo.findById(1);

    expect(map).toBeDefined();
    expect(map?.width).toBe(15);
    expect(map?.cells).toBeInstanceOf(Uint8Array);
    expect(map?.cells?.length).toBe(10);
  });

  test("findNeighborInDirection returns the E neighbor", async () => {
    const link = await repo.findNeighborInDirection(1, 0);

    expect(link?.neighborMapId).toBe(2);
  });

  test("findNeighborInDirection returns undefined for missing direction", async () => {
    await expect(repo.findNeighborInDirection(1, 6)).resolves.toBeUndefined();
  });
});
