import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await sql`ALTER TABLE maps
    ALTER COLUMN key TYPE TEXT,
    ADD COLUMN map_data text DEFAULT '',
    ADD COLUMN capabilities integer DEFAULT 0,
    ADD COLUMN numgroup smallint DEFAULT 3,
    ADD COLUMN mob_size_min smallint DEFAULT 1,
    ADD COLUMN mob_size_max smallint DEFAULT 8,
    ADD COLUMN mob_fix_size smallint DEFAULT -1,
    ADD COLUMN forbidden varchar(32) DEFAULT '0;0;0;0;0;0;0',
    ADD COLUMN monsters_raw text DEFAULT ''`.execute(db);

  await sql`ALTER TABLE subareas ADD COLUMN prism_id integer DEFAULT 0`.execute(
    db
  );

  await sql`ALTER TABLE guild_tax_collectors
    ADD COLUMN n1 integer DEFAULT 0,
    ADD COLUMN n2 integer DEFAULT 0,
    ADD COLUMN xp_accumulated bigint DEFAULT 0`.execute(db);

  await db.schema
    .createTable("interactive_objects_templates")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("name", "text", (col) => col.defaultTo(""))
    .addColumn("respawn_ms", "integer", (col) => col.defaultTo(10000))
    .addColumn("duration_ms", "integer", (col) => col.defaultTo(1500))
    .addColumn("walkable", "boolean", (col) => col.defaultTo(true))
    .addColumn("unknown", "integer", (col) => col.defaultTo(4))
    .execute();

  await db.schema
    .createTable("interactive_doors")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("maps", "varchar(255)")
    .addColumn("doors_enable", "varchar(255)", (col) => col.defaultTo(""))
    .addColumn("doors_disable", "varchar(255)", (col) => col.defaultTo(""))
    .addColumn("cells_enable", "varchar(255)", (col) => col.defaultTo(""))
    .addColumn("cells_disable", "varchar(255)", (col) => col.defaultTo(""))
    .addColumn("required_cells", "varchar(500)", (col) => col.defaultTo(""))
    .addColumn("button", "varchar(16)", (col) => col.defaultTo("-1"))
    .addColumn("time_seconds", "integer", (col) => col.defaultTo(30))
    .execute();

  await db.schema
    .createTable("dungeons")
    .addColumn("map_id", "integer", (col) => col.primaryKey())
    .addColumn("npc_id", "integer", (col) => col.defaultTo(0))
    .addColumn("key_code", "varchar(16)", (col) => col.defaultTo(""))
    .addColumn("name", "text", (col) => col.defaultTo(""))
    .execute();

  await db.schema
    .createTable("runes_templates")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("name", "text", (col) => col.defaultTo(""))
    .addColumn("bonus", "text", (col) => col.defaultTo(""))
    .addColumn("weight", "real", (col) => col.defaultTo(0))
    .execute();

  await db.schema
    .createTable("pet_templates")
    .addColumn("template_id", "integer", (col) => col.primaryKey())
    .addColumn("name", "text", (col) => col.defaultTo("Undefined"))
    .addColumn("pet_type", "smallint", (col) => col.defaultTo(0))
    .addColumn("gap", "varchar(16)", (col) => col.defaultTo(""))
    .addColumn("stats_up", "text", (col) => col.defaultTo(""))
    .addColumn("stat_max", "integer", (col) => col.defaultTo(0))
    .addColumn("gain_per_meal", "integer", (col) => col.defaultTo(0))
    .addColumn("dead_template", "integer", (col) => col.defaultTo(0))
    .addColumn("starving_ms", "integer", (col) => col.defaultTo(0))
    .addColumn("stats_max", "varchar(255)", (col) => col.defaultTo(""))
    .addColumn("jet", "varchar(255)", (col) => col.defaultTo(""))
    .execute();

  await db.schema
    .createTable("end_fight_actions")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("map_id", "integer")
    .addColumn("fight_type", "smallint")
    .addColumn("action", "integer")
    .addColumn("args", "varchar(64)", (col) => col.defaultTo(""))
    .addColumn("condition", "varchar(128)", (col) => col.defaultTo(""))
    .execute();

  await sql`CREATE INDEX idx_end_fight_actions_map_type ON end_fight_actions(map_id, fight_type)`.execute(
    db
  );

  await db.schema
    .createTable("item_actions")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("template_id", "integer")
    .addColumn("action_type", "varchar(64)", (col) => col.defaultTo(""))
    .addColumn("args", "varchar(400)", (col) => col.defaultTo(""))
    .execute();

  await sql`CREATE INDEX idx_item_actions_template_id ON item_actions(template_id)`.execute(
    db
  );

  await db.schema
    .createTable("hdv_templates")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("map_id", "integer")
    .addColumn("categories", "varchar(500)", (col) => col.defaultTo(""))
    .addColumn("sell_tax", sql`DOUBLE PRECISION`, (col) => col.defaultTo(1))
    .addColumn("level_max", "integer", (col) => col.defaultTo(2000))
    .addColumn("account_items", "integer", (col) => col.defaultTo(20))
    .addColumn("sell_time_days", "integer", (col) => col.defaultTo(350))
    .execute();

  await db.schema
    .createTable("full_morphs")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("name", "text", (col) => col.defaultTo(""))
    .addColumn("gfx_id", "integer")
    .addColumn("spells", "text", (col) => col.defaultTo(""))
    .addColumn("args", "text", (col) => col.defaultTo(""))
    .execute();

  await db.schema
    .createTable("map_animations")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("template_id", "integer")
    .addColumn("name", "varchar(64)", (col) => col.defaultTo(""))
    .addColumn("area", "integer", (col) => col.defaultTo(0))
    .addColumn("action", "integer", (col) => col.defaultTo(0))
    .addColumn("size", "integer", (col) => col.defaultTo(0))
    .execute();

  await db.schema
    .createTable("chests")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("items", "text", (col) => col.defaultTo(""))
    .addColumn("kamas", "bigint", (col) => col.defaultTo(0))
    .addColumn("key_code", "varchar(16)", (col) => col.defaultTo("-"))
    .addColumn("owner_id", "bigint", (col) => col.defaultTo(0))
    .execute();

  await db.schema
    .createTable("tutorials")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("name", "text", (col) => col.defaultTo(""))
    .addColumn("start", "varchar(255)", (col) => col.defaultTo(""))
    .addColumn("reward1", "varchar(255)", (col) => col.defaultTo(""))
    .addColumn("reward2", "varchar(255)", (col) => col.defaultTo(""))
    .addColumn("reward3", "varchar(255)", (col) => col.defaultTo(""))
    .addColumn("reward4", "varchar(255)", (col) => col.defaultTo(""))
    .addColumn("end_step", "varchar(255)", (col) => col.defaultTo(""))
    .execute();

  await db.schema
    .createTable("bandits")
    .addColumn("schedule_ms", "bigint", (col) => col.primaryKey())
    .addColumn("mobs_raw", "text", (col) => col.defaultTo(""))
    .addColumn("maps_raw", "text", (col) => col.defaultTo(""))
    .execute();

  await sql`ALTER TABLE gifts ADD COLUMN objects_raw text DEFAULT ''`.execute(
    db
  );

  await db.schema
    .createTable("mount_paddock_templates")
    .addColumn("map_id", "integer", (col) => col.primaryKey())
    .addColumn("price", "bigint", (col) => col.defaultTo(0))
    .addColumn("data", "text", (col) => col.defaultTo(""))
    .addColumn("enclos_raw", "text", (col) => col.defaultTo(""))
    .addColumn("placed_raw", "text", (col) => col.defaultTo(""))
    .addColumn("durability", "text", (col) => col.defaultTo(""))
    .execute();
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("mount_paddock_templates").execute();
  await sql`ALTER TABLE gifts DROP COLUMN objects_raw`.execute(db);
  await db.schema.dropTable("bandits").execute();
  await db.schema.dropTable("tutorials").execute();
  await db.schema.dropTable("chests").execute();
  await db.schema.dropTable("map_animations").execute();
  await db.schema.dropTable("full_morphs").execute();
  await db.schema.dropTable("hdv_templates").execute();
  await db.schema.dropTable("item_actions").execute();
  await db.schema.dropTable("end_fight_actions").execute();
  await db.schema.dropTable("pet_templates").execute();
  await db.schema.dropTable("runes_templates").execute();
  await db.schema.dropTable("dungeons").execute();
  await db.schema.dropTable("interactive_doors").execute();
  await db.schema.dropTable("interactive_objects_templates").execute();
  await sql`ALTER TABLE guild_tax_collectors DROP COLUMN xp_accumulated, DROP COLUMN n2, DROP COLUMN n1`.execute(
    db
  );
  await sql`ALTER TABLE subareas DROP COLUMN prism_id`.execute(db);
  await sql`ALTER TABLE maps
    ALTER COLUMN key TYPE VARCHAR(255),
    DROP COLUMN monsters_raw,
    DROP COLUMN forbidden,
    DROP COLUMN mob_fix_size,
    DROP COLUMN mob_size_max,
    DROP COLUMN mob_size_min,
    DROP COLUMN numgroup,
    DROP COLUMN capabilities,
    DROP COLUMN map_data`.execute(db);
}
