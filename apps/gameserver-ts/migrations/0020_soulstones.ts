import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await sql`
    CREATE INDEX IF NOT EXISTS idx_player_items_player_template ON player_items(player_id, template_id)
  `.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`
    DROP INDEX IF EXISTS idx_player_items_player_template
  `.execute(db);
}
