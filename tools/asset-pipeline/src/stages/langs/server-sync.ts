import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { SQL } from "bun";

import { logger } from "../../logger.ts";
import { paths } from "../../paths.ts";

/**
 * Server-owned namespaces — authoritative game data used in gameserver-ts
 * for NPC dialogs, item tooltips, spell descriptions, quest text. Every
 * other namespace lives only in the client bundles.
 *
 * Keeping this list in the pipeline (not just the client) so the sync step
 * stays single-source-of-truth — the SERVER_NAMESPACES constant shipped in
 * @dofus/dofus-lang mirrors this for client-side awareness.
 */
const SERVER_NAMESPACES = [
  "items",
  "itemstats",
  "itemsets",
  "spells",
  "effects",
  "monsters",
  "npc",
  "dialog",
  "quests",
  "dungeons",
  "crafts",
  "rides",
  "states",
  "speakingitems",
  "jobs",
  "alignment",
  "guilds",
  "pvp",
  "houses",
  "interactiveobjects",
  "skills",
  "titles",
  "subtitles",
  "timezones",
  "names",
  "servers",
  "scripts",
] as const;

export interface LangsServerSyncOptions {
  filterNamespace?: string;
  filterLocale?: string;
  /** Bun.sql connection string; defaults to PG env vars. */
  databaseUrl?: string;
  batchSize?: number;
}

export interface LangsServerSyncResult {
  upserts: number;
  bundles: number;
  durationMs: number;
}

interface LangBundle {
  entries: Record<string, string>;
}

function pgUrl(opts: LangsServerSyncOptions): string {
  if (opts.databaseUrl) return opts.databaseUrl;
  const host = process.env.PG_HOST ?? "localhost";
  const port = process.env.PG_PORT ?? "5432";
  const user = process.env.PG_USER ?? "dofus";
  const pwd = process.env.PG_PASSWORD ?? "dofus";
  const db = process.env.PG_DATABASE ?? "dofus";
  return `postgres://${user}:${encodeURIComponent(pwd)}@${host}:${port}/${db}`;
}

/**
 * Upsert every (namespace, entry_key, locale) row from the dist bundles for
 * server-owned namespaces into Postgres `i18n.translations`. Batches inserts
 * so large bundles (spells has ~70K entries per locale) don't blow the query
 * parameter budget.
 */
export async function syncLangsToServer(
  opts: LangsServerSyncOptions = {}
): Promise<LangsServerSyncResult> {
  const distRoot = resolve(paths.dist, "langs");
  const batchSize = opts.batchSize ?? 1000;
  const start = performance.now();

  const sql = new SQL(pgUrl(opts));

  let locales: string[];
  try {
    locales = await readdir(distRoot);
  } catch {
    logger.warn({ distRoot }, "no langs dist dir — run `pipeline langs` first");
    await sql.end();
    return { upserts: 0, bundles: 0, durationMs: 0 };
  }

  let upserts = 0;
  let bundles = 0;

  for (const locale of locales) {
    if (opts.filterLocale && locale !== opts.filterLocale) continue;

    for (const namespace of SERVER_NAMESPACES) {
      if (opts.filterNamespace && namespace !== opts.filterNamespace) continue;

      const bundlePath = resolve(distRoot, locale, `${namespace}.json`);
      let bundle: LangBundle;
      try {
        bundle = JSON.parse(await readFile(bundlePath, "utf-8")) as LangBundle;
      } catch {
        continue; // namespace absent for this locale — OK
      }
      bundles++;

      const rows = Object.entries(bundle.entries ?? {});
      if (rows.length === 0) continue;

      for (let i = 0; i < rows.length; i += batchSize) {
        const chunk = rows.slice(i, i + batchSize);
        await sql`
          INSERT INTO i18n.translations (namespace, entry_key, locale, value)
          SELECT * FROM UNNEST(
            ${chunk.map(() => namespace)}::text[],
            ${chunk.map(([k]) => k)}::text[],
            ${chunk.map(() => locale)}::text[],
            ${chunk.map(([, v]) => v)}::text[]
          )
          ON CONFLICT (namespace, entry_key, locale) DO UPDATE
            SET value = EXCLUDED.value,
                updated_at = now()
        `;
        upserts += chunk.length;
      }

      logger.info(
        { namespace, locale, rows: rows.length },
        "langs:server-sync bundle upserted"
      );
    }
  }

  await sql.end();

  const durationMs = Math.round(performance.now() - start);
  logger.info({ bundles, upserts, durationMs }, "langs:server-sync done");
  return { upserts, bundles, durationMs };
}
