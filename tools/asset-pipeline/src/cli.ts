#!/usr/bin/env bun
import { Command } from "commander";
import { match } from "ts-pattern";

import {
  loadCatalog,
  updateCategorySection,
  updateLangsSection,
  type SpriteEntry,
} from "./catalog.ts";
import { CATEGORIES, categoryByName } from "./categories.ts";
import type { CategoryDef, CategoryTraits } from "./category.ts";
import { logger } from "./logger.ts";
import { compileAccessories } from "./stages/compile/accessories.ts";
import { compileItems } from "./stages/compile/items.ts";
import { compilePointsCss } from "./stages/compile/points-css.ts";
import { compileSpellIcons } from "./stages/compile/spell-icons.ts";
import { compileSpells } from "./stages/compile/spells.ts";
import { compileSprites } from "./stages/compile/sprites.ts";
import { compileStaticCategory } from "./stages/compile/static.ts";
import { compileStaticTileCategory } from "./stages/compile/static-tile.ts";
import { compileTiles, type TileKind } from "./stages/compile/tiles.ts";
import { extractAccessories } from "./stages/extract/accessories.ts";
import { extractPoints } from "./stages/extract/points.ts";
import { extractBundleSymbols } from "./stages/extract/bundle.ts";
import { extractItems } from "./stages/extract/items.ts";
import { extractSprites } from "./stages/extract/sprites.ts";
import { extractStatic } from "./stages/extract/static.ts";
import { extractTiles } from "./stages/extract/tiles.ts";
import { extractLangs } from "./stages/langs/extract.ts";
import { syncLangsToServer } from "./stages/langs/server-sync.ts";
import { publishCategory, publishLangs } from "./stages/publish/index.ts";

/** `--ids 7500,7503` — the tile stages take a set, not a single id. */
function parseIdList(value: string): number[] {
  return value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isFinite(id));
}

type ExtractMode =
  | "items"
  | "staticFlat"
  | "bundleMulti"
  | "sprites"
  | "spritesChevauchor"
  | "spritesAccessories"
  | "spells"
  | "spellIcons"
  | "spellIconsBack"
  | "tiles"
  | "unsupported";

function extractModeFor(c: CategoryDef): ExtractMode {
  if (c.name === "items") return "items";
  if (c.name === "sprites") return "sprites";
  if (c.name === "sprites.chevauchors") return "spritesChevauchor";
  if (c.name === "sprites.accessories") return "spritesAccessories";
  if (c.name === "spells") return "spells";
  if (c.name === "spells.icons") return "spellIcons";
  if (c.name === "spells.icons.back") return "spellIconsBack";
  if (c.name === "tiles.ground" || c.name === "tiles.objects") return "tiles";
  if (c.shape === "static" && c.source.endsWith("/*.swf")) return "staticFlat";
  // Single-SWF bundles — may export many symbols (effectsicons, statesicons,
  // smileys.bundle) or just a root timeline (demonangel, fallenDemonAngel,
  // gfx.cell, ui.*). The PHP bin handles both. `staticTile` (gfx.tactic,
  // gfx.cell) reuses the same bundle extract; compile branches on shape.
  if (
    (c.shape === "static" || c.shape === "staticTile") &&
    c.source.endsWith(".swf") &&
    !c.source.includes("*")
  ) {
    return "bundleMulti";
  }
  return "unsupported";
}

function tileKindFor(categoryName: string): TileKind {
  return categoryName === "tiles.ground" ? "ground" : "objects";
}

async function mergeSpriteEntries(
  categoryName: string,
  updates: SpriteEntry[]
): Promise<void> {
  const catalog = await loadCatalog();
  const existing = catalog.byCategory[categoryName];
  const byId = new Map<number, SpriteEntry>(
    existing?.kind === "sprites"
      ? existing.entries.map((e) => [e.gfxId, e])
      : []
  );
  for (const u of updates) {
    const prev = byId.get(u.gfxId) ?? { gfxId: u.gfxId };
    byId.set(u.gfxId, { ...prev, ...u });
  }
  const merged = [...byId.values()].sort((a, b) => a.gfxId - b.gfxId);
  await updateCategorySection(categoryName, {
    kind: "sprites",
    entries: merged,
    updatedAt: new Date().toISOString(),
  });
}

function formatTraits(traits: CategoryTraits): string {
  const parts: string[] = [];
  if (traits.colorZones) {
    parts.push(
      `colorZones(${traits.colorZones.zoneCount}, ${traits.colorZones.tintMode})`
    );
  }
  if (traits.accessorySlots) parts.push(`accessorySlots(${traits.accessorySlots.count})`);
  if (traits.directionLabels) {
    parts.push(`directionLabels(${traits.directionLabels.names.length})`);
  }
  if (traits.multiSymbol) parts.push(`multiSymbol(${traits.multiSymbol.symbolRegex})`);
  if (traits.tileBehavior) parts.push(`tileBehavior`);
  if (traits.sound) parts.push(`sound`);
  if (traits.lifecycle) parts.push(`lifecycle(${traits.lifecycle.markers.join(",")})`);
  return parts.length > 0 ? parts.join(" ") : "—";
}

function formatCategory(c: CategoryDef): string {
  const offset = c.idOffset ? ` +${c.idOffset.toLocaleString()}` : "";
  const skip = c.skip ? " [skip]" : "";
  return `  ${c.name.padEnd(28)}${c.shape.padEnd(9)}${c.idFrom.padEnd(20)}${skip}  ${formatTraits(c.traits)}${offset}\n      src: ${c.source}`;
}

const program = new Command()
  .name("asset-pipeline")
  .description("Unified Dofus asset extraction + compile + i18n pipeline")
  .version("0.1.0");

program
  .command("list")
  .description("Print the category registry")
  .action(() => {
    logger.info(`Registered categories: ${CATEGORIES.length}`);
    const header =
      "  " +
      "name".padEnd(28) +
      "shape".padEnd(9) +
      "idFrom".padEnd(20) +
      "       traits";
    console.log(header);
    console.log("  " + "-".repeat(header.length - 2));
    for (const c of CATEGORIES) {
      console.log(formatCategory(c));
    }
    const skipped = CATEGORIES.filter((c) => c.skip).length;
    const withTraits = CATEGORIES.filter(
      (c) => Object.keys(c.traits).length > 0
    ).length;
    logger.info(
      `Total: ${CATEGORIES.length} | with traits: ${withTraits} | skipped: ${skipped}`
    );
  });

program
  .command("run <category>")
  .description("Run the extract stage for a single category")
  .option("--type <n>", "Filter by parent-dir type (items)", parseInt)
  .option("--id <n>", "Filter by numeric id", parseInt)
  .option("--ids <list>", "Comma-separated numeric ids (tiles)", parseIdList)
  .option("--clean", "Wipe cache output before extracting", false)
  .action(
    async (
      categoryName: string,
      opts: { type?: number; id?: number; ids?: number[]; clean: boolean }
    ) => {
      const category = categoryByName(categoryName);
      if (!category) {
        logger.error(`Unknown category: ${categoryName}`);
        process.exit(1);
      }
      if (category.skip) {
        logger.warn(`Category ${categoryName} is marked skip — nothing to do`);
        return;
      }

      await match(extractModeFor(category))
        .with("items", async () => {
          const result = await extractItems({
            filterType: opts.type,
            filterId: opts.id,
            clean: opts.clean,
          });
          await updateCategorySection(category.name, {
            kind: "items",
            entries: result.entries,
            updatedAt: new Date().toISOString(),
          });
          logger.info(
            { entries: result.entries.length, durationMs: result.durationMs },
            `catalog updated for ${category.name}`
          );
        })
        .with("staticFlat", () =>
          extractStaticFlat(category, opts.id, opts.clean)
        )
        .with("bundleMulti", async () => {
          const result = await extractBundleSymbols(category, {
            filterSymbol: opts.id !== undefined ? String(opts.id) : undefined,
            clean: opts.clean,
          });
          await updateCategorySection(category.name, {
            kind: "static",
            entries: result.entries,
            updatedAt: new Date().toISOString(),
          });
          logger.info(
            { entries: result.entries.length, durationMs: result.durationMs },
            `catalog updated for ${category.name}`
          );
        })
        .with("sprites", async () => {
          const result = await extractSprites({
            filterId: opts.id,
            clean: opts.clean,
          });
          await mergeSpriteEntries(
            "sprites",
            result.entries.map((e) => ({
              gfxId: e.gfxId,
              svgDir: e.svgDir,
              metadataPath: e.metadataPath,
            }))
          );
          logger.info(
            { entries: result.entries.length, durationMs: result.durationMs },
            `catalog updated for ${category.name}`
          );
        })
        .with("spritesChevauchor", async () => {
          const result = await extractSprites({
            filterId: opts.id,
            clean: opts.clean,
            subdir: "chevauchor",
            categoryName: "sprites.chevauchors",
          });
          await mergeSpriteEntries(
            "sprites.chevauchors",
            result.entries.map((e) => ({
              gfxId: e.gfxId,
              svgDir: e.svgDir,
              metadataPath: e.metadataPath,
            }))
          );
          logger.info(
            { entries: result.entries.length, durationMs: result.durationMs },
            `catalog updated for ${category.name}`
          );
        })
        .with("spritesAccessories", async () => {
          const result = await extractAccessories({ clean: opts.clean });
          await updateCategorySection("sprites.accessories", {
            kind: "accessories",
            entries: result.entries.map((e) => ({
              symbol: e.symbol,
              type: e.type,
              gfxId: e.gfxId,
              svgDir: e.svgDir,
            })),
            updatedAt: new Date().toISOString(),
          });
          logger.info(
            { entries: result.entries.length, durationMs: result.durationMs },
            `catalog updated for ${category.name}`
          );
        })
        .with("spells", async () => {
          logger.info(
            "spells extract is produced by tools/combat-exporter (writes atlas.svg + atlas.json directly); run it upstream, then `pipeline compile spells`"
          );
        })
        .with("spellIcons", () =>
          extractStaticFlat(category, opts.id, opts.clean)
        )
        .with("spellIconsBack", () =>
          extractStaticFlat(category, opts.id, opts.clean)
        )
        .with("tiles", async () => {
          const kind = tileKindFor(category.name);
          const result = await extractTiles({
            kind,
            clean: opts.clean,
            ...(opts.ids ? { only: opts.ids } : {}),
          });
          const sectionKey = category.name;
          const catalog = await loadCatalog();
          const existing = catalog.byCategory[sectionKey];
          const prior =
            existing?.kind === "tiles" ? existing.entries : [];
          const byId = new Map(prior.map((e) => [e.tileId, e]));
          for (const e of result.entries) {
            byId.set(e.tileId, {
              tileId: e.tileId,
              kind: e.kind,
              svgDir: e.svgDir,
            });
          }
          await updateCategorySection(sectionKey, {
            kind: "tiles",
            entries: [...byId.values()].sort((a, b) => a.tileId - b.tileId),
            updatedAt: new Date().toISOString(),
          });
          logger.info(
            { entries: result.entries.length, durationMs: result.durationMs },
            `catalog updated for ${category.name}`
          );
        })
        .with("unsupported", async () => {
          logger.error(
            `No extract handler wired for ${category.name} yet (shape=${category.shape}, source=${category.source})`
          );
          process.exit(2);
        })
        .exhaustive();
    }
  );

program
  .command("compile <category>")
  .description("Compile extracted assets into .dofasset binaries")
  .option("--type <n>", "Filter by parent-dir type (items)", parseInt)
  .option("--id <n>", "Filter by numeric id", parseInt)
  .option("--ids <list>", "Comma-separated numeric ids (tiles)", parseIdList)
  .option("--symbol <name>", "Filter by bundle symbol (accessories)")
  .action(
    async (
      categoryName: string,
      opts: { type?: number; id?: number; ids?: number[]; symbol?: string }
    ) => {
      const category = categoryByName(categoryName);
      if (!category) {
        logger.error(`Unknown category: ${categoryName}`);
        process.exit(1);
      }
      if (category.skip) {
        logger.warn(`Category ${categoryName} is marked skip — nothing to do`);
        return;
      }

      await match(extractModeFor(category))
        .with("items", async () => {
          const result = await compileItems({
            filterType: opts.type,
            filterId: opts.id,
          });

          const catalog = await loadCatalog();
          const section = catalog.byCategory["items"];
          if (!section || section.kind !== "items") {
            logger.error("items extract section missing — cannot merge compile results");
            process.exit(3);
          }
          const compiledByKey = new Map(
            result.entries.map((e) => [`${e.type}/${e.id}`, e])
          );
          const mergedEntries = section.entries.map((e) => {
            const compiled = compiledByKey.get(`${e.type}/${e.id}`);
            return compiled
              ? { ...e, dofassetPath: compiled.dofassetPath, outputBytes: compiled.outputBytes }
              : e;
          });
          await updateCategorySection("items", {
            kind: "items",
            entries: mergedEntries,
            updatedAt: new Date().toISOString(),
          });

          logCompression(category.name, result);
        })
        .with("staticFlat", () => compileStaticAndMergeFor(category, opts.id))
        .with("bundleMulti", () => compileStaticAndMergeFor(category, opts.id))
        .with("sprites", async () => {
          const result = await compileSprites({
            filterId: opts.id,
            categoryName: "sprites",
          });
          await mergeSpriteEntries(
            "sprites",
            result.entries.map((e) => ({
              gfxId: e.gfxId,
              svgDir: e.svgDir,
              dofassetPath: e.dofassetPath,
              animations: e.animations,
              outputBytes: e.outputBytes,
            }))
          );
          logCompression(category.name, result);
        })
        .with("spritesChevauchor", async () => {
          const result = await compileSprites({
            filterId: opts.id,
            categoryName: "sprites.chevauchors",
          });
          await mergeSpriteEntries(
            "sprites.chevauchors",
            result.entries.map((e) => ({
              gfxId: e.gfxId,
              svgDir: e.svgDir,
              dofassetPath: e.dofassetPath,
              animations: e.animations,
              outputBytes: e.outputBytes,
            }))
          );
          logCompression(category.name, result);
        })
        .with("spells", async () => {
          const result = await compileSpells({ filterId: opts.id });
          await updateCategorySection("spells", {
            kind: "spells",
            entries: result.entries.map((e) => ({
              spellId: e.spellId,
              atlasDir: e.atlasDir,
              dofassetPath: e.dofassetPath,
              animations: e.animations,
              outputBytes: e.outputBytes,
              soundCount: e.soundCount,
              requiresTypeScript: e.requiresTypeScript,
            })),
            updatedAt: new Date().toISOString(),
          });
          logCompression(category.name, result);
        })
        .with("tiles", async () => {
          const kind = tileKindFor(category.name);
          const result = await compileTiles({
            kind,
            filterId: opts.id,
            ...(opts.ids ? { filterIds: opts.ids } : {}),
          });
          const catalog = await loadCatalog();
          const sectionKey = category.name;
          const existing = catalog.byCategory[sectionKey];
          const prior =
            existing?.kind === "tiles" ? existing.entries : [];
          const byId = new Map(prior.map((e) => [e.tileId, e]));
          for (const e of result.entries) {
            byId.set(e.tileId, {
              tileId: e.tileId,
              kind: e.kind,
              svgDir: e.svgDir,
              dofassetPath: e.dofassetPath,
              outputBytes: e.outputBytes,
              behavior: e.behavior,
            });
          }
          await updateCategorySection(sectionKey, {
            kind: "tiles",
            entries: [...byId.values()].sort((a, b) => a.tileId - b.tileId),
            updatedAt: new Date().toISOString(),
          });
          logCompression(category.name, result);
        })
        .with("spellIcons", async () => {
          const result = await compileSpellIcons({ filterId: opts.id });
          // Overwrite the extract-stage section (keyed by up-sprite id) with
          // one keyed by spell_id — that's what the client fetches and what
          // `publishCategory` needs to mirror under /assets/dofassets/spells/
          // icons/<spell_id>.dofasset.
          await updateCategorySection(category.name, {
            kind: "static",
            entries: result.entries.map((e) => ({
              id: String(e.spellId),
              // No raw SVG input here — the composer operates on two SVGs +
              // lang data. `svgPath` is required by the schema; use the
              // output path as a harmless placeholder so publish still works.
              svgPath: e.dofassetPath,
              dofassetPath: e.dofassetPath,
              outputBytes: e.outputBytes,
            })),
            updatedAt: new Date().toISOString(),
          });
          logger.info(
            {
              composed: result.entries.length,
              skipped: result.skipped,
              failed: result.failed,
              durationMs: result.durationMs,
              outputDir: result.outputDir,
              dofassetBytes: result.entries.reduce(
                (a, e) => a + e.outputBytes,
                0
              ),
            },
            `compile:${category.name} done`
          );
        })
        .with("spellIconsBack", async () => {
          logger.info(
            "spells.icons.back compile is a no-op — the back layer is merged into spells.icons dofassets by `pipeline compile spells.icons`"
          );
        })
        .with("spritesAccessories", async () => {
          const result = await compileAccessories({ filterSymbol: opts.symbol });
          await updateCategorySection("sprites.accessories", {
            kind: "accessories",
            entries: result.entries.map((e) => ({
              symbol: e.symbol,
              type: e.type,
              gfxId: e.gfxId,
              dofassetPath: e.dofassetPath,
              outputBytes: e.outputBytes,
            })),
            updatedAt: new Date().toISOString(),
          });
          logCompression(category.name, result);
        })
        .with("unsupported", async () => {
          logger.error(
            `No compile handler wired for ${category.name} yet (shape=${category.shape}, source=${category.source})`
          );
          process.exit(2);
        })
        .exhaustive();
    }
  );

/**
 * Extract a static-flat category (one SWF per file under a directory).
 * Shared by the default staticFlat arm and the spells.icons[.back] arms,
 * since those extract identically — the composition happens at compile time.
 */
async function extractStaticFlat(
  category: CategoryDef,
  filterId: number | undefined,
  clean: boolean
) {
  const result = await extractStatic(category, {
    filterId: filterId !== undefined ? String(filterId) : undefined,
    clean,
  });
  await updateCategorySection(category.name, {
    kind: "static",
    entries: result.entries,
    updatedAt: new Date().toISOString(),
  });
  logger.info(
    { entries: result.entries.length, durationMs: result.durationMs },
    `catalog updated for ${category.name}`
  );
}

// NOTE: the `pipeline atlas` verb has been retired. compileSprites now reads
// per-frame SVGs directly from the extract cache — svg-spritesheet and its
// atlased intermediate files are no longer part of the pipeline. Sprites /
// chevauchors / accessories go extract → compile → publish with no middle
// stage. See packages/dofasset-format/src/sprite-compile.ts.

/**
 * Compile a static-flat or bundle-multi category and merge the compile
 * outputs (dofassetPath, outputBytes) back into the catalog section. Shared
 * between the two dispatch arms since they both land at the same static
 * compile path.
 */
async function compileStaticAndMergeFor(category: CategoryDef, id?: number) {
  const result =
    category.shape === "staticTile"
      ? await compileStaticTileCategory(category, {
          filterId: id !== undefined ? String(id) : undefined,
        })
      : await compileStaticCategory(category, {
          filterId: id !== undefined ? String(id) : undefined,
        });
  const catalog = await loadCatalog();
  const section = catalog.byCategory[category.name];
  if (!section || section.kind !== "static") {
    logger.error(
      `${category.name} extract section missing — cannot merge compile results`
    );
    process.exit(3);
  }
  const compiledById = new Map(result.entries.map((e) => [e.id, e]));
  const mergedEntries = section.entries.map((e) => {
    const compiled = compiledById.get(e.id);
    return compiled
      ? { ...e, dofassetPath: compiled.dofassetPath, outputBytes: compiled.outputBytes }
      : e;
  });
  await updateCategorySection(category.name, {
    kind: "static",
    entries: mergedEntries,
    updatedAt: new Date().toISOString(),
  });
  logCompression(category.name, result);
}

function logCompression(
  name: string,
  result: {
    entries: Array<{
      sourceBytes: number;
      outputBytes: number;
      uniquePaths?: number;
      drawCommands?: number;
      bodyParts?: number;
      transforms?: number;
      frames?: number;
      images?: number;
    }>;
    skipped: number;
    failed: number;
    durationMs: number;
  }
): void {
  const totalIn = result.entries.reduce((a, e) => a + e.sourceBytes, 0);
  const totalOut = result.entries.reduce((a, e) => a + e.outputBytes, 0);
  const compression = totalIn > 0 ? Math.round((1 - totalOut / totalIn) * 100) : 0;

  // Dedup counts — present on compileSprite/compileSpells results; show them
  // so the "was dedup preserved" question is always answered by the build log.
  const hasDedup = result.entries[0]?.uniquePaths !== undefined;
  const dedup = hasDedup
    ? {
        uniquePaths: sum(result.entries, (e) => e.uniquePaths ?? 0),
        drawCommands: sum(result.entries, (e) => e.drawCommands ?? 0),
        bodyParts: sum(result.entries, (e) => e.bodyParts ?? 0),
        transforms: sum(result.entries, (e) => e.transforms ?? 0),
        frames: sum(result.entries, (e) => e.frames ?? 0),
        images: sum(result.entries, (e) => e.images ?? 0),
      }
    : undefined;

  logger.info(
    {
      compiled: result.entries.length,
      skipped: result.skipped,
      failed: result.failed,
      durationMs: result.durationMs,
      svgBytes: totalIn,
      dofassetBytes: totalOut,
      compression: `${compression}%`,
      ...(dedup ? { dedup } : {}),
    },
    `compile:${name} done`
  );
}

function sum<T>(arr: T[], pick: (x: T) => number): number {
  let s = 0;
  for (const x of arr) s += pick(x);
  return s;
}

program
  .command("publish <category>")
  .description("Mirror compiled outputs into apps/electrobun/public/assets/")
  .action(async (categoryName: string) => {
    if (categoryName === "langs") {
      await publishLangs();
      return;
    }
    const category = categoryByName(categoryName);
    if (!category) {
      logger.error(`Unknown category: ${categoryName}`);
      process.exit(1);
    }
    await publishCategory(category.name);
  });

program
  .command("points")
  .description(
    "Extract floating damage/AP/MP/heal point clips into JSON manifests AND compile them into apps/electrobun/src/hud/fight/points.generated.css with @keyframes that drive the canonical SWF curve via @property-typed CSS variables."
  )
  .action(async () => {
    const ex = await extractPoints();
    logger.info(
      { outputDir: ex.outputDir, count: ex.count },
      "points extracted"
    );
    const css = await compilePointsCss();
    logger.info(
      {
        outputPath: css.outputPath,
        clips: css.clips,
        bytes: css.bytes,
        durationMs: css.durationMs,
      },
      "points CSS compiled"
    );
  });

program
  .command("langs")
  .description("Extract i18n bundles from lang SWFs via AS2 bytecode walker")
  .option("--namespace <name>", "Only extract a single namespace (e.g. lang)")
  .option("--locale <code>", "Only extract a single locale (e.g. fr)")
  .action(
    async (opts: { namespace?: string; locale?: string }) => {
      const result = await extractLangs({
        filterNamespace: opts.namespace,
        filterLocale: opts.locale,
      });
      await updateLangsSection(result.bundles);
      const totalEntries = result.bundles.reduce((a, b) => a + b.entryCount, 0);
      logger.info(
        {
          bundles: result.bundles.length,
          skipped: result.skipped,
          failed: result.failed,
          totalEntries,
          durationMs: result.durationMs,
        },
        "langs done"
      );
    }
  );

program
  .command("langs:server-sync")
  .description("Upsert server-owned langs into Postgres i18n.translations")
  .option("--namespace <name>", "Only sync this namespace (e.g. items)")
  .option("--locale <code>", "Only sync this locale (e.g. fr)")
  .option("--database-url <url>", "Override PG connection string")
  .option(
    "--batch-size <n>",
    "Rows per INSERT batch (default 1000)",
    (v) => parseInt(v, 10),
    1000
  )
  .action(
    async (opts: {
      namespace?: string;
      locale?: string;
      databaseUrl?: string;
      batchSize: number;
    }) => {
      await syncLangsToServer({
        filterNamespace: opts.namespace,
        filterLocale: opts.locale,
        databaseUrl: opts.databaseUrl,
        batchSize: opts.batchSize,
      });
    }
  );

program.parseAsync().catch((err) => {
  logger.error(err);
  process.exit(1);
});
