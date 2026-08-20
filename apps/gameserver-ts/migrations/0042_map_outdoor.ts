import { type Kysely, sql } from "kysely";

/**
 * The authentic indoor/outdoor flag, read from each map's own SWF by
 * `scripts/import-map-swf.ts`.
 *
 * Without it, `import-starloco-maps.ts` has to guess which of the maps sharing
 * a world position is the overworld one — and guessing on edge-cell counts
 * picked house interiors, teleporting players inside buildings they could not
 * walk out of. NULL means "not imported", so the guess stays available as a
 * fallback.
 */
export async function up(db: Kysely<never>): Promise<void> {
  await sql`ALTER TABLE maps ADD COLUMN outdoor boolean`.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`ALTER TABLE maps DROP COLUMN outdoor`.execute(db);
}
