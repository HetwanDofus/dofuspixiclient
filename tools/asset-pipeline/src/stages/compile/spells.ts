import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { ExtrasKind, type ExtrasPayload } from "@dofus/dofasset-format";
import { compileSprite } from "@dofus/dofasset-format/pipeline";

import { logger } from "../../logger.ts";
import { distDofassetPath, legacySpellAtlasDir } from "../../paths.ts";

export interface SpellCompileEntry {
  spellId: number;
  atlasDir: string;
  dofassetPath: string;
  animations: number;
  sourceBytes: number;
  outputBytes: number;
  soundCount: number;
  requiresTypeScript: boolean;
}

export interface SpellCompileOptions {
  filterId?: number;
}

export interface SpellCompileResult {
  outputDir: string;
  entries: SpellCompileEntry[];
  skipped: number;
  failed: number;
  durationMs: number;
}

interface LegacyAnimationEntry {
  file?: string;
  width?: number;
  height?: number;
  offsetX?: number;
  offsetY?: number;
  fps?: number;
}

interface LegacySpellManifest {
  version: number;
  spriteId: string | number;
  animations: Record<string, LegacyAnimationEntry>;
  spell?: {
    id: number;
    fps: number;
    mainTimelineScale?: number;
    requiresTypeScript?: boolean;
    sounds?: { frame: number; soundId: string }[];
    librarySymbols?: unknown[];
    animationMeta?: Record<
      string,
      {
        stopFrame?: number;
        fadingFrame?: number;
        isComposite?: boolean;
        hasMorphShapes?: boolean;
      }
    >;
  };
}

/**
 * Compile atlased spell dirs into .dofasset binaries with sound triggers +
 * lifecycle metadata baked into the Extras section — no sidecar manifest.json
 * required at runtime.
 *
 * Input layout (produced by combat-exporter + svg-spritesheet):
 *   assets/spritesheets/spells/<id>/
 *     anim1/atlas.svg + atlas.json
 *     sprite_<n>/atlas.svg + atlas.json   (optional sub-animations)
 *     manifest.json                       (carries `spell` metadata)
 *
 * Output:
 *   assets/dist/dofassets/spells/<id>.dofasset
 */
export async function compileSpells(
  opts: SpellCompileOptions = {}
): Promise<SpellCompileResult> {
  const atlasRoot = legacySpellAtlasDir();
  const outputDir = distDofassetPath("spells");
  await mkdir(outputDir, { recursive: true });

  const start = performance.now();
  const entries: SpellCompileEntry[] = [];
  let skipped = 0;
  let failed = 0;

  let ids: string[];
  try {
    ids = await readdir(atlasRoot);
  } catch {
    ids = [];
  }

  for (const name of ids) {
    const spellId = Number(name);
    if (!Number.isFinite(spellId)) continue;
    if (opts.filterId !== undefined && spellId !== opts.filterId) {
      skipped++;
      continue;
    }

    const atlasDir = resolve(atlasRoot, name);
    const manifestPath = resolve(atlasDir, "manifest.json");
    let manifest: LegacySpellManifest | null = null;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as LegacySpellManifest;
    } catch {
      logger.warn({ spellId }, "spell manifest missing/unreadable — skipping");
      failed++;
      continue;
    }

    const extras = buildSpellExtras(manifest);

    try {
      const result = compileSprite(atlasDir, {
        assetId: spellId,
        extras,
      });
      const dofassetPath = resolve(outputDir, `${spellId}.dofasset`);
      await mkdir(dirname(dofassetPath), { recursive: true });
      await writeFile(dofassetPath, result.bytes);

      entries.push({
        spellId,
        atlasDir,
        dofassetPath,
        animations: result.animations,
        sourceBytes: result.stats.totalSvgBytes,
        outputBytes: result.bytes.byteLength,
        soundCount: manifest.spell?.sounds?.length ?? 0,
        requiresTypeScript: manifest.spell?.requiresTypeScript ?? false,
      });
    } catch (err) {
      failed++;
      logger.warn({ spellId, err: (err as Error).message }, "compile:spells failed");
    }
  }

  return {
    outputDir,
    entries,
    skipped,
    failed,
    durationMs: Math.round(performance.now() - start),
  };
}

function buildSpellExtras(manifest: LegacySpellManifest): ExtrasPayload {
  const spell = manifest.spell;
  const animations: Record<
    string,
    { width: number; height: number; offsetX: number; offsetY: number; fps: number }
  > = {};
  for (const [name, entry] of Object.entries(manifest.animations ?? {})) {
    animations[name] = {
      width: entry.width ?? 0,
      height: entry.height ?? 0,
      offsetX: entry.offsetX ?? 0,
      offsetY: entry.offsetY ?? 0,
      fps: entry.fps ?? spell?.fps ?? 60,
    };
  }
  return {
    kind: ExtrasKind.Spell,
    data: {
      fps: spell?.fps ?? 60,
      mainTimelineScale: spell?.mainTimelineScale ?? 1,
      requiresTypeScript: spell?.requiresTypeScript ?? false,
      sounds: spell?.sounds ?? [],
      animationMeta: spell?.animationMeta ?? {},
      animations,
    },
  };
}
