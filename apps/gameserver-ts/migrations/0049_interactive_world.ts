import { type Kysely, sql } from "kysely";

/**
 * Columns the interactive world needs before `scripts/import-starloco-triggers.ts`
 * can fill it.
 *
 * `interactive_objects_templates` was created by 0014 with StarLoco's own shape
 * (`respawn`, `duration`, `walkable`) and never seeded. What decides *what a
 * click on the object offers* is not in the dump at all — it is the 1.29 lang
 * bundle's `IO` table, which gives every gfx a type (5 = house door,
 * 3 = zaap, 6 = storage…) and the list of skill ids the popup menu is built
 * from. Those two columns are added here so the importer has somewhere to put
 * them.
 *
 * `houses` knows where a door *is* (`map_id`, `cell_id`) but not where it
 * leads. The interior maps come from `houses.json` (`H.m`: mapId → houseId)
 * and the arrival cell from the interior map's own `scripted_cells` exit —
 * see the importer's header.
 *
 * `house_doors` exists because `houses.map_id`/`cell_id` can only name one
 * door and 40 of the 1 052 houses in the 1.29 bundle have two or three
 * (`H.d` lists 1 095 doors). The handler resolves a click by `(map_id,
 * cell_id)`, so that lookup needs its own indexed table rather than a scan of
 * the `doors` jsonb blob.
 */
export async function up(db: Kysely<never>): Promise<void> {
  await sql`ALTER TABLE interactive_objects_templates ADD COLUMN IF NOT EXISTS type smallint NOT NULL DEFAULT 0`.execute(
    db
  );
  await sql`ALTER TABLE interactive_objects_templates ADD COLUMN IF NOT EXISTS skills text NOT NULL DEFAULT ''`.execute(
    db
  );

  await sql`ALTER TABLE houses ADD COLUMN IF NOT EXISTS entry_map_id integer`.execute(
    db
  );
  await sql`ALTER TABLE houses ADD COLUMN IF NOT EXISTS entry_cell_id integer`.execute(
    db
  );
  await sql`ALTER TABLE houses ADD COLUMN IF NOT EXISTS interior_map_ids jsonb NOT NULL DEFAULT '[]'::jsonb`.execute(
    db
  );

  await sql`
    CREATE TABLE IF NOT EXISTS house_doors (
      map_id   integer NOT NULL,
      cell_id  integer NOT NULL,
      house_id bigint  NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
      PRIMARY KEY (map_id, cell_id)
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_house_doors_house ON house_doors(house_id)
  `.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`DROP TABLE IF EXISTS house_doors`.execute(db);

  await sql`ALTER TABLE houses DROP COLUMN IF EXISTS interior_map_ids`.execute(
    db
  );
  await sql`ALTER TABLE houses DROP COLUMN IF EXISTS entry_cell_id`.execute(db);
  await sql`ALTER TABLE houses DROP COLUMN IF EXISTS entry_map_id`.execute(db);

  await sql`ALTER TABLE interactive_objects_templates DROP COLUMN IF EXISTS skills`.execute(
    db
  );
  await sql`ALTER TABLE interactive_objects_templates DROP COLUMN IF EXISTS type`.execute(
    db
  );
}
