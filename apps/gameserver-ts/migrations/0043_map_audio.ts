import { type Kysely, sql } from "kysely";

/**
 * Per-map music and ambiance, read from each map's own SWF by
 * `scripts/import-map-swf.ts`.
 *
 * Both are indices into the `audio` lang bundle, exactly as the retail client
 * uses them (`MapsServersManager.as:135-136` → `DofusBattlefield.as:130-136`):
 * `AUM[music_id]` names an mp3 to loop, `AUA[ambiance_id]` names an
 * environment bed plus the random noises layered over it.
 *
 * NULL means "not imported"; the client treats a missing id as silence rather
 * than falling back to a guess, because the wrong music is worse than none.
 */
export async function up(db: Kysely<never>): Promise<void> {
  await sql`ALTER TABLE maps ADD COLUMN music_id integer`.execute(db);
  await sql`ALTER TABLE maps ADD COLUMN ambiance_id integer`.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`ALTER TABLE maps DROP COLUMN ambiance_id`.execute(db);
  await sql`ALTER TABLE maps DROP COLUMN music_id`.execute(db);
}
