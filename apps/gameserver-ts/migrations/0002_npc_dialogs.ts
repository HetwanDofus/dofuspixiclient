import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  // npc_templates
  await db.schema
    .createTable("npc_templates")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("name", sql`VARCHAR(64)`)
    .addColumn("gfx", "integer")
    .addColumn("sex", "smallint", (col) => col.defaultTo(0))
    .addColumn("color1", "integer", (col) => col.defaultTo(-1))
    .addColumn("color2", "integer", (col) => col.defaultTo(-1))
    .addColumn("color3", "integer", (col) => col.defaultTo(-1))
    .addColumn("accessories", "text", (col) => col.defaultTo(""))
    .addColumn("extra_clip", "integer", (col) => col.defaultTo(0))
    .addColumn("custom_artwork", "integer", (col) => col.defaultTo(0))
    .addColumn("initial_question", "integer", (col) => col.defaultTo(0))
    .addColumn("sale_store_id", "integer", (col) => col.defaultTo(0))
    .execute();

  // npc_dialog_questions
  await db.schema
    .createTable("npc_dialog_questions")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("text_id", "integer")
    .addColumn("parameters", "jsonb", (col) => col.defaultTo("[]"))
    .addColumn("response_ids", "jsonb", (col) => col.defaultTo("[]"))
    .execute();

  // npc_dialog_responses
  await db.schema
    .createTable("npc_dialog_responses")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("text_id", "integer")
    .addColumn("next_question", "integer", (col) => col.defaultTo(0))
    .addColumn("action", sql`VARCHAR(32)`, (col) => col.defaultTo(""))
    .addColumn("action_args", "jsonb", (col) => col.defaultTo("[]"))
    .addColumn("requires_level", "smallint", (col) => col.defaultTo(0))
    .addColumn("requires_kamas", "integer", (col) => col.defaultTo(0))
    .execute();

  // waypoints
  await db.schema
    .createTable("waypoints")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("map_id", "integer", (col) =>
      col.notNull().references("maps.id").onDelete("cascade")
    )
    .addColumn("cell_id", "integer")
    .addColumn("kind", "smallint", (col) => col.defaultTo(0))
    .addColumn("cost_kamas", "integer", (col) => col.defaultTo(10))
    .addColumn("sub_area_id", "integer")
    .execute();

  await sql`CREATE INDEX idx_waypoints_map ON waypoints(map_id)`.execute(db);

  // waypoint_known
  await db.schema
    .createTable("waypoint_known")
    .addColumn("player_id", "bigint", (col) =>
      col.notNull().references("players.id").onDelete("cascade")
    )
    .addColumn("waypoint_id", "bigint", (col) =>
      col.notNull().references("waypoints.id").onDelete("cascade")
    )
    .addColumn("discovered_at", "timestamptz", (col) =>
      col.defaultTo(sql`now()`)
    )
    .addPrimaryKeyConstraint("pk_waypoint_known", ["player_id", "waypoint_id"])
    .execute();
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("waypoint_known").execute();
  await db.schema.dropTable("waypoints").execute();
  await db.schema.dropTable("npc_dialog_responses").execute();
  await db.schema.dropTable("npc_dialog_questions").execute();
  await db.schema.dropTable("npc_templates").execute();
}
