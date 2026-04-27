import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await sql`DROP TABLE IF EXISTS map_triggers CASCADE`.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS map_triggers (
      id bigserial PRIMARY KEY,
      map_id integer,
      cell_id integer,
      action smallint DEFAULT 0,
      arguments text DEFAULT '',
      conditions text DEFAULT ''
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_map_triggers_map_id ON map_triggers(map_id)
  `.execute(db);
}
