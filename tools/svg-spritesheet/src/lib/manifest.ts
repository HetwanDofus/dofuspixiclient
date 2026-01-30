/**
 * Manifest Generator - Creates JSON manifest with animation metadata
 */
import * as path from 'node:path';
import type {
  Manifest,
  AnimationMetadata,
  ManifestStats,
  ProcessedSprite,
  DeduplicationStats,
} from '../types.ts';

/**
 * Generate manifest from processed sprites
 */
export function generateManifest(
  spriteId: string,
  sprites: ProcessedSprite[],
  deduplicationStats: DeduplicationStats,
  inputSize: number,
  outputSize: number
): Manifest {
  // Group sprites by animation
  const animationMap = new Map<string, ProcessedSprite[]>();

  for (const sprite of sprites) {
    const existing = animationMap.get(sprite.animationName) || [];
    existing.push(sprite);
    animationMap.set(sprite.animationName, existing);
  }

  // Build animations metadata
  const animations: Record<string, AnimationMetadata> = {};

  for (const [name, spriteList] of animationMap) {
    // Sort by frame index
    spriteList.sort((a, b) => a.frameIndex - b.frameIndex);

    const frames = spriteList.map((s) => s.id);
    const duplicates: Record<string, string> = {};

    for (const sprite of spriteList) {
      if (sprite.duplicateOf) {
        duplicates[sprite.id] = sprite.duplicateOf;
      }
    }

    animations[name] = {
      name,
      frameCount: spriteList.length,
      frames,
      duplicates,
    };
  }

  // Calculate stats
  const totalFrames = sprites.length;
  const duplicateFrames = sprites.filter((s) => s.duplicateOf).length;
  const uniqueFrames = totalFrames - duplicateFrames;

  const stats: ManifestStats = {
    totalFrames,
    uniqueFrames,
    duplicateFrames,
    inputSize,
    outputSize,
    compressionPercent: inputSize > 0 ? (1 - outputSize / inputSize) * 100 : 0,
    deduplication: deduplicationStats,
  };

  return {
    version: 1,
    spriteId,
    animations,
    stats,
    files: {
      spritesheet: 'spritesheet.svg',
      defs: 'defs.svg',
      sprites: 'sprites.svg',
      manifest: 'manifest.json',
    },
  };
}

/**
 * Write manifest to file
 */
export async function writeManifest(
  outputDir: string,
  manifest: Manifest
): Promise<void> {
  const manifestPath = path.join(outputDir, 'manifest.json');
  await Bun.write(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * Format manifest stats for logging
 */
export function formatStats(manifest: Manifest): string {
  const { stats } = manifest;
  const lines: string[] = [];

  lines.push('=== Spritesheet Generation Complete ===');
  lines.push('');
  lines.push(`Sprite ID: ${manifest.spriteId}`);
  lines.push(`Animations: ${Object.keys(manifest.animations).length}`);
  lines.push('');
  lines.push('Frame Statistics:');
  lines.push(`  Total frames: ${stats.totalFrames}`);
  lines.push(`  Unique frames: ${stats.uniqueFrames}`);
  lines.push(`  Duplicate frames: ${stats.duplicateFrames}`);
  lines.push('');
  lines.push('Definition Deduplication:');
  lines.push(`  Total definitions (before): ${stats.deduplication.totalDefinitions}`);
  lines.push(`  Unique definitions (after): ${stats.deduplication.uniqueDefinitions}`);
  lines.push(`  Definition compression: ${stats.deduplication.compressionRatio.toFixed(1)}%`);
  lines.push(`  Patterns found: ${stats.deduplication.patternCount}`);
  lines.push('');
  lines.push('Size Statistics:');
  lines.push(`  Input size: ${formatSize(stats.inputSize)}`);
  lines.push(`  Output size: ${formatSize(stats.outputSize)}`);
  lines.push(`  Compression: ${stats.compressionPercent.toFixed(1)}%`);
  lines.push('');
  lines.push('Output Files:');
  lines.push(`  ${manifest.files.spritesheet} (main - use this)`);
  lines.push(`  ${manifest.files.defs} (definitions only)`);
  lines.push(`  ${manifest.files.sprites} (symbols only)`);
  lines.push(`  ${manifest.files.manifest}`);

  if (stats.deduplication.topDefinitions.length > 0) {
    lines.push('');
    lines.push('Top Definitions by Reference Count:');
    for (const def of stats.deduplication.topDefinitions.slice(0, 5)) {
      lines.push(`  ${def.id}: ${def.refCount} refs, ${formatSize(def.size)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format size as human-readable string
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  } else {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }
}

/**
 * Generate animation list for logging
 */
export function formatAnimationList(manifest: Manifest): string {
  const lines: string[] = ['Animations:'];

  for (const [name, anim] of Object.entries(manifest.animations)) {
    const dupeCount = Object.keys(anim.duplicates).length;
    const dupeInfo = dupeCount > 0 ? ` (${dupeCount} duplicates)` : '';
    lines.push(`  ${name}: ${anim.frameCount} frames${dupeInfo}`);
  }

  return lines.join('\n');
}
