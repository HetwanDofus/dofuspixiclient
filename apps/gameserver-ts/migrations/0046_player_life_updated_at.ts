import { type Kysely, sql } from "kysely";

/**
 * The instant `players.life` was last known to be exact.
 *
 * Out-of-combat regeneration is derived from this column rather than
 * driven by a timer: on every read of a character's life we work out how
 * much time has passed and how many points that is worth. A timer per
 * connected player would not scale, would be lost on a core restart, and
 * would regenerate nothing while the player is offline — whereas 1.29
 * characters heal while logged out.
 *
 * NULL means "never measured": the first read stamps it and grants
 * nothing, which is the only honest answer for a character whose life
 * was written before this column existed. It is the reason there is no
 * backfill here — dating every existing character to the migration would
 * be a lie in the one direction that matters, handing free life on the
 * next login.
 *
 * Note there is deliberately no companion `max_life` column: the cap is
 * derived from level and total vitality by `maxLifePoints()`, equipment
 * included, so it follows a gear change instead of drifting away from it.
 */
export async function up(db: Kysely<never>): Promise<void> {
  await sql`ALTER TABLE players ADD COLUMN life_updated_at timestamptz`.execute(
    db
  );
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`ALTER TABLE players DROP COLUMN life_updated_at`.execute(db);
}
