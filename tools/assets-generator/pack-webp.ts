/**
 * Pack existing WebP raster tiles into WebP atlases with region-based deduplication.
 * Run this after extraction to continue from where it left off.
 * 
 * This uses region-based frame deduplication which:
 * - Divides each frame into grid regions (e.g., 64x64 pixels)
 * - Deduplicates identical regions across all frames
 * - Results in much smaller atlases for animations where only parts change
 */
import * as fs from 'fs';
import * as path from 'path';
import { packTilesToWebp, type GameWebpManifest } from './src/lib/webp-packer.ts';

interface TileData {
  id: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  frameCount: number;
  behavior: string | null;
  fps?: number;
  autoplay?: boolean;
  loop?: boolean;
}

interface TileManifest {
  type: 'ground' | 'objects';
  tiles: { [tileId: string]: TileData };
}

const assetsPath = path.resolve(__dirname, '../../');
const gameAssetsPath = path.join(assetsPath, 'apps/game/public/assets/maps/tilesv4');

console.log('📦 Packing tiles into WebP atlases with region deduplication...');

// Load extraction manifests for tile metadata
const groundsManifestPath = path.join(assetsPath, 'assets/rasters/grounds/manifest.json');
const objectsManifestPath = path.join(assetsPath, 'assets/rasters/objects/manifest.json');

const groundsManifest: TileManifest | null = fs.existsSync(groundsManifestPath)
  ? JSON.parse(fs.readFileSync(groundsManifestPath, 'utf-8'))
  : null;

const objectsManifest: TileManifest | null = fs.existsSync(objectsManifestPath)
  ? JSON.parse(fs.readFileSync(objectsManifestPath, 'utf-8'))
  : null;

// Pack each tile type into WebP atlases
const [groundsResult, objectsResult] = await Promise.all([
  packTilesToWebp({
    inputDir: path.join(assetsPath, 'assets/rasters/grounds'),
    outputDir: path.join(assetsPath, 'assets/output/grounds-webp'),
    tileType: 'ground',
    tileMetadata: groundsManifest?.tiles,
    maxAtlasSize: 4096 * 3,
    quality: 95,
    regionSize: 96, // 64x64 pixel regions for deduplication
    parallelism: 4, // Reduce parallelism to avoid memory issues
  }),
  packTilesToWebp({
    inputDir: path.join(assetsPath, 'assets/rasters/objects'),
    outputDir: path.join(assetsPath, 'assets/output/objects-webp'),
    tileType: 'objects',
    tileMetadata: objectsManifest?.tiles,
    maxAtlasSize: 4096 * 3,
    quality: 95,
    regionSize: 96,
    parallelism: 4, // Reduce parallelism to avoid memory issues
  }),
]);

// Combine game manifests and write to game assets
if (groundsResult.gameManifest || objectsResult.gameManifest) {
  const combinedManifest: GameWebpManifest = {
    version: 2,
    format: 'webp-regions',
    scales: [],
    tiles: {},
  };

  const scalesSet = new Set<number>();

  // Merge grounds
  if (groundsResult.gameManifest) {
    for (const scale of groundsResult.gameManifest.scales) scalesSet.add(scale);
    Object.assign(combinedManifest.tiles, groundsResult.gameManifest.tiles);
  }

  // Merge objects
  if (objectsResult.gameManifest) {
    for (const scale of objectsResult.gameManifest.scales) scalesSet.add(scale);
    Object.assign(combinedManifest.tiles, objectsResult.gameManifest.tiles);
  }

  combinedManifest.scales = Array.from(scalesSet).sort((a, b) => a - b);

  // Write combined manifest
  fs.mkdirSync(gameAssetsPath, { recursive: true });
  const manifestPath = path.join(gameAssetsPath, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(combinedManifest, null, 2));
  console.log(`✅ Game manifest written to ${manifestPath}`);
  console.log(`   Format: ${combinedManifest.format}`);
  console.log(`   Scales: ${combinedManifest.scales.join(', ')}`);
  console.log(`   Tiles: ${Object.keys(combinedManifest.tiles).length}`);

  // Copy WebP files to game assets
  console.log('\n📦 Copying WebP files to game assets...');
  let copied = 0;

  for (const [tileType, outputDir] of [
    ['ground', path.join(assetsPath, 'assets/output/grounds-webp')],
    ['objects', path.join(assetsPath, 'assets/output/objects-webp')],
  ] as const) {
    for (const scaleDir of fs.readdirSync(outputDir)) {
      if (!scaleDir.endsWith('x')) continue;
      const scalePath = path.join(outputDir, scaleDir);
      if (!fs.statSync(scalePath).isDirectory()) continue;

      const destDir = path.join(gameAssetsPath, tileType, scaleDir);
      fs.mkdirSync(destDir, { recursive: true });

      for (const file of fs.readdirSync(scalePath)) {
        if (!file.endsWith('.webp')) continue;
        const src = path.join(scalePath, file);
        const dest = path.join(destDir, file);
        fs.copyFileSync(src, dest);
        copied++;
      }
    }
  }
  console.log(`✅ Copied ${copied} WebP files`);
}

// Print statistics
console.log('\n📊 Statistics:');
console.log(`   Grounds: ${groundsResult.stats.totalFrames} frames, ${groundsResult.stats.uniqueRegions}/${groundsResult.stats.totalRegions} unique regions`);
console.log(`   Objects: ${objectsResult.stats.totalFrames} frames, ${objectsResult.stats.uniqueRegions}/${objectsResult.stats.totalRegions} unique regions`);
console.log(`   Total size: ${((groundsResult.stats.totalSizeBytes + objectsResult.stats.totalSizeBytes) / 1024 / 1024).toFixed(1)} MB`);

console.log('\n✅ WebP packing complete!');

