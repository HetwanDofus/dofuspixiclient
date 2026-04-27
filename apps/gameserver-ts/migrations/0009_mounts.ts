import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await db.schema
    .createTable("mounts")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("player_id", "bigint", (col) =>
      col.references("players.id").onDelete("set null")
    )
    .addColumn("name", "varchar(48)", (col) => col.defaultTo(""))
    .addColumn("model_id", "integer")
    .addColumn("sex", "smallint")
    .addColumn("level", "smallint", (col) => col.defaultTo(1))
    .addColumn("experience", "bigint", (col) => col.defaultTo(0))
    .addColumn("energy", "integer", (col) => col.defaultTo(1000))
    .addColumn("maturity", "integer", (col) => col.defaultTo(0))
    .addColumn("serenity", "integer", (col) => col.defaultTo(0))
    .addColumn("stamina", "integer", (col) => col.defaultTo(1000))
    .addColumn("love", "integer", (col) => col.defaultTo(1000))
    .addColumn("fecundity", "integer", (col) => col.defaultTo(0))
    .addColumn("pregnant_until", "timestamptz")
    .addColumn("sterilized", "boolean", (col) => col.defaultTo(false))
    .addColumn("color1", "integer", (col) => col.defaultTo(-1))
    .addColumn("color2", "integer", (col) => col.defaultTo(-1))
    .addColumn("color3", "integer", (col) => col.defaultTo(-1))
    .addColumn("capacities", "jsonb", (col) => col.defaultTo(sql`'[]'`))
    .addColumn("last_fed_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .addColumn("born_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .execute();

  await sql`CREATE INDEX idx_mounts_player_id ON mounts(player_id)`.execute(db);

  await db.schema
    .createTable("mount_ancestors")
    .addColumn("mount_id", "bigint", (col) =>
      col.notNull().references("mounts.id").onDelete("cascade")
    )
    .addColumn("ancestor_id", "bigint", (col) => col.notNull())
    .addColumn("generation", "smallint")
    .addPrimaryKeyConstraint("pk_mount_ancestors", ["mount_id", "ancestor_id"])
    .execute();

  await db.schema
    .createTable("mount_paddocks")
    .addColumn("map_id", "integer", (col) => col.notNull())
    .addColumn("cell_id", "integer", (col) => col.notNull())
    .addColumn("guild_id", "bigint", (col) =>
      col.references("guilds.id").onDelete("set null")
    )
    .addColumn("mount_id", "bigint", (col) =>
      col.references("mounts.id").onDelete("set null")
    )
    .addPrimaryKeyConstraint("pk_mount_paddocks", ["map_id", "cell_id"])
    .execute();

  await sql`CREATE INDEX idx_mount_paddocks_guild_id ON mount_paddocks(guild_id)`.execute(
    db
  );
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("mount_paddocks").execute();
  await db.schema.dropTable("mount_ancestors").execute();
  await db.schema.dropTable("mounts").execute();
}
