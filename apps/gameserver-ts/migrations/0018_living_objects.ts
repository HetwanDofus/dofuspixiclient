import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await sql`
    ALTER TABLE living_objects
    ADD COLUMN id bigserial,
    ADD COLUMN xp bigint DEFAULT 0,
    ADD COLUMN hunger smallint DEFAULT 100,
    ADD COLUMN evolution_age smallint DEFAULT 0,
    ADD COLUMN born_at timestamptz DEFAULT now()
  `.execute(db);

  await sql`
    CREATE INDEX idx_living_objects_item_id ON living_objects(item_id)
  `.execute(db);

  await db.schema
    .createTable("living_object_templates")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("name", sql`VARCHAR(64)`)
    .addColumn("food_item_ids", "jsonb", (col) => col.defaultTo("[]"))
    .addColumn("bonus_per_level", "jsonb", (col) => col.defaultTo("[]"))
    .addColumn("evolution_thresholds", "jsonb", (col) => col.defaultTo("[]"))
    .execute();
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("living_object_templates").execute();

  await sql`
    ALTER TABLE living_objects
    DROP COLUMN id,
    DROP COLUMN xp,
    DROP COLUMN hunger,
    DROP COLUMN evolution_age,
    DROP COLUMN born_at
  `.execute(db);
}
