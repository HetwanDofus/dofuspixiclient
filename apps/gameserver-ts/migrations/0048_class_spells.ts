import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type Kysely, sql } from "kysely";

/**
 * `class_spells` — the whole spell progression of a breed, not just what
 * it starts with.
 *
 * 0044 seeded `class_starter_spells`: the three spells a level-1
 * character of each class knows. That table answered "what does a new
 * Iop own?" and nothing else, and since no code path has ever inserted
 * into `player_spells`, three spells is also what an Iop owns at level
 * 200 — a level-101 Féca in this database had `Glyphe Agressif`,
 * `Attaque Naturelle` and `Armure Terrestre`, and none of the seventeen
 * spells it should have learned on the way up.
 *
 * The missing datum was the *learn level*. It comes from the same two
 * bundles 0044 already cross-references, and 0044 already read it — it
 * just threw away every row that did not say 1:
 *
 *   classes.json  `G[classId].s`   the breed's 21 spell ids, in the
 *                                  order the client lists them.
 *   spells.json   `S[spellId].l1[2]`  minimum *player* level for spell
 *                                  level 1 — i.e. when it is learned.
 *
 * So `class_spells` is `class_starter_spells` with the filter removed
 * and the level kept: 252 rows, 21 per class, learn levels 1 → 200. A
 * starter spell is now simply `learn_level = 1`, which is why
 * `class_starter_spells` is dropped here rather than left behind to
 * drift — one table, one truth. `dev-seed.ts` reads this one now.
 *
 * `position` is the spell-bar slot, numbered from 1 in learn order (ties
 * broken by the bundle's own order). That reproduces 0044's positions
 * for the three starters exactly — 17, 3, 6 → 1, 2, 3 for a Féca — so
 * existing spell bars do not shuffle.
 *
 * The migration then backfills every existing character: each one gets
 * the spells its class learns at or below its current level, at spell
 * level 1. Existing rows are left untouched (`do nothing`), so a spell
 * already upgraded to level 5 keeps its level and its chosen slot.
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

interface ClassSpell {
  class_id: number;
  spell_id: number;
  learn_level: number;
  position: number;
}

export async function up(db: Kysely<never>): Promise<void> {
  await db.schema
    .createTable("class_spells")
    .addColumn("class_id", "smallint", (col) => col.notNull())
    .addColumn("spell_id", "integer", (col) => col.notNull())
    .addColumn("learn_level", "integer", (col) => col.notNull().defaultTo(1))
    .addColumn("position", "smallint", (col) => col.notNull().defaultTo(-1))
    .addPrimaryKeyConstraint("pk_class_spells", ["class_id", "spell_id"])
    .execute();

  await db.schema
    .createIndex("idx_class_spells_learn_level")
    .on("class_spells")
    .columns(["class_id", "learn_level"])
    .execute();

  const rows = await deriveRows();

  if (rows.length === 0) {
    console.warn(
      "[0048] no class spells derived — lang bundles missing? " +
        "`class_spells` stays empty and nobody learns anything."
    );
    return;
  }

  await db
    .insertInto("class_spells" as never)
    .values(rows as never)
    .onConflict((oc) =>
      oc.columns(["class_id", "spell_id"]).doUpdateSet({
        learn_level: sql.ref("excluded.learn_level"),
        position: sql.ref("excluded.position"),
      } as never)
    )
    .execute();

  console.log(
    `[0048] seeded ${rows.length} class spells across ` +
      `${new Set(rows.map((r) => r.class_id)).size} classes`
  );

  // Backfill: every character owns what its class learns at or below its
  // level. `on conflict do nothing` protects upgraded spells and
  // hand-picked bar positions.
  const backfilled = await sql<{ count: string }>`
    WITH inserted AS (
      INSERT INTO player_spells (player_id, spell_id, level, position)
      SELECT p.id, cs.spell_id, 1, cs.position
      FROM players p
      JOIN class_spells cs
        ON cs.class_id = p.class
       AND cs.learn_level <= p.level
      WHERE p.deleted_at IS NULL
      ON CONFLICT (player_id, spell_id) DO NOTHING
      RETURNING 1
    )
    SELECT count(*)::text AS count FROM inserted
  `.execute(db);

  console.log(
    `[0048] backfilled ${backfilled.rows[0]?.count ?? 0} player spells`
  );

  await db.schema.dropTable("class_starter_spells").execute();
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema
    .createTable("class_starter_spells")
    .addColumn("class_id", "smallint", (col) => col.notNull())
    .addColumn("spell_id", "integer", (col) => col.notNull())
    .addColumn("level", "smallint", (col) => col.defaultTo(1))
    .addColumn("position", "smallint", (col) => col.defaultTo(-1))
    .addPrimaryKeyConstraint("pk_class_starter_spells", [
      "class_id",
      "spell_id",
    ])
    .execute();

  // Rebuild 0044's table from this one — a starter is a spell learned at
  // level 1 — so rolling back does not leave the seed script mute.
  await sql`
    INSERT INTO class_starter_spells (class_id, spell_id, level, position)
    SELECT class_id, spell_id, 1, position
    FROM class_spells
    WHERE learn_level = 1
  `.execute(db);

  await db.schema.dropTable("class_spells").execute();
}

/**
 * One row per (class, spell), ordered by learn level so `position`
 * numbers the spell bar the way a character fills it in: the three
 * starters first, then each spell as it is unlocked.
 */
async function deriveRows(): Promise<ClassSpell[]> {
  const classes = await readBundle<{
    G?: Record<string, { s?: number[] }>;
  }>(CLASSES_RELATIVE);
  const spells = await readBundle<{
    S?: Record<string, Record<string, unknown>>;
  }>(SPELLS_RELATIVE);

  const breeds = classes.G ?? {};
  const catalogue = spells.S ?? {};
  const rows: ClassSpell[] = [];
  const unknown: number[] = [];

  for (const [classIdStr, breed] of Object.entries(breeds)) {
    const classId = Number.parseInt(classIdStr, 10);
    if (!Number.isFinite(classId)) {
      continue;
    }

    const learned: Array<{ spellId: number; learnLevel: number }> = [];

    for (const spellId of breed.s ?? []) {
      const level1 = catalogue[String(spellId)]?.l1;
      if (!Array.isArray(level1)) {
        unknown.push(spellId);
        continue;
      }

      const learnLevel = Number(level1[MIN_PLAYER_LEVEL_INDEX]);
      learned.push({
        spellId,
        learnLevel: Number.isFinite(learnLevel) ? learnLevel : 1,
      });
    }

    // Stable: same learn level → the bundle's order, which is the order
    // 0044 numbered the starters in.
    learned.sort((a, b) => a.learnLevel - b.learnLevel);

    learned.forEach((spell, index) => {
      rows.push({
        class_id: classId,
        spell_id: spell.spellId,
        learn_level: spell.learnLevel,
        position: index + 1,
      });
    });
  }

  if (unknown.length > 0) {
    console.warn(
      `[0048] ${unknown.length} breed spells are absent from spells.json ` +
        `(${unknown.slice(0, 8).join(", ")}…)`
    );
  }

  return rows;
}
