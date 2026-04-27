import { link, mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { match } from "ts-pattern";

import { loadCatalog } from "../../catalog.ts";
import { categoryByName } from "../../categories.ts";
import { logger } from "../../logger.ts";
import { paths } from "../../paths.ts";

const PUBLIC_ASSETS = resolve(paths.repoRoot, "apps/electrobun/public/assets");

/**
 * Mirror every lang bundle under assets/dist/langs/<locale>/<namespace>.json
 * to apps/electrobun/public/assets/langs/<locale>/<namespace>.json so the
 * client can fetch them directly via Vite-served URLs. One hardlink per
 * bundle — zero-cost on the same filesystem.
 */
export async function publishLangs(): Promise<PublishResult> {
  const catalog = await loadCatalog();
  const bundles = catalog.langs?.bundles ?? [];
  let written = 0;
  let skipped = 0;
  let failed = 0;

  for (const b of bundles) {
    const src = b.bundlePath;
    const dest = resolve(
      PUBLIC_ASSETS,
      `langs/${b.locale}/${b.namespace}.json`
    );
    try {
      if (!(await exists(src))) {
        skipped++;
        continue;
      }
      await mkdir(dirname(dest), { recursive: true });
      await rm(dest, { force: true });
      try {
        await link(src, dest);
      } catch {
        await Bun.write(dest, Bun.file(src));
      }
      written++;
    } catch (err) {
      failed++;
      logger.warn(
        { src, dest, err: (err as Error).message },
        "publish:langs failed"
      );
    }
  }

  logger.info({ written, skipped, failed }, "publish:langs done");
  return { categoryName: "langs", written, skipped, failed };
}

export interface PublishEntry {
  src: string;
  dest: string;
}

export interface PublishResult {
  categoryName: string;
  written: number;
  skipped: number;
  failed: number;
}

/**
 * Mirror pipeline outputs from assets/dist/ into apps/electrobun/public/assets/
 * at the exact URL layout the client already fetches from. Uses hardlinks where
 * possible (same filesystem) so the published copy is zero-cost and stays in
 * sync with the dist source after re-runs.
 */
export async function publishCategory(categoryName: string): Promise<PublishResult> {
  const catalog = await loadCatalog();
  const section = catalog.byCategory[categoryName];

  const entries = section
    ? await planEntries(categoryName, section)
    : [];

  let written = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of entries) {
    try {
      if (!(await exists(entry.src))) {
        skipped++;
        continue;
      }
      await mkdir(dirname(entry.dest), { recursive: true });
      await rm(entry.dest, { force: true });
      try {
        await link(entry.src, entry.dest);
      } catch {
        // Cross-device — fall back to copy
        await Bun.write(entry.dest, Bun.file(entry.src));
      }
      written++;
    } catch (err) {
      failed++;
      logger.warn(
        { src: entry.src, dest: entry.dest, err: (err as Error).message },
        "publish failed"
      );
    }
  }

  logger.info(
    { categoryName, written, skipped, failed },
    `publish:${categoryName} done`
  );
  return { categoryName, written, skipped, failed };
}

async function planEntries(
  categoryName: string,
  section: NonNullable<Awaited<ReturnType<typeof loadCatalog>>["byCategory"][string]>
): Promise<PublishEntry[]> {
  return match(section)
    .with({ kind: "items" }, (s) =>
      // Items still ship as SVG at /assets/items/<type>/<id>.svg — the client
      // hasn't been flipped to dofasset for icons yet.
      s.entries
        .filter((e) => e.svgPath)
        .map<PublishEntry>((e) => ({
          src: e.svgPath,
          dest: resolve(PUBLIC_ASSETS, `items/${e.type}/${e.id}.svg`),
        }))
    )
    .with({ kind: "static" }, (s) => {
      // `staticTile` categories (gfx.tactic, gfx.cell) share the "static"
      // catalog section shape but the client fetches them through the tile
      // loader — they must land at /assets/spritesheets/<leaf>/<id>.dofasset
      // instead of the generic dofassets/ tree.
      const cat = categoryByName(categoryName);
      const isStaticTile = cat?.shape === "staticTile";
      if (isStaticTile) {
        const leaf = categoryName.split(".").pop() ?? categoryName;
        return s.entries
          .filter((e): e is typeof e & { dofassetPath: string } => Boolean(e.dofassetPath))
          .map<PublishEntry>((e) => ({
            src: e.dofassetPath,
            dest: resolve(
              PUBLIC_ASSETS,
              `spritesheets/${leaf}/${e.id}.dofasset`
            ),
          }));
      }
      // Every static-flat category (artworks.*, emblems.*, auras, etc.)
      // publishes to /assets/dofassets/<category-path>/<id>.dofasset.
      return s.entries
        .filter((e): e is typeof e & { dofassetPath: string } => Boolean(e.dofassetPath))
        .map<PublishEntry>((e) => ({
          src: e.dofassetPath,
          dest: resolve(
            PUBLIC_ASSETS,
            `dofassets/${categoryName.replace(/\./g, "/")}/${e.id}.dofasset`
          ),
        }));
    })
    .with({ kind: "sprites" }, (s) =>
      s.entries
        .filter((e): e is typeof e & { dofassetPath: string } => Boolean(e.dofassetPath))
        .map<PublishEntry>((e) => ({
          src: e.dofassetPath,
          dest: runtimePathForSprite(categoryName, e.gfxId),
        }))
    )
    .with({ kind: "spells" }, (s) =>
      s.entries
        .filter((e): e is typeof e & { dofassetPath: string } => Boolean(e.dofassetPath))
        .map<PublishEntry>((e) => ({
          src: e.dofassetPath,
          dest: resolve(
            PUBLIC_ASSETS,
            `spritesheets/spells/${e.spellId}.dofasset`
          ),
        }))
    )
    .with({ kind: "tiles" }, (s) =>
      s.entries
        .filter((e): e is typeof e & { dofassetPath: string } => Boolean(e.dofassetPath))
        .map<PublishEntry>((e) => ({
          src: e.dofassetPath,
          dest: resolve(
            PUBLIC_ASSETS,
            `spritesheets/tiles/${e.kind}/${e.tileId}.dofasset`
          ),
        }))
    )
    .with({ kind: "accessories" }, (s) =>
      s.entries
        .filter((e): e is typeof e & { dofassetPath: string } => Boolean(e.dofassetPath))
        .map<PublishEntry>((e) => ({
          src: e.dofassetPath,
          dest: resolve(
            PUBLIC_ASSETS,
            `spritesheets/sprites/acc_${e.symbol}.dofasset`
          ),
        }))
    )
    .exhaustive();
}

function runtimePathForSprite(categoryName: string, gfxId: number): string {
  // Main character sprites → /assets/spritesheets/sprites/<gfxId>.dofasset
  // Mount riders         → /assets/spritesheets/chevauchors/<gfxId>.dofasset
  return match(categoryName)
    .with("sprites", () =>
      resolve(PUBLIC_ASSETS, `spritesheets/sprites/${gfxId}.dofasset`)
    )
    .with("sprites.chevauchors", () =>
      resolve(PUBLIC_ASSETS, `spritesheets/chevauchors/${gfxId}.dofasset`)
    )
    .otherwise(() =>
      resolve(
        PUBLIC_ASSETS,
        `dofassets/${categoryName.replace(/\./g, "/")}/${gfxId}.dofasset`
      )
    );
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
