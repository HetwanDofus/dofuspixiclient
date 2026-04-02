import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { Command } from "commander";
import pino from "pino";

import type {
  AnimationGroup,
  AtlasManifest,
  CombinedManifest,
  CompileResult,
  OptimizationOptions,
  TileBehavior,
} from "./types.ts";
import { deduplicateDefinitions, processFrames } from "./lib/deduplicator.ts";
import {
  calculateInputSize,
  formatBytes,
  writeAtlasOutput,
} from "./lib/generator.ts";
import {
  type ImageRegistry,
  loadImageRegistry,
  saveImageRegistry,
} from "./lib/image-exporter.ts";
import { parseSvgFiles } from "./lib/parser.ts";
import type { AnimationMeta, PartMeta } from "./lib/generator.ts";

// ---------------------------------------------------------------------------
// Sprite config — per-sprite overrides (frame limits, hair behavior, etc.)
// ---------------------------------------------------------------------------

interface HairToggleConfig {
  sourceFrame: number;
  compareFrame: number;
  cssClass: string;
  triggerSlot: number;
}

interface SpriteOverride {
  staticFrameLimit?: number;
  hairToggle?: HairToggleConfig;
}

interface AccBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface SpriteConfig {
  defaults?: { staticFrameLimit?: number };
  accessoryBounds?: Record<string, AccBounds>;
  sprites?: Record<string, SpriteOverride>;
}

/**
 * Apply hair toggle to parsed frames.
 *
 * Compares frame 0 (long hair) with frame 1 (short hair) definitions.
 * Finds the definition that differs most (the hair).
 * Injects frame 0's hair definition into ALL other frames as an extra
 * use element wrapped in class="hair-long", so it can be CSS-toggled.
 */
function applyHairToggle(
  frames: import("./types.ts").ParsedFrame[],
  config: HairToggleConfig
): void {
  if (frames.length < 2) return;

  const frame0 = frames[config.sourceFrame];
  const frame1 = frames[config.compareFrame];
  if (!frame0 || !frame1) return;

  // Build def maps: id → normalizedContent
  const defs0 = new Map<string, import("./types.ts").Definition>();
  for (const d of frame0.definitions) defs0.set(d.originalId, d);
  const defs1 = new Map<string, import("./types.ts").Definition>();
  for (const d of frame1.definitions) defs1.set(d.originalId, d);

  // Find the definition with the biggest content size difference
  let hairDefId: string | null = null;
  let hairDefMaxDiff = 0;
  for (const [id, def0] of defs0) {
    const def1 = defs1.get(id);
    if (!def1) continue;
    if (def0.normalizedContent === def1.normalizedContent) continue;
    const diff = def0.normalizedContent.length - def1.normalizedContent.length;
    if (diff > hairDefMaxDiff) {
      hairDefMaxDiff = diff;
      hairDefId = id;
    }
  }

  if (!hairDefId || hairDefMaxDiff < 50) return; // No significant hair difference

  // Find which useElement in frame 0 references this def (directly or via parent)
  const hairDef0 = defs0.get(hairDefId)!;
  let hairUseIdx = -1;
  for (let i = 0; i < frame0.useElements.length; i++) {
    const href = frame0.useElements[i].originalHref.replace(/^#/, "");
    if (refsContain(href, hairDefId, defs0)) {
      hairUseIdx = i;
      break;
    }
  }

  if (hairUseIdx < 0) return;

  const hairUse = frame0.useElements[hairUseIdx];

  // Create a modified copy of the hair definition with a unique ID
  const hairLongId = `${hairDefId}_hairlong`;
  const hairLongDef: import("./types.ts").Definition = {
    ...hairDef0,
    originalId: hairLongId,
    // Rewrite the normalizedContent to use the new ID
    normalizedContent: hairDef0.normalizedContent,
  };

  // Create a use element that references the hair-long def, with same transform
  // but wrapped conceptually — the generator will emit it, and we mark it with
  // a special attribute that the generator can detect
  const hairLongUse: import("./types.ts").UseElement = {
    ...hairUse,
    originalHref: `#${hairLongId}`,
    attributes: { ...hairUse.attributes, class: config.cssClass },
  };

  // Inject into all frames except sourceFrame:
  // - Add the long-hair definition
  // - Add the use element (at the same z-position as the original hair)
  for (let fi = 0; fi < frames.length; fi++) {
    if (fi === config.sourceFrame) continue;

    // Add the hair-long definition to this frame
    frames[fi].definitions.push(hairLongDef);

    // Insert the hair-long use element at the same position
    const insertIdx = Math.min(hairUseIdx, frames[fi].useElements.length);
    frames[fi].useElements.splice(insertIdx, 0, hairLongUse);
  }
}

/** Check if defId's tree contains targetId */
function refsContain(
  defId: string,
  targetId: string,
  defs: Map<string, import("./types.ts").Definition>,
  visited = new Set<string>()
): boolean {
  if (defId === targetId) return true;
  if (visited.has(defId)) return false;
  visited.add(defId);
  const def = defs.get(defId);
  if (!def) return false;
  for (const ref of def.nestedRefs) {
    if (refsContain(ref, targetId, defs, visited)) return true;
  }
  return false;
}

let spriteConfig: SpriteConfig = {};

function loadSpriteConfig(): SpriteConfig {
  const configPath = path.join(import.meta.dir, "..", "sprite-config.json");
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }
  } catch { /* ignore */ }
  return {};
}

/**
 * Apply sprite config to animation groups:
 * - Limit static animations to N frames (default: 1)
 */
function applyFrameLimits(groups: AnimationGroup[], spriteId: string): void {
  const defaultLimit = spriteConfig.defaults?.staticFrameLimit;
  const spriteOverride = (spriteConfig.sprites as Record<string, { staticFrameLimit?: number }> | undefined)?.[spriteId];
  const limit = spriteOverride?.staticFrameLimit ?? defaultLimit;
  if (!limit) return;

  for (const group of groups) {
    if (group.name.startsWith("static") && group.files.length > limit) {
      group.files = group.files.slice(0, limit);
    }
  }
}

interface SpriteMetadataJson {
  gfxId: number;
  colorZones: Record<string, string[]>;
  colorMapping: Record<string, number>;
  animations: Record<string, Array<{
    accessories: Array<{ slot: number; depth: number; x: number; y: number; matrix?: number[] }>;
    parts?: PartMeta[];
  }>>;
}

/**
 * Load sprite metadata and build AnimationMeta for the generator.
 */
function loadAnimationMeta(
  outputDir: string,
  animName: string
): AnimationMeta | undefined {
  const metaPath = path.join(outputDir, "metadata.json");
  if (!fs.existsSync(metaPath)) return undefined;

  try {
    const meta: SpriteMetadataJson = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    const animFrames = meta.animations[animName];
    if (!animFrames?.[0]?.parts) return undefined;

    // Check if any frame has accessories
    const hasAccessories = animFrames.some((f) =>
      f.parts?.some((p) => p.accessory !== undefined)
    );
    if (!hasAccessories) return undefined;

    const parts: PartMeta[][] = animFrames.map((f) => f.parts ?? []);

    // Build accessory attachment lookup: "animName_frameIdx_slot" → attachment info
    const attachments = new Map<string, Array<{ slot: number; x: number; y: number; depth: number; matrix?: number[] }>>();
    for (let fi = 0; fi < animFrames.length; fi++) {
      for (const acc of animFrames[fi].accessories) {
        const key = `${animName}_${fi}_${acc.slot}`;
        const existing = attachments.get(key) ?? [];
        existing.push(acc);
        attachments.set(key, existing);
      }
    }

    // Compute padding from actual attachment positions + scaled accessory bounds.
    // For each attachment point, compute the worst-case overflow considering:
    // - The attachment position (tx, ty) in character space
    // - The accessory max bounds for that slot type (from config)
    // - The scale from the attachment matrix
    const accBounds = spriteConfig.accessoryBounds;
    let padLeft = 0, padTop = 0, padRight = 0, padBottom = 0;
    if (accBounds) {
      for (const frame of animFrames) {
        for (const acc of frame.accessories) {
          const slotBounds = accBounds[String(acc.slot)];
          if (!slotBounds) continue;
          // Extract scale from matrix
          const mat = acc.matrix;
          const scale = mat ? Math.max(Math.abs(mat[0]), Math.abs(mat[3])) : 1;
          // Accessory extent from attachment point (scaled)
          const accLeft = acc.x + slotBounds.left * scale;
          const accTop = acc.y + slotBounds.top * scale;
          const accRight = acc.x + slotBounds.right * scale;
          const accBottom = acc.y + slotBounds.bottom * scale;
          // Track the most extreme extents across all frames
          padLeft = Math.min(padLeft, accLeft);
          padTop = Math.min(padTop, accTop);
          padRight = Math.max(padRight, accRight);
          padBottom = Math.max(padBottom, accBottom);
        }
      }
    }
    // Pass raw extents — the generator compares against the actual viewBox
    const padding = { left: padLeft, top: padTop, right: padRight, bottom: padBottom };

    return { parts, accessoryAttachments: attachments, padding };
  } catch {
    return undefined;
  }
}

const logger = pino({
  name: "svg-spritesheet",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      ignore: "pid,hostname",
      translateTime: "HH:MM:ss",
    },
  },
});

function groupByAnimation(svgFiles: string[]): AnimationGroup[] {
  const groups = new Map<string, string[]>();

  for (const file of svgFiles) {
    const basename = path.basename(file, ".svg");
    const match = basename.match(/^(.+)_\d+$/);
    const animName = match ? match[1] : basename;

    const existing = groups.get(animName) ?? [];
    existing.push(file);
    groups.set(animName, existing);
  }

  const result: AnimationGroup[] = [];
  for (const [name, files] of groups) {
    files.sort((a, b) => {
      const aMatch = path.basename(a, ".svg").match(/_(\d+)$/);
      const bMatch = path.basename(b, ".svg").match(/_(\d+)$/);
      const aNum = aMatch ? parseInt(aMatch[1], 10) : 0;
      const bNum = bMatch ? parseInt(bMatch[1], 10) : 0;
      return aNum - bNum;
    });
    result.push({ name, files });
  }

  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

async function runSvgo(filePath: string, configPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "svgo",
      ["--config", configPath, filePath, "-o", filePath],
      {
        stdio: "pipe",
      }
    );

    let stderr = "";

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`SVGO failed: ${stderr}`));
      }
    });

    proc.on("error", reject);
  });
}

async function compileAnimation(
  group: AnimationGroup,
  outputDir: string,
  svgoConfigPath: string,
  opts: OptimizationOptions,
  singleAnimation: boolean = false,
  imageRegistry?: ImageRegistry,
  maxPageDimension?: number,
  animMeta?: AnimationMeta,
  hairToggle?: HairToggleConfig
): Promise<{
  manifest: AtlasManifest;
  outputSize: number;
  inputSize: number;
} | null> {
  // If single animation, output directly to sprite folder; otherwise create subfolder
  const animOutputDir = singleAnimation
    ? outputDir
    : path.join(outputDir, group.name);

  if (group.files.length === 0) {
    return null;
  }

  const inputSize = await calculateInputSize(group.files);
  const frames = await parseSvgFiles(group.files);

  if (frames.length === 0) {
    return null;
  }

  // Apply hair toggle if configured for this sprite
  if (hairToggle) {
    applyHairToggle(frames, hairToggle);
  }

  // Mark accessory use elements BEFORE dedup so the generator can emit placeholders
  if (animMeta) {
    for (const frame of frames) {
      const frameParts = animMeta.parts[frame.frameIndex];
      if (!frameParts) continue;
      for (let j = 0; j < frame.useElements.length && j < frameParts.length; j++) {
        const part = frameParts[j];
        if (part.accessory !== undefined) {
          const att = animMeta.accessoryAttachments.get(
            `${frame.animationName}_${frame.frameIndex}_${part.accessory}`
          );
          const attInfo = att?.[0];
          // Mark this use element as an accessory placeholder
          frame.useElements[j].attributes["data-acc-slot"] = String(part.accessory);
          frame.useElements[j].attributes["data-tx"] = String(attInfo?.x ?? 0);
          frame.useElements[j].attributes["data-ty"] = String(attInfo?.y ?? 0);
          frame.useElements[j].attributes["data-depth"] = String(part.depth);
          if (attInfo?.matrix) {
            frame.useElements[j].attributes["data-matrix"] = attInfo.matrix.join(",");
          }
        }
      }
    }
  }

  const dedup = deduplicateDefinitions(frames, opts, imageRegistry);
  const sprites = processFrames(frames, dedup);

  fs.mkdirSync(animOutputDir, { recursive: true });
  const result = await writeAtlasOutput(
    animOutputDir,
    frames,
    dedup,
    sprites,
    opts,
    imageRegistry,
    maxPageDimension,
    animMeta
  );

  // Run SVGO on each output SVG file (skip if placeholders present — SVGO strips them)
  let finalSize = 0;
  for (const svgPath of result.svgFiles) {
    if (!animMeta) {
      try {
        await runSvgo(svgPath, svgoConfigPath);
      } catch {
        // SVGO failure is non-fatal
      }
    }
    finalSize += fs.statSync(svgPath).size;
  }

  return { manifest: result.manifest, outputSize: finalSize, inputSize };
}

/** Tile classification entry from tile-classifications.json */
interface TileClassificationEntry {
  behavior: TileBehavior;
  fps?: number;
  autoplay?: boolean;
  loop?: boolean;
}

/** Tile classifications file format */
interface TileClassifications {
  version: number;
  ground: Record<string, TileClassificationEntry>;
  objects: Record<string, TileClassificationEntry>;
}

/**
 * Load tile classifications from JSON file.
 */
function loadTileClassifications(
  filePath: string
): TileClassifications | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (e) {
    logger.warn(`Failed to load tile classifications from ${filePath}: ${e}`);
    return null;
  }
}

/**
 * Look up a tile's classification by its spriteId and the parent directory type.
 */
function lookupTileClassification(
  classifications: TileClassifications | null,
  spriteId: string,
  tileType: "ground" | "objects" | null
): TileClassificationEntry | null {
  if (!classifications || !tileType) {
    return null;
  }

  return classifications[tileType]?.[spriteId] ?? null;
}

async function generateCombinedManifest(
  spriteId: string,
  outputDir: string,
  manifests: Map<string, { manifest: AtlasManifest; inputSize: number }>,
  totalInputSize: number,
  totalOutputSize: number,
  singleAnimation: boolean = false,
  tileClassification: TileClassificationEntry | null = null
): Promise<CombinedManifest> {
  // Slim manifest: only animation names (frame data is in per-animation atlas.json)
  const animations: CombinedManifest["animations"] = {};

  for (const [animName, { manifest }] of manifests) {
    animations[animName] = {
      file: singleAnimation ? "atlas.svg" : `${animName}/atlas.svg`,
      width: manifest.width,
      height: manifest.height,
      offsetX: manifest.offsetX,
      offsetY: manifest.offsetY,
      fps: manifest.fps,
      frames: [],
      frameOrder: [],
      duplicates: {},
    };
  }

  const combined: CombinedManifest = {
    version: 1,
    spriteId,
    animations,
  };

  // Embed hair toggle info from sprite config (for client-side hat detection)
  const spriteOverrides = spriteConfig.sprites?.[spriteId];
  if (spriteOverrides?.hairToggle) {
    (combined as unknown as Record<string, unknown>).hairToggle = {
      cssClass: spriteOverrides.hairToggle.cssClass,
      triggerSlot: spriteOverrides.hairToggle.triggerSlot,
    };
  }

  // Embed tile classification if available
  if (tileClassification) {
    combined.behavior = tileClassification.behavior;

    if (tileClassification.fps !== undefined) {
      combined.fps_hint = tileClassification.fps;
    }
    if (tileClassification.autoplay !== undefined) {
      combined.autoplay = tileClassification.autoplay;
    }
    if (tileClassification.loop !== undefined) {
      combined.loop = tileClassification.loop;
    }
  }

  const manifestPath = path.join(outputDir, "manifest.json");
  await Bun.write(manifestPath, JSON.stringify(combined));

  return combined;
}

async function compileSprite(
  spriteDir: string,
  outputDir: string,
  spriteId: string,
  svgoConfigPath: string,
  parallel: number,
  imageRegistry?: ImageRegistry,
  tileClassification?: TileClassificationEntry | null,
  maxPageDimension?: number
): Promise<CompileResult> {
  try {
    const svgFiles = fs
      .readdirSync(spriteDir)
      .filter((f) => f.endsWith(".svg"))
      .map((f) => path.join(spriteDir, f));

    if (svgFiles.length === 0) {
      return { spriteId, success: false, error: "No SVG files" };
    }

    const totalInputSize = await calculateInputSize(svgFiles);
    const groups = groupByAnimation(svgFiles);

    // Apply sprite-specific frame limits (e.g., static animations → 1 frame)
    applyFrameLimits(groups, spriteId);

    fs.mkdirSync(outputDir, { recursive: true });

    const opts: OptimizationOptions = {
      shortIds: true,
      minify: true,
      stripDefaults: true,
      precision: 2,
    };

    const manifests = new Map<
      string,
      { manifest: AtlasManifest; inputSize: number }
    >();
    let totalOutputSize = 0;

    const singleAnimation = groups.length === 1;

    for (let i = 0; i < groups.length; i += parallel) {
      const batch = groups.slice(i, i + parallel);
      const results = await Promise.all(
        batch.map((group) => {
          const animMeta = loadAnimationMeta(outputDir, group.name);
          const spriteOverrides = spriteConfig.sprites?.[spriteId];
          return compileAnimation(
            group,
            outputDir,
            svgoConfigPath,
            opts,
            singleAnimation,
            imageRegistry,
            maxPageDimension,
            animMeta,
            spriteOverrides?.hairToggle
          );
        })
      );

      for (let j = 0; j < batch.length; j++) {
        const result = results[j];
        if (result) {
          manifests.set(batch[j].name, {
            manifest: result.manifest,
            inputSize: result.inputSize,
          });
          totalOutputSize += result.outputSize;
        }
      }
    }

    await generateCombinedManifest(
      spriteId,
      outputDir,
      manifests,
      totalInputSize,
      totalOutputSize,
      singleAnimation,
      tileClassification ?? null
    );

    // Aggregate element dedup stats across animations
    let elemTotal = 0, elemUnique = 0, elemPooled = 0, elemBase = 0, elemFlips = 0;
    for (const { manifest } of manifests.values()) {
      if (manifest.elementDedup) {
        elemTotal += manifest.elementDedup.totalElements;
        elemUnique += manifest.elementDedup.uniqueElements;
        elemPooled += manifest.elementDedup.pooledElements;
        elemBase += manifest.elementDedup.baseElements;
        elemFlips += manifest.elementDedup.flipPairs;
      }
    }

    return {
      spriteId,
      success: true,
      inputSize: totalInputSize,
      outputSize: totalOutputSize,
      animationCount: manifests.size,
      elementDedup: elemTotal > 0 ? { total: elemTotal, unique: elemUnique, pooled: elemPooled, base: elemBase, flips: elemFlips } : undefined,
    };
  } catch (error) {
    return {
      spriteId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function findSpriteDirectories(inputBase: string): string[] {
  if (!fs.existsSync(inputBase)) {
    return [];
  }

  return fs
    .readdirSync(inputBase, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .sort((a, b) => {
      const aNum = parseInt(a, 10);
      const bNum = parseInt(b, 10);
      if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
        return aNum - bNum;
      }
      return a.localeCompare(b);
    });
}

interface CompileOptions {
  inputBase: string;
  outputBase: string;
  svgoConfig?: string;
  parallel: number;
  exportImages?: string;
  webBasePath?: string;
  tileClassifications?: string;
  tileType?: "ground" | "objects";
  maxPageDimension?: number;
}

async function compileAll(options: CompileOptions): Promise<void> {
  const { inputBase, outputBase, svgoConfig, parallel, exportImages, webBasePath, tileClassifications: tileClassPath, tileType, maxPageDimension } = options;

  // Load sprite config (frame limits, hair behavior, etc.)
  spriteConfig = loadSpriteConfig();

  logger.info("=== SVG Sprite Compiler ===");
  logger.info(`Input: ${inputBase}`);
  logger.info(`Output: ${outputBase}`);

  if (!fs.existsSync(inputBase)) {
    throw new Error(`Input directory does not exist: ${inputBase}`);
  }

  const spriteIds = findSpriteDirectories(inputBase);

  if (spriteIds.length === 0) {
    throw new Error(`No sprite directories found in: ${inputBase}`);
  }

  logger.info(`Found ${spriteIds.length} sprites`);

  fs.mkdirSync(outputBase, { recursive: true });

  // Initialize image registry if export-images is enabled
  let imageRegistry: ImageRegistry | undefined;
  if (exportImages) {
    const imageOutputDir = path.resolve(exportImages);
    logger.info(`Exporting rasterized images to: ${imageOutputDir}`);
    if (webBasePath) {
      logger.info(`Using web base path: ${webBasePath}`);
    }
    imageRegistry = loadImageRegistry(imageOutputDir, webBasePath);
    logger.info(
      `Loaded ${imageRegistry.images.size} existing images from registry`
    );
  }

  // Load tile classifications if provided
  let classifications: TileClassifications | null = null;

  if (tileClassPath) {
    classifications = loadTileClassifications(path.resolve(tileClassPath));

    if (classifications) {
      const groundCount = Object.keys(classifications.ground).length;
      const objectsCount = Object.keys(classifications.objects).length;
      logger.info(
        `Loaded tile classifications: ${groundCount} ground, ${objectsCount} objects`
      );
    } else {
      logger.warn(`Could not load tile classifications from: ${tileClassPath}`);
    }
  }

  const svgoConfigPath =
    svgoConfig ?? path.join(import.meta.dir, "..", "svgo.config.mjs");

  let success = 0;
  let failed = 0;
  let totalInputSize = 0;
  let totalOutputSize = 0;
  let totalElemDedup = { total: 0, unique: 0, pooled: 0, base: 0, flips: 0 };

  for (let i = 0; i < spriteIds.length; i++) {
    const spriteId = spriteIds[i];
    const spriteDir = path.join(inputBase, spriteId);
    const outputDir = path.join(outputBase, spriteId);

    const svgCount = fs
      .readdirSync(spriteDir)
      .filter((f) => f.endsWith(".svg")).length;
    if (svgCount === 0) {
      logger.info(
        `[${i + 1}/${spriteIds.length}] Skipping ${spriteId} (no SVG files)`
      );
      continue;
    }

    // Look up tile classification for this sprite
    const tileClass = lookupTileClassification(
      classifications,
      spriteId,
      tileType ?? null
    );

    const result = await compileSprite(
      spriteDir,
      outputDir,
      spriteId,
      svgoConfigPath,
      parallel,
      imageRegistry,
      tileClass,
      maxPageDimension
    );

    if (result.success) {
      success++;
      totalInputSize += result.inputSize ?? 0;
      totalOutputSize += result.outputSize ?? 0;

      const compression = result.inputSize
        ? Math.round((1 - (result.outputSize ?? 0) / result.inputSize) * 100)
        : 0;

      const elemInfo = result.elementDedup
        ? `, elem: ${result.elementDedup.pooled} pooled/${result.elementDedup.unique} unique` +
          (result.elementDedup.base > 0 ? `, ${result.elementDedup.base} base` : "") +
          (result.elementDedup.flips > 0 ? `, ${result.elementDedup.flips} flips` : "")
        : "";
      logger.info(
        `[${i + 1}/${spriteIds.length}] ${spriteId}: ${result.animationCount} anims, ` +
          `${formatBytes(result.inputSize ?? 0)} -> ${formatBytes(result.outputSize ?? 0)} (${compression}%)${elemInfo}`
      );

      if (result.elementDedup) {
        totalElemDedup.total += result.elementDedup.total;
        totalElemDedup.unique += result.elementDedup.unique;
        totalElemDedup.pooled += result.elementDedup.pooled;
        totalElemDedup.base += result.elementDedup.base;
        totalElemDedup.flips += result.elementDedup.flips;
      }
    } else {
      failed++;
      logger.error(
        `[${i + 1}/${spriteIds.length}] ${spriteId}: FAILED - ${result.error}`
      );
    }
  }

  // Save image registry if enabled
  if (imageRegistry) {
    saveImageRegistry(imageRegistry);
    logger.info(`Saved ${imageRegistry.images.size} unique images to registry`);
  }

  logger.info("=== Compilation Complete ===");
  logger.info(`Total: ${spriteIds.length}`);
  logger.info(`Success: ${success}`);
  logger.info(`Failed: ${failed}`);
  logger.info(`Input size: ${formatBytes(totalInputSize)}`);
  logger.info(`Output size: ${formatBytes(totalOutputSize)}`);

  if (totalInputSize > 0) {
    logger.info(
      `Compression: ${Math.round((1 - totalOutputSize / totalInputSize) * 100)}%`
    );
  }

  if (totalElemDedup.total > 0) {
    const elemSaved = totalElemDedup.total - totalElemDedup.unique;
    const elemPct = Math.round((elemSaved / totalElemDedup.total) * 100);
    logger.info(
      `Element dedup: ${totalElemDedup.total} total, ${totalElemDedup.unique} unique (${elemPct}% dedup), ` +
        `${totalElemDedup.pooled} pooled, ${totalElemDedup.base} base, ${totalElemDedup.flips} flip pairs`
    );
  }

  if (imageRegistry) {
    // Calculate total image size
    let totalImageSize = 0;
    for (const img of imageRegistry.images.values()) {
      totalImageSize += img.size;
    }
    logger.info(
      `Exported images: ${imageRegistry.images.size} unique files (${formatBytes(totalImageSize)})`
    );
  }
}

const program = new Command();

program
  .name("svg-spritesheet")
  .description("Compile SVG sprites into optimized atlas spritesheets")
  .version("1.0.0")
  .argument("<input>", "Input directory containing sprite subdirectories")
  .argument("<output>", "Output directory for compiled sprites")
  .option(
    "-p, --parallel <n>",
    "Number of animations to process in parallel",
    "8"
  )
  .option("-c, --config <path>", "Path to SVGO config file")
  .option(
    "-e, --export-images <path>",
    "Export rasterized images (base64) to a separate folder for cross-animation deduplication"
  )
  .option(
    "-w, --web-base-path <path>",
    "Web URL base path for image references (e.g., /assets/images). If set, absolute URLs are used instead of relative paths"
  )
  .option(
    "--tile-classifications <path>",
    "Path to tile-classifications.json (generated by tile-classifier tool)"
  )
  .option(
    "--tile-type <type>",
    "Tile type for classification lookup: ground or objects"
  )
  .option(
    "--max-page-dimension <pixels>",
    "Max atlas dimension in pixels at 1x (splits into pages if exceeded). Default: 2700 (fits 3x in 8192 GPU limit)"
  )
  .action(
    async (
      input: string,
      output: string,
      opts: { parallel: string; config?: string; exportImages?: string; webBasePath?: string; tileClassifications?: string; tileType?: string; maxPageDimension?: string }
    ) => {
      try {
        await compileAll({
          inputBase: path.resolve(input),
          outputBase: path.resolve(output),
          parallel: parseInt(opts.parallel, 10),
          svgoConfig: opts.config ? path.resolve(opts.config) : undefined,
          exportImages: opts.exportImages,
          webBasePath: opts.webBasePath,
          tileClassifications: opts.tileClassifications,
          tileType: opts.tileType as "ground" | "objects" | undefined,
          maxPageDimension: opts.maxPageDimension ? parseInt(opts.maxPageDimension, 10) : 2700,
        });
      } catch (error) {
        logger.error(`Compilation failed: ${error}`);

        process.exit(1);
      }
    }
  );

program.parse();
