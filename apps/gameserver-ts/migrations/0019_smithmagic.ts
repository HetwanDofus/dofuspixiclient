import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await sql`
    ALTER TABLE runes_templates
    ADD COLUMN effect_id smallint DEFAULT 0,
    ADD COLUMN min_value integer DEFAULT 0,
    ADD COLUMN max_value integer DEFAULT 0
  `.execute(db);

  await sql`
    CREATE INDEX idx_runes_templates_effect ON runes_templates(effect_id)
  `.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`
    DROP INDEX IF EXISTS idx_runes_templates_effect
  `.execute(db);

  await sql`
    ALTER TABLE runes_templates
    DROP COLUMN effect_id,
    DROP COLUMN min_value,
    DROP COLUMN max_value
  `.execute(db);
}
