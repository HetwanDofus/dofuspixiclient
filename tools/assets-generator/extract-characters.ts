/**
 * Extract character animations: SWF -> rasters -> packed atlases -> game assets
 */
import * as fs from 'fs';
import * as path from 'path';
import { extractCharacter, packCharacter, getCharacterIds } from './src/sub-types/characters/index.ts';

const assetsPath = path.resolve(__dirname, '../../');
const spritesSwfPath = path.join(assetsPath, 'assets/sources/clips/sprites');
const rastersPath = path.join(assetsPath, 'assets/rasters/characters');
const outputPath = path.join(assetsPath, 'assets/output/characters');
const gameAssetsPath = path.join(assetsPath, 'apps/game/public/assets/sprites/characters');

console.log('🎮 Character Animation Extraction Pipeline');
console.log('═══════════════════════════════════════════');
console.log(`   SWF Source:  ${spritesSwfPath}`);
console.log(`   Rasters:     ${rastersPath}`);
console.log(`   Output:      ${outputPath}`);
console.log(`   Game Assets: ${gameAssetsPath}\n`);

const characterIds = getCharacterIds();
const swfFiles = new Map<number, string>();

for (const id of characterIds) {
  const swfFile = path.join(spritesSwfPath, `${id}.swf`);
  if (fs.existsSync(swfFile)) {
    swfFiles.set(id, swfFile);
  }
}

console.log(`Found ${swfFiles.size}/${characterIds.length} character SWF files\n`);

const results: Array<{ charId: number; success: boolean; manifest?: any; error?: string }> = [];

// STAGE 1: Extract raw frames to rasters
console.log('📦 STAGE 1: Extracting raw frames to rasters...');
console.log('─────────────────────────────────────────────\n');

for (const [charId, swfFile] of swfFiles) {
  console.log(`Character ${charId}...`);
  const startTime = Date.now();

  try {
    const manifest = await extractCharacter({
      swfFile,
      charId,
      outputDir: path.join(rastersPath, `char_${charId}`),
      scales: [1.5, 2, 3],
      quality: 90,
    });

    const duration = Date.now() - startTime;
    const staticCount = manifest.animations.filter(a => a.isStatic).length;

    console.log(`  ✅ ${manifest.animations.length} animations (${staticCount} static) in ${(duration / 1000).toFixed(1)}s`);

    // Save raster manifest
    const manifestPath = path.join(rastersPath, `char_${charId}`, 'manifest.json');
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    results.push({ charId, success: true, manifest });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.log(`  ❌ FAILED: ${errMsg}`);
    results.push({ charId, success: false, error: errMsg });
  }
}

const extractSuccessful = results.filter(r => r.success).length;
console.log(`\n✅ Extracted: ${extractSuccessful}/${swfFiles.size} characters\n`);

// STAGE 2: Pack rasters into atlases
console.log('📦 STAGE 2: Packing atlases with 32x32 region deduplication...');
console.log('──────────────────────────────────────────────────────────────\n');

for (const result of results) {
  if (!result.success || !result.manifest) continue;

  const { charId, manifest } = result;
  console.log(`Character ${charId}...`);
  const startTime = Date.now();

  try {
    await packCharacter({
      rastersDir: path.join(rastersPath, `char_${charId}`),
      outputDir: path.join(outputPath, `char_${charId}`),
      charId,
      manifest,
      regionSize: 32,
      quality: 90,
    });

    const duration = Date.now() - startTime;
    console.log(`  ✅ Packed in ${(duration / 1000).toFixed(1)}s`);

    // Save packed manifest
    const manifestPath = path.join(outputPath, `char_${charId}`, 'manifest.json');
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.log(`  ❌ Pack failed: ${errMsg}`);
  }
}

console.log('\n✅ Packing complete\n');

// STAGE 3: Copy to game assets
console.log('📦 STAGE 3: Copying to game assets...');
console.log('──────────────────────────────────────────\n');

let copiedFiles = 0;
for (const result of results) {
  if (!result.success) continue;

  const charOutputDir = path.join(outputPath, `char_${result.charId}`);
  if (!fs.existsSync(charOutputDir)) continue;

  for (const scaleKey of ['1.5x', '2x', '3x']) {
    const srcDir = path.join(charOutputDir, scaleKey);
    if (!fs.existsSync(srcDir)) continue;

    const destDir = path.join(gameAssetsPath, `char_${result.charId}`, scaleKey);
    fs.mkdirSync(destDir, { recursive: true });

    const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.webp'));
    for (const file of files) {
      fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
      copiedFiles++;
    }
  }

  // Copy manifest
  const srcManifest = path.join(charOutputDir, 'manifest.json');
  const destManifest = path.join(gameAssetsPath, `char_${result.charId}`, 'manifest.json');
  if (fs.existsSync(srcManifest)) {
    fs.copyFileSync(srcManifest, destManifest);
  }
}

console.log(`✅ Copied ${copiedFiles} atlas files\n`);

// Build combined manifest
const combinedManifest = {
  version: 1,
  format: 'webp-32x32-regions',
  extractedAt: new Date().toISOString(),
  scales: [1.5, 2, 3],
  characters: {} as Record<number, any>,
};

for (const r of results) {
  if (r.success && r.manifest) {
    combinedManifest.characters[r.charId] = r.manifest;
  }
}

// Save combined manifests
const rastersManifestPath = path.join(rastersPath, 'manifest.json');
const outputManifestPath = path.join(outputPath, 'manifest.json');
const gameManifestPath = path.join(gameAssetsPath, 'manifest.json');

fs.writeFileSync(rastersManifestPath, JSON.stringify(combinedManifest, null, 2));
fs.writeFileSync(outputManifestPath, JSON.stringify(combinedManifest, null, 2));
fs.writeFileSync(gameManifestPath, JSON.stringify(combinedManifest, null, 2));

// Final summary
console.log('═══════════════════════════════════════════');
console.log('📊 SUMMARY');
console.log('═══════════════════════════════════════════');
const successful = results.filter(r => r.success).length;
const failed = results.filter(r => !r.success).length;
console.log(`   Successful: ${successful}`);
console.log(`   Failed:     ${failed}`);
console.log(`   Characters: ${Object.keys(combinedManifest.characters).length}`);

if (failed > 0) {
  console.log('\n❌ Failed characters:');
  for (const r of results) {
    if (!r.success) {
      console.log(`   - Character ${r.charId}: ${r.error}`);
    }
  }
}

console.log(`\n✅ Pipeline complete!`);
console.log(`   Rasters:     ${rastersManifestPath}`);
console.log(`   Output:      ${outputManifestPath}`);
console.log(`   Game Assets: ${gameManifestPath}`);
