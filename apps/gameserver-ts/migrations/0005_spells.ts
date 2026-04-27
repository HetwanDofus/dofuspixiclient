import type { Kysely } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  // class_starter_spells
  await db.schema
    .createTable("class_starter_spells")
    .addColumn("class_id", "smallint", (col) => col.notNull())
    .addColumn("spell_id", "integer", (col) => col.notNull())
    .addColumn("level", "smallint", (col) => col.defaultTo(1))
    .addColumn("position", "smallint", (col) => col.defaultTo(-1))
    .addPrimaryKeyConstraint("pk_class_starter_spells", [
      "class_id",
      "spell_id",
    ])
    .execute();

  // spell_cooldowns
  await db.schema
    .createTable("spell_cooldowns")
    .addColumn("player_id", "bigint", (col) =>
      col.notNull().references("players.id").onDelete("cascade")
    )
    .addColumn("spell_id", "integer", (col) => col.notNull())
    .addColumn("available_at_turn", "integer", (col) => col.defaultTo(0))
    .addColumn("persistent", "boolean", (col) => col.defaultTo(false))
    .addPrimaryKeyConstraint("pk_spell_cooldowns", ["player_id", "spell_id"])
    .execute();
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("spell_cooldowns").execute();
  await db.schema.dropTable("class_starter_spells").execute();
}
