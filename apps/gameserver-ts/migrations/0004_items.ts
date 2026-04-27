import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  // Alter item_templates to add new columns
  await sql`ALTER TABLE item_templates ADD COLUMN super_type smallint default 0`.execute(
    db
  );
  await sql`ALTER TABLE item_templates ADD COLUMN category smallint default 0`.execute(
    db
  );
  await sql`ALTER TABLE item_templates ADD COLUMN sell_price integer default 0`.execute(
    db
  );
  await sql`ALTER TABLE item_templates ADD COLUMN max_per_target smallint default 0`.execute(
    db
  );

  // player_item_shortcuts
  await db.schema
    .createTable("player_item_shortcuts")
    .addColumn("player_id", "bigint", (col) =>
      col.notNull().references("players.id").onDelete("cascade")
    )
    .addColumn("slot", "smallint", (col) => col.notNull())
    .addColumn("item_id", "bigint", (col) =>
      col.references("player_items.id").onDelete("cascade")
    )
    .addColumn("spell_id", "integer")
    .addPrimaryKeyConstraint("pk_player_item_shortcuts", ["player_id", "slot"])
    .execute();

  await sql`ALTER TABLE player_item_shortcuts ADD CONSTRAINT chk_slot_range CHECK(slot >= 0 AND slot < 30)`.execute(
    db
  );

  // player_soul_stones
  await db.schema
    .createTable("player_soul_stones")
    .addColumn("item_id", "bigint", (col) =>
      col.primaryKey().references("player_items.id").onDelete("cascade")
    )
    .addColumn("captured", "jsonb", (col) => col.defaultTo("[]"))
    .execute();

  // living_objects
  await db.schema
    .createTable("living_objects")
    .addColumn("item_id", "bigint", (col) =>
      col.primaryKey().references("player_items.id").onDelete("cascade")
    )
    .addColumn("level", "smallint", (col) => col.defaultTo(1))
    .addColumn("experience", "bigint", (col) => col.defaultTo(0))
    .addColumn("mood", "smallint", (col) => col.defaultTo(0))
    .addColumn("skin", "integer", (col) => col.defaultTo(0))
    .execute();
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("living_objects").execute();
  await db.schema.dropTable("player_soul_stones").execute();
  await db.schema.dropTable("player_item_shortcuts").execute();
  await sql`ALTER TABLE item_templates DROP COLUMN super_type`.execute(db);
  await sql`ALTER TABLE item_templates DROP COLUMN category`.execute(db);
  await sql`ALTER TABLE item_templates DROP COLUMN sell_price`.execute(db);
  await sql`ALTER TABLE item_templates DROP COLUMN max_per_target`.execute(db);
}
