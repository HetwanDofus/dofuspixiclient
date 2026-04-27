import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await sql`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS mmr integer NOT NULL DEFAULT 1000,
    ADD COLUMN IF NOT EXISTS koliseum_points integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS active_title_id integer NOT NULL DEFAULT 0
  `.execute(db);

  await db.schema
    .createTable("koliseum_queue")
    .ifNotExists()
    .addColumn("player_id", "bigint", (col) =>
      col.primaryKey().references("players.id").onDelete("cascade")
    )
    .addColumn("team_size", "integer")
    .addColumn("mmr", "integer")
    .addColumn("enqueued_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .execute();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_koliseum_queue_team_size_mmr ON koliseum_queue(team_size, mmr)
  `.execute(db);

  await db.schema
    .createTable("koliseum_matches")
    .ifNotExists()
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("team_size", "integer")
    .addColumn("started_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .addColumn("ended_at", "timestamptz")
    .addColumn("winner_team", "integer")
    .execute();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_koliseum_matches_ended_at ON koliseum_matches(ended_at)
  `.execute(db);

  await db.schema
    .createTable("koliseum_seasons")
    .ifNotExists()
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("name", sql`VARCHAR(64)`)
    .addColumn("started_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .addColumn("ended_at", "timestamptz")
    .addColumn("mmr_reset", "boolean", (col) => col.defaultTo(false))
    .execute();
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("koliseum_seasons").execute();
  await db.schema.dropTable("koliseum_matches").execute();
  await db.schema.dropTable("koliseum_queue").execute();

  await sql`
    ALTER TABLE players
    DROP COLUMN mmr,
    DROP COLUMN koliseum_points,
    DROP COLUMN active_title_id
  `.execute(db);
}
