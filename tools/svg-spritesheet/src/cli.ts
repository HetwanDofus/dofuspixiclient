#!/usr/bin/env bun
/**
 * SVG Spritesheet Generator CLI
 *
 * A command-line tool for generating optimized SVG spritesheets
 * with element-level deduplication.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import pino from 'pino';

import { parseSvgFiles } from './lib/parser.ts';
import { deduplicateDefinitions, processFrames } from './lib/deduplicator.ts';
import { writeOutput, calculateInputSize, formatBytes } from './lib/generator.ts';
import { generateManifest, writeManifest, formatStats, formatAnimationList } from './lib/manifest.ts';

const logger = pino({
  name: 'svg-spritesheet',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      ignore: 'pid,hostname',
      translateTime: 'HH:MM:ss',
    },
  },
});

interface PackOptions {
  precision: string;
  inlineThreshold: string;
  dryRun: boolean;
  shortIds: boolean;
  minify: boolean;
  stripDefaults: boolean;
}

interface AnalyzeOptions {
  detailed: boolean;
}

const program = new Command();

program
  .name('svg-spritesheet')
  .description('Generate optimized SVG spritesheets with element-level deduplication')
  .version('1.0.0');

program
  .command('pack')
  .description('Pack SVG frames into an optimized spritesheet')
  .argument('<input>', 'Input directory containing SVG frames')
  .argument('<output>', 'Output directory for spritesheet files')
  .option('-p, --precision <digits>', 'Numeric precision for transforms', '2')
  .option('-t, --inline-threshold <bytes>', 'Inline definitions smaller than N bytes', '100')
  .option('-n, --dry-run', 'Analyze only, do not write output files', false)
  .option('-s, --short-ids', 'Use short sequential IDs (d0, d1) instead of hash-based', false)
  .option('-m, --minify', 'Minify output (remove whitespace/newlines)', false)
  .option('--strip-defaults', 'Remove redundant/default attributes', false)
  .option('-O, --optimize', 'Enable all optimizations (short-ids, minify, strip-defaults)', false)
  .action(async (input: string, output: string, options: PackOptions & { optimize?: boolean }) => {
    try {
      const inputDir = path.resolve(input);
      const outputDir = path.resolve(output);
      const precision = parseInt(options.precision, 10);

      // Build optimization options
      const enableAll = options.optimize ?? false;
      const optimizationOpts = {
        shortIds: enableAll || options.shortIds,
        minify: enableAll || options.minify,
        stripDefaults: enableAll || options.stripDefaults,
        precision,
      };

      logger.info(`Packing SVG sprites from: ${inputDir}`);
      logger.info(`Output directory: ${outputDir}`);
      logger.info(`Precision: ${precision} decimal places`);

      if (optimizationOpts.shortIds || optimizationOpts.minify || optimizationOpts.stripDefaults) {
        logger.info(`Optimizations: ${[
          optimizationOpts.shortIds && 'short-ids',
          optimizationOpts.minify && 'minify',
          optimizationOpts.stripDefaults && 'strip-defaults',
        ].filter(Boolean).join(', ')}`);
      }

      // Validate input directory
      if (!fs.existsSync(inputDir)) {
        logger.error(`Input directory does not exist: ${inputDir}`);
        process.exit(1);
      }

      // Find all SVG files
      const svgFiles = fs.readdirSync(inputDir)
        .filter((f) => f.endsWith('.svg'))
        .map((f) => path.join(inputDir, f))
        .sort();

      if (svgFiles.length === 0) {
        logger.error(`No SVG files found in: ${inputDir}`);
        process.exit(1);
      }

      logger.info(`Found ${svgFiles.length} SVG files`);

      // Calculate input size
      const inputSize = await calculateInputSize(svgFiles);
      logger.info(`Input size: ${formatBytes(inputSize)}`);

      // Parse all SVG files
      logger.info('Parsing SVG files...');
      let lastProgress = 0;
      const frames = await parseSvgFiles(svgFiles, (current, total) => {
        const progress = Math.floor((current / total) * 100);
        if (progress >= lastProgress + 10) {
          logger.info(`  Parsed ${current}/${total} files (${progress}%)`);
          lastProgress = progress;
        }
      });

      logger.info(`Parsed ${frames.length} frames successfully`);

      // Count total definitions before dedup
      const totalDefs = frames.reduce((sum, f) => sum + f.definitions.length, 0);
      logger.info(`Total definitions across all frames: ${totalDefs}`);

      // Deduplicate definitions
      logger.info('Deduplicating definitions...');
      const dedup = deduplicateDefinitions(frames, optimizationOpts);

      logger.info(`Unique definitions: ${dedup.stats.uniqueDefinitions}`);
      logger.info(`Definition compression: ${dedup.stats.compressionRatio.toFixed(1)}%`);
      logger.info(`Patterns found: ${dedup.stats.patternCount}`);

      // Process frames with deduplicated references
      logger.info('Processing frames...');
      const sprites = processFrames(frames, dedup);

      const duplicateFrames = sprites.filter((s) => s.duplicateOf).length;
      logger.info(`Frame-level duplicates found: ${duplicateFrames}`);

      // Extract sprite ID from input directory name
      const spriteId = path.basename(inputDir);

      if (options.dryRun) {
        logger.info('Dry run mode - not writing output files');

        // Generate manifest for stats
        const manifest = generateManifest(spriteId, sprites, dedup.stats, inputSize, 0);
        logger.info('\n' + formatStats(manifest));
        logger.info('\n' + formatAnimationList(manifest));

        return;
      }

      // Write output files
      logger.info('Writing output files...');
      const { defsSize, spritesSize, combinedSize } = await writeOutput(outputDir, frames, dedup, sprites, optimizationOpts);

      // Use combined size as the main metric (it's the usable file)
      const outputSize = combinedSize;
      logger.info(`Output size: ${formatBytes(outputSize)} (spritesheet.svg)`);
      logger.info(`  defs.svg: ${formatBytes(defsSize)}, sprites.svg: ${formatBytes(spritesSize)}`);

      // Generate and write manifest
      const manifest = generateManifest(spriteId, sprites, dedup.stats, inputSize, outputSize);
      await writeManifest(outputDir, manifest);

      // Print final stats
      logger.info('\n' + formatStats(manifest));
      logger.info('\n' + formatAnimationList(manifest));

      const compressionPercent = ((1 - outputSize / inputSize) * 100).toFixed(1);
      logger.info(`\nCompression achieved: ${compressionPercent}%`);
      logger.info(`Output written to: ${outputDir}`);

    } catch (error) {
      logger.error(`Failed to pack sprites: ${error}`);
      process.exit(1);
    }
  });

program
  .command('analyze')
  .description('Analyze SVG files without generating output')
  .argument('<input>', 'Input directory containing SVG frames')
  .option('-d, --detailed', 'Show detailed analysis', false)
  .action(async (input: string, options: AnalyzeOptions) => {
    try {
      const inputDir = path.resolve(input);

      logger.info(`Analyzing SVG sprites in: ${inputDir}`);

      // Validate input directory
      if (!fs.existsSync(inputDir)) {
        logger.error(`Input directory does not exist: ${inputDir}`);
        process.exit(1);
      }

      // Find all SVG files
      const svgFiles = fs.readdirSync(inputDir)
        .filter((f) => f.endsWith('.svg'))
        .map((f) => path.join(inputDir, f))
        .sort();

      if (svgFiles.length === 0) {
        logger.error(`No SVG files found in: ${inputDir}`);
        process.exit(1);
      }

      logger.info(`Found ${svgFiles.length} SVG files`);

      // Calculate input size
      const inputSize = await calculateInputSize(svgFiles);
      logger.info(`Total input size: ${formatBytes(inputSize)}`);
      logger.info(`Average file size: ${formatBytes(Math.floor(inputSize / svgFiles.length))}`);

      // Parse files
      logger.info('Parsing SVG files...');
      const frames = await parseSvgFiles(svgFiles);
      logger.info(`Parsed ${frames.length} frames`);

      // Analyze definitions
      const totalDefs = frames.reduce((sum, f) => sum + f.definitions.length, 0);
      const avgDefsPerFrame = (totalDefs / frames.length).toFixed(1);
      logger.info(`Total definitions: ${totalDefs}`);
      logger.info(`Average definitions per frame: ${avgDefsPerFrame}`);

      // Analyze use elements
      const totalUses = frames.reduce((sum, f) => sum + f.useElements.length, 0);
      const avgUsesPerFrame = (totalUses / frames.length).toFixed(1);
      logger.info(`Total use elements: ${totalUses}`);
      logger.info(`Average use elements per frame: ${avgUsesPerFrame}`);

      // Deduplicate to show potential savings
      logger.info('\nDeduplication Analysis:');
      const dedup = deduplicateDefinitions(frames);

      logger.info(`  Unique definitions: ${dedup.stats.uniqueDefinitions}`);
      logger.info(`  Definition reduction: ${((1 - dedup.stats.uniqueDefinitions / totalDefs) * 100).toFixed(1)}%`);
      logger.info(`  Byte reduction: ${dedup.stats.compressionRatio.toFixed(1)}%`);

      // Process for frame-level stats
      const sprites = processFrames(frames, dedup);
      const duplicateFrames = sprites.filter((s) => s.duplicateOf).length;
      logger.info(`  Frame-level duplicates: ${duplicateFrames}`);

      // Animation breakdown
      const animations = new Map<string, number>();
      for (const frame of frames) {
        const count = animations.get(frame.animationName) || 0;
        animations.set(frame.animationName, count + 1);
      }

      logger.info(`\nAnimations found: ${animations.size}`);
      if (options.detailed) {
        for (const [name, count] of Array.from(animations.entries()).sort()) {
          logger.info(`  ${name}: ${count} frames`);
        }
      }

      // Estimated output size
      const estimatedOutputRatio = 1 - dedup.stats.compressionRatio / 100;
      const estimatedOutputSize = Math.floor(inputSize * estimatedOutputRatio * 0.3); // Further reduction from frame dedup
      logger.info(`\nEstimated output size: ${formatBytes(estimatedOutputSize)}`);
      logger.info(`Estimated compression: ${((1 - estimatedOutputSize / inputSize) * 100).toFixed(1)}%`);

      if (options.detailed) {
        logger.info('\nTop definitions by reference count:');
        for (const def of dedup.stats.topDefinitions.slice(0, 10)) {
          logger.info(`  ${def.id}: ${def.refCount} refs, ${formatBytes(def.size)}`);
        }

        // Pattern analysis
        if (dedup.stats.patternCount > 0) {
          logger.info(`\nPatterns with embedded images: ${dedup.stats.patternCount}`);
        }
      }

    } catch (error) {
      logger.error(`Failed to analyze sprites: ${error}`);
      process.exit(1);
    }
  });

program.parse();
