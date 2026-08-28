import type { Kysely } from "kysely";

/**
 * Give NPCs the two things the display path needs and the schema never had.
 *
 * `scale_x` / `scale_y` — StarLoco's `npc_template` carries them and the
 * importer already reads them (`NPC_TEMPLATE_COLUMNS`), but there was no
 * column to write them to, so they were parsed and dropped. The 1.29 client
 * applies them per sprite (`GameIn.as:281-282` → `CharactersManager
 * .createNonPlayableCharacter` → `sprite.scaleX`), and the protobuf field
 * (`SpriteMovementEntry.scale_x/scale_y`) has always been there. They are
 * percentages: 100 is life size.
 *
 * `idx_scripted_npcs_map` — placements are about to be looked up by map on
 * every `enter-game`, and the table had no index on `map_id` (unlike
 * `waypoints`, which got `idx_waypoints_map` in 0002).
 *
 * The default of 100 keeps every existing row valid; re-running
 * `just import-content <game.sql>` is what fills in the real values.
 */
export async function up(db: Kysely<never>): Promise<void> {
  await db.schema
    .alterTable("npc_templates")
    .addColumn("scale_x", "integer", (col) => col.notNull().defaultTo(100))
    .execute();

  await db.schema
    .alterTable("npc_templates")
    .addColumn("scale_y", "integer", (col) => col.notNull().defaultTo(100))
    .execute();

  await db.schema
    .createIndex("idx_scripted_npcs_map")
    .on("scripted_npcs")
    .column("map_id")
    .execute();
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropIndex("idx_scripted_npcs_map").execute();
  await db.schema.alterTable("npc_templates").dropColumn("scale_y").execute();
  await db.schema.alterTable("npc_templates").dropColumn("scale_x").execute();
}
