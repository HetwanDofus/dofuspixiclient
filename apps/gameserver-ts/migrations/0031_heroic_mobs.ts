import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS heroic_mobs_groups (
      id bigint,
      map_id integer,
      cell_id integer,
      "group" VARCHAR(255) DEFAULT '',
      objects text DEFAULT '',
      stars smallint DEFAULT 0,
      defeated boolean DEFAULT false,
      PRIMARY KEY (id, map_id)
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_heroic_mobs_groups_map_id ON heroic_mobs_groups(map_id)
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS heroic_mobs_groups_limits (
      map_id integer PRIMARY KEY,
      min_level smallint DEFAULT 0,
      max_level smallint DEFAULT 0,
      max_alive smallint DEFAULT 0
    )
  `.execute(db);

  await sql`
    INSERT INTO heroic_mobs_groups (id, map_id, cell_id, "group", objects, stars) VALUES
    (1, 1, 180, '285,10,12', '', 1),
    (2, 2, 240, '286,15,18', '', 2),
    (3, 7, 310, '287,25,30', '', 3)
  `.execute(db);

  await sql`
    INSERT INTO heroic_mobs_groups_limits (map_id, min_level, max_level, max_alive) VALUES
    (1, 1, 30, 4),
    (2, 15, 50, 3),
    (7, 40, 100, 2)
  `.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("heroic_mobs_groups_limits").ifExists().execute();
  await db.schema.dropTable("heroic_mobs_groups").ifExists().execute();
}
