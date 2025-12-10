import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { createHash } from 'crypto';
import pino from 'pino';

import {
  Swf,
  SwfExtractor,
  SvgCanvas,
  convertSvg,
  ImageFormat,
  setSubprocessRendering,
  setWorkerPoolSize,
  acquireWorkerPool,
  releaseWorkerPool,
} from '../../../../../packages/swf-extractor/src/index.ts';
import type { BitmapResolver } from '../../../../../packages/swf-extractor/src/index.ts';

const DEFAULT_PARALLELISM = Math.max(4, os.cpus().length);

export function getCharacterIds(): number[] {
  const ids: number[] = [];
  for (let classId = 1; classId <= 12; classId++) {
    ids.push(classId * 10);
    ids.push(classId * 10 + 1);
  }
  return ids;
}

export interface AnimationInfo {
  name: string;
  frameCount: number;
  isStatic: boolean;
}

export interface CharacterManifest {
  charId: number;
  fps: number;
  animations: AnimationInfo[];
}

export interface CharacterExtractionConfig {
  swfFile: string;
  charId: number;
  outputDir: string;
  scales?: number[];
  quality?: number;
  safeMode?: boolean;
}

export interface CharacterPackConfig {
  rastersDir: string;
  outputDir: string;
  charId: number;
  manifest: CharacterManifest;
  regionSize?: number;
  quality?: number;
}

/**
 * STEP 1: Extract raw frames to rasters directory.
 */
export async function extractCharacter(config: CharacterExtractionConfig): Promise<CharacterManifest> {
  const {
    swfFile,
    charId,
    outputDir,
    scales = [1.5, 2, 3],
    quality = 90,
    safeMode = true,
  } = config;

  const logger = pino({ name: 'character-extractor' });

  // Setup worker pool
  setWorkerPoolSize(DEFAULT_PARALLELISM * scales.length);
  acquireWorkerPool();
  setSubprocessRendering(safeMode);

  // Load SWF
  const swfData = fs.readFileSync(swfFile);
  const swf = Swf.fromBuffer(new Uint8Array(swfData), 0);
  const extractor = new SwfExtractor(swf);
  const frameRate = swf.header.frameRate;

  // Preload images
  const imageMap = await extractor.preloadImages();
  const bitmapResolver = SwfExtractor.createBitmapResolver(imageMap);

  // Extract all animations (each exported symbol IS an animation)
  const animations: AnimationInfo[] = [];

  for (const asset of extractor.exported()) {
    if (asset.name === '[liaison]') continue;

    const drawable = extractor.getDrawable(asset.id);
    if (!drawable) continue;

    const frameCount = drawable.framesCount(true);
    const isStatic = asset.name.toLowerCase().startsWith('static');
    const actualFrameCount = isStatic ? 1 : frameCount;

    animations.push({
      name: asset.name,
      frameCount: actualFrameCount,
      isStatic,
    });

    // Extract frames for each scale
    const bounds = drawable.bounds();
    const width = (bounds.xMax - bounds.xMin) / 20;
    const height = (bounds.yMax - bounds.yMin) / 20;

    for (const scale of scales) {
      const scaleKey = `${scale}x`;
      const animDir = path.join(outputDir, scaleKey, asset.name);
      fs.mkdirSync(animDir, { recursive: true });

      for (let frameIdx = 0; frameIdx < actualFrameCount; frameIdx++) {
        let svg: string;
        try {
          const canvas = new SvgCanvas({ bitmapResolver, subpixelStrokeWidth: false });
          canvas.area(drawable.bounds());
          drawable.draw(canvas, frameIdx);
          svg = canvas.render();
        } catch (e) {
          continue;
        }

        const targetWidth = Math.round(width * scale);
        const targetHeight = Math.round(height * scale);
        const webpBuffer = await convertSvg(svg, ImageFormat.Webp, {
          width: targetWidth,
          height: targetHeight,
          quality,
        });

        if (webpBuffer.length > 0) {
          const filepath = path.join(animDir, `frame_${frameIdx}.webp`);
          fs.writeFileSync(filepath, webpBuffer);
        }
      }
    }

    logger.debug(`Extracted ${asset.name}: ${actualFrameCount} frames`);
  }

  logger.info(`Extracted ${animations.length} animations`);

  releaseWorkerPool();

  return {
    charId,
    fps: frameRate,
    animations,
  };
}

/**
 * STEP 2: Pack raster frames into atlases with 32x32 region deduplication.
 */
export async function packCharacter(config: CharacterPackConfig): Promise<void> {
  const {
    rastersDir,
    outputDir,
    manifest,
    regionSize = 32,
    quality = 90,
  } = config;

  const logger = pino({ name: 'character-packer' });
  logger.info('Packing animations with 32x32 region deduplication...');

  const sharp = (await import('sharp')).default;
  const { MaxRectsPacker } = await import('maxrects-packer');

  const scales = ['1.5x', '2x', '3x'];

  for (const scaleKey of scales) {
    const scaleDir = path.join(rastersDir, scaleKey);
    const atlasDir = path.join(outputDir, scaleKey);
    fs.mkdirSync(atlasDir, { recursive: true });

    // Pack each regular animation into its own atlas
    const regularAnims = manifest.animations.filter(a => !a.isStatic);
    for (const anim of regularAnims) {
      const animDir = path.join(scaleDir, anim.name);
      if (!fs.existsSync(animDir)) continue;

      await packSingleAnimation(
        anim.name,
        animDir,
        path.join(atlasDir, `${anim.name}.webp`),
        regionSize,
        quality,
        sharp,
        MaxRectsPacker,
      );
    }

    // Pack all static animations into ONE combined atlas
    const staticAnims = manifest.animations.filter(a => a.isStatic);
    if (staticAnims.length > 0) {
      await packStaticAnimations(
        staticAnims,
        scaleDir,
        path.join(atlasDir, 'static.webp'),
        regionSize,
        quality,
        sharp,
        MaxRectsPacker,
      );
    }

    logger.info(`Packed ${scaleKey}: ${regularAnims.length} animations + 1 static atlas`);
  }
}

/**
 * Pack a single animation into an atlas with 32x32 region deduplication.
 */
async function packSingleAnimation(
  animName: string,
  animDir: string,
  outputPath: string,
  regionSize: number,
  quality: number,
  sharp: any,
  MaxRectsPacker: any,
): Promise<void> {
  const frameFiles = fs.readdirSync(animDir)
    .filter(name => name.endsWith('.webp'))
    .sort((a, b) => {
      const idxA = parseInt(a.split('_')[1]?.split('.')[0] ?? '0', 10);
      const idxB = parseInt(b.split('_')[1]?.split('.')[0] ?? '0', 10);
      return idxA - idxB;
    });

  if (frameFiles.length === 0) return;

  // Collect unique regions across all frames
  const uniqueRegions = new Map<string, { buffer: Buffer; width: number; height: number }>();

  for (const frameFile of frameFiles) {
    const framePath = path.join(animDir, frameFile);
    const { data, info } = await sharp(framePath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const numRegionsX = Math.ceil(info.width / regionSize);
    const numRegionsY = Math.ceil(info.height / regionSize);

    for (let ry = 0; ry < numRegionsY; ry++) {
      for (let rx = 0; rx < numRegionsX; rx++) {
        const startX = rx * regionSize;
        const startY = ry * regionSize;
        const regWidth = Math.min(regionSize, info.width - startX);
        const regHeight = Math.min(regionSize, info.height - startY);

        // Check if region has content
        let hasContent = false;
        for (let y = 0; y < regHeight && !hasContent; y++) {
          for (let x = 0; x < regWidth && !hasContent; x++) {
            const alphaIdx = ((startY + y) * info.width + (startX + x)) * 4 + 3;
            if (data[alphaIdx]! > 0) hasContent = true;
          }
        }

        if (!hasContent) continue;

        // Extract region with 4px border
        const BORDER = 4;
        const paddedWidth = regWidth + BORDER * 2;
        const paddedHeight = regHeight + BORDER * 2;
        const regionBuffer = Buffer.alloc(paddedWidth * paddedHeight * 4);

        for (let y = 0; y < paddedHeight; y++) {
          for (let x = 0; x < paddedWidth; x++) {
            const localX = Math.max(0, Math.min(regWidth - 1, x - BORDER));
            const localY = Math.max(0, Math.min(regHeight - 1, y - BORDER));
            const srcIdx = ((startY + localY) * info.width + (startX + localX)) * 4;
            const dstIdx = (y * paddedWidth + x) * 4;
            regionBuffer[dstIdx] = data[srcIdx]!;
            regionBuffer[dstIdx + 1] = data[srcIdx + 1]!;
            regionBuffer[dstIdx + 2] = data[srcIdx + 2]!;
            regionBuffer[dstIdx + 3] = data[srcIdx + 3]!;
          }
        }

        const hash = createHash('md5').update(regionBuffer).digest('hex');
        if (!uniqueRegions.has(hash)) {
          uniqueRegions.set(hash, { buffer: regionBuffer, width: paddedWidth, height: paddedHeight });
        }
      }
    }
  }

  if (uniqueRegions.size === 0) return;

  // Pack regions into atlas
  const packer = new MaxRectsPacker(4096, 4096, 1, {
    smart: true,
    pot: true,
    square: false,
    allowRotation: false,
    border: 0,
  });

  for (const [hash, region] of uniqueRegions) {
    packer.add(region.width, region.height, { hash, ...region });
  }

  if (packer.bins.length === 0) return;

  // Create atlas
  const bin = packer.bins[0]!;
  const composites = await Promise.all(
    bin.rects.map(async (rect) => {
      const data = rect.data as { hash: string; buffer: Buffer; width: number; height: number };
      return {
        input: await sharp(data.buffer, {
          raw: { width: data.width, height: data.height, channels: 4 as const },
        }).png().toBuffer(),
        left: rect.x,
        top: rect.y,
      };
    })
  );

  await sharp({
    create: {
      width: bin.width,
      height: bin.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .webp({ quality, alphaQuality: 100, effort: 4 })
    .toFile(outputPath);
}

/**
 * Pack all static animations into ONE combined atlas.
 */
async function packStaticAnimations(
  staticAnims: AnimationInfo[],
  scaleDir: string,
  outputPath: string,
  regionSize: number,
  quality: number,
  sharp: any,
  MaxRectsPacker: any,
): Promise<void> {
  const uniqueRegions = new Map<string, { buffer: Buffer; width: number; height: number }>();

  for (const anim of staticAnims) {
    const animDir = path.join(scaleDir, anim.name);
    const firstFrame = path.join(animDir, 'frame_0.webp');
    if (!fs.existsSync(firstFrame)) continue;

    const { data, info } = await sharp(firstFrame)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const numRegionsX = Math.ceil(info.width / regionSize);
    const numRegionsY = Math.ceil(info.height / regionSize);

    for (let ry = 0; ry < numRegionsY; ry++) {
      for (let rx = 0; rx < numRegionsX; rx++) {
        const startX = rx * regionSize;
        const startY = ry * regionSize;
        const regWidth = Math.min(regionSize, info.width - startX);
        const regHeight = Math.min(regionSize, info.height - startY);

        let hasContent = false;
        for (let y = 0; y < regHeight && !hasContent; y++) {
          for (let x = 0; x < regWidth && !hasContent; x++) {
            const alphaIdx = ((startY + y) * info.width + (startX + x)) * 4 + 3;
            if (data[alphaIdx]! > 0) hasContent = true;
          }
        }

        if (!hasContent) continue;

        const BORDER = 4;
        const paddedWidth = regWidth + BORDER * 2;
        const paddedHeight = regHeight + BORDER * 2;
        const regionBuffer = Buffer.alloc(paddedWidth * paddedHeight * 4);

        for (let y = 0; y < paddedHeight; y++) {
          for (let x = 0; x < paddedWidth; x++) {
            const localX = Math.max(0, Math.min(regWidth - 1, x - BORDER));
            const localY = Math.max(0, Math.min(regHeight - 1, y - BORDER));
            const srcIdx = ((startY + localY) * info.width + (startX + localX)) * 4;
            const dstIdx = (y * paddedWidth + x) * 4;
            regionBuffer[dstIdx] = data[srcIdx]!;
            regionBuffer[dstIdx + 1] = data[srcIdx + 1]!;
            regionBuffer[dstIdx + 2] = data[srcIdx + 2]!;
            regionBuffer[dstIdx + 3] = data[srcIdx + 3]!;
          }
        }

        const hash = createHash('md5').update(regionBuffer).digest('hex');
        if (!uniqueRegions.has(hash)) {
          uniqueRegions.set(hash, { buffer: regionBuffer, width: paddedWidth, height: paddedHeight });
        }
      }
    }
  }

  if (uniqueRegions.size === 0) return;

  const packer = new MaxRectsPacker(4096, 4096, 1, {
    smart: true,
    pot: true,
    square: false,
    allowRotation: false,
    border: 0,
  });

  for (const [hash, region] of uniqueRegions) {
    packer.add(region.width, region.height, { hash, ...region });
  }

  if (packer.bins.length === 0) return;

  const bin = packer.bins[0]!;
  const composites = await Promise.all(
    bin.rects.map(async (rect) => {
      const data = rect.data as { hash: string; buffer: Buffer; width: number; height: number };
      return {
        input: await sharp(data.buffer, {
          raw: { width: data.width, height: data.height, channels: 4 as const },
        }).png().toBuffer(),
        left: rect.x,
        top: rect.y,
      };
    })
  );

  await sharp({
    create: {
      width: bin.width,
      height: bin.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .webp({ quality, alphaQuality: 100, effort: 4 })
    .toFile(outputPath);
}
