import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await db.schema
    .createTable("auth_queue")
    .addColumn("ticket", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn("account_id", "bigint", (col) =>
      col.notNull().references("accounts.id").onDelete("cascade")
    )
    .addColumn("enqueued_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .addColumn("promoted_at", "timestamptz")
    .execute();

  await sql`CREATE INDEX idx_auth_queue_enqueued ON auth_queue(enqueued_at) WHERE promoted_at IS NULL`.execute(
    db
  );
  await sql`CREATE UNIQUE INDEX idx_auth_queue_account_id ON auth_queue(account_id) WHERE promoted_at IS NULL`.execute(
    db
  );

  await db.schema
    .createTable("gifts")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("title", "varchar(128)")
    .addColumn("description", "text", (col) => col.defaultTo(""))
    .addColumn("gfx_url", "text", (col) => col.defaultTo(""))
    .addColumn("items", "jsonb", (col) => col.defaultTo(sql`'[]'`))
    .addColumn("expires_at", "timestamptz")
    .execute();

  await db.schema
    .createTable("account_gifts")
    .addColumn("account_id", "bigint", (col) =>
      col.notNull().references("accounts.id").onDelete("cascade")
    )
    .addColumn("gift_id", "integer", (col) =>
      col.notNull().references("gifts.id").onDelete("cascade")
    )
    .addColumn("claimed", "boolean", (col) => col.defaultTo(false))
    .addColumn("claimed_at", "timestamptz")
    .addPrimaryKeyConstraint("pk_account_gifts", ["account_id", "gift_id"])
    .execute();

  await db.schema
    .createTable("keys")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("kind", "smallint")
    .addColumn("code", "varchar(64)", (col) => col.unique())
    .addColumn("reward", "jsonb", (col) => col.defaultTo(sql`'{}'`))
    .addColumn("expires_at", "timestamptz")
    .execute();

  await db.schema
    .createTable("account_keys")
    .addColumn("account_id", "bigint", (col) =>
      col.notNull().references("accounts.id").onDelete("cascade")
    )
    .addColumn("key_id", "integer", (col) =>
      col.notNull().references("keys.id").onDelete("cascade")
    )
    .addColumn("used_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .addPrimaryKeyConstraint("pk_account_keys", ["account_id", "key_id"])
    .execute();

  await db.schema
    .createTable("banishments")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("account_id", "bigint", (col) =>
      col.notNull().references("accounts.id").onDelete("cascade")
    )
    .addColumn("banned_by", "bigint", (col) =>
      col.references("accounts.id").onDelete("set null")
    )
    .addColumn("reason", "varchar(255)", (col) => col.defaultTo(""))
    .addColumn("expires_at", "timestamptz")
    .addColumn("permanent", "boolean", (col) => col.defaultTo(false))
    .addColumn("created_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .execute();

  await sql`CREATE INDEX idx_banishments_account_id ON banishments(account_id)`.execute(
    db
  );
  await sql`CREATE INDEX idx_banishments_expires_at ON banishments(expires_at)`.execute(
    db
  );

  await db.schema
    .createTable("ban_ips")
    .addColumn("ip", sql`INET`, (col) => col.primaryKey())
    .addColumn("reason", "varchar(255)", (col) => col.defaultTo(""))
    .addColumn("expires_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable("connection_logs")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("account_id", "bigint", (col) =>
      col.notNull().references("accounts.id").onDelete("cascade")
    )
    .addColumn("ip", sql`INET`)
    .addColumn("at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .execute();

  await sql`CREATE INDEX idx_connection_logs_at ON connection_logs(account_id, at DESC)`.execute(
    db
  );

  await db.schema
    .createTable("character_migrations")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("player_id", "bigint", (col) =>
      col.notNull().references("players.id").onDelete("cascade")
    )
    .addColumn("source_server_id", "integer", (col) =>
      col.notNull().references("game_servers.id").onDelete("cascade")
    )
    .addColumn("target_server_id", "integer", (col) =>
      col.notNull().references("game_servers.id").onDelete("cascade")
    )
    .addColumn("requested_at", "timestamptz", (col) =>
      col.defaultTo(sql`now()`)
    )
    .addColumn("completed_at", "timestamptz")
    .addColumn("state", "smallint", (col) => col.defaultTo(0))
    .execute();

  await sql`CREATE INDEX idx_character_migrations_player ON character_migrations(player_id) WHERE completed_at IS NULL`.execute(
    db
  );

  await sql`ALTER TABLE game_servers ADD COLUMN accepts_migration boolean DEFAULT false`.execute(
    db
  );
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`ALTER TABLE game_servers DROP COLUMN accepts_migration`.execute(db);
  await db.schema.dropTable("character_migrations").execute();
  await db.schema.dropTable("connection_logs").execute();
  await db.schema.dropTable("ban_ips").execute();
  await db.schema.dropTable("banishments").execute();
  await db.schema.dropTable("account_keys").execute();
  await db.schema.dropTable("keys").execute();
  await db.schema.dropTable("account_gifts").execute();
  await db.schema.dropTable("gifts").execute();
  await db.schema.dropTable("auth_queue").execute();
}
