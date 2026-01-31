import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { Command } from "commander";
import pino from "pino";

import type {
  AnimationGroup,
  AtlasManifest,
  CombinedManifest,
  CompileOptions,
  CompileResult,
  OptimizationOptions,
} from "./types.ts";
import { deduplicateDefinitions, processFrames } from "./lib/deduplicator.ts";
import {
  calculateInputSize,
  formatBytes,
  writeAtlasOutput,
} from "./lib/generator.ts";
import { parseSvgFiles } from "./lib/parser.ts";

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
  opts: OptimizationOptions
): Promise<{
  manifest: AtlasManifest;
  outputSize: number;
  inputSize: number;
} | null> {
  const animOutputDir = path.join(outputDir, group.name);

  if (group.files.length === 0) {
    return null;
  }

  const inputSize = await calculateInputSize(group.files);
  const frames = await parseSvgFiles(group.files);

  if (frames.length === 0) {
    return null;
  }

  const dedup = deduplicateDefinitions(frames, opts);
  const sprites = processFrames(frames, dedup);

  fs.mkdirSync(animOutputDir, { recursive: true });
  await writeAtlasOutput(animOutputDir, frames, dedup, sprites, opts);

  const atlasPath = path.join(animOutputDir, "atlas.svg");

  try {
    await runSvgo(atlasPath, svgoConfigPath);
  } catch {
    // SVGO failure is non-fatal
  }

  const finalSize = fs.statSync(atlasPath).size;
  const manifestPath = path.join(animOutputDir, "atlas.json");
  const manifestContent = fs.readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(manifestContent) as AtlasManifest;

  return { manifest, outputSize: finalSize, inputSize };
}

async function generateCombinedManifest(
  spriteId: string,
  outputDir: string,
  manifests: Map<string, { manifest: AtlasManifest; inputSize: number }>,
  totalInputSize: number,
  totalOutputSize: number
): Promise<CombinedManifest> {
  let totalFrames = 0;
  let uniqueFrames = 0;

  const animations: CombinedManifest["animations"] = {};

  for (const [animName, { manifest }] of manifests) {
    const frameCount = manifest.frameOrder.length;
    const uniqueCount = manifest.frames.length;
    totalFrames += frameCount;
    uniqueFrames += uniqueCount;

    animations[animName] = {
      frameCount,
      uniqueFrames: uniqueCount,
      atlasWidth: manifest.width,
      atlasHeight: manifest.height,
      file: `${animName}/atlas.svg`,
      manifestFile: `${animName}/atlas.json`,
    };
  }

  const combined: CombinedManifest = {
    version: 1,
    spriteId,
    generatedAt: new Date().toISOString(),
    totalAnimations: manifests.size,
    totalFrames,
    uniqueFrames,
    totalInputSize,
    totalOutputSize,
    compressionPercent:
      Math.round((1 - totalOutputSize / totalInputSize) * 1000) / 10,
    animations,
  };

  const manifestPath = path.join(outputDir, "manifest.json");
  await Bun.write(manifestPath, JSON.stringify(combined, null, 2));

  return combined;
}

async function compileSprite(
  spriteDir: string,
  outputDir: string,
  spriteId: string,
  svgoConfigPath: string,
  parallel: number
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

    for (let i = 0; i < groups.length; i += parallel) {
      const batch = groups.slice(i, i + parallel);
      const results = await Promise.all(
        batch.map((group) =>
          compileAnimation(group, outputDir, svgoConfigPath, opts)
        )
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
      totalOutputSize
    );

    return {
      spriteId,
      success: true,
      inputSize: totalInputSize,
      outputSize: totalOutputSize,
      animationCount: manifests.size,
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

async function compileAll(options: CompileOptions): Promise<void> {
  const { inputBase, outputBase, svgoConfig, parallel } = options;

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

  const svgoConfigPath =
    svgoConfig ?? path.join(import.meta.dir, "..", "svgo.config.mjs");

  let success = 0;
  let failed = 0;
  let totalInputSize = 0;
  let totalOutputSize = 0;

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

    const result = await compileSprite(
      spriteDir,
      outputDir,
      spriteId,
      svgoConfigPath,
      parallel
    );

    if (result.success) {
      success++;
      totalInputSize += result.inputSize ?? 0;
      totalOutputSize += result.outputSize ?? 0;

      const compression = result.inputSize
        ? Math.round((1 - (result.outputSize ?? 0) / result.inputSize) * 100)
        : 0;

      logger.info(
        `[${i + 1}/${spriteIds.length}] ${spriteId}: ${result.animationCount} anims, ` +
          `${formatBytes(result.inputSize ?? 0)} -> ${formatBytes(result.outputSize ?? 0)} (${compression}%)`
      );
    } else {
      failed++;
      logger.error(
        `[${i + 1}/${spriteIds.length}] ${spriteId}: FAILED - ${result.error}`
      );
    }
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
  .action(
    async (
      input: string,
      output: string,
      opts: { parallel: string; config?: string }
    ) => {
      try {
        await compileAll({
          inputBase: path.resolve(input),
          outputBase: path.resolve(output),
          parallel: parseInt(opts.parallel, 10),
          svgoConfig: opts.config ? path.resolve(opts.config) : undefined,
        });
      } catch (error) {
        logger.error(`Compilation failed: ${error}`);

        process.exit(1);
      }
    }
  );

program.parse();
