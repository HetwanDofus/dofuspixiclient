import { type Kysely, sql } from "kysely";

/**
 * Item presentation data — the columns the inventory window needs to
 * describe an item without the client ever loading `items.json` itself.
 *
 * `item_templates.description` was dropped by the content importer (only
 * `name`, not `d`, was mapped) — this backfills the column so a future
 * import run can fill it.
 *
 * `item_types` and `item_super_types` mirror the 1.29 lang bundle's
 * `I.t` (type → {name, superType, weapon zone}) and `I.ss` (superType →
 * legal equipment positions) tables. They are the canonical source for
 * two things this project had gotten wrong in-code:
 *   - `packages/protocol/src/item-types.ts`'s `EquipmentPosition` swapped
 *     BELT and RING_RIGHT (3 and 4) relative to the bundle.
 *   - `accessories.service.ts`'s hand-written position→ordinal table
 *     used made-up position numbers for hat/cape/pet/shield.
 * Both are corrected in the same change that adds these tables, and both
 * should read `item_super_types.positions` instead of hardcoding again.
 */
export async function up(db: Kysely<never>): Promise<void> {
  await sql`ALTER TABLE item_templates ADD COLUMN description text NOT NULL DEFAULT ''`.execute(
    db
  );

  await db.schema
    .createTable("item_types")
    .addColumn("id", "smallint", (col) => col.primaryKey())
    .addColumn("name", "varchar(64)", (col) => col.notNull())
    .addColumn("super_type", "smallint", (col) => col.notNull().defaultTo(0))
    .addColumn("effect_zone", "varchar(8)")
    .execute();

  await db.schema
    .createTable("item_super_types")
    .addColumn("id", "smallint", (col) => col.primaryKey())
    .addColumn("positions", sql`smallint[]`, (col) =>
      col.notNull().defaultTo(sql`'{}'::smallint[]`)
    )
    .execute();
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("item_super_types").execute();
  await db.schema.dropTable("item_types").execute();
  await sql`ALTER TABLE item_templates DROP COLUMN description`.execute(db);
}
