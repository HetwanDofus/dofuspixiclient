import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await db.schema
    .createTable("achievement_templates")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("category", sql`VARCHAR(64)`, (col) => col.defaultTo(""))
    .addColumn("name", sql`VARCHAR(128)`)
    .addColumn("description", "text", (col) => col.defaultTo(""))
    .addColumn("objectives", "jsonb", (col) => col.defaultTo("[]"))
    .addColumn("rewards", "jsonb", (col) => col.defaultTo("{}"))
    .execute();

  await db.schema
    .createTable("player_achievements")
    .ifNotExists()
    .addColumn("player_id", "bigint", (col) =>
      col.references("players.id").onDelete("cascade")
    )
    .addColumn("achievement_id", "integer", (col) =>
      col.references("achievement_templates.id").onDelete("cascade")
    )
    .addColumn("earned_at", "timestamptz")
    .addColumn("progress", "jsonb", (col) => col.defaultTo("{}"))
    .addPrimaryKeyConstraint("pk_player_achievements", [
      "player_id",
      "achievement_id",
    ])
    .execute();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_player_achievements_earned ON player_achievements(player_id) WHERE earned_at IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("player_achievements").execute();
  await db.schema.dropTable("achievement_templates").execute();
}
