import { sql } from "kysely";

import { db } from "./database.ts";

async function migrate() {
  console.log("Running migrations...");

  await db.schema
    .createTable("maps")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("width", "integer", (col) => col.notNull())
    .addColumn("height", "integer", (col) => col.notNull())
    .addColumn("x", "integer", (col) => col.notNull())
    .addColumn("y", "integer", (col) => col.notNull())
    .addColumn("superarea", "integer", (col) => col.notNull())
    .addColumn("background", "integer", (col) => col.defaultTo(0))
    .addColumn("places", "text", (col) => col.defaultTo(""))
    .addColumn("cells", "jsonb", (col) => col.notNull())
    .addColumn("cells_gzip", sql`bytea`, (col) => col.notNull())
    .addColumn("walkable_ids", sql`integer[]`, (col) => col.notNull())
    .addColumn("monsters", "text", (col) => col.defaultTo(""))
    .execute();

  await db.schema
    .createTable("accounts")
    .ifNotExists()
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("username", "varchar(30)", (col) => col.unique().notNull())
    .addColumn("password", "varchar(50)", (col) => col.notNull())
    .addColumn("pseudo", "varchar(30)", (col) => col.notNull())
    .execute();

  await db.schema
    .createTable("characters")
    .ifNotExists()
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("account_id", "integer", (col) =>
      col.notNull().references("accounts.id")
    )
    .addColumn("name", "varchar(30)", (col) => col.unique().notNull())
    .addColumn("class", "smallint", (col) => col.notNull())
    .addColumn("sex", "smallint", (col) => col.notNull())
    .addColumn("color1", "integer", (col) => col.defaultTo(-1))
    .addColumn("color2", "integer", (col) => col.defaultTo(-1))
    .addColumn("color3", "integer", (col) => col.defaultTo(-1))
    .addColumn("gfx", "integer", (col) => col.notNull())
    .addColumn("level", "integer", (col) => col.defaultTo(1))
    .addColumn("map_id", "integer", (col) => col.defaultTo(8479))
    .addColumn("cell_id", "integer", (col) => col.defaultTo(314))
    .addColumn("direction", "smallint", (col) => col.defaultTo(1))
    // Stats
    .addColumn("vitality", "integer", (col) => col.defaultTo(0))
    .addColumn("wisdom", "integer", (col) => col.defaultTo(0))
    .addColumn("strength", "integer", (col) => col.defaultTo(0))
    .addColumn("chance", "integer", (col) => col.defaultTo(0))
    .addColumn("agility", "integer", (col) => col.defaultTo(0))
    .addColumn("intelligence", "integer", (col) => col.defaultTo(0))
    .addColumn("hp", "integer", (col) => col.defaultTo(55))
    .addColumn("max_hp", "integer", (col) => col.defaultTo(55))
    .addColumn("ap", "smallint", (col) => col.defaultTo(6))
    .addColumn("mp", "smallint", (col) => col.defaultTo(3))
    .addColumn("energy", "integer", (col) => col.defaultTo(10000))
    .addColumn("max_energy", "integer", (col) => col.defaultTo(10000))
    .addColumn("bonus_points", "integer", (col) => col.defaultTo(0))
    .addColumn("bonus_points_spell", "integer", (col) => col.defaultTo(0))
    .addColumn("xp", "bigint", (col) => col.defaultTo(0))
    .addColumn("xp_low", "bigint", (col) => col.defaultTo(0))
    .addColumn("xp_high", "bigint", (col) => col.defaultTo(110))
    .addColumn("kama", "integer", (col) => col.defaultTo(0))
    .addColumn("initiative", "integer", (col) => col.defaultTo(100))
    .addColumn("discernment", "integer", (col) => col.defaultTo(0))
    .addColumn("range", "smallint", (col) => col.defaultTo(0))
    .addColumn("summon_limit", "smallint", (col) => col.defaultTo(1))
    .execute();

  await db.schema
    .createTable("scripted_cells")
    .ifNotExists()
    .addColumn("map_id", "integer", (col) => col.notNull())
    .addColumn("cell_id", "integer", (col) => col.notNull())
    .addColumn("action_id", "integer", (col) => col.notNull())
    .addColumn("event_id", "integer", (col) => col.notNull())
    .addColumn("action_args", "text", (col) => col.defaultTo(""))
    .addColumn("conditions", "text", (col) => col.defaultTo(""))
    .execute();

  // Index for fast lookup by map_id
  await sql`CREATE INDEX IF NOT EXISTS idx_scripted_cells_map_id ON scripted_cells (map_id)`.execute(
    db
  );

  // ── Item templates (static data) ──
  await db.schema
    .createTable("item_templates")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("name", "varchar(100)", (col) => col.notNull())
    .addColumn("type", "smallint", (col) => col.notNull()) // ItemCategory
    .addColumn("super_type", "smallint", (col) => col.defaultTo(0)) // ItemSuperType
    .addColumn("level", "smallint", (col) => col.defaultTo(1))
    .addColumn("weight", "integer", (col) => col.defaultTo(1))
    .addColumn("gfx_id", "integer", (col) => col.defaultTo(0))
    .addColumn("equip_positions", "jsonb", (col) => col.defaultTo("[]"))
    .addColumn("effects", "jsonb", (col) => col.defaultTo("[]"))
    .addColumn("item_set_id", "integer", (col) => col.defaultTo(0))
    .addColumn("two_handed", "boolean", (col) => col.defaultTo(false))
    .addColumn("usable", "boolean", (col) => col.defaultTo(false))
    .addColumn("stackable", "boolean", (col) => col.defaultTo(true))
    .addColumn("description", "text", (col) => col.defaultTo(""))
    .execute();

  // ── Character inventory items ──
  await db.schema
    .createTable("character_items")
    .ifNotExists()
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("character_id", "integer", (col) =>
      col.notNull().references("characters.id").onDelete("cascade")
    )
    .addColumn("template_id", "integer", (col) =>
      col.notNull().references("item_templates.id")
    )
    .addColumn("quantity", "integer", (col) => col.defaultTo(1))
    .addColumn("position", "smallint", (col) => col.defaultTo(-1)) // -1 = bag
    .addColumn("effects", "jsonb", (col) => col.defaultTo("[]"))
    .execute();

  await sql`CREATE INDEX IF NOT EXISTS idx_character_items_char_id ON character_items (character_id)`.execute(
    db
  );

  // Add stats columns to existing characters table (safe to re-run)
  const statsColumns: Array<[string, string, string | number]> = [
    ["vitality", "integer", 0],
    ["wisdom", "integer", 0],
    ["strength", "integer", 0],
    ["chance", "integer", 0],
    ["agility", "integer", 0],
    ["intelligence", "integer", 0],
    ["hp", "integer", 55],
    ["max_hp", "integer", 55],
    ["ap", "smallint", 6],
    ["mp", "smallint", 3],
    ["energy", "integer", 10000],
    ["max_energy", "integer", 10000],
    ["bonus_points", "integer", 0],
    ["bonus_points_spell", "integer", 0],
    ["xp", "bigint", 0],
    ["xp_low", "bigint", 0],
    ["xp_high", "bigint", 110],
    ["kama", "integer", 0],
    ["initiative", "integer", 100],
    ["discernment", "integer", 0],
    ["range", "smallint", 0],
    ["summon_limit", "smallint", 1],
  ];

  for (const [name, type, defaultVal] of statsColumns) {
    try {
      await sql`ALTER TABLE characters ADD COLUMN IF NOT EXISTS ${sql.ref(name)} ${sql.raw(type)} DEFAULT ${sql.raw(String(defaultVal))}`.execute(db);
    } catch {
      // Column already exists — ignore
    }
  }

  // Backfill NULL values for existing rows
  await sql`UPDATE characters SET
    vitality = COALESCE(vitality, 0),
    wisdom = COALESCE(wisdom, 0),
    strength = COALESCE(strength, 0),
    chance = COALESCE(chance, 0),
    agility = COALESCE(agility, 0),
    intelligence = COALESCE(intelligence, 0),
    hp = COALESCE(hp, 55),
    max_hp = COALESCE(max_hp, 55),
    ap = COALESCE(ap, 6),
    mp = COALESCE(mp, 3),
    energy = COALESCE(energy, 10000),
    max_energy = COALESCE(max_energy, 10000),
    bonus_points = COALESCE(bonus_points, 0),
    bonus_points_spell = COALESCE(bonus_points_spell, 0),
    xp = COALESCE(xp, 0),
    xp_low = COALESCE(xp_low, 0),
    xp_high = COALESCE(xp_high, 110),
    kama = COALESCE(kama, 0),
    initiative = COALESCE(initiative, 100),
    discernment = COALESCE(discernment, 0),
    range = COALESCE(range, 0),
    summon_limit = COALESCE(summon_limit, 1)
  `.execute(db);

  console.log("Migrations complete.");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
