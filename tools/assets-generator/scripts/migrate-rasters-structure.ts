#!/usr/bin/env npx ts-node

import * as fs from 'fs';
import * as path from 'path';
import pino from 'pino';

const logger = pino();

interface Frame {
  name: string;
  scales: {
    [resolution: string]: string;
  };
}

interface Tile {
  id: number;
  type: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  frameCount: number;
  isVector: boolean;
  behavior: string;
  frames: Frame[];
}

interface Manifest {
  type: string;
  tiles: {
    [tileId: string]: Tile;
  };
}

/**
 * Migrate rasters structure from tile_id/resolution/ to resolution/tile_id/
 * Updates manifest paths accordingly
 */
async function migrateRastersStructure(
  tilesDir: string,
  manifestPath: string,
  backupDir: string
): Promise<void> {
  logger.info(`Starting rasters structure migration`);
  logger.info(`Source: ${tilesDir}`);
  logger.info(`Manifest: ${manifestPath}`);

  // Read existing manifest
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }

  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  logger.info(`Loaded manifest with ${Object.keys(manifest.tiles).length} tiles`);

  // Backup original structure
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `rasters-backup-${timestamp}`);
  fs.mkdirSync(backupPath, { recursive: true });
  logger.info(`Creating backup at ${backupPath}`);

  // Copy entire tiles directory to backup
  execSync(`cp -r "${tilesDir}" "${backupPath}/tiles"`);

  // Get all resolutions from manifest
  const resolutions = new Set<string>();
  for (const tileData of Object.values(manifest.tiles)) {
    for (const frame of tileData.frames) {
      Object.keys(frame.scales).forEach(r => resolutions.add(r));
    }
  }

  logger.info(`Found resolutions: ${Array.from(resolutions).sort()}`);

  // Create resolution directories
  const resolutionDirs: { [res: string]: string } = {};
  for (const resolution of resolutions) {
    const resDir = path.join(tilesDir, resolution);
    if (!fs.existsSync(resDir)) {
      fs.mkdirSync(resDir, { recursive: true });
      logger.debug(`Created directory: ${resDir}`);
    }
    resolutionDirs[resolution] = resDir;
  }

  // Migrate files
  let migratedCount = 0;
  for (const [tileId] of Object.entries(manifest.tiles)) {
    const tileSourceDir = path.join(tilesDir, `tile_${tileId}`);

    if (!fs.existsSync(tileSourceDir)) {
      logger.warn(`Tile source directory not found: ${tileSourceDir}`);
      continue;
    }

    // For each resolution
    for (const resolution of resolutions) {
      const resSourceDir = path.join(tileSourceDir, resolution);

      if (!fs.existsSync(resSourceDir)) {
        logger.warn(`Resolution dir not found for tile ${tileId}: ${resSourceDir}`);
        continue;
      }

      const tileResDir = path.join(resolutionDirs[resolution], `tile_${tileId}`);
      fs.mkdirSync(tileResDir, { recursive: true });

      // Copy files from resolution subdirectory to new location
      const files = fs.readdirSync(resSourceDir);
      for (const file of files) {
        const srcFile = path.join(resSourceDir, file);
        const destFile = path.join(tileResDir, file);
        fs.copyFileSync(srcFile, destFile);
        migratedCount++;
      }
    }
  }

  logger.info(`Migrated ${migratedCount} files`);

  // Update manifest paths
  const newManifest: Manifest = {
    ...manifest,
    tiles: {},
  };

  for (const [tileId, tile] of Object.entries(manifest.tiles)) {
    const newFrames: Frame[] = tile.frames.map(frame => ({
      name: frame.name,
      scales: {} as { [res: string]: string },
    }));

    // Update scale paths
    for (const resolution of resolutions) {
      for (let frameIdx = 0; frameIdx < tile.frames.length; frameIdx++) {
        const oldPath = tile.frames[frameIdx]?.scales?.[resolution];
        if (oldPath) {
          // Old path: "resolution/filename"
          // New path: "resolution/tile_<id>/filename"
          const filename = path.basename(oldPath);
          const newPath = path.join(resolution, `tile_${tileId}`, filename);
          newFrames[frameIdx]!.scales[resolution] = newPath.replace(/\\/g, '/');
        }
      }
    }

    newManifest.tiles[tileId] = {
      ...tile,
      frames: newFrames,
    };
  }

  // Write updated manifest
  fs.writeFileSync(manifestPath, JSON.stringify(newManifest, null, 2));
  logger.info(`Updated manifest written to ${manifestPath}`);

  // Remove old tile directories
  for (const [tileId] of Object.entries(manifest.tiles)) {
    const oldTileDir = path.join(tilesDir, `tile_${tileId}`);
    if (fs.existsSync(oldTileDir)) {
      fs.rmSync(oldTileDir, { recursive: true, force: true });
      logger.debug(`Removed old directory: ${oldTileDir}`);
    }
  }

  logger.info('Migration complete!');
  logger.info(`Backup saved to: ${backupPath}`);
}

// Helper function
function execSync(command: string): string {
  const { execSync } = require('child_process');
  return execSync(command, { encoding: 'utf-8' });
}

// Main
const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Usage: npx ts-node migrate-rasters-structure.ts <tiles-dir> <manifest-path> [backup-dir]');
  console.log('');
  console.log('Example:');
  console.log('  npx ts-node migrate-rasters-structure.ts ./assets/rasters/tiles/ground ./assets/rasters/tiles/ground/manifest.json ./backups');
  process.exit(1);
}

const tilesDir = path.resolve(args[0]!);
const manifestPath = path.resolve(args[1]!);
const backupDir = args[2] ? path.resolve(args[2]) : path.dirname(tilesDir);

migrateRastersStructure(tilesDir, manifestPath, backupDir)
  .catch(error => {
    logger.error({ error }, 'Migration failed');
    process.exit(1);
  });
