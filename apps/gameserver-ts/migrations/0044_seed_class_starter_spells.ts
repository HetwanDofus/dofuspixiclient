import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type Kysely, sql } from "kysely";

/**
 * Seeds `class_starter_spells` — the spells a freshly created character of
 * each class knows — from the canonical 1.29 lang bundles.
 *
 * The table has been empty since it was created in 0005, so nothing could
 * answer "what does a new Iop start with?". `scripts/dev-seed.ts` papered over
 * that by copying the *entire* `spell_templates` catalogue into
 * `player_spells`, which is why a level-1 test character owns all 2 091 spells
 * in the game and the server rebuilds that list on every map change.
 *
 * Two bundles, one row each:
 *
 *   classes.json  `G[classId].s` — the breed's own spell ids, 21 per class,
 *                 in the order the client lists them.
 *   spells.json   `S[spellId].l1[2]` — minimum *player* level for spell
 *                 level 1. A starter spell is one that asks for level 1.
 *
 * That gives three spells per class, matching retail 1.29 (an Iop starts with
 * Pression, Bond and Intimidation). `position` is the spell-bar slot, numbered
 * in the bundle's own order.
 *
 * Note the breed → spell-id ranges in 0037 are *not* usable here: they are
 * 2.x ranges. 101-111 is Ecaflip in 1.29, not Iop.
 */

const CLASSES_RELATIVE = "../../../assets/dist/langs/fr/classes.json";
const SPELLS_RELATIVE = "../../../assets/dist/langs/fr/spells.json";

/** Index of `minPlayerLevel` in a spell's positional level array — see 0039. */
const MIN_PLAYER_LEVEL_INDEX = 2;

function langPath(relative: string): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), relative);
}

async function readBundle<T>(relative: string): Promise<T> {
  const raw = await readFile(langPath(relative), "utf8");
  return (JSON.parse(raw) as { data?: T }).data ?? ({} as T);
}

interface StarterSpell {
  class_id: number;
  spell_id: number;
  level: number;
  position: number;
}

export async function up(db: Kysely<never>): Promise<void> {
  const classes = await readBundle<{
    G?: Record<string, { s?: number[] }>;
  }>(CLASSES_RELATIVE);
  const spells = await readBundle<{
    S?: Record<string, Record<string, unknown>>;
  }>(SPELLS_RELATIVE);

  const breeds = classes.G ?? {};
  const catalogue = spells.S ?? {};
  const rows: StarterSpell[] = [];
  const unknown: number[] = [];

  for (const [classIdStr, breed] of Object.entries(breeds)) {
    const classId = Number.parseInt(classIdStr, 10);
    if (!Number.isFinite(classId)) {
      continue;
    }

    let position = 1;

    for (const spellId of breed.s ?? []) {
      const level1 = catalogue[String(spellId)]?.l1;
      if (!Array.isArray(level1)) {
        unknown.push(spellId);
        continue;
      }
      if (Number(level1[MIN_PLAYER_LEVEL_INDEX]) !== 1) {
        continue;
      }

      rows.push({
        class_id: classId,
        spell_id: spellId,
        level: 1,
        position: position++,
      });
    }
  }

  if (unknown.length > 0) {
    console.warn(
      `[0044] ${unknown.length} breed spells are absent from spells.json ` +
        `(${unknown.slice(0, 8).join(", ")}…)`
    );
  }

  if (rows.length === 0) {
    console.warn("[0044] no starter spells derived — lang bundles missing?");
    return;
  }

  await db
    .insertInto("class_starter_spells" as never)
    .values(rows as never)
    .onConflict((oc) =>
      oc.columns(["class_id", "spell_id"]).doUpdateSet({
        level: sql.ref("excluded.level"),
        position: sql.ref("excluded.position"),
      } as never)
    )
    .execute();

  console.log(
    `[0044] seeded ${rows.length} starter spells across ` +
      `${new Set(rows.map((r) => r.class_id)).size} classes`
  );
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`DELETE FROM class_starter_spells`.execute(db);
}
