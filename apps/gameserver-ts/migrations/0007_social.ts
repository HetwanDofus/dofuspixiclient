import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  // friends
  await db.schema
    .createTable("friends")
    .addColumn("account_id", "bigint", (col) =>
      col.notNull().references("accounts.id").onDelete("cascade")
    )
    .addColumn("friend_id", "bigint", (col) =>
      col.notNull().references("accounts.id").onDelete("cascade")
    )
    .addColumn("added_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .addPrimaryKeyConstraint("pk_friends", ["account_id", "friend_id"])
    .execute();

  await sql`ALTER TABLE friends ADD CONSTRAINT chk_friends_self CHECK(account_id <> friend_id)`.execute(
    db
  );

  // enemies
  await db.schema
    .createTable("enemies")
    .addColumn("account_id", "bigint", (col) =>
      col.notNull().references("accounts.id").onDelete("cascade")
    )
    .addColumn("enemy_id", "bigint", (col) =>
      col.notNull().references("accounts.id").onDelete("cascade")
    )
    .addColumn("added_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .addPrimaryKeyConstraint("pk_enemies", ["account_id", "enemy_id"])
    .execute();

  await sql`ALTER TABLE enemies ADD CONSTRAINT chk_enemies_self CHECK(account_id <> enemy_id)`.execute(
    db
  );

  // guilds
  await db.schema
    .createTable("guilds")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("server_id", "integer", (col) =>
      col.notNull().references("game_servers.id").onDelete("cascade")
    )
    .addColumn("name", sql`VARCHAR(64)`)
    .addColumn("emblem", "jsonb", (col) => col.defaultTo("{}"))
    .addColumn("level", "smallint", (col) => col.defaultTo(1))
    .addColumn("experience", "bigint", (col) => col.defaultTo(0))
    .addColumn("bank_kamas", "bigint", (col) => col.defaultTo(0))
    .addColumn("founder_id", "bigint", (col) =>
      col.references("players.id").onDelete("set null")
    )
    .addColumn("created_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .addUniqueConstraint("uq_guilds_server_name", ["server_id", "name"])
    .execute();

  // guild_members
  await db.schema
    .createTable("guild_members")
    .addColumn("guild_id", "bigint", (col) =>
      col.notNull().references("guilds.id").onDelete("cascade")
    )
    .addColumn("player_id", "bigint", (col) =>
      col.notNull().references("players.id").onDelete("cascade")
    )
    .addColumn("rank", "smallint", (col) => col.defaultTo(0))
    .addColumn("rights", "bigint", (col) => col.defaultTo(0))
    .addColumn("xp_share", "smallint", (col) => col.defaultTo(0))
    .addColumn("joined_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .addPrimaryKeyConstraint("pk_guild_members", ["guild_id", "player_id"])
    .execute();

  await sql`CREATE INDEX idx_guild_members_player ON guild_members(player_id)`.execute(
    db
  );

  // guild_ranks
  await db.schema
    .createTable("guild_ranks")
    .addColumn("guild_id", "bigint", (col) =>
      col.notNull().references("guilds.id").onDelete("cascade")
    )
    .addColumn("rank_id", "smallint", (col) => col.notNull())
    .addColumn("name", sql`VARCHAR(48)`)
    .addPrimaryKeyConstraint("pk_guild_ranks", ["guild_id", "rank_id"])
    .execute();

  // guild_tax_collectors
  await db.schema
    .createTable("guild_tax_collectors")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("guild_id", "bigint", (col) =>
      col.notNull().references("guilds.id").onDelete("cascade")
    )
    .addColumn("map_id", "integer")
    .addColumn("cell_id", "integer")
    .addColumn("kamas", "bigint", (col) => col.defaultTo(0))
    .addColumn("items", "jsonb", (col) => col.defaultTo("[]"))
    .addColumn("spawned_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .addUniqueConstraint("uq_tax_collectors_map_cell", ["map_id", "cell_id"])
    .execute();
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("guild_tax_collectors").execute();
  await db.schema.dropTable("guild_ranks").execute();
  await db.schema.dropTable("guild_members").execute();
  await db.schema.dropTable("guilds").execute();
  await db.schema.dropTable("enemies").execute();
  await db.schema.dropTable("friends").execute();
}
