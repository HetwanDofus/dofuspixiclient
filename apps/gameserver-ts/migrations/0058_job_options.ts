import { type Kysely, sql } from "kysely";

/**
 * The artisan's own terms — QA-139.
 *
 * `options` is the bitmask `dofus.datacenter.JobOptions` reads: bit 1 "je
 * fais payer", bit 2 "gratuit si j'échoue", bit 4 "le client fournit les
 * ressources". `min_slots` is the fourth setting, which is a number rather
 * than a flag: the smallest recipe the artisan will accept.
 *
 * `listed` is the artisan's presence in the craftsmen's book, and it is
 * **not** a preference: 1.29 asks for it again at every connection, and
 * taking the tool out of the weapon slot drops it too. It is stored rather
 * than kept in memory only so that a crash leaves the world consistent —
 * every path that ends a session clears it.
 */
export async function up(db: Kysely<never>): Promise<void> {
  await sql`ALTER TABLE player_jobs ADD COLUMN IF NOT EXISTS options smallint NOT NULL DEFAULT 0`.execute(
    db
  );
  await sql`ALTER TABLE player_jobs ADD COLUMN IF NOT EXISTS min_slots smallint NOT NULL DEFAULT 2`.execute(
    db
  );
  await sql`ALTER TABLE player_jobs ADD COLUMN IF NOT EXISTS listed boolean NOT NULL DEFAULT false`.execute(
    db
  );

  await sql`
    CREATE INDEX IF NOT EXISTS idx_player_jobs_listed
      ON player_jobs(job_id) WHERE listed
  `.execute(db);

  // A restart is a disconnection for everyone; nobody is still at a bench.
  await sql`UPDATE player_jobs SET listed = false WHERE listed`.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_player_jobs_listed`.execute(db);
  await sql`
    ALTER TABLE player_jobs
      DROP COLUMN IF EXISTS options,
      DROP COLUMN IF EXISTS min_slots,
      DROP COLUMN IF EXISTS listed
  `.execute(db);
}
