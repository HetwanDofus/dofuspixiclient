import { type Kysely, sql } from "kysely";

/**
 * Adds `visual_gfx_id` to spell_levels — the SWF/dofasset filename the
 * client should load to render the spell. In canonical Dofus 1.29 this
 * is *separate* from the gameplay spell id (StarLoco's `sorts.sprite`
 * column; Hetwan's GA;300 `visual` field). Multiple spells routinely
 * share the same gfx file (e.g. several elemental damage spells all
 * reuse one explosion SWF), and many gameplay spells have visuals at
 * IDs the gameplay system never references.
 *
 * Backfill: visual_gfx_id := spell_id. That preserves current behavior
 * (we previously used spell_id as the SWF filename). Once the StarLoco
 * `sorts` dump lands, a follow-up migration overwrites these rows with
 * the canonical gfxIds from `sorts.sprite`.
 */
export async function up(db: Kysely<never>): Promise<void> {
  await db.schema
    .alterTable("spell_levels")
    .addColumn("visual_gfx_id", "integer")
    .execute();

  await sql`UPDATE spell_levels SET visual_gfx_id = spell_id WHERE visual_gfx_id IS NULL`.execute(
    db
  );

  // Index — fight cast lookups by visual_gfx_id will be hot once the
  // client preloads bespoke spell classes by gfx id.
  await db.schema
    .createIndex("spell_levels_visual_gfx_id_idx")
    .on("spell_levels")
    .column("visual_gfx_id")
    .execute();
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema
    .dropIndex("spell_levels_visual_gfx_id_idx")
    .ifExists()
    .execute();
  await db.schema
    .alterTable("spell_levels")
    .dropColumn("visual_gfx_id")
    .execute();
}
