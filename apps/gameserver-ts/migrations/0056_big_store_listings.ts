import { type Kysely, sql } from "kysely";

/**
 * `big_store_listings`, rewritten as a 1.29 auction lot.
 *
 * The old shape carried a single `price` and a single `quantity` with no
 * constraint on either, which cannot describe what the protocol sends:
 * `BigStoreListingLine` puts `price_qty1`, `price_qty10` and
 * `price_qty100` on **one** line, because 1.29 sells resources in three
 * standard, indivisible lots and nothing else. See QA-108.
 *
 * The table is empty in every environment and no code reads or writes
 * it, so it is replaced rather than migrated; `down` puts the old shape
 * back exactly.
 *
 * ── Where the goods actually live ─────────────────────────────────────
 *
 * Not here. A listing's stock is an ordinary row in `items` owned by
 * `(owner_kind = OwnerKind.BigStore, owner_id = big_store_listings.id)`,
 * which is why there is no `item_id` column: a foreign key in that
 * direction would be circular — the listing has to exist before anything
 * can belong to it. `idx_items_owner` already covers the lookup.
 *
 * That also settles what QA-108 called the missing `sold_at` and
 * `buyer_id`. A sold listing is deleted and the sale is a row in
 * `item_ledger`, which records the item, the kamas, both containers and
 * the actor inside the same transaction. Two records of one event is one
 * record too many.
 *
 * `lot_size` is denormalised out of `items.quantity` and `template_id`
 * out of the item's template on purpose: the two hot queries — "which
 * templates are on sale in this hall for this type" and "the cheapest
 * price per lot size for this template" — then never touch `items` at
 * all.
 */

/** Mirrors `items/item-owner.ts`. */
const OWNER_BIG_STORE = 4;

export async function up(db: Kysely<never>): Promise<void> {
  // `hdvs.sellTime` is 1500 on every row of the dump. Read as days that
  // is four years, which no auction house has ever meant; read as hours
  // it is 62 days, the retail order of magnitude. The column is renamed
  // rather than reinterpreted in silence — `hdv_templates` has no rows
  // anywhere, so nothing is being converted.
  await sql`ALTER TABLE hdv_templates
    RENAME COLUMN sell_time_days TO sell_time_hours`.execute(db);

  await db.schema.dropTable("big_store_listings").execute();

  await db.schema
    .createTable("big_store_listings")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("hdv_id", "integer", (col) =>
      col.notNull().references("hdv_templates.id").onDelete("cascade")
    )
    // The seller is a character (it is their name on the sale) but the
    // slot cap and the delivery of both proceeds and unsold stock are
    // per **account**: 1.29 credits `coffre de banque`, and the bank is
    // keyed by account. Both ids are kept so neither has to be looked up
    // on a path that must stay short.
    .addColumn("seller_id", "bigint", (col) => col.notNull())
    .addColumn("seller_account_id", "bigint", (col) => col.notNull())
    .addColumn("template_id", "integer", (col) =>
      col.notNull().references("item_templates.id")
    )
    .addColumn("lot_size", "smallint", (col) => col.notNull())
    .addColumn("price", "bigint", (col) => col.notNull())
    .addColumn("posted_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    .execute();

  // The three lots of 1.29, stated where they cannot be forgotten. A
  // unitary item (equipment, weapon, pet) is a lot of 1.
  await sql`ALTER TABLE big_store_listings
    ADD CONSTRAINT chk_big_store_lot_size
    CHECK (lot_size IN (1, 10, 100))`.execute(db);

  await sql`ALTER TABLE big_store_listings
    ADD CONSTRAINT chk_big_store_price_positive
    CHECK (price > 0)`.execute(db);

  // `EHl` — the cheapest price per lot size for one template in one
  // hall. Leading `hdv_id, template_id` also serves `EHT`.
  await sql`CREATE INDEX idx_big_store_listings_lookup
    ON big_store_listings (hdv_id, template_id, lot_size, price)`.execute(db);

  // The slot cap, counted per account and per hall.
  await sql`CREATE INDEX idx_big_store_listings_seller
    ON big_store_listings (seller_account_id, hdv_id)`.execute(db);

  // Reloading the expiry jobs on a cold start.
  await sql`CREATE INDEX idx_big_store_listings_expiry
    ON big_store_listings (expires_at)`.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`ALTER TABLE hdv_templates
    RENAME COLUMN sell_time_hours TO sell_time_days`.execute(db);

  // Anything listed goes back to nobody: the old shape has no column for
  // a hall, and its `seller_id` cascade would not describe stock that
  // lives in `items`. The table is empty going forward, so this is the
  // honest inverse rather than a lossy copy.
  await sql`DELETE FROM items
    WHERE owner_kind = ${sql.lit(OWNER_BIG_STORE)}`.execute(db);

  await db.schema.dropTable("big_store_listings").execute();

  await db.schema
    .createTable("big_store_listings")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("seller_id", "bigint", (col) =>
      col.notNull().references("players.id").onDelete("cascade")
    )
    .addColumn("template_id", "integer")
    .addColumn("quantity", "integer")
    .addColumn("price", "bigint")
    .addColumn("effects", "jsonb", (col) => col.defaultTo(sql`'[]'`))
    .addColumn("posted_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .addColumn("expires_at", "timestamptz")
    .addColumn("sold", "boolean", (col) => col.defaultTo(false))
    .execute();

  await sql`CREATE INDEX idx_big_store_listings_template_id ON big_store_listings(template_id) WHERE NOT sold`.execute(
    db
  );

  await sql`CREATE INDEX idx_big_store_listings_seller_id ON big_store_listings(seller_id) WHERE NOT sold`.execute(
    db
  );
}
