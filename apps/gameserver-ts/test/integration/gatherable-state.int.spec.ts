import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import type { DB } from "@core/shared/db/schema.ts";
import type { Kysely } from "kysely";
import { GatherableStateRepository } from "@core/modules/harvest/gatherable-state.repository.ts";
import { Test } from "@nestjs/testing";
import { sql } from "kysely";

import { createTestDatabaseModule, setupTestDatabase } from "./harness.ts";

/**
 * The one thing about the harvest loop that cannot be proved with fakes:
 * that two clients cannot take the same tree.
 *
 * `WsRouter.dispatch` is called without `await`, so two frames from the same
 * socket — a double-click — genuinely interleave, and two sockets on the same
 * map genuinely race. The defence is that `reserve` is a single statement
 * whose `WHERE` *is* the availability test; a read-then-write would let both
 * callers conclude the resource was free. Only a real Postgres can show the
 * difference, which is why this test lives here and not beside the service.
 *
 * Covers QA-123's "un test concurrent lance deux récoltes sur la même
 * occurrence : une seule transaction crédite une récompense".
 */
describe("GatherableStateRepository (integration)", () => {
  let db: Kysely<DB>;
  let repo: GatherableStateRepository;

  const MAP_ID = 7411;
  const CELL_ID = 170;
  const ALICE = "1";
  const BOB = "2";
  const HOLD_MS = 12_000;

  beforeAll(async () => {
    const harness = await setupTestDatabase();
    db = harness.db;

    const moduleRef = await Test.createTestingModule({
      imports: [createTestDatabaseModule(db)],
      providers: [GatherableStateRepository],
    }).compile();

    repo = moduleRef.get(GatherableStateRepository);
  });

  beforeEach(async () => {
    await db.deleteFrom("gatherableCellStates").execute();
  });

  test("the first caller takes an untouched resource", async () => {
    expect(await repo.reserve(MAP_ID, CELL_ID, ALICE, HOLD_MS)).toBe(true);
  });

  test("a second caller is refused while the first holds it", async () => {
    await repo.reserve(MAP_ID, CELL_ID, ALICE, HOLD_MS);

    expect(await repo.reserve(MAP_ID, CELL_ID, BOB, HOLD_MS)).toBe(false);
  });

  test("two simultaneous attempts produce exactly one winner", async () => {
    const [a, b] = await Promise.all([
      repo.reserve(MAP_ID, CELL_ID, ALICE, HOLD_MS),
      repo.reserve(MAP_ID, CELL_ID, BOB, HOLD_MS),
    ]);

    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  test("a double-click by one character is still one reservation", async () => {
    // The same player, twice, as fast as the socket allows. The second must
    // not "renew" the first: that would be a second reward on one resource.
    const [a, b] = await Promise.all([
      repo.reserve(MAP_ID, CELL_ID, ALICE, HOLD_MS),
      repo.reserve(MAP_ID, CELL_ID, ALICE, HOLD_MS),
    ]);

    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  test("ten concurrent attempts still produce exactly one winner", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        repo.reserve(MAP_ID, CELL_ID, String(i + 1), HOLD_MS)
      )
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("releasing hands it straight back", async () => {
    await repo.reserve(MAP_ID, CELL_ID, ALICE, HOLD_MS);
    await repo.release(MAP_ID, CELL_ID, ALICE);

    expect(await repo.reserve(MAP_ID, CELL_ID, BOB, HOLD_MS)).toBe(true);
  });

  test("releasing somebody else's reservation does nothing", async () => {
    await repo.reserve(MAP_ID, CELL_ID, ALICE, HOLD_MS);
    await repo.release(MAP_ID, CELL_ID, BOB);

    expect(await repo.reserve(MAP_ID, CELL_ID, BOB, HOLD_MS)).toBe(false);
  });

  test("an abandoned reservation expires rather than sealing the cell", async () => {
    // The one path the service cannot clean up after itself: the process
    // dying between the reservation and the reward.
    await repo.reserve(MAP_ID, CELL_ID, ALICE, -1);

    expect(await repo.reserve(MAP_ID, CELL_ID, BOB, HOLD_MS)).toBe(true);
  });

  test("depleting sets the respawn instant and frees the holder", async () => {
    await repo.reserve(MAP_ID, CELL_ID, ALICE, HOLD_MS);

    const availableAt = await repo.deplete(MAP_ID, CELL_ID, ALICE, 300);

    expect(availableAt).toBeInstanceOf(Date);
    expect((availableAt as Date).getTime()).toBeGreaterThan(Date.now());

    const row = await db
      .selectFrom("gatherableCellStates")
      .selectAll()
      .where("mapId", "=", MAP_ID)
      .where("cellId", "=", CELL_ID)
      .executeTakeFirstOrThrow();

    expect(row.reservedBy).toBeNull();
    expect(row.reservedUntil).toBeNull();
  });

  test("only the holder may deplete", async () => {
    await repo.reserve(MAP_ID, CELL_ID, ALICE, HOLD_MS);

    expect(await repo.deplete(MAP_ID, CELL_ID, BOB, 300)).toBeNull();
  });

  test("a depleted resource is refused until its instant passes", async () => {
    await repo.reserve(MAP_ID, CELL_ID, ALICE, HOLD_MS);
    await repo.deplete(MAP_ID, CELL_ID, ALICE, 300);

    expect(await repo.reserve(MAP_ID, CELL_ID, BOB, HOLD_MS)).toBe(false);
  });

  test("and is offered again once it has", async () => {
    await repo.reserve(MAP_ID, CELL_ID, ALICE, HOLD_MS);
    await repo.deplete(MAP_ID, CELL_ID, ALICE, 300);

    // `deplete` clamps its delay to at least a second on purpose, so the
    // instant is moved rather than the test made to wait for one.
    await sql`
      UPDATE gatherable_cell_states SET available_at = now() - interval '1 second'
    `.execute(db);

    expect(await repo.reserve(MAP_ID, CELL_ID, BOB, HOLD_MS)).toBe(true);
  });

  test("a pending respawn survives to be re-armed on boot", async () => {
    await repo.reserve(MAP_ID, CELL_ID, ALICE, HOLD_MS);
    await repo.deplete(MAP_ID, CELL_ID, ALICE, 300);

    const pending = await repo.pending();

    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ mapId: MAP_ID, cellId: CELL_ID });

    // And the same rows are what a newcomer to the map is shown.
    expect(await repo.depletedOnMap(MAP_ID)).toEqual([{ cellId: CELL_ID }]);
    expect(await repo.depletedOnMap(MAP_ID + 1)).toEqual([]);
  });
});
