#!/usr/bin/env npx ts-node

import * as path from 'path';
import * as fs from 'fs';
import pino from 'pino';
import { AssetPack } from '@assetpack/core';
import { texturePacker, texturePackerCompress } from '@assetpack/core/texture-packer';

const logger = pino();

const args = process.argv.slice(2);

if (args.length < 1) {
  console.log('Usage: npx ts-node pack-tiles.ts <base-tiles-dir> [output-base-dir]');
  console.log('');
  console.log('Example:');
  console.log('  npx ts-node pack-tiles.ts ./assets/rasters/tiles ./assets/packed');
  console.log('');
  console.log('This will pack both ground and objects:');
  console.log('  - ground tiles: ./assets/rasters/tiles/ground -> ./assets/packed/ground');
  console.log('  - objects tiles: ./assets/rasters/tiles/objects -> ./assets/packed/objects');
  process.exit(1);
}

const baseTilesDir = path.resolve(args[0]!);
const baseOutputDir = args[1] ? path.resolve(args[1]) : path.join(baseTilesDir, '..', 'packed');

const tileTypes = ['ground', 'objects'];

/**
 * Flatten tile directory structure for AssetPack
 * AssetPack needs images at top level of input directory
 */
async function flattenTilesForPacking(
  sourceTilesDir: string,
  flatDir: string
): Promise<void> {
  if (!fs.existsSync(flatDir)) {
    fs.mkdirSync(flatDir, { recursive: true });
  }

  // Get all resolution directories
  const resolutions = fs
    .readdirSync(sourceTilesDir)
    .filter(file => /^\d+(\.\d+)?x$/.test(file));

  logger.info(`Flattening for resolutions: ${resolutions}`);

  for (const resolution of resolutions) {
    const resDir = path.join(sourceTilesDir, resolution);
    const flatResDir = path.join(flatDir, resolution);

    if (!fs.existsSync(flatResDir)) {
      fs.mkdirSync(flatResDir, { recursive: true });
    }

    // Walk through all tile directories and copy images to flat structure
    const tileDirs = fs
      .readdirSync(resDir)
      .filter(file => /^tile_\d+$/.test(file));

    for (const tileDir of tileDirs) {
      const tilePath = path.join(resDir, tileDir);
      const files = fs.readdirSync(tilePath);

      for (const file of files) {
        const srcFile = path.join(tilePath, file);
        const destFile = path.join(flatResDir, file);
        fs.copyFileSync(srcFile, destFile);
      }
    }

    logger.info(`Flattened ${resolution}: ${fs.readdirSync(flatResDir).length} images`);
  }
}

/**
 * Pack tiles with AssetPack
 */
async function packTilesWithAssetPack(
  flatDir: string,
  outputDir: string,
  tileType: string
): Promise<number> {
  const startTime = Date.now();

  logger.info(`Packing ${tileType} tiles from ${flatDir}`);

  // Get resolutions
  const resolutions = fs
    .readdirSync(flatDir)
    .filter(file => /^\d+(\.\d+)?x$/.test(file))
    .sort();

  if (resolutions.length === 0) {
    throw new Error(`No resolution directories found in ${flatDir}`);
  }

  // Pack each resolution
  const atlasManifests: { [res: string]: any } = {};

  for (const resolution of resolutions) {
    const resInput = path.join(flatDir, resolution);
    const resOutput = path.join(outputDir, resolution);

    logger.info(`Packing ${resolution}...`);

    const assetpack = new AssetPack({
      entry: resInput,
      output: resOutput,
      pipes: [
        texturePacker({
          texturePacker: {
            padding: 2,
            nameStyle: 'relative',
            removeFileExtension: false,
          },
          resolutionOptions: {
            template: '@%%x',
            resolutions: { default: 1 },
            fixedResolution: 'default',
            maximumTextureSize: 4096 * 3,
          },
        }),
        texturePackerCompress({
          png: false,
          webp: {
            quality: 95,
          },
        }),
      ],
    });

    await assetpack.run();

    const manifestPath = path.join(resOutput, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      atlasManifests[resolution] = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      logger.info(`✓ ${resolution} complete`);
    }
  }

  // Write combined manifest
  const combinedManifest = {
    version: '1.0.0',
    type: tileType,
    generatedAt: new Date().toISOString(),
    atlases: atlasManifests,
  };

  const manifestPath = path.join(outputDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(combinedManifest, null, 2));

  const duration = Date.now() - startTime;
  return duration;
}

(async () => {
  try {
    let totalDuration = 0;

    for (const tileType of tileTypes) {
      const tilesDir = path.join(baseTilesDir, tileType);
      const outputDir = path.join(baseOutputDir, tileType);
      const flatDir = path.join(outputDir, '.flat-temp');

      if (!fs.existsSync(tilesDir)) {
        logger.warn(`Skipping ${tileType}: directory not found at ${tilesDir}`);
        continue;
      }

      console.log(`\nPacking ${tileType} tiles...`);
      console.log(`  Input: ${tilesDir}`);
      console.log(`  Output: ${outputDir}`);

      // Flatten structure
      await flattenTilesForPacking(tilesDir, flatDir);

      // Pack
      const duration = await packTilesWithAssetPack(flatDir, outputDir, tileType);
      totalDuration += duration;

      // Cleanup temp directory
      fs.rmSync(flatDir, { recursive: true, force: true });

      console.log(`✓ ${tileType} complete in ${duration}ms`);
      console.log(`  Manifest: ${path.join(outputDir, 'manifest.json')}`);
    }

    console.log(`\n✓ All packing complete! Total duration: ${totalDuration}ms`);
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Packing failed:');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
})();
