import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await db.schema
    .createTable("houses")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("map_id", "integer")
    .addColumn("cell_id", "integer")
    .addColumn("price", "bigint")
    .addColumn("owner_id", "bigint", (col) =>
      col.references("players.id").onDelete("set null")
    )
    .addColumn("guild_id", "bigint", (col) =>
      col.references("guilds.id").onDelete("set null")
    )
    .addColumn("locked", "boolean", (col) => col.defaultTo(false))
    .addColumn("lock_code", "varchar(16)", (col) => col.defaultTo(""))
    .addColumn("doors", "jsonb", (col) => col.defaultTo(sql`'[]'`))
    .addColumn("purchased_at", "timestamptz")
    .execute();

  await sql`ALTER TABLE houses ADD CONSTRAINT check_house_owner_or_guild CHECK (owner_id IS NULL OR guild_id IS NULL)`.execute(
    db
  );
  await sql`CREATE UNIQUE INDEX idx_houses_map_cell ON houses(map_id, cell_id)`.execute(
    db
  );
  await sql`CREATE INDEX idx_houses_owner_id ON houses(owner_id) WHERE owner_id IS NOT NULL`.execute(
    db
  );
  await sql`CREATE INDEX idx_houses_guild_id ON houses(guild_id) WHERE guild_id IS NOT NULL`.execute(
    db
  );

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

  await sql`CREATE INDEX idx_house_storage_items_house_id ON house_storage_items(house_id)`.execute(
    db
  );

  await db.schema
    .createTable("prisms")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("subarea_id", "integer", (col) =>
      col.notNull().references("subareas.id").onDelete("cascade")
    )
    .addColumn("map_id", "integer")
    .addColumn("cell_id", "integer")
    .addColumn("alignment", "smallint")
    .addColumn("level", "smallint", (col) => col.defaultTo(1))
    .addColumn("hp", "integer")
    .addColumn("max_hp", "integer")
    .addColumn("state", "smallint", (col) => col.defaultTo(0))
    .addColumn("vulnerable_at", "timestamptz")
    .addColumn("last_attacked_at", "timestamptz")
    .addColumn("placed_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .execute();

  await sql`CREATE UNIQUE INDEX idx_prisms_subarea_id ON prisms(subarea_id)`.execute(
    db
  );
  await sql`CREATE INDEX idx_prisms_state ON prisms(state)`.execute(db);

  await db.schema
    .createTable("prism_modules")
    .addColumn("prism_id", "bigint", (col) =>
      col.notNull().references("prisms.id").onDelete("cascade")
    )
    .addColumn("slot", "smallint", (col) => col.notNull())
    .addColumn("module_id", "integer")
    .addPrimaryKeyConstraint("pk_prism_modules", ["prism_id", "slot"])
    .execute();

  await db.schema
    .createTable("alignment_balance")
    .addColumn("server_id", "integer", (col) =>
      col.primaryKey().references("game_servers.id").onDelete("cascade")
    )
    .addColumn("bontarian_players", "integer", (col) => col.defaultTo(0))
    .addColumn("brakmarian_players", "integer", (col) => col.defaultTo(0))
    .addColumn("neutrality_index", "integer", (col) => col.defaultTo(0))
    .addColumn("updated_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable("player_alignment_ledger")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("player_id", "bigint", (col) =>
      col.notNull().references("players.id").onDelete("cascade")
    )
    .addColumn("delta_honor", "integer", (col) => col.defaultTo(0))
    .addColumn("delta_disgrace", "integer", (col) => col.defaultTo(0))
    .addColumn("reason", "smallint")
    .addColumn("fight_id", "bigint", (col) =>
      col.references("fight_history.id").onDelete("set null")
    )
    .addColumn("at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .execute();

  await sql`CREATE INDEX idx_player_alignment_ledger_at ON player_alignment_ledger(player_id, at DESC)`.execute(
    db
  );
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("player_alignment_ledger").execute();
  await db.schema.dropTable("alignment_balance").execute();
  await db.schema.dropTable("prism_modules").execute();
  await db.schema.dropTable("prisms").execute();
  await db.schema.dropTable("house_storage_items").execute();
  await db.schema.dropTable("houses").execute();
}
