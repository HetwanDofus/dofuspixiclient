import { type Kysely, sql } from "kysely";

/**
 * Server-owned i18n storage. Every (namespace, entry_key, locale) triple
 * gets one row. This keeps the schema simple (one table) while the access
 * pattern stays O(1) — server code fetches translations by key via an index
 * lookup, same cost as a K/V.
 *
 * The source of truth is the asset-pipeline's `assets/dist/langs/<locale>/
 * <namespace>.json` bundles; `pipeline langs:server-sync` upserts server-
 * owned namespaces (items, spells, monsters, …) into this table.
 */
export async function up(db: Kysely<never>): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS i18n`.execute(db);

  await db.schema
    .withSchema("i18n")
    .createTable("translations")
    .addColumn("namespace", sql`VARCHAR(64)`, (col) => col.notNull())
    .addColumn("entry_key", sql`VARCHAR(256)`, (col) => col.notNull())
    .addColumn("locale", sql`VARCHAR(8)`, (col) => col.notNull())
    .addColumn("value", sql`TEXT`, (col) => col.notNull())
    .addColumn("updated_at", "timestamptz", (col) =>
      col.defaultTo(sql`now()`).notNull()
    )
    .addPrimaryKeyConstraint("i18n_translations_pk", [
      "namespace",
      "entry_key",
      "locale",
    ])
    .execute();

  // Namespace+locale covers the common "list all strings for this locale"
  // pattern server-side renders (NPC dialog, item tooltips in server logs).
  await sql`CREATE INDEX i18n_translations_ns_loc ON i18n.translations(namespace, locale)`.execute(
    db
  );
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.withSchema("i18n").dropTable("translations").execute();
  await sql`DROP SCHEMA IF EXISTS i18n CASCADE`.execute(db);
}
