import { type Kysely, sql } from "kysely";

/**
 * Kamas held by a container, for any kind of container.
 *
 * `account_banks` could only answer "how many kamas does this *account*
 * hold", which made the kamas half of the storage window dead the moment
 * it was opened on a house chest rather than a bank — the only two
 * holders `KamasTransferService` recognised were the player and the
 * bank, so a deposit into a chest was refused as `unsupported-owner`
 * with nothing on screen to say why.
 *
 * 1.29 shows a balance on both sides of the `Storage` window whatever it
 * was opened on (`showKamas` is cleared only for a mount), so the fix is
 * not to hide the field: it is to let a container hold kamas.
 *
 * Keyed the same way `items` is keyed, and for the same reason. A
 * merchant stall and a tax collector both hold kamas too, and each of
 * them is now a row here rather than another table with another balance
 * column and another repository to go with it.
 *
 * `account_banks` is empty in every environment, but the copy is written
 * anyway: a migration that silently drops money is not one anybody
 * should have to read twice to trust.
 */

/** Mirrors `items/item-owner.ts`. */
const OWNER_BANK = 2;

export async function up(db: Kysely<never>): Promise<void> {
  await db.schema
    .createTable("container_kamas")
    .addColumn("owner_kind", "smallint", (col) => col.notNull())
    .addColumn("owner_id", "bigint", (col) => col.notNull())
    .addColumn("kamas", "bigint", (col) => col.notNull().defaultTo(0))
    .addPrimaryKeyConstraint("pk_container_kamas", ["owner_kind", "owner_id"])
    .execute();

  await sql`ALTER TABLE container_kamas
    ADD CONSTRAINT chk_container_kamas_non_negative
    CHECK (kamas >= 0)`.execute(db);

  await sql`
    INSERT INTO container_kamas (owner_kind, owner_id, kamas)
    SELECT ${sql.lit(OWNER_BANK)}, account_id, kamas FROM account_banks
  `.execute(db);

  await db.schema.dropTable("account_banks").execute();
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema
    .createTable("account_banks")
    .addColumn("account_id", "bigint", (col) =>
      col.primaryKey().references("accounts.id").onDelete("cascade")
    )
    .addColumn("kamas", "bigint", (col) => col.defaultTo(0))
    .execute();

  await sql`ALTER TABLE account_banks
    ADD CONSTRAINT chk_account_banks_kamas_non_negative
    CHECK (kamas >= 0)`.execute(db);

  // Only the bank's own balances have somewhere to go back to; a chest's
  // kamas have no column in the old shape. This direction is lossy, which
  // is the point of going forward instead.
  await sql`
    INSERT INTO account_banks (account_id, kamas)
    SELECT owner_id, kamas FROM container_kamas
     WHERE owner_kind = ${sql.lit(OWNER_BANK)}
  `.execute(db);

  await db.schema.dropTable("container_kamas").execute();
}
