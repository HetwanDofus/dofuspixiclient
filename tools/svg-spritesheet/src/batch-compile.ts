#!/usr/bin/env bun
/**
 * Batch compile SVG sprites per-animation with SVGO post-processing
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import pino from 'pino';

import { parseSvgFiles } from './lib/parser.ts';
import { deduplicateDefinitions, processFrames } from './lib/deduplicator.ts';
import { writeAtlasOutput, calculateInputSize, formatBytes } from './lib/generator.ts';
import type { OptimizationOptions, AtlasManifest } from './types.ts';

const logger = pino({
  name: 'batch-compile',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      ignore: 'pid,hostname',
      translateTime: 'HH:MM:ss',
    },
  },
});

interface BatchOptions {
  inputDir: string;
  outputDir: string;
  spriteId: string;
  svgoConfig?: string;
  parallel?: number;
}

interface AnimationGroup {
  name: string;
  files: string[];
}

/**
 * Group SVG files by animation name
 */
function groupByAnimation(svgFiles: string[]): AnimationGroup[] {
  const groups = new Map<string, string[]>();

  for (const file of svgFiles) {
    const basename = path.basename(file, '.svg');
    // Extract animation name (everything before the last underscore and number)
    const match = basename.match(/^(.+)_\d+$/);
    const animName = match ? match[1] : basename;

    const existing = groups.get(animName) ?? [];
    existing.push(file);
    groups.set(animName, existing);
  }

  // Sort files within each group by frame number
  const result: AnimationGroup[] = [];
  for (const [name, files] of groups) {
    files.sort((a, b) => {
      const aMatch = path.basename(a, '.svg').match(/_(\d+)$/);
      const bMatch = path.basename(b, '.svg').match(/_(\d+)$/);
      const aNum = aMatch ? parseInt(aMatch[1], 10) : 0;
      const bNum = bMatch ? parseInt(bMatch[1], 10) : 0;
      return aNum - bNum;
    });
    result.push({ name, files });
  }

  // Sort groups by name
  result.sort((a, b) => a.name.localeCompare(b.name));

  return result;
}

/**
 * Run SVGO on a file
 */
async function runSvgo(filePath: string, configPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('svgo', ['--config', configPath, filePath, '-o', filePath], {
      stdio: 'pipe',
    });

    let stderr = '';
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`SVGO failed: ${stderr}`));
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Compile a single animation to atlas format
 */
async function compileAnimation(
  group: AnimationGroup,
  outputDir: string,
  spriteId: string,
  svgoConfigPath: string,
  opts: OptimizationOptions
): Promise<{ manifest: AtlasManifest; outputSize: number; inputSize: number } | null> {
  const animOutputDir = path.join(outputDir, group.name);

  // Skip if no files
  if (group.files.length === 0) {
    return null;
  }

  // Calculate input size
  const inputSize = await calculateInputSize(group.files);

  // Parse SVG files
  const frames = await parseSvgFiles(group.files);

  if (frames.length === 0) {
    return null;
  }

  // Deduplicate definitions
  const dedup = deduplicateDefinitions(frames, opts);

  // Process frames
  const sprites = processFrames(frames, dedup);

  // Write atlas output (pre-rendered frames in grid layout)
  fs.mkdirSync(animOutputDir, { recursive: true });
  const { atlasSize } = await writeAtlasOutput(animOutputDir, frames, dedup, sprites, opts);

  // Run SVGO on atlas
  const atlasPath = path.join(animOutputDir, 'atlas.svg');
  try {
    await runSvgo(atlasPath, svgoConfigPath);
  } catch (error) {
    logger.warn(`SVGO failed for ${group.name}: ${error}`);
  }

  // Get final size after SVGO
  const finalSize = fs.statSync(atlasPath).size;

  // Read the generated atlas manifest
  const manifestPath = path.join(animOutputDir, 'atlas.json');
  const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
  const manifest = JSON.parse(manifestContent) as AtlasManifest;

  return { manifest, outputSize: finalSize, inputSize };
}

/**
 * Generate combined manifest for all animations
 */
interface CombinedManifest {
  version: number;
  spriteId: string;
  generatedAt: string;
  totalAnimations: number;
  totalFrames: number;
  uniqueFrames: number;
  totalInputSize: number;
  totalOutputSize: number;
  compressionPercent: number;
  animations: Record<string, {
    frameCount: number;
    uniqueFrames: number;
    atlasWidth: number;
    atlasHeight: number;
    file: string;
    manifestFile: string;
  }>;
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

  const animations: CombinedManifest['animations'] = {};

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
    compressionPercent: Math.round((1 - totalOutputSize / totalInputSize) * 1000) / 10,
    animations,
  };

  // Write combined manifest
  const manifestPath = path.join(outputDir, 'manifest.json');
  await Bun.write(manifestPath, JSON.stringify(combined, null, 2));

  return combined;
}

/**
 * Main batch compile function
 */
async function batchCompile(options: BatchOptions): Promise<void> {
  const { inputDir, outputDir, spriteId, svgoConfig, parallel = 4 } = options;

  logger.info(`Batch compiling sprite ${spriteId}`);
  logger.info(`Input: ${inputDir}`);
  logger.info(`Output: ${outputDir}`);

  // Validate input
  if (!fs.existsSync(inputDir)) {
    throw new Error(`Input directory does not exist: ${inputDir}`);
  }

  // Find all SVG files
  const svgFiles = fs.readdirSync(inputDir)
    .filter((f) => f.endsWith('.svg'))
    .map((f) => path.join(inputDir, f));

  if (svgFiles.length === 0) {
    throw new Error(`No SVG files found in: ${inputDir}`);
  }

  logger.info(`Found ${svgFiles.length} SVG files`);

  // Calculate total input size
  const totalInputSize = await calculateInputSize(svgFiles);
  logger.info(`Total input size: ${formatBytes(totalInputSize)}`);

  // Group by animation
  const groups = groupByAnimation(svgFiles);
  logger.info(`Found ${groups.length} animations`);

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  // Get SVGO config path
  const svgoConfigPath = svgoConfig ?? path.join(import.meta.dir, '..', 'svgo.config.mjs');

  // Optimization options
  const opts: OptimizationOptions = {
    shortIds: true,
    minify: true,
    stripDefaults: true,
    precision: 2,
  };

  // Process animations in parallel batches
  const manifests = new Map<string, { manifest: AtlasManifest; inputSize: number }>();
  let totalOutputSize = 0;
  let completed = 0;

  const processGroup = async (group: AnimationGroup): Promise<void> => {
    const result = await compileAnimation(group, outputDir, spriteId, svgoConfigPath, opts);
    if (result) {
      manifests.set(group.name, { manifest: result.manifest, inputSize: result.inputSize });
      totalOutputSize += result.outputSize;
    }
    completed++;
    const percent = Math.round((completed / groups.length) * 100);
    logger.info(`[${percent}%] Compiled ${group.name} (${group.files.length} frames) -> ${result?.manifest.width}x${result?.manifest.height} atlas`);
  };

  // Process in parallel batches
  for (let i = 0; i < groups.length; i += parallel) {
    const batch = groups.slice(i, i + parallel);
    await Promise.all(batch.map(processGroup));
  }

  // Generate combined manifest
  const combined = await generateCombinedManifest(
    spriteId,
    outputDir,
    manifests,
    totalInputSize,
    totalOutputSize
  );

  logger.info('');
  logger.info('=== Compilation Complete ===');
  logger.info(`Animations: ${combined.totalAnimations}`);
  logger.info(`Total frames: ${combined.totalFrames}`);
  logger.info(`Unique frames: ${combined.uniqueFrames}`);
  logger.info(`Input size: ${formatBytes(combined.totalInputSize)}`);
  logger.info(`Output size: ${formatBytes(combined.totalOutputSize)}`);
  logger.info(`Compression: ${combined.compressionPercent}%`);
  logger.info(`Output: ${outputDir}`);
}

// CLI
const args = process.argv.slice(2);

if (args.length < 3) {
  console.log('Usage: bun batch-compile.ts <input-dir> <output-dir> <sprite-id> [--parallel N]');
  console.log('');
  console.log('Example:');
  console.log('  bun batch-compile.ts ./sprites/10 ./output/10 10 --parallel 8');
  process.exit(1);
}

const inputDir = path.resolve(args[0]);
const outputDir = path.resolve(args[1]);
const spriteId = args[2];

let parallel = 4;
const parallelIdx = args.indexOf('--parallel');
if (parallelIdx !== -1 && args[parallelIdx + 1]) {
  parallel = parseInt(args[parallelIdx + 1], 10);
}

batchCompile({
  inputDir,
  outputDir,
  spriteId,
  parallel,
}).catch((error) => {
  logger.error(`Batch compile failed: ${error}`);
  process.exit(1);
});
