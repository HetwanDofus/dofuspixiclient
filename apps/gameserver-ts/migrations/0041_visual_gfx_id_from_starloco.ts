import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type Kysely, sql } from "kysely";

/**
 * Imports the canonical spell → visual gfx mapping from the StarLoco
 * `sorts` table. Each row in StarLoco's `sorts` has a `sprite` column
 * that holds the SWF/dofasset filename the original Dofus 1.29 client
 * loaded for that spell — that's the only authoritative source for the
 * spellId → gfxId bridge (Hetwan's GA;300 `visual` field carries this).
 *
 * Input: `assets/sources/starloco/sorts.sql` (mysqldump --compact).
 * We parse only the `id` and `sprite` columns from each INSERT row;
 * the rest of the canonical fields can land in a follow-up migration
 * once we agree on the encoding for effects/levels/zones.
 *
 * sprite = -1 means "no spell-specific visual" (e.g. Coup de Poing
 * uses the character's own basic-attack pose). We coalesce -1 → NULL
 * in the DB, and the runtime falls back to spell_id (which renders as
 * "loadSpell returned null → no visual" — matches AS2 behaviour).
 */
export async function up(db: Kysely<never>): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const sortsPath = resolve(
    here,
    "../../../assets/sources/starloco/sorts.sql"
  );

  let raw: string;
  try {
    raw = await readFile(sortsPath, "utf8");
  } catch (err) {
    console.warn(
      `[0041] sorts.sql missing at ${sortsPath} — skipping import. ` +
        `Drop the file in place and re-run to apply the canonical mapping.`
    );
    return;
  }

  // Parse INSERT lines. mysqldump --compact emits one INSERT per row:
  //   INSERT INTO `sorts` VALUES (128,'Mot…',707,'11,1,1','5;1;-1…',…);
  // We only need the FIRST integer (id) and THIRD value (sprite).
  // The `name` column is a quoted string that may contain escaped
  // quotes/commas; skip it cleanly by walking the string.
  const pairs: { id: number; sprite: number }[] = [];
  const lineRe = /^INSERT INTO `sorts` VALUES \((.*)\);\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(raw)) !== null) {
    const tuple = m[1] ?? "";
    const parsed = parseFirstThree(tuple);
    if (!parsed) continue;
    if (parsed.sprite < 0) continue; // sprite=-1 = no spell-specific visual
    pairs.push(parsed);
  }

  if (pairs.length === 0) {
    console.warn("[0041] sorts.sql parsed but no rows extracted");
    return;
  }

  // Bulk update via a VALUES table. We chunk to avoid pg parameter limits.
  const chunkSize = 500;
  let updated = 0;
  for (let i = 0; i < pairs.length; i += chunkSize) {
    const chunk = pairs.slice(i, i + chunkSize);
    const values = sql.join(
      chunk.map(({ id, sprite }) => sql`(${id}::int, ${sprite}::int)`),
      sql`, `
    );
    const result = await sql`
      WITH mapping(spell_id, sprite) AS (VALUES ${values})
      UPDATE spell_levels sl
      SET visual_gfx_id = mapping.sprite
      FROM mapping
      WHERE sl.spell_id = mapping.spell_id
    `.execute(db);
    updated += Number(result.numAffectedRows ?? 0);
  }

  console.log(
    `[0041] StarLoco sorts → spell_levels.visual_gfx_id: ` +
      `${pairs.length} mappings, ${updated} level rows updated`
  );
}

export async function down(_db: Kysely<never>): Promise<void> {
  // Data-only update; rollback is a no-op (the prior values were
  // backfilled in 0040 from spell_id, but we don't try to restore that).
}

/**
 * Walk a tuple body to grab the 1st (int), 2nd (string), 3rd (int).
 * MySQL string literals in mysqldump are single-quoted with backslash
 * escapes, so we honour those when scanning past the name column.
 */
function parseFirstThree(
  body: string
): { id: number; sprite: number } | null {
  let pos = 0;
  // 1st value: id (int up to first comma)
  const comma1 = body.indexOf(",", pos);
  if (comma1 < 0) return null;
  const id = Number.parseInt(body.slice(0, comma1).trim(), 10);
  if (!Number.isFinite(id)) return null;
  pos = comma1 + 1;

  // 2nd value: name (single-quoted string, may contain escaped quotes)
  while (pos < body.length && body[pos] === " ") pos++;
  if (body[pos] !== "'") return null;
  pos++; // consume opening quote
  while (pos < body.length) {
    const ch = body[pos];
    if (ch === "\\") {
      pos += 2;
      continue;
    }
    if (ch === "'") {
      pos++;
      break;
    }
    pos++;
  }

  // expect comma + spaces + sprite int
  while (pos < body.length && (body[pos] === " " || body[pos] === ",")) pos++;
  const comma3 = body.indexOf(",", pos);
  if (comma3 < 0) return null;
  const sprite = Number.parseInt(body.slice(pos, comma3).trim(), 10);
  if (!Number.isFinite(sprite)) return null;

  return { id, sprite };
}
