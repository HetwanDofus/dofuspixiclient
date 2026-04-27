import { resolve } from "node:path";

const PACKAGE_ROOT = resolve(import.meta.dir, "..");

export const paths = {
  packageRoot: PACKAGE_ROOT,
  repoRoot: resolve(PACKAGE_ROOT, "../.."),
  sources: resolve(PACKAGE_ROOT, "../../assets/sources"),
  cache: resolve(PACKAGE_ROOT, "../../assets/cache"),
  dist: resolve(PACKAGE_ROOT, "../../assets/dist"),
  assetsExporter: resolve(PACKAGE_ROOT, "../assets-exporter"),
  catalogFile: resolve(PACKAGE_ROOT, "../../assets/dist/catalog.json"),
} as const;

export function extractCachePath(categoryName: string): string {
  return resolve(paths.cache, "extract", categoryName);
}

export function distDofassetPath(categoryName: string): string {
  return resolve(paths.dist, "dofassets", categoryName);
}

export function langsSourceDir(): string {
  return resolve(paths.sources, "langs");
}

export function spritesSourceDir(): string {
  return resolve(paths.sources, "clips/sprites");
}

export function legacySpellAtlasDir(): string {
  return resolve(paths.repoRoot, "assets/spritesheets/spells");
}

export function tileClassificationsPath(): string {
  return resolve(paths.repoRoot, "assets/tile-classifications.json");
}

export function tileOverridesPath(): string {
  return resolve(paths.repoRoot, "assets/tile-overrides.json");
}

export function spriteConfigPath(): string {
  return resolve(paths.repoRoot, "assets/sprite-config.json");
}

export function distLangsBundlePath(locale: string, namespace: string): string {
  return resolve(paths.dist, "langs", locale, `${namespace}.json`);
}
