import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await db.schema
    .createTable("account_banks")
    .addColumn("account_id", "bigint", (col) =>
      col.primaryKey().references("accounts.id").onDelete("cascade")
    )
    .addColumn("kamas", "bigint", (col) => col.defaultTo(0))
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

  await sql`CREATE INDEX idx_account_bank_items_account_id ON account_bank_items(account_id)`.execute(
    db
  );

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

  await db.schema
    .createTable("recipes")
    .addColumn("result_item_id", "integer", (col) => col.primaryKey())
    .addColumn("skill_id", "integer")
    .addColumn("skill_level", "smallint", (col) => col.defaultTo(1))
    .addColumn("ingredients", "jsonb", (col) => col.defaultTo(sql`'[]'`))
    .execute();
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("recipes").execute();
  await db.schema.dropTable("big_store_listings").execute();
  await db.schema.dropTable("account_bank_items").execute();
  await db.schema.dropTable("account_banks").execute();
}
