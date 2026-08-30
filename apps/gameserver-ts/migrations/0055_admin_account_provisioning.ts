import { type Kysely, sql } from "kysely";

/**
 * The ledger behind `POST /admin/accounts` (QA-126).
 *
 * An external control plane provisions a bot account over HTTP, and HTTP
 * retries: a timeout on the caller's side says nothing about whether the
 * transaction committed. Replaying the same call must therefore return the
 * same account rather than create a second one, which is what the
 * `Idempotency-Key` header buys — and a key is only worth something if the
 * server remembers it, hence this table.
 *
 * The claim row is inserted *first*, inside the same transaction that then
 * creates the account and the character, so two concurrent calls carrying
 * the same key serialise on the primary key: the loser waits on the
 * speculative insert, sees the committed row and replays its result. That
 * is also why `account_id` / `character_id` are nullable — they are filled
 * in at the end of the very transaction that inserted the row, so a
 * *visible* row always has them, and a rolled back attempt leaves nothing
 * at all behind.
 *
 * `request_hash` is a SHA-256 of the normalised request body. Reusing a key
 * with a different body is a caller bug, not a retry, and gets a 409.
 *
 * The unique index on `lower(pseudo)` is the other half of the contract:
 * the API must answer 409 for a pseudonym already taken, and a SELECT
 * cannot promise that under concurrency. Every account written so far sets
 * `pseudo` to the (already unique) username, so this constraint adopts the
 * existing data as it stands.
 */
export async function up(db: Kysely<never>): Promise<void> {
  await db.schema
    .createTable("provisioning_requests")
    .addColumn("idempotency_key", sql`VARCHAR(255)`, (col) => col.primaryKey())
    .addColumn("request_hash", sql`CHAR(64)`, (col) => col.notNull())
    .addColumn("account_id", "bigint", (col) =>
      col.references("accounts.id").onDelete("cascade")
    )
    .addColumn("character_id", "bigint", (col) =>
      col.references("players.id").onDelete("cascade")
    )
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute();

  await sql`CREATE UNIQUE INDEX uq_accounts_pseudo_lower
    ON accounts (lower(pseudo)) WHERE pseudo IS NOT NULL`.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`DROP INDEX IF EXISTS uq_accounts_pseudo_lower`.execute(db);
  await db.schema.dropTable("provisioning_requests").execute();
}
