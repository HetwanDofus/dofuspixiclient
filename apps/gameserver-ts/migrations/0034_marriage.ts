import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS marriages (
      id bigserial PRIMARY KEY,
      player_a bigint REFERENCES players(id) ON DELETE CASCADE,
      player_b bigint REFERENCES players(id) ON DELETE CASCADE,
      state text CHECK(state IN ('proposed','engaged','married','divorced')),
      proposed_at timestamptz DEFAULT NOW(),
      married_at timestamptz,
      location_map_id integer DEFAULT 0,
      location_cell_id integer DEFAULT 0,
      CHECK(player_a < player_b)
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_marriages_player_a ON marriages(player_a) WHERE state <> 'divorced'
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_marriages_player_b ON marriages(player_b) WHERE state <> 'divorced'
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_marriages_player_a_active ON marriages(player_a) WHERE state <> 'divorced'
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_marriages_player_b_active ON marriages(player_b) WHERE state <> 'divorced'
  `.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("marriages").ifExists().cascade().execute();
}
