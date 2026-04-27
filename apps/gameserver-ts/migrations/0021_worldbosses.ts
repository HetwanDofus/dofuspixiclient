import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await db.schema
    .createTable("world_boss_templates")
    .ifNotExists()
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("monster_template_id", "integer", (col) =>
      col.references("monster_templates.id").onDelete("cascade")
    )
    .addColumn("spawn_weight", "integer", (col) => col.defaultTo(1))
    .execute();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_world_boss_templates_monster_template_id ON world_boss_templates(monster_template_id)
  `.execute(db);

  await db.schema
    .createTable("world_boss_spawns")
    .ifNotExists()
    .addColumn("map_id", "integer", (col) =>
      col.primaryKey().references("maps.id").onDelete("cascade")
    )
    .addColumn("last_killed_at", "timestamptz")
    .addColumn("next_spawn_at", "timestamptz")
    .addColumn("active_boss_id", "bigint")
    .execute();
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("world_boss_spawns").execute();
  await db.schema.dropTable("world_boss_templates").execute();
}
