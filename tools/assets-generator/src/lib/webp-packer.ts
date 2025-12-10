/**
 * WebP Atlas Packer with Delta/Region-based Frame Deduplication
 * 
 * This packer optimizes animations by:
 * 1. Full frame deduplication (identical frames share atlas position)
 * 2. Region-based deduplication (divides frames into grid, shares identical regions)
 * 
 * The region approach dramatically reduces atlas size for animations where
 * only small portions of the frame change between keyframes.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import pino from 'pino';
import { MaxRectsPacker } from 'maxrects-packer';

import * as os from 'os';

// Re-export existing types that we'll extend
export interface WebpPackConfig {
  /** Input directory containing extracted tiles (with scale subdirectories) */
  inputDir: string;
  /** Output directory for WebP atlases */
  outputDir: string;
  /** Tile type: 'ground' or 'objects' */
  tileType: 'ground' | 'objects';
  /** Tile metadata from extraction manifest */
  tileMetadata?: { [tileId: string]: TileData };
  /** Maximum atlas size (default: 4096) */
  maxAtlasSize?: number;
  /** Padding between regions (default: 1) */
  padding?: number;
  /** WebP quality 0-100 (default: 90) */
  quality?: number;
  /** Region size for delta detection (default: 64) */
  regionSize?: number;
  /** Enable region-based deduplication (default: true) */
  enableRegionDedup?: boolean;
  /** WebP encoding effort 0-6 (default: 4, lower = faster) */
  effort?: number;
  /** Number of tiles to process in parallel (default: CPU cores) */
  parallelism?: number;
}

export interface TileData {
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

/** A region within a frame */
export interface RegionInfo {
  /** Region hash for deduplication */
  hash: string;
  /** Region position within the frame */
  regionX: number;
  regionY: number;
  /** Region size */
  width: number;
  height: number;
  /** Trimmed content bounds within the region */
  contentX: number;
  contentY: number;
  contentWidth: number;
  contentHeight: number;
  /** Actual pixel data (trimmed) */
  buffer: Buffer;
}

/** Frame after region analysis */
export interface AnalyzedFrame {
  frameIndex: number;
  sourceWidth: number;
  sourceHeight: number;
  /** Regions that make up this frame */
  regions: RegionInfo[];
  /** If this entire frame is a duplicate of another */
  duplicateOfFrame?: number;
}

/** Packed region position in atlas */
export interface PackedRegion {
  /** Region hash */
  hash: string;
  /** Atlas index */
  atlasIndex: number;
  /** Position in atlas */
  x: number;
  y: number;
  /** Size in atlas */
  width: number;
  height: number;
}

/** Single atlas file info */
export interface WebpAtlasFile {
  filename: string;
  width: number;
  height: number;
}

/** Frame region reference - how to reconstruct a frame region from the atlas */
export interface FrameRegionRef {
  /** Region grid position (regionX, regionY in region units) */
  rx: number;
  ry: number;
  /** Atlas position of this region's content */
  ax: number;
  ay: number;
  /** Content size in atlas */
  aw: number;
  ah: number;
  /** Offset within the region to place the content */
  ox: number;
  oy: number;
  /** Atlas index if multiple atlases */
  atlas?: number;
}

/** Frame manifest entry */
export interface WebpFrameInfo {
  /** Frame index */
  frame: number;
  /** Original frame dimensions */
  w: number;
  h: number;
  /** Region size used for this tile */
  rs: number;
  /** If entire frame is duplicate of another frame index */
  dup?: number;
  /** Regions that make up this frame (empty if dup is set) */
  regions?: FrameRegionRef[];
}

/** Per-tile atlas manifest */
export interface WebpTileAtlas {
  tileId: number;
  atlases: WebpAtlasFile[];
  frames: WebpFrameInfo[];
  stats: {
    totalRegions: number;
    uniqueRegions: number;
    duplicateRegions: number;
  };
}

export interface WebpScaleManifest {
  scale: string;
  tiles: { [tileId: string]: WebpTileAtlas };
}

/** Game-compatible manifest formats */
export interface GameWebpAtlasFrame {
  frame: number;
  w: number;
  h: number;
  rs: number;
  dup?: number;
  regions?: FrameRegionRef[];
}

export interface GameWebpAtlasData {
  width: number;
  height: number;
  file: string;
  files?: string[];
  frames: GameWebpAtlasFrame[];
}

export interface GameWebpTileData {
  id: number;
  type: 'ground' | 'objects';
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  frameCount: number;
  behavior: string | null;
  fps: number | null;
  autoplay: boolean | null;
  loop: boolean | null;
  atlases: Record<string, GameWebpAtlasData>;
}

export interface GameWebpManifest {
  version: 2;
  format: 'webp-regions';
  scales: number[];
  tiles: Record<string, GameWebpTileData>;
}

export interface WebpPackResult {
  scales: { [scaleKey: string]: WebpScaleManifest };
  manifestPath: string;
  gameManifest?: GameWebpManifest;
  stats: {
    totalTiles: number;
    totalFrames: number;
    uniqueFrames: number;
    duplicateFrames: number;
    totalRegions: number;
    uniqueRegions: number;
    totalSizeBytes: number;
  };
}

/**
 * Analyze a frame and extract regions for deduplication.
 */
async function analyzeFrameRegions(
  sharp: typeof import('sharp').default,
  framePath: string,
  frameIndex: number,
  regionSize: number,
): Promise<AnalyzedFrame> {
  const { data, info } = await sharp(framePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const regions: RegionInfo[] = [];
  const numRegionsX = Math.ceil(info.width / regionSize);
  const numRegionsY = Math.ceil(info.height / regionSize);

  for (let ry = 0; ry < numRegionsY; ry++) {
    for (let rx = 0; rx < numRegionsX; rx++) {
      const startX = rx * regionSize;
      const startY = ry * regionSize;
      const regWidth = Math.min(regionSize, info.width - startX);
      const regHeight = Math.min(regionSize, info.height - startY);

      // Check if region has any non-transparent pixels
      let hasContent = false;
      for (let y = 0; y < regHeight && !hasContent; y++) {
        for (let x = 0; x < regWidth && !hasContent; x++) {
          const srcX = startX + x;
          const srcY = startY + y;
          const alphaIdx = (srcY * info.width + srcX) * 4 + 3;
          if (data[alphaIdx]! > 0) {
            hasContent = true;
          }
        }
      }

      // Skip fully transparent regions
      if (!hasContent) continue;

      // Store full region with 4px border duplication to avoid compression seams
      const BORDER = 4;
      const contentWidth = regWidth;
      const contentHeight = regHeight;
      const paddedWidth = contentWidth + BORDER * 2;
      const paddedHeight = contentHeight + BORDER * 2;

      // Extract region with duplicated border pixels
      const contentBuffer = Buffer.alloc(paddedWidth * paddedHeight * 4);
      for (let y = 0; y < paddedHeight; y++) {
        for (let x = 0; x < paddedWidth; x++) {
          // Clamp to source region bounds (duplicates edge pixels)
          const localX = Math.max(0, Math.min(contentWidth - 1, x - BORDER));
          const localY = Math.max(0, Math.min(contentHeight - 1, y - BORDER));
          const srcX = startX + localX;
          const srcY = startY + localY;
          const srcIdx = (srcY * info.width + srcX) * 4;
          const dstIdx = (y * paddedWidth + x) * 4;
          contentBuffer[dstIdx] = data[srcIdx]!;
          contentBuffer[dstIdx + 1] = data[srcIdx + 1]!;
          contentBuffer[dstIdx + 2] = data[srcIdx + 2]!;
          contentBuffer[dstIdx + 3] = data[srcIdx + 3]!;
        }
      }

      const hash = createHash('md5').update(contentBuffer).digest('hex');

      regions.push({
        hash,
        regionX: rx,
        regionY: ry,
        width: regWidth,
        height: regHeight,
        contentX: BORDER,  // Offset to skip border in atlas
        contentY: BORDER,
        contentWidth: paddedWidth,  // Full padded size in atlas
        contentHeight: paddedHeight,
        buffer: contentBuffer,
      });
    }
  }

  return {
    frameIndex,
    sourceWidth: info.width,
    sourceHeight: info.height,
    regions,
  };
}

/**
 * Check if two frames are identical (all regions match).
 */
function framesAreIdentical(frame1: AnalyzedFrame, frame2: AnalyzedFrame): boolean {
  if (frame1.regions.length !== frame2.regions.length) return false;
  if (frame1.sourceWidth !== frame2.sourceWidth) return false;
  if (frame1.sourceHeight !== frame2.sourceHeight) return false;

  const hashes1 = new Map(frame1.regions.map(r => [`${r.regionX},${r.regionY}`, r.hash]));

  for (const r2 of frame2.regions) {
    const key = `${r2.regionX},${r2.regionY}`;
    if (hashes1.get(key) !== r2.hash) return false;
  }

  return true;
}

/**
 * Timeout wrapper for promises
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMsg: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMsg)), timeoutMs)
    ),
  ]);
}

/**
 * Pack a single tile's frames into WebP atlas with region deduplication.
 */
async function packTileToWebpAtlas(
  tileId: number,
  tilePath: string,
  outputDir: string,
  maxAtlasSize: number,
  padding: number,
  quality: number,
  regionSize: number,
  effort: number,
  _packLogger: pino.Logger,
): Promise<WebpTileAtlas | null> {
  // Check if tile directory exists (tiles may not exist in all scales)
  if (!fs.existsSync(tilePath)) {
    return null;
  }

  const sharp = (await import('sharp')).default;

  // Find all frame files
  const frameFiles = fs.readdirSync(tilePath)
    .filter(name => name.endsWith('.webp') || name.endsWith('.png'))
    .sort((a, b) => {
      const idxA = parseInt(a.split('_')[1]?.split('.')[0] ?? '0', 10);
      const idxB = parseInt(b.split('_')[1]?.split('.')[0] ?? '0', 10);
      return idxA - idxB;
    });

  if (frameFiles.length === 0) return null;

  // Analyze all frames for regions
  const analyzedFrames: AnalyzedFrame[] = [];
  for (const frameFile of frameFiles) {
    const framePath = path.join(tilePath, frameFile);
    const frameIndex = parseInt(frameFile.split('_')[1]?.split('.')[0] ?? '0', 10);
    const analyzed = await analyzeFrameRegions(sharp, framePath, frameIndex, regionSize);
    analyzedFrames.push(analyzed);
  }

  // Detect full frame duplicates
  const frameDuplicateMap = new Map<number, number>();
  for (let i = 1; i < analyzedFrames.length; i++) {
    for (let j = 0; j < i; j++) {
      if (!frameDuplicateMap.has(analyzedFrames[j]!.frameIndex) &&
        framesAreIdentical(analyzedFrames[i]!, analyzedFrames[j]!)) {
        frameDuplicateMap.set(analyzedFrames[i]!.frameIndex, analyzedFrames[j]!.frameIndex);
        break;
      }
    }
  }

  // Collect unique regions across all non-duplicate frames
  const uniqueRegions = new Map<string, { region: RegionInfo; sourceFrame: number }>();
  let totalRegionCount = 0;

  for (const frame of analyzedFrames) {
    if (frameDuplicateMap.has(frame.frameIndex)) continue;

    for (const region of frame.regions) {
      totalRegionCount++;
      if (!uniqueRegions.has(region.hash)) {
        uniqueRegions.set(region.hash, { region, sourceFrame: frame.frameIndex });
      }
    }
  }

  if (uniqueRegions.size === 0) return null;

  // Pack unique regions into atlas
  const packer = new MaxRectsPacker(maxAtlasSize, maxAtlasSize, padding, {
    smart: true,
    pot: true,
    square: false,
    allowRotation: false,
    border: 0,
  });

  for (const [hash, { region }] of uniqueRegions) {
    packer.add(region.contentWidth, region.contentHeight, { hash, region });
  }

  if (packer.bins.length === 0) {
    return null;
  }

  // Build region position map
  const regionPositions = new Map<string, PackedRegion>();
  const atlasFiles: WebpAtlasFile[] = [];

  for (let atlasIndex = 0; atlasIndex < packer.bins.length; atlasIndex++) {
    const bin = packer.bins[atlasIndex]!;

    for (const rect of bin.rects) {
      const data = rect.data as { hash: string; region: RegionInfo };
      regionPositions.set(data.hash, {
        hash: data.hash,
        atlasIndex,
        x: rect.x,
        y: rect.y,
        width: data.region.contentWidth,
        height: data.region.contentHeight,
      });
    }

    // Create atlas image
    const composites = bin.rects.map(rect => {
      const data = rect.data as { hash: string; region: RegionInfo };
      return {
        input: sharp(data.region.buffer, {
          raw: { width: data.region.contentWidth, height: data.region.contentHeight, channels: 4 as const },
        }).png().toBuffer(),
        left: rect.x,
        top: rect.y,
      };
    });

    // Resolve all buffers
    const resolvedComposites = await Promise.all(
      composites.map(async c => ({ input: await c.input, left: c.left, top: c.top }))
    );

    const suffix = packer.bins.length > 1 ? `_${atlasIndex}` : '';
    const atlasFilename = `tile_${tileId}${suffix}.webp`;
    const atlasPath = path.join(outputDir, atlasFilename);

    await sharp({
      create: {
        width: bin.width,
        height: bin.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(resolvedComposites)
      .webp({ quality, alphaQuality: 100, effort })
      .toFile(atlasPath);

    atlasFiles.push({ filename: atlasFilename, width: bin.width, height: bin.height });
  }

  // Build frame manifest
  const frames: WebpFrameInfo[] = analyzedFrames.map(frame => {
    const dupOf = frameDuplicateMap.get(frame.frameIndex);
    if (dupOf !== undefined) {
      return { frame: frame.frameIndex, w: frame.sourceWidth, h: frame.sourceHeight, rs: regionSize, dup: dupOf };
    }

    const regions: FrameRegionRef[] = frame.regions.map(region => {
      const pos = regionPositions.get(region.hash)!;
      const ref: FrameRegionRef = {
        rx: region.regionX,
        ry: region.regionY,
        ax: pos.x,
        ay: pos.y,
        aw: pos.width,
        ah: pos.height,
        ox: region.contentX,
        oy: region.contentY,
      };
      if (packer.bins.length > 1) ref.atlas = pos.atlasIndex;
      return ref;
    });

    return { frame: frame.frameIndex, w: frame.sourceWidth, h: frame.sourceHeight, rs: regionSize, regions };
  });

  return {
    tileId,
    atlases: atlasFiles,
    frames,
    stats: {
      totalRegions: totalRegionCount,
      uniqueRegions: uniqueRegions.size,
      duplicateRegions: totalRegionCount - uniqueRegions.size,
    },
  };
}

/**
 * Pack tiles into WebP atlases with region-based deduplication.
 * One atlas per tile containing all its unique regions.
 */
export async function packTilesToWebp(config: WebpPackConfig): Promise<WebpPackResult> {
  const {
    inputDir,
    outputDir,
    tileType,
    tileMetadata,
    maxAtlasSize = 4096,
    padding = 1,
    quality = 90,
    regionSize = 64,
    effort = 4,  // 0-6, lower = faster encoding
    parallelism = Math.min(8, os.cpus().length),  // Limit to 8 to avoid memory issues
  } = config;

  const packLogger = pino({ name: 'webp-packer' });

  // Find scale directories
  const scaleKeys = fs.readdirSync(inputDir)
    .filter(name => /^[\d.]+x$/.test(name) && fs.statSync(path.join(inputDir, name)).isDirectory())
    .sort();

  if (scaleKeys.length === 0) {
    throw new Error(`No scale directories found in ${inputDir}`);
  }

  packLogger.info(`Found scales: ${scaleKeys.join(', ')}`);
  packLogger.info(`Region size: ${regionSize}px, Effort: ${effort}, Parallelism: ${parallelism}`);

  const result: WebpPackResult = {
    scales: {},
    manifestPath: path.join(outputDir, 'atlas-manifest.json'),
    stats: {
      totalTiles: 0,
      totalFrames: 0,
      uniqueFrames: 0,
      duplicateFrames: 0,
      totalRegions: 0,
      uniqueRegions: 0,
      totalSizeBytes: 0,
    },
  };

  // Build game manifest if metadata provided
  const gameManifest: GameWebpManifest | undefined = tileMetadata
    ? { version: 2, format: 'webp-regions', scales: [], tiles: {} }
    : undefined;
  const scalesSet = new Set<number>();

  // Process each scale
  for (const scaleKey of scaleKeys) {
    const scaleDir = path.join(inputDir, scaleKey);
    const scaleOutputDir = path.join(outputDir, scaleKey);
    fs.mkdirSync(scaleOutputDir, { recursive: true });

    const scaleNum = parseFloat(scaleKey.replace('x', ''));
    scalesSet.add(scaleNum);

    packLogger.info(`Processing ${scaleKey}...`);

    const tileDirs = fs.readdirSync(scaleDir)
      .filter(name => name.startsWith('tile_') && fs.statSync(path.join(scaleDir, name)).isDirectory())
      .sort((a, b) => parseInt(a.replace('tile_', ''), 10) - parseInt(b.replace('tile_', ''), 10));

    // Filter out already-processed tiles (resume capability)
    const pendingTileDirs = tileDirs.filter(tileDir => {
      const tileId = parseInt(tileDir.replace('tile_', ''), 10);
      const outputFile = path.join(scaleOutputDir, `tile_${tileId}_atlas.webp`);
      return !fs.existsSync(outputFile);
    });

    const skippedCount = tileDirs.length - pendingTileDirs.length;
    if (skippedCount > 0) {
      packLogger.info(`  Skipping ${skippedCount} already-processed tiles`);
    }
    packLogger.info(`  Processing ${pendingTileDirs.length} tiles (${parallelism} in parallel)`);

    const scaleManifest: WebpScaleManifest = { scale: scaleKey, tiles: {} };
    let processedCount = 0;
    let errorCount = 0;

    // Process tiles in parallel batches
    for (let i = 0; i < pendingTileDirs.length; i += parallelism) {
      const batch = pendingTileDirs.slice(i, i + parallelism);
      const batchTileIds = batch.map(d => parseInt(d.replace('tile_', ''), 10));

      if (i % (parallelism * 10) === 0) {
        packLogger.info(`  Starting batch ${Math.floor(i / parallelism) + 1}: tiles [${batchTileIds.join(', ')}]`);
      }

      const batchResults = await Promise.allSettled(
        batch.map(async (tileDir) => {
          const tileId = parseInt(tileDir.replace('tile_', ''), 10);
          const tilePath = path.join(scaleDir, tileDir);

          // Add timeout (5 minutes per tile)
          const tileAtlas = await withTimeout(
            packTileToWebpAtlas(
              tileId,
              tilePath,
              scaleOutputDir,
              maxAtlasSize,
              padding,
              quality,
              regionSize,
              effort,
              packLogger,
            ),
            5 * 60 * 1000,
            `Tile ${tileId} timed out after 5 minutes`
          );

          return { tileId, tileAtlas };
        })
      );

      // Process results, handling failures gracefully
      for (let j = 0; j < batchResults.length; j++) {
        const settledResult = batchResults[j]!;
        const tileDir = batch[j]!;
        const tileId = parseInt(tileDir.replace('tile_', ''), 10);

        if (settledResult.status === 'rejected') {
          errorCount++;
          packLogger.error(`  Tile ${tileId} failed: ${settledResult.reason}`);
          continue;
        }
        const { tileAtlas } = settledResult.value;
        processedCount++;

        if (tileAtlas) {
          scaleManifest.tiles[tileId] = tileAtlas;

          const dupFrames = tileAtlas.frames.filter(f => f.dup !== undefined).length;
          result.stats.totalFrames += tileAtlas.frames.length;
          result.stats.uniqueFrames += tileAtlas.frames.length - dupFrames;
          result.stats.duplicateFrames += dupFrames;
          result.stats.totalRegions += tileAtlas.stats.totalRegions;
          result.stats.uniqueRegions += tileAtlas.stats.uniqueRegions;

          // Build game manifest entry
          if (gameManifest && tileMetadata) {
            const meta = tileMetadata[String(tileId)];
            if (meta) {
              const gameKey = `${tileType}_${tileId}`;
              if (!gameManifest.tiles[gameKey]) {
                gameManifest.tiles[gameKey] = {
                  id: meta.id,
                  type: tileType,
                  width: meta.width,
                  height: meta.height,
                  offsetX: meta.offsetX,
                  offsetY: meta.offsetY,
                  frameCount: meta.frameCount,
                  behavior: meta.behavior,
                  fps: meta.fps ?? null,
                  autoplay: meta.autoplay ?? null,
                  loop: meta.loop ?? null,
                  atlases: {},
                };
              }

              const hasMultipleAtlases = tileAtlas.atlases.length > 1;
              const firstAtlas = tileAtlas.atlases[0]!;

              const gameFrames: GameWebpAtlasFrame[] = tileAtlas.frames.map(f => ({
                frame: f.frame,
                w: f.w,
                h: f.h,
                rs: f.rs,
                dup: f.dup,
                regions: f.regions,
              }));

              const atlasData: GameWebpAtlasData = {
                width: firstAtlas.width,
                height: firstAtlas.height,
                file: `${tileType}/${scaleKey}/${firstAtlas.filename}`,
                frames: gameFrames,
              };

              if (hasMultipleAtlases) {
                atlasData.files = tileAtlas.atlases.map(a => `${tileType}/${scaleKey}/${a.filename}`);
              }

              gameManifest.tiles[gameKey]!.atlases[String(scaleNum)] = atlasData;
            }
          }
        }
      }

      // Progress logging every 10 tiles or at completion
      if (processedCount % 10 === 0 || processedCount === pendingTileDirs.length) {
        const lastTileId = batch[batch.length - 1] ? parseInt(batch[batch.length - 1]!.replace('tile_', ''), 10) : 0;
        packLogger.info(`  Progress: ${processedCount}/${pendingTileDirs.length} tiles (${errorCount} errors) - last: tile_${lastTileId}`);
      }

      // Force garbage collection every 100 tiles to help with memory
      if (processedCount % 100 === 0 && global.gc) {
        global.gc();
      }
    }

    if (errorCount > 0) {
      packLogger.warn(`  Completed with ${errorCount} errors`);
    }

    result.scales[scaleKey] = scaleManifest;
    result.stats.totalTiles = Math.max(result.stats.totalTiles, Object.keys(scaleManifest.tiles).length);
  }

  // Finalize game manifest
  if (gameManifest) {
    gameManifest.scales = Array.from(scalesSet).sort((a, b) => a - b);
    result.gameManifest = gameManifest;
  }

  // Calculate total size
  for (const scaleKey of scaleKeys) {
    const scaleOutputDir = path.join(outputDir, scaleKey);
    if (fs.existsSync(scaleOutputDir)) {
      const files = fs.readdirSync(scaleOutputDir).filter(f => f.endsWith('.webp'));
      for (const file of files) {
        result.stats.totalSizeBytes += fs.statSync(path.join(scaleOutputDir, file)).size;
      }
    }
  }

  // Write manifests
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(result.manifestPath, JSON.stringify(result, null, 2));

  if (gameManifest) {
    const gameManifestPath = path.join(outputDir, 'manifest.json');
    fs.writeFileSync(gameManifestPath, JSON.stringify(gameManifest, null, 2));
    packLogger.info(`Game manifest written to ${gameManifestPath}`);
  }

  packLogger.info(`Atlas manifest written to ${result.manifestPath}`);
  packLogger.info(`  Tiles: ${result.stats.totalTiles}`);
  packLogger.info(`  Frames: ${result.stats.totalFrames} (${result.stats.uniqueFrames} unique, ${result.stats.duplicateFrames} duplicates)`);
  packLogger.info(`  Regions: ${result.stats.totalRegions} (${result.stats.uniqueRegions} unique)`);
  packLogger.info(`  Size: ${(result.stats.totalSizeBytes / 1024 / 1024).toFixed(1)} MB`);

  return result;
}

// ============================================================================
// PIXI.JS LOADER UTILITIES
// Copy the code below to your game client to load region-based WebP atlases
// ============================================================================

/**
 * Example Pixi.js loader for region-based WebP atlases.
 *
 * Usage in your game:
 * ```typescript
 * import { Assets, Container, Sprite, Texture, RenderTexture, Graphics } from 'pixi.js';
 *
 * // Load manifest
 * const manifest = await fetch('/assets/maps/tilesv4/manifest.json').then(r => r.json());
 *
 * // Create loader instance
 * const loader = new RegionAtlasLoader(app.renderer);
 *
 * // Load a tile's frame
 * const texture = await loader.loadFrame(manifest, 'objects_1234', 3, 0);
 * const sprite = new Sprite(texture);
 * ```
 */
export const PIXI_LOADER_EXAMPLE = `
// RegionAtlasLoader for Pixi.js
// Efficiently loads and reconstructs frames from region-based WebP atlases

import { Assets, RenderTexture, Texture, Container, Sprite, type Renderer } from 'pixi.js';

interface FrameRegionRef {
  rx: number;  // Region grid X
  ry: number;  // Region grid Y
  ax: number;  // Atlas X position
  ay: number;  // Atlas Y position
  aw: number;  // Atlas content width
  ah: number;  // Atlas content height
  ox: number;  // Offset X within region
  oy: number;  // Offset Y within region
  atlas?: number;  // Atlas index if multiple
}

interface WebpFrameInfo {
  frame: number;
  w: number;
  h: number;
  rs: number;  // Region size
  dup?: number;  // Duplicate of frame index
  regions?: FrameRegionRef[];
}

interface WebpAtlasData {
  width: number;
  height: number;
  file: string;
  files?: string[];
  frames: WebpFrameInfo[];
}

interface WebpTileData {
  id: number;
  type: 'ground' | 'objects';
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  frameCount: number;
  atlases: Record<string, WebpAtlasData>;
}

interface WebpManifest {
  version: 2;
  format: 'webp-regions';
  scales: number[];
  tiles: Record<string, WebpTileData>;
}

export class RegionAtlasLoader {
  private atlasCache = new Map<string, Texture>();
  private frameCache = new Map<string, Texture>();
  private renderer: Renderer;
  private basePath: string;

  constructor(renderer: Renderer, basePath = '/assets/maps/tilesv4') {
    this.renderer = renderer;
    this.basePath = basePath;
  }

  /**
   * Load a specific frame of a tile.
   * @param manifest The loaded manifest
   * @param tileKey Tile key like "objects_1234" or "ground_567"
   * @param frameIndex Frame index to load
   * @param scale Scale to use (1.5, 2, or 3)
   */
  async loadFrame(
    manifest: WebpManifest,
    tileKey: string,
    frameIndex: number,
    scale: number,
  ): Promise<Texture | null> {
    const cacheKey = \`\${tileKey}:\${scale}:\${frameIndex}\`;
    if (this.frameCache.has(cacheKey)) {
      return this.frameCache.get(cacheKey)!;
    }

    const tile = manifest.tiles[tileKey];
    if (!tile) return null;

    const atlas = tile.atlases[String(scale)];
    if (!atlas) return null;

    const frameInfo = atlas.frames.find(f => f.frame === frameIndex);
    if (!frameInfo) return null;

    // Handle duplicate frames
    if (frameInfo.dup !== undefined) {
      return this.loadFrame(manifest, tileKey, frameInfo.dup, scale);
    }

    // Reconstruct frame from regions
    const texture = await this.reconstructFrame(atlas, frameInfo, scale);
    if (texture) {
      this.frameCache.set(cacheKey, texture);
    }
    return texture;
  }

  /**
   * Load all frames for an animated tile.
   */
  async loadAnimationFrames(
    manifest: WebpManifest,
    tileKey: string,
    scale: number,
  ): Promise<Texture[]> {
    const tile = manifest.tiles[tileKey];
    if (!tile) return [];

    const textures: Texture[] = [];
    for (let i = 0; i < tile.frameCount; i++) {
      const texture = await this.loadFrame(manifest, tileKey, i, scale);
      if (texture) textures.push(texture);
    }
    return textures;
  }

  private async reconstructFrame(
    atlas: WebpAtlasData,
    frameInfo: WebpFrameInfo,
    scale: number,
  ): Promise<Texture | null> {
    if (!frameInfo.regions || frameInfo.regions.length === 0) {
      return null;
    }

    // Load atlas texture(s)
    const atlasTextures = await this.loadAtlasTextures(atlas, scale);
    if (atlasTextures.length === 0) return null;

    // Create container to composite regions
    const container = new Container();

    for (const region of frameInfo.regions) {
      const atlasTexture = atlasTextures[region.atlas ?? 0];
      if (!atlasTexture) continue;

      // Extract region from atlas
      const regionTexture = new Texture({
        source: atlasTexture.source,
        frame: {
          x: region.ax,
          y: region.ay,
          width: region.aw,
          height: region.ah,
        },
      });

      // Position in final frame
      const sprite = new Sprite(regionTexture);
      sprite.x = region.rx * frameInfo.rs + region.ox;
      sprite.y = region.ry * frameInfo.rs + region.oy;
      container.addChild(sprite);
    }

    // Render to texture
    const renderTexture = RenderTexture.create({
      width: frameInfo.w,
      height: frameInfo.h,
    });
    this.renderer.render({ container, target: renderTexture });

    // Clean up container
    container.destroy({ children: true });

    return renderTexture;
  }

  private async loadAtlasTextures(atlas: WebpAtlasData, scale: number): Promise<Texture[]> {
    const files = atlas.files ?? [atlas.file];
    const textures: Texture[] = [];

    for (const file of files) {
      const cacheKey = \`atlas:\${file}\`;
      if (this.atlasCache.has(cacheKey)) {
        textures.push(this.atlasCache.get(cacheKey)!);
        continue;
      }

      try {
        const texture = await Assets.load(\`\${this.basePath}/\${file}\`);
        this.atlasCache.set(cacheKey, texture);
        textures.push(texture);
      } catch (err) {
        console.warn(\`Failed to load atlas: \${file}\`, err);
      }
    }

    return textures;
  }

  /**
   * Clear caches to free memory.
   */
  clearCache(): void {
    for (const texture of this.frameCache.values()) {
      texture.destroy(true);
    }
    this.frameCache.clear();
    // Note: atlas textures are shared, so we don't destroy them
    this.atlasCache.clear();
  }
}
`;