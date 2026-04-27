import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import { PIPELINE_VERSION } from "./category.ts";
import { paths } from "./paths.ts";

const ItemEntrySchema = z.object({
  type: z.number().int(),
  id: z.number().int(),
  svgPath: z.string(),
  dofassetPath: z.string().optional(),
  outputBytes: z.number().int().nonnegative().optional(),
});
export type ItemEntry = z.infer<typeof ItemEntrySchema>;

const ItemsSectionSchema = z.object({
  kind: z.literal("items"),
  entries: z.array(ItemEntrySchema),
  updatedAt: z.string(),
});

const StaticEntrySchema = z.object({
  id: z.string(),
  svgPath: z.string(),
  dofassetPath: z.string().optional(),
  outputBytes: z.number().int().nonnegative().optional(),
});
export type StaticEntry = z.infer<typeof StaticEntrySchema>;

const StaticSectionSchema = z.object({
  kind: z.literal("static"),
  entries: z.array(StaticEntrySchema),
  updatedAt: z.string(),
});

const SpriteEntrySchema = z.object({
  gfxId: z.number().int(),
  svgDir: z.string().optional(),
  metadataPath: z.string().nullable().optional(),
  atlasDir: z.string().optional(),
  manifestPath: z.string().optional(),
  dofassetPath: z.string().optional(),
  animations: z.number().int().nonnegative().optional(),
  outputBytes: z.number().int().nonnegative().optional(),
});
export type SpriteEntry = z.infer<typeof SpriteEntrySchema>;

const SpritesSectionSchema = z.object({
  kind: z.literal("sprites"),
  entries: z.array(SpriteEntrySchema),
  updatedAt: z.string(),
});

const AccessoryEntrySchema = z.object({
  symbol: z.string(),
  type: z.number().int(),
  gfxId: z.number().int(),
  svgDir: z.string().optional(),
  dofassetPath: z.string().optional(),
  outputBytes: z.number().int().nonnegative().optional(),
});
export type AccessoryEntry = z.infer<typeof AccessoryEntrySchema>;

const AccessoriesSectionSchema = z.object({
  kind: z.literal("accessories"),
  entries: z.array(AccessoryEntrySchema),
  updatedAt: z.string(),
});

const SpellEntrySchema = z.object({
  spellId: z.number().int(),
  atlasDir: z.string().optional(),
  dofassetPath: z.string().optional(),
  animations: z.number().int().nonnegative().optional(),
  outputBytes: z.number().int().nonnegative().optional(),
  soundCount: z.number().int().nonnegative().optional(),
  requiresTypeScript: z.boolean().optional(),
});
export type SpellEntry = z.infer<typeof SpellEntrySchema>;

const SpellsSectionSchema = z.object({
  kind: z.literal("spells"),
  entries: z.array(SpellEntrySchema),
  updatedAt: z.string(),
});

const TileEntrySchema = z.object({
  tileId: z.number().int(),
  kind: z.enum(["ground", "objects"]),
  svgDir: z.string().optional(),
  dofassetPath: z.string().optional(),
  outputBytes: z.number().int().nonnegative().optional(),
  behavior: z
    .enum(["static", "slope", "animated", "random", "resource"])
    .optional(),
});
export type TileEntry = z.infer<typeof TileEntrySchema>;

const TilesSectionSchema = z.object({
  kind: z.literal("tiles"),
  entries: z.array(TileEntrySchema),
  updatedAt: z.string(),
});

const CategorySectionSchema = z.discriminatedUnion("kind", [
  ItemsSectionSchema,
  StaticSectionSchema,
  SpritesSectionSchema,
  AccessoriesSectionSchema,
  SpellsSectionSchema,
  TilesSectionSchema,
]);
export type CategorySection = z.infer<typeof CategorySectionSchema>;

const LangBundleEntrySchema = z.object({
  namespace: z.string(),
  locale: z.string(),
  bundlePath: z.string(),
  entryCount: z.number().int().nonnegative(),
  mode: z.string(),
});
export type LangBundleEntryCatalog = z.infer<typeof LangBundleEntrySchema>;

export const CatalogSchema = z.object({
  pipelineVersion: z.number().int(),
  generatedAt: z.string(),
  byCategory: z.record(z.string(), CategorySectionSchema),
  langs: z
    .object({
      bundles: z.array(LangBundleEntrySchema),
      updatedAt: z.string(),
    })
    .optional(),
});
export type Catalog = z.infer<typeof CatalogSchema>;

function emptyCatalog(): Catalog {
  return {
    pipelineVersion: PIPELINE_VERSION,
    generatedAt: new Date().toISOString(),
    byCategory: {},
  };
}

export async function loadCatalog(): Promise<Catalog> {
  try {
    const raw = await readFile(paths.catalogFile, "utf-8");
    const parsed = CatalogSchema.safeParse(JSON.parse(raw));
    if (parsed.success && parsed.data.pipelineVersion === PIPELINE_VERSION) {
      return parsed.data;
    }
  } catch {
    // missing or malformed → start fresh
  }
  return emptyCatalog();
}

export async function writeCatalog(catalog: Catalog): Promise<void> {
  const validated = CatalogSchema.parse({
    ...catalog,
    generatedAt: new Date().toISOString(),
  });
  await mkdir(dirname(paths.catalogFile), { recursive: true });
  await writeFile(paths.catalogFile, JSON.stringify(validated, null, 2));
}

export async function updateCategorySection(
  categoryName: string,
  section: CategorySection
): Promise<Catalog> {
  const catalog = await loadCatalog();
  catalog.byCategory[categoryName] = section;
  await writeCatalog(catalog);
  return catalog;
}

export async function updateLangsSection(
  bundles: LangBundleEntryCatalog[]
): Promise<Catalog> {
  const catalog = await loadCatalog();
  catalog.langs = { bundles, updatedAt: new Date().toISOString() };
  await writeCatalog(catalog);
  return catalog;
}
