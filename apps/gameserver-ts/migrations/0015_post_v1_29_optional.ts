import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await db.schema
    .createTable("koliseum_queue")
    .addColumn("player_id", "bigint", (col) => col.primaryKey())
    .addColumn("team_size", "smallint", (col) => col.defaultTo(1))
    .addColumn("mmr", "integer", (col) => col.defaultTo(1000))
    .addColumn("enqueued_at", "timestamptz", (col) =>
      col.defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute();

  await db.schema
    .createTable("koliseum_matches")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("team_size", "smallint")
    .addColumn("started_at", "timestamptz")
    .addColumn("ended_at", "timestamptz")
    .addColumn("winner_team", "smallint")
    .addColumn("created_at", "timestamptz", (col) =>
      col.defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute();

  await db.schema
    .createTable("koliseum_seasons")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("name", "text")
    .addColumn("started_at", "timestamptz")
    .addColumn("ended_at", "timestamptz")
    .addColumn("mmr_reset", "boolean", (col) => col.defaultTo(false))
    .addColumn("created_at", "timestamptz", (col) =>
      col.defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute();

  await db.schema
    .createTable("achievement_templates")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("category", "text")
    .addColumn("name", "text")
    .addColumn("description", "text", (col) => col.defaultTo(""))
    .addColumn("objectives", "jsonb")
    .addColumn("rewards", "jsonb")
    .addColumn("created_at", "timestamptz", (col) =>
      col.defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute();

  await db.schema
    .createTable("player_achievements")
    .addColumn("player_id", "bigint", (col) =>
      col.notNull().references("players.id").onDelete("cascade")
    )
    .addColumn("achievement_id", "integer")
    .addColumn("earned_at", "timestamptz")
    .addColumn("progress", "jsonb", (col) => col.defaultTo(sql`'{}'`))
    .addPrimaryKeyConstraint("pk_player_achievements", [
      "player_id",
      "achievement_id",
    ])
    .execute();

  await sql`CREATE INDEX idx_player_achievements_earned ON player_achievements(player_id, earned_at)`.execute(
    db
  );

  await db.schema
    .createTable("world_boss_templates")
    .addColumn("monster_template_id", "integer", (col) => col.primaryKey())
    .addColumn("spawn_weight", "integer", (col) => col.defaultTo(100))
    .addColumn("created_at", "timestamptz", (col) =>
      col.defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute();

  await db.schema
    .createTable("world_boss_spawns")
    .addColumn("map_id", "integer", (col) => col.primaryKey())
    .addColumn("last_killed_at", "timestamptz")
    .addColumn("next_spawn_at", "timestamptz")
    .addColumn("active_boss_id", "bigint")
    .addColumn("created_at", "timestamptz", (col) =>
      col.defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute();
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("world_boss_spawns").execute();
  await db.schema.dropTable("world_boss_templates").execute();
  await db.schema.dropTable("player_achievements").execute();
  await db.schema.dropTable("achievement_templates").execute();
  await db.schema.dropTable("koliseum_seasons").execute();
  await db.schema.dropTable("koliseum_matches").execute();
  await db.schema.dropTable("koliseum_queue").execute();
}
