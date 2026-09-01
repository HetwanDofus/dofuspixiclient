import { type Kysely, sql } from "kysely";

/**
 * Canonical `items.json` field `I.u[id].an` — the character animation used
 * by an equipped weapon/tool. A missing value means the roleplay default,
 * `anim3`; harvest actions send the resolved id so every observing client
 * can animate another player's tool without knowing their item template.
 */
export async function up(db: Kysely<never>): Promise<void> {
  await sql`
    ALTER TABLE item_templates
      ADD COLUMN IF NOT EXISTS animation_id smallint NOT NULL DEFAULT 3
  `.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`
    ALTER TABLE item_templates DROP COLUMN IF EXISTS animation_id
  `.execute(db);
}
