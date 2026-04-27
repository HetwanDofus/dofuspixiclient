import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await sql`ALTER TABLE mounts ADD COLUMN IF NOT EXISTS reproduction_count integer DEFAULT 0`.execute(
    db
  );

  await sql`
    CREATE TABLE IF NOT EXISTS mount_paddock_data (
      map_id integer PRIMARY KEY,
      owner_id bigint REFERENCES players(id) ON DELETE SET NULL,
      guild_id bigint REFERENCES guilds(id) ON DELETE SET NULL,
      size integer DEFAULT 0,
      price bigint DEFAULT 0,
      price_base bigint DEFAULT 0,
      place_of_spawn integer DEFAULT -1,
      door_cell integer DEFAULT -1,
      anchor_cell integer DEFAULT -1,
      max_object integer DEFAULT 0,
      allowed_cells INTEGER[] NOT NULL DEFAULT '{}',
      allowed_object_ids INTEGER[] NOT NULL DEFAULT '{}',
      updated_at timestamptz DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_mount_paddock_data_guild_id ON mount_paddock_data(guild_id)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_mount_paddock_data_owner_id ON mount_paddock_data(owner_id)
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS mount_breeding_log (
      id bigserial PRIMARY KEY,
      player_id bigint REFERENCES players(id) ON DELETE CASCADE,
      sire_id bigint,
      dam_id bigint,
      child_id bigint,
      offspring smallint,
      bred_at timestamptz DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_mount_breeding_log_player_id ON mount_breeding_log(player_id)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_mount_breeding_log_sire_id ON mount_breeding_log(sire_id)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_mount_breeding_log_dam_id ON mount_breeding_log(dam_id)
  `.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("mount_breeding_log").ifExists().execute();
  await db.schema.dropTable("mount_paddock_data").ifExists().execute();

  await sql`ALTER TABLE mounts DROP COLUMN IF EXISTS reproduction_count`.execute(
    db
  );
}
