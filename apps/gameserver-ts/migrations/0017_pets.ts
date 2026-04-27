import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await db.schema
    .createTable("pets")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("player_id", "bigint", (col) =>
      col.references("players.id").onDelete("cascade")
    )
    .addColumn("template_id", "integer")
    .addColumn("name", sql`VARCHAR(64)`, (col) => col.defaultTo(""))
    .addColumn("level", "smallint", (col) => col.defaultTo(1))
    .addColumn("xp", "bigint", (col) => col.defaultTo(0))
    .addColumn("hunger", "smallint", (col) => col.defaultTo(100))
    .addColumn("last_fed_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .addColumn("is_dead", "boolean", (col) => col.defaultTo(false))
    .addColumn("born_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .execute();

  await sql`
    CREATE INDEX idx_pets_player_id ON pets(player_id)
  `.execute(db);

  await sql`
    ALTER TABLE pet_templates
    ADD COLUMN food_item_ids jsonb DEFAULT '[]',
    ADD COLUMN hunger_drain_per_day smallint DEFAULT 50,
    ADD COLUMN bonus_effects jsonb DEFAULT '[]',
    ADD COLUMN evolution_levels jsonb DEFAULT '[]'
  `.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`
    ALTER TABLE pet_templates
    DROP COLUMN food_item_ids,
    DROP COLUMN hunger_drain_per_day,
    DROP COLUMN bonus_effects,
    DROP COLUMN evolution_levels
  `.execute(db);

  await db.schema.dropTable("pets").execute();
}
