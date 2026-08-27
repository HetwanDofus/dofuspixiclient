import { type Kysely, sql } from "kysely";

/**
 * Hotbar item shortcuts, take two.
 *
 * `player_item_shortcuts` was created by 0004 and never read or written
 * by anything. Wiring it up (QA-007) surfaced two problems with its
 * shape, so it is recreated rather than patched:
 *
 *   - `item_id` referenced `player_items.id` with `ON DELETE CASCADE`,
 *     so drinking the last potion of a stack deleted the shortcut that
 *     pointed at it. 1.29 does the opposite: a shortcut holds a
 *     *template* (`InventoryShortcutItem._nGenericID`) and rescans the
 *     inventory for any stack of that template on every render
 *     (`findRealItem()`), greying the slot out when there is none. The
 *     shortcut is meant to outlive the stack.
 *   - `spell_id` duplicated `player_spells.position`, which is where
 *     spell slots already live and where the SM/SR handlers write. Two
 *     columns answering "which slot is this spell in" is one too many.
 *
 * The slot range widens from `[0, 30)` to `[1, 42]`: slots are 1-based
 * in 1.29 (slot 0 is the melee-attack container, which is not a
 * shortcut), and the bar pages through 3 pages of 14.
 *
 * The table is empty in every environment — nothing ever inserted into
 * it — so dropping it loses no data.
 */
export async function up(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("player_item_shortcuts").execute();

  await db.schema
    .createTable("player_item_shortcuts")
    .addColumn("player_id", "bigint", (col) =>
      col.notNull().references("players.id").onDelete("cascade")
    )
    .addColumn("slot", "smallint", (col) => col.notNull())
    .addColumn("template_id", "integer", (col) =>
      col.notNull().references("item_templates.id").onDelete("cascade")
    )
    .addPrimaryKeyConstraint("pk_player_item_shortcuts", ["player_id", "slot"])
    .execute();

  await sql`ALTER TABLE player_item_shortcuts ADD CONSTRAINT chk_slot_range CHECK(slot >= 1 AND slot <= 42)`.execute(
    db
  );
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("player_item_shortcuts").execute();

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
}
