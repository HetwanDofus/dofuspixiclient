import * as fs from 'fs';
import * as path from 'path';
import { SwfFile } from '@/swf-file.ts';
import { SwfExtractor } from '@/extractor/swf-extractor.ts';
import { type ExtractOptions, resolveFilename } from './extract-options.ts';
import { Errors } from '@/error/errors.ts';
import type { SpriteDefinition } from '@/extractor/sprite/sprite-definition.ts';
import type { Drawable } from '@/extractor/drawable.ts';
import { Opcode, containsOpcode } from '@/parser/structure/action/opcode.ts';

/**
 * Tile behavior types.
 */
export type TileBehavior = 'static' | 'animated' | 'random' | 'slope';

/**
 * Tile metadata for manifest generation.
 */
export interface TileMetadata {
  id: number;
  type: string | null;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  frameCount: number;
  behavior: TileBehavior;
  frames: string[];
  fps?: number;
  autoplay?: boolean;
  loop?: boolean;
  rasterized?: boolean;
}

/**
 * Check if a drawable is a SpriteDefinition.
 */
function isSprite(drawable: Drawable): drawable is SpriteDefinition {
  return 'timeline' in drawable && typeof (drawable as SpriteDefinition).timeline === 'function';
}

/**
 * Determine tile behavior from ActionScript analysis.
 */
function determineTileBehavior(
  drawable: Drawable,
  frameCount: number,
  tileType: string | null,
): { type: TileBehavior; autoplay: boolean; loop: boolean } {
  const behavior = { type: 'static' as TileBehavior, autoplay: false, loop: false };

  if (frameCount <= 1 || !isSprite(drawable)) {
    return behavior;
  }

  const timeline = drawable.timeline();
  const frames = timeline.frames;
  let hasRandom = false;
  let hasStopOnFirstFrame = false;
  let hasStopOnLastFrame = false;

  for (let frameNum = 0; frameNum < frames.length; frameNum++) {
    const frame = frames[frameNum]!;
    for (const doAction of frame.actions) {
      if (containsOpcode(doAction.actions, Opcode.ActionRandomNumber)) {
        hasRandom = true;
      }
      if (containsOpcode(doAction.actions, Opcode.ActionStop)) {
        if (frameNum === 0) {
          hasStopOnFirstFrame = true;
        }
        if (frameNum === frameCount - 1) {
          hasStopOnLastFrame = true;
        }
      }
    }
  }

  // Ground tiles: slope vs random
  if (tileType === 'ground') {
    if (hasRandom) {
      return { type: 'random', autoplay: false, loop: false };
    } else {
      return { type: 'slope', autoplay: false, loop: false };
    }
  }

  // Object tiles: random vs animated
  if (hasRandom) {
    return { type: 'random', autoplay: false, loop: false };
  }

  // Multi-frame object without random = animated
  return {
    type: 'animated',
    autoplay: !hasStopOnFirstFrame,
    loop: !hasStopOnLastFrame,
  };
}

/**
 * Process a single tile and generate metadata.
 */
function processTileMetadata(
  filePath: string,
  baseName: string,
  extractor: SwfExtractor,
  tileId: number,
  frameRate: number,
  options: ExtractOptions,
): TileMetadata | null {
  const drawable = extractor.getDrawable(tileId);
  if (!drawable) return null;

  const bounds = drawable.bounds();
  const width = (bounds.xMax - bounds.xMin) / 20;
  const height = (bounds.yMax - bounds.yMin) / 20;
  const offsetX = bounds.xMin / 20;
  const offsetY = bounds.yMin / 20;

  const frameCount = drawable.framesCount(options.fullAnimation);
  const behavior = determineTileBehavior(drawable, frameCount, options.tileType);

  // Build frame list based on output filename pattern
  const frames: string[] = [];
  for (let i = 0; i < frameCount; i++) {
    const frameNum = i + 1;
    const frameName = resolveFilename(options.outputFilename, {
      basename: baseName,
      dirname: path.basename(path.dirname(filePath)),
      name: String(tileId),
      ext: 'svg',
      frame: frameCount > 1 ? frameNum : null,
      scale: null,
    });
    frames.push(frameName);
  }

  const tileData: TileMetadata = {
    id: tileId,
    type: options.tileType,
    width,
    height,
    offsetX,
    offsetY,
    frameCount,
    behavior: behavior.type,
    frames,
  };

  if (behavior.type === 'animated') {
    tileData.fps = frameRate;
    tileData.autoplay = behavior.autoplay;
    tileData.loop = behavior.loop;
  }

  return tileData;
}

/**
 * Generate manifest for exported tiles.
 */
export async function generateManifest(
  filePath: string,
  options: ExtractOptions,
): Promise<boolean> {
  const swfFile = SwfFile.fromFileSync(filePath, Errors.IGNORE_INVALID_TAG);
  const extractor = new SwfExtractor(swfFile.parser);
  const baseName = path.basename(filePath, '.swf');
  const frameRate = swfFile.frameRate;

  let success = true;

  for (const asset of extractor.exported()) {
    const tileId = parseInt(asset.name, 10);
    if (isNaN(tileId)) continue;

    try {
      const tileData = processTileMetadata(filePath, baseName, extractor, asset.id, frameRate, options);

      if (tileData) {
        const tileJsonFile = path.join(options.output, `${tileId}.json`);
        await fs.promises.mkdir(path.dirname(tileJsonFile), { recursive: true });
        await fs.promises.writeFile(tileJsonFile, JSON.stringify(tileData, null, 2));
        console.log(`Extracted tile ${tileId} with metadata to ${tileJsonFile}`);
      }
    } catch (e) {
      console.error(`Error extracting tile ${tileId}: ${e instanceof Error ? e.message : String(e)}`);
      success = false;
    }
  }

  extractor.clearCaches();
  return success;
}

