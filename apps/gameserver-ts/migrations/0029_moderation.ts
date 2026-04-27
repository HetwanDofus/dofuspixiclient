import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS banned_until timestamptz`.execute(
    db
  );
  await sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ban_reason text`.execute(
    db
  );

  await sql`
    CREATE INDEX IF NOT EXISTS accounts_banned_until_idx ON accounts(banned_until) WHERE banned_until IS NOT NULL
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS banned_ips (
      ip inet PRIMARY KEY,
      banned_until timestamptz,
      reason text,
      banned_by_admin_id bigint,
      created_at timestamptz DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_banned_ips_banned_until ON banned_ips(banned_until)
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS muted_players (
      player_id bigint,
      channel smallint,
      muted_until timestamptz,
      reason text,
      created_at timestamptz DEFAULT now(),
      PRIMARY KEY (player_id, channel)
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_muted_players_muted_until ON muted_players(muted_until)
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS player_jail (
      player_id bigint PRIMARY KEY,
      jail_map_id integer,
      jail_cell_id integer DEFAULT 0,
      previous_map_id integer,
      previous_cell_id integer,
      jailed_until timestamptz,
      jailed_by_admin_id bigint,
      reason text,
      created_at timestamptz DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_player_jail_jailed_until ON player_jail(jailed_until)
  `.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("player_jail").ifExists().execute();
  await db.schema.dropTable("muted_players").ifExists().execute();
  await db.schema.dropTable("banned_ips").ifExists().execute();

  await sql`ALTER TABLE accounts DROP COLUMN IF EXISTS ban_reason`.execute(db);
  await sql`ALTER TABLE accounts DROP COLUMN IF EXISTS banned_until`.execute(
    db
  );
}
