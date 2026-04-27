import type { Kysely } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await db.schema
    .createTable("fight_challenge_templates")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("name", "varchar(64)")
    .addColumn("xp_bonus_pct", "integer", (col) => col.defaultTo(0))
    .addColumn("drop_bonus_pct", "integer", (col) => col.defaultTo(0))
    .addColumn("gain_per_mob_pct", "integer", (col) => col.defaultTo(0))
    .addColumn("conditions_mask", "integer", (col) => col.defaultTo(0))
    .execute();
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("fight_challenge_templates").execute();
}
