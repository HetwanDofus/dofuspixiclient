import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await db.schema
    .createTable("dungeon_templates")
    .addColumn("id", "smallint", (col) => col.primaryKey())
    .addColumn("name", sql`VARCHAR(128)`)
    .addColumn("key_item_template_id", "integer")
    .addColumn("max_level", "smallint", (col) => col.defaultTo(100))
    .addColumn("entrance_map_id", "integer", (col) => col.unique())
    .execute();

  await db.schema
    .createTable("dungeon_maps")
    .addColumn("template_id", "smallint", (col) =>
      col.references("dungeon_templates.id").onDelete("cascade")
    )
    .addColumn("position", "smallint")
    .addColumn("map_id", "integer")
    .addPrimaryKeyConstraint("pk_dungeon_maps", ["template_id", "position"])
    .execute();

  await db.schema
    .createTable("dungeon_boss_spawns")
    .addColumn("template_id", "smallint", (col) =>
      col.primaryKey().references("dungeon_templates.id").onDelete("cascade")
    )
    .addColumn("monster_template_id", "integer")
    .execute();

  await db.schema
    .createTable("dungeon_instances")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("template_id", "smallint", (col) =>
      col.references("dungeon_templates.id")
    )
    .addColumn("owner_player_id", "bigint", (col) =>
      col.references("players.id").onDelete("cascade")
    )
    .addColumn("created_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .addColumn("expires_at", "timestamptz")
    .addColumn("current_map_id", "integer")
    .addColumn("current_map_pos", "smallint", (col) => col.defaultTo(0))
    .execute();

  await db.schema
    .createTable("dungeon_participants")
    .addColumn("instance_id", "bigint", (col) =>
      col.references("dungeon_instances.id").onDelete("cascade")
    )
    .addColumn("player_id", "bigint", (col) =>
      col.references("players.id").onDelete("cascade")
    )
    .addColumn("joined_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .addPrimaryKeyConstraint("pk_dungeon_participants", [
      "instance_id",
      "player_id",
    ])
    .execute();

  await sql`
    CREATE INDEX idx_dungeon_instances_owner_player_id ON dungeon_instances(owner_player_id)
  `.execute(db);

  await sql`
    CREATE INDEX idx_dungeon_instances_expires_at ON dungeon_instances(expires_at)
  `.execute(db);

  await sql`
    CREATE INDEX idx_dungeon_participants_player_id ON dungeon_participants(player_id)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_player_items_player_template ON player_items(player_id, template_id)
  `.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("dungeon_participants").execute();
  await db.schema.dropTable("dungeon_boss_spawns").execute();
  await db.schema.dropTable("dungeon_instances").execute();
  await db.schema.dropTable("dungeon_maps").execute();
  await db.schema.dropTable("dungeon_templates").execute();
  await sql`DROP INDEX IF EXISTS idx_player_items_player_template`.execute(db);
}
