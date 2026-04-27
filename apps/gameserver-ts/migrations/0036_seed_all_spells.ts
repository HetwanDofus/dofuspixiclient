import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await sql`
    INSERT INTO player_spells (player_id, spell_id, level, position)
    SELECT p.id, st.id, 1, -1
    FROM players p
    CROSS JOIN spell_templates st
    ON CONFLICT (player_id, spell_id) DO NOTHING
  `.execute(db);
}

export async function down(_db: Kysely<never>): Promise<void> {}
