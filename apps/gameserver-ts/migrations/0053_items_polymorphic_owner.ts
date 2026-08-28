import { type Kysely, sql } from "kysely";

/**
 * One `items` table with a polymorphic owner, replacing `player_items`.
 *
 * An exchange — any exchange — is "move a stack from one container to
 * another". Before this migration the project had four containers of
 * identical shape and four independent `bigserial`s: `player_items`,
 * `account_bank_items`, `house_storage_items`, `big_store_listings`.
 * Depositing an item meant DELETE here, INSERT there: the instance id
 * was destroyed and a fresh one allocated, so no object had an identity
 * that survived a move, and an audit trail had nothing stable to
 * reference. See QA-101.
 *
 * `player_items` is **renamed**, not recreated. Two (empty) tables carry
 * a foreign key into it — `living_objects.item_id`,
 * `player_soul_stones.item_id` — and a rename carries them, the primary
 * key and the id sequence along with it, where a copy would have had to
 * rebuild all three and renumber every row.
 *
 * ── The stacking index is the point ───────────────────────────────────
 *
 * `InventoryRepository.insertItem` looked for a matching stack and then
 * wrote, and its own comment admitted the read-then-write was not
 * atomic. Under READ COMMITTED — the default, and no isolation level is
 * set anywhere in this server — two concurrent grants both see no stack
 * and both insert. `items_stack` makes that state unrepresentable, so
 * the insert becomes an `ON CONFLICT DO UPDATE` and the race stops
 * existing rather than being guarded against.
 *
 * It is partial on `position = -1` because equipped items must never
 * merge: two identical rings in two slots are two rows, on purpose.
 *
 * The key is hashed rather than indexed on `effects` directly. `jsonb`
 * normalises key order, so equality is well defined and a plain btree on
 * it would be correct — but a btree entry is capped at about 2704 bytes
 * and a long effect list would then fail to insert at an unpredictable
 * size. `md5(effects::text)` has no such ceiling.
 *
 * ── What is deliberately given up ─────────────────────────────────────
 *
 * `owner_id` carries no foreign key: Postgres has no polymorphic
 * reference, and the alternative — one nullable column per owner kind —
 * is the four-table problem wearing a hat. `player_items.player_id` did
 * have `ON DELETE CASCADE`, but players are only ever soft-deleted
 * (`players.deleted_at`), so that cascade has never fired.
 */

/**
 * Owner kinds. Only Player and Bank are produced today; the rest are
 * declared so the numbering is settled once rather than renegotiated
 * every time a container is added. Mirrored in `items/item-owner.ts`.
 */
const OWNER_PLAYER = 1;

export async function up(db: Kysely<never>): Promise<void> {
  await sql`ALTER TABLE player_items RENAME TO items`.execute(db);
  await sql`ALTER SEQUENCE player_items_id_seq RENAME TO items_id_seq`.execute(
    db
  );
  await sql`ALTER INDEX player_items_pkey RENAME TO items_pkey`.execute(db);

  await sql`ALTER TABLE items ADD COLUMN owner_kind smallint`.execute(db);
  await sql`ALTER TABLE items ADD COLUMN owner_id bigint`.execute(db);

  await sql`UPDATE items
    SET owner_kind = ${sql.lit(OWNER_PLAYER)}, owner_id = player_id`.execute(
    db
  );

  await sql`ALTER TABLE items
    DROP CONSTRAINT player_items_player_id_fkey`.execute(db);
  await sql`DROP INDEX idx_player_items_player`.execute(db);
  await sql`DROP INDEX idx_player_items_player_template`.execute(db);
  await sql`ALTER TABLE items DROP COLUMN player_id`.execute(db);

  // Every column `player_items` left loose. Checked against the live dev
  // database before writing this: no null template, no null or
  // non-positive quantity, no null effects or position, no orphan
  // template id and no duplicate stack — so none of these can fail on
  // existing rows.
  await sql`ALTER TABLE items
    ALTER COLUMN owner_kind SET NOT NULL,
    ALTER COLUMN owner_id SET NOT NULL,
    ALTER COLUMN template_id SET NOT NULL,
    ALTER COLUMN quantity SET NOT NULL,
    ALTER COLUMN quantity SET DEFAULT 1,
    ALTER COLUMN effects SET NOT NULL,
    ALTER COLUMN effects SET DEFAULT '[]'::jsonb,
    ALTER COLUMN position SET NOT NULL,
    ALTER COLUMN position SET DEFAULT -1`.execute(db);

  await sql`ALTER TABLE items
    ADD CONSTRAINT chk_items_quantity_positive CHECK (quantity > 0)`.execute(
    db
  );

  await sql`ALTER TABLE items
    ADD CONSTRAINT items_template_id_fkey
    FOREIGN KEY (template_id) REFERENCES item_templates(id)`.execute(db);

  await sql`ALTER TABLE items
    ADD COLUMN effects_hash text
    GENERATED ALWAYS AS (md5(effects::text)) STORED`.execute(db);

  await sql`CREATE INDEX idx_items_owner
    ON items (owner_kind, owner_id)`.execute(db);

  await sql`CREATE UNIQUE INDEX items_stack
    ON items (owner_kind, owner_id, template_id, effects_hash)
    WHERE position = -1`.execute(db);

  // The bank and the house chest become owner kinds. Both are empty in
  // every environment — nothing has ever written to them — so dropping
  // them loses nothing. `account_banks` stays for now: it holds bank
  // kamas, which are not items. Migration 0054 generalises it.
  await db.schema.dropTable("account_bank_items").execute();
  await db.schema.dropTable("house_storage_items").execute();

  // A balance that can go negative is a duplication bug that has not
  // happened yet. `PlayersRepository.spendKamas` already carries the
  // predicate in its UPDATE (QA-077); this states the same rule where it
  // cannot be forgotten.
  await sql`ALTER TABLE players
    ADD CONSTRAINT chk_players_kamas_non_negative
    CHECK (kamas >= 0)`.execute(db);

  // Audit. Written inside the same transaction as the move it describes,
  // so a ledger line exists if and only if the move committed.
  //
  // `item_id` is not a foreign key on purpose: a stack fully merged into
  // another is deleted, and the record of where it went must outlive it.
  // Same reasoning for `actor_character_id`.
  await db.schema
    .createTable("item_ledger")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .addColumn("tx_id", "uuid", (col) => col.notNull())
    .addColumn("actor_character_id", "bigint")
    .addColumn("item_id", "bigint")
    .addColumn("template_id", "integer")
    .addColumn("quantity", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("kamas", "bigint", (col) => col.notNull().defaultTo(0))
    .addColumn("from_kind", "smallint", (col) => col.notNull())
    .addColumn("from_id", "bigint", (col) => col.notNull())
    .addColumn("to_kind", "smallint", (col) => col.notNull())
    .addColumn("to_id", "bigint", (col) => col.notNull())
    .addColumn("exchange_kind", "smallint")
    .addColumn("exchange_session_id", "text")
    .execute();

  await sql`CREATE INDEX idx_item_ledger_tx ON item_ledger (tx_id)`.execute(db);
  await sql`CREATE INDEX idx_item_ledger_actor_at
    ON item_ledger (actor_character_id, at DESC)`.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("item_ledger").execute();

  await sql`ALTER TABLE players
    DROP CONSTRAINT chk_players_kamas_non_negative`.execute(db);

  await db.schema
    .createTable("house_storage_items")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("house_id", "bigint", (col) =>
      col.notNull().references("houses.id").onDelete("cascade")
    )
    .addColumn("template_id", "integer")
    .addColumn("quantity", "integer", (col) => col.defaultTo(1))
    .addColumn("effects", "jsonb", (col) => col.defaultTo(sql`'[]'`))
    .execute();

  await db.schema
    .createTable("account_bank_items")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("account_id", "bigint", (col) =>
      col.notNull().references("accounts.id").onDelete("cascade")
    )
    .addColumn("template_id", "integer")
    .addColumn("quantity", "integer", (col) => col.defaultTo(1))
    .addColumn("effects", "jsonb", (col) => col.defaultTo(sql`'[]'`))
    .execute();

  await sql`CREATE INDEX idx_account_bank_items_account_id
    ON account_bank_items(account_id)`.execute(db);

  await sql`DROP INDEX items_stack`.execute(db);
  await sql`DROP INDEX idx_items_owner`.execute(db);
  await sql`ALTER TABLE items DROP COLUMN effects_hash`.execute(db);
  await sql`ALTER TABLE items
    DROP CONSTRAINT items_template_id_fkey`.execute(db);
  await sql`ALTER TABLE items
    DROP CONSTRAINT chk_items_quantity_positive`.execute(db);

  await sql`ALTER TABLE items ADD COLUMN player_id bigint`.execute(db);
  await sql`UPDATE items SET player_id = owner_id
    WHERE owner_kind = ${sql.lit(OWNER_PLAYER)}`.execute(db);
  // Anything owned by a container `player_items` cannot express is
  // dropped: this direction is lossy by nature, which is the point of
  // going forward instead.
  await sql`DELETE FROM items WHERE player_id IS NULL`.execute(db);
  await sql`ALTER TABLE items ALTER COLUMN player_id SET NOT NULL`.execute(db);
  await sql`ALTER TABLE items
    ADD CONSTRAINT player_items_player_id_fkey
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE`.execute(
    db
  );

  await sql`ALTER TABLE items
    ALTER COLUMN template_id DROP NOT NULL,
    ALTER COLUMN quantity DROP NOT NULL,
    ALTER COLUMN effects DROP NOT NULL,
    ALTER COLUMN position DROP NOT NULL`.execute(db);

  await sql`ALTER TABLE items DROP COLUMN owner_id`.execute(db);
  await sql`ALTER TABLE items DROP COLUMN owner_kind`.execute(db);

  await sql`ALTER INDEX items_pkey RENAME TO player_items_pkey`.execute(db);
  await sql`ALTER SEQUENCE items_id_seq RENAME TO player_items_id_seq`.execute(
    db
  );
  await sql`ALTER TABLE items RENAME TO player_items`.execute(db);

  await sql`CREATE INDEX idx_player_items_player
    ON player_items(player_id)`.execute(db);
  await sql`CREATE INDEX idx_player_items_player_template
    ON player_items(player_id, template_id)`.execute(db);
}
