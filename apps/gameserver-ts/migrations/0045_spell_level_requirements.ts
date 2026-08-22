import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type Kysely, sql } from "kysely";

/**
 * Adds the two `spell_levels` columns the spell book needs and that
 * nothing in the cast path reads:
 *
 *   min_player_level        "Niveau requis: 101" in the detail panel, and
 *                           the gate on the `+` upgrade button.
 *   crit_failure_ends_turn  "EC fini le tour" in "Autres caractéristiques".
 *
 * Both live in the canonical lang JSON that 0039 already seeds from —
 * slots [2] and [1] of the `lN` array — but 0039 dropped them because
 * only the combat resolver consumed spell_levels at the time.
 *
 * Seeding them from the same file rather than hard-coding a level curve
 * keeps them customisable: a custom server tunes the requirement per
 * (spell, level) row and both the panel and the upgrade handler follow.
 *
 * See 0039 for the full lN slot layout.
 */

const LANG_RELATIVE = "../../../assets/dist/langs/fr/spells.json";

function langPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, LANG_RELATIVE);
}

interface LangSpell {
  [key: string]: unknown;
}

interface RequirementRow {
  spellId: number;
  level: number;
  minPlayerLevel: number;
  critFailureEndsTurn: boolean;
}

export async function up(db: Kysely<never>): Promise<void> {
  await db.schema
    .alterTable("spell_levels")
    .addColumn("min_player_level", "integer", (col) =>
      col.notNull().defaultTo(1)
    )
    .execute();

  await db.schema
    .alterTable("spell_levels")
    .addColumn("crit_failure_ends_turn", "boolean", (col) =>
      col.notNull().defaultTo(false)
    )
    .execute();

  const raw = await readFile(langPath(), "utf8");
  const parsed = JSON.parse(raw) as {
    data?: { S?: Record<string, LangSpell> };
  };
  const spells = parsed.data?.S ?? {};

  const rows: RequirementRow[] = [];
  for (const [idStr, spell] of Object.entries(spells)) {
    const spellId = Number.parseInt(idStr, 10);
    if (!Number.isFinite(spellId)) {
      continue;
    }
    for (let level = 1; level <= 6; level++) {
      const l = spell[`l${level}`];
      if (!Array.isArray(l) || l.length < 21) {
        continue;
      }
      const minPlayerLevel =
        typeof l[2] === "number" && Number.isFinite(l[2]) ? l[2] : 1;
      rows.push({
        spellId,
        level,
        // Slot [1] is the "critical failure ends the turn" flag.
        minPlayerLevel: Math.max(1, minPlayerLevel),
        critFailureEndsTurn: l[1] === true,
      });
    }
  }

  // One UPDATE ... FROM (VALUES ...) per chunk: 12 000-odd rows would be
  // 12 000 round-trips as individual statements.
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = sql.join(
      chunk.map(
        (r) =>
          sql`(${r.spellId}::integer, ${r.level}::integer, ${r.minPlayerLevel}::integer, ${r.critFailureEndsTurn}::boolean)`
      )
    );
    await sql`
      UPDATE spell_levels AS sl
      SET min_player_level = v.min_player_level,
          crit_failure_ends_turn = v.crit_failure_ends_turn
      FROM (VALUES ${values})
        AS v(spell_id, level, min_player_level, crit_failure_ends_turn)
      WHERE sl.spell_id = v.spell_id AND sl.level = v.level
    `.execute(db);
  }

  console.log(`[0045] seeded level requirements for ${rows.length} rows`);
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema
    .alterTable("spell_levels")
    .dropColumn("crit_failure_ends_turn")
    .execute();
  await db.schema
    .alterTable("spell_levels")
    .dropColumn("min_player_level")
    .execute();
}
