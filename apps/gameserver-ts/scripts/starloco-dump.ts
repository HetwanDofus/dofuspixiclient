/**
 * Shared reader for StarLoco's published MySQL dump.
 *
 *   curl -LO https://raw.githubusercontent.com/StarLoco/StarLoco-Game/master/game.sql
 *
 * The file is a plain `mysqldump` with one `INSERT INTO \`table\` VALUES (...)`
 * statement per row, so it can be walked without a MySQL server. What it
 * cannot be walked with is a regex: cell payloads, item stat templates and
 * monster names all contain commas, escaped quotes and parentheses.
 *
 * `import-starloco-maps.ts` (world geometry) and `import-starloco-content.ts`
 * (monsters, items, NPCs) both read it; the tuple splitter lives here so the
 * two agree on escaping.
 */

/**
 * Splits one `INSERT ... VALUES (...)` tuple into raw column values. A regex
 * cannot do this safely: the cell payload and the names both contain commas
 * and escaped quotes.
 */
export function splitTuple(body: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  let escaped = false;

  for (const ch of body) {
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (inQuote && ch === "\\") {
      cur += ch;
      escaped = true;
      continue;
    }
    if (ch === "'") {
      inQuote = !inQuote;
      cur += ch;
      continue;
    }
    if (!inQuote && ch === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);

  return out;
}

export function unquote(raw: string): string {
  const v = raw.trim();
  if (!v.startsWith("'")) {
    return v;
  }
  return v
    .slice(1, -1)
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\\\/g, "\\");
}

/** Yields the value tuples of every `INSERT INTO \`table\`` row in the dump. */
export function* insertRows(dump: string, table: string): Generator<string[]> {
  const marker = `INSERT INTO \`${table}\` VALUES `;
  let at = dump.indexOf(marker);

  while (at !== -1) {
    const open = dump.indexOf("(", at);
    let i = open + 1;
    let inQuote = false;
    let escaped = false;

    for (; i < dump.length; i++) {
      const ch = dump[i]!;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (inQuote && ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "'") {
        inQuote = !inQuote;
        continue;
      }
      if (!inQuote && ch === ")") {
        break;
      }
    }

    yield splitTuple(dump.slice(open + 1, i)).map(unquote);
    at = dump.indexOf(marker, i);
  }
}

/**
 * Maps a dump row onto the named columns of its table. `mysqldump` writes
 * values positionally, so every caller needs the column order from the
 * matching `CREATE TABLE` — typos included (StarLoco's `maps` really does
 * spell it `heigth`).
 */
export function toRecord<const C extends readonly string[]>(
  columns: C,
  values: string[]
): Record<C[number], string> {
  return Object.fromEntries(
    columns.map((c, i) => [c, values[i] ?? ""])
  ) as Record<C[number], string>;
}

/**
 * Absolute path of a published 1.29 lang bundle.
 *
 * The bundles are the canonical 1.29 truth for names, gfx ids and item
 * effects — see the header of `import-starloco-content.ts`. A checkout always
 * carries them under `apps/electrobun/public/assets/langs`; the
 * asset-pipeline's own output directory (`assets/dist/langs`, which the
 * migrations read) only exists once the retail lang SWFs have been extracted,
 * so scripts read the published copy directly.
 */
export function langBundlePath(namespace: string, locale = "fr"): string {
  return new URL(
    `../../../apps/electrobun/public/assets/langs/${locale}/${namespace}.json`,
    import.meta.url
  ).pathname;
}
