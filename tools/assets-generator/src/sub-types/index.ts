import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { MaxRectsPacker } from 'maxrects-packer';
import pino from 'pino';

// Import from swf-extractor package (relative path since tools is not in workspaces)
import {
  Swf,
  SwfExtractor,
  SvgCanvas,
  convertSvg,
  ImageFormat,
  Opcode,
  containsOpcode,
  setSubprocessRendering,
  setWorkerPoolSize,
  acquireWorkerPool,
  releaseWorkerPool,
} from '../../../../packages/swf-extractor/src/index.ts';
import type { SpriteDefinition, Drawable, BitmapResolver } from '../../../../packages/swf-extractor/src/index.ts';

/**
 * Extract priority number from SWF filename.
 * Higher numbers = higher priority (o6 > o1, g10 > g2).
 * Returns the numeric part of filenames like o1.swf, g5.swf, etc.
 */
function getSwfPriority(swfPath: string): number {
  const basename = path.basename(swfPath, '.swf');
  // Extract numeric suffix: o1 -> 1, g10 -> 10, etc.
  const match = basename.match(/(\d+)$/);
  return match ? parseInt(match[1]!, 10) : 0;
}

/**
 * Collected tile info from SWF before rendering.
 */
interface CollectedTile {
  tileId: number;
  characterId: number;
  swfPath: string;
  priority: number;
  extractor: SwfExtractor;
  bitmapResolver: BitmapResolver;
  frameRate: number;
}

/** Default parallelism for tile rendering - use all available CPU cores */
const DEFAULT_PARALLELISM = Math.max(8, os.cpus().length);

export interface TileExtractionConfig {
  /** SWF files to extract */
  swfFiles: string[];
  /** Output directory */
  outputDir: string;
  /** Tile type: 'ground' or 'objects' */
  tileType: 'ground' | 'objects';
  /** Scale factors for output */
  scales?: number[];
  /** WebP quality (default: 100 for lossless) */
  quality?: number;
  /** Filter to specific tile IDs */
  filterTileIds?: number[];
  /** Number of tiles to process in parallel (default: 4) */
  parallelism?: number;
  /** Use subprocess for resvg rendering to prevent crashes (default: true for safety) */
  safeMode?: boolean;
}

export interface FailedTile {
  tileId: number;
  swfPath: string;
  swfName: string;
  reason: string;
}

export interface ExtractionResult {
  tileType: 'ground' | 'objects';
  swfFiles: string[];
  outputDir: string;
  manifestPath: string;
  stats: {
    processed: number;
    skipped: number;
    failed: number;
    vector: number;
    raster: number;
    static: number;
    animated: number;
    random: number;
  };
  manifest: TileManifest;
  duration: number;
  failedTiles: FailedTile[];
}

export type TileBehavior = 'static' | 'animated' | 'random' | 'slope';

export interface TileData {
  id: number;
  type: 'ground' | 'objects';
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  frameCount: number;
  isVector: boolean;
  behavior: TileBehavior;
  fps?: number;
  autoplay?: boolean;
  loop?: boolean;
  frames: TileFrame[];
}

export interface TileFrame {
  name: string;
  scales: { [scaleKey: string]: string };
}

export interface TileManifest {
  type: 'ground' | 'objects';
  tiles: { [tileId: number]: TileData };
  metadata: {
    extractedAt: string;
    totalTiles: number;
    stats: ExtractionResult['stats'];
  };
}

/**
 * Check if a drawable has a timeline (is sprite-like).
 */
function hasTimeline(drawable: Drawable): boolean {
  return 'timeline' in drawable && typeof (drawable as unknown as { timeline: () => unknown }).timeline === 'function';
}

/**
 * Get timeline from drawable if it has one.
 */
function getTimeline(drawable: Drawable): ReturnType<SpriteDefinition['timeline']> | null {
  if (hasTimeline(drawable)) {
    return (drawable as unknown as SpriteDefinition).timeline();
  }
  return null;
}

/**
 * Recursively analyze a timeline for actions.
 * Returns info about actions found in the timeline and all nested sprites.
 */
function analyzeTimelineActions(
  timeline: ReturnType<SpriteDefinition['timeline']>,
  frameCount: number,
): { hasRandom: boolean; hasStopOnFirstFrame: boolean; hasStopOnLastFrame: boolean; totalActionBytes: number } {
  let hasRandom = false;
  let hasStopOnFirstFrame = false;
  let hasStopOnLastFrame = false;
  let totalActionBytes = 0;

  const frames = timeline.frames;

  for (let frameNum = 0; frameNum < frames.length; frameNum++) {
    const frame = frames[frameNum]!;
    for (const doAction of frame.actions) {
      totalActionBytes += doAction.actions.length;
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

    // Also check nested sprites in frame objects
    for (const obj of frame.objects) {
      if (obj.drawable && hasTimeline(obj.drawable)) {
        const nestedTimeline = (obj.drawable as unknown as SpriteDefinition).timeline();
        const nestedResult = analyzeTimelineActions(nestedTimeline, nestedTimeline.frames.length);
        if (nestedResult.hasRandom) hasRandom = true;
        if (nestedResult.hasStopOnFirstFrame) hasStopOnFirstFrame = true;
        if (nestedResult.hasStopOnLastFrame) hasStopOnLastFrame = true;
        totalActionBytes += nestedResult.totalActionBytes;
      }
    }
  }

  return { hasRandom, hasStopOnFirstFrame, hasStopOnLastFrame, totalActionBytes };
}

/**
 * Determine tile behavior from ActionScript analysis.
 *
 * The logic is:
 * - If ActionRandomNumber is found anywhere (top-level or nested) → random
 * - If multi-frame but NO code at all → random (frame variations picked by cellId)
 * - If multi-frame with code but no random → animated
 * - Ground tiles without random → slope (frame selected by groundSlope value)
 */
function determineTileBehavior(
  drawable: Drawable,
  frameCount: number,
  tileType: 'ground' | 'objects',
): { type: TileBehavior; autoplay: boolean; loop: boolean } {
  const behavior = { type: 'static' as TileBehavior, autoplay: false, loop: false };

  if (frameCount <= 1) {
    return behavior;
  }

  const timeline = getTimeline(drawable);
  if (!timeline) {
    return behavior;
  }

  // Recursively analyze actions in the timeline and all nested sprites
  const { hasRandom, hasStopOnFirstFrame, hasStopOnLastFrame, totalActionBytes } =
    analyzeTimelineActions(timeline, frameCount);

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

  // If there's NO code at all but multiple frames, treat as random (frame variations)
  // This handles cases like tile 225 where nested sprites have multiple frames
  // but no ActionScript code - these are meant to be static variations, not animations
  if (totalActionBytes === 0) {
    return { type: 'random', autoplay: false, loop: false };
  }

  // Multi-frame object with code but no random = animated
  return {
    type: 'animated',
    autoplay: !hasStopOnFirstFrame,
    loop: !hasStopOnLastFrame,
  };
}

/**
 * Check if drawable is vector (no embedded raster images).
 */
function isVector(drawable: Drawable, bitmapResolver: BitmapResolver): boolean {
  try {
    const canvas = new SvgCanvas({ bitmapResolver, subpixelStrokeWidth: false });
    canvas.area(drawable.bounds());
    drawable.draw(canvas, 0);
    const svg = canvas.render();

    // Check for embedded raster data
    return !svg.includes('data:image/png;base64') && !svg.includes('data:image/jpeg;base64');
  } catch {
    return false;
  }
}



/**
 * TypeScript tile extractor using swf-extractor package.
 * Replaces the PHP TileExporter.
 */
export class TileExtractor {
  private logger: pino.Logger;
  private scales: number[];
  private quality: number;

  constructor(scales: number[] = [1.5, 2, 3], quality: number = 100) {
    this.logger = pino();
    this.scales = scales;
    this.quality = quality;
  }

  /**
   * Extract tiles from SWF files.
   * Uses priority system: files with higher numbers (o6 > o1) take precedence for duplicate tile IDs.
   * Processes tiles in parallel for better performance.
   */
  async extract(config: TileExtractionConfig): Promise<ExtractionResult> {
    const startTime = Date.now();

    // Validate input
    if (!config.swfFiles || config.swfFiles.length === 0) {
      throw new Error('No SWF files provided');
    }

    // Create output directory
    const outputDir = path.resolve(config.outputDir);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Create scale directories
    const scales = config.scales ?? this.scales;
    for (const scale of scales) {
      const scaleDir = path.join(outputDir, `${scale}x`);
      if (!fs.existsSync(scaleDir)) {
        fs.mkdirSync(scaleDir, { recursive: true });
      }
    }

    const manifestPath = path.join(outputDir, 'manifest.json');
    const quality = config.quality ?? this.quality;
    const parallelism = config.parallelism ?? DEFAULT_PARALLELISM;
    const safeMode = config.safeMode ?? true; // Default to safe mode

    // Configure worker pool for parallel rendering
    // We use a larger pool since each tile renders 3 scales in parallel
    const workerPoolSize = parallelism * scales.length;
    setWorkerPoolSize(workerPoolSize);

    // Acquire reference to worker pool (released at end)
    acquireWorkerPool();

    // Enable subprocess rendering to prevent resvg panics from crashing the process
    setSubprocessRendering(safeMode);
    if (safeMode) {
      this.logger.info(`Safe mode enabled: using ${workerPoolSize} render workers (crash-resistant)`);
    }

    this.logger.info(`Extracting ${config.tileType} tiles (${config.swfFiles.length} files, parallelism=${parallelism})`);

    const stats = {
      processed: 0,
      skipped: 0,
      failed: 0,
      vector: 0,
      raster: 0,
      static: 0,
      animated: 0,
      random: 0,
    };

    const tiles: { [tileId: number]: TileData } = {};
    const failedTiles: FailedTile[] = [];

    // Phase 1: Collect all tiles from all SWFs with priority tracking
    // Higher priority SWF files override lower priority ones for the same tile ID
    const collectedTiles = new Map<number, CollectedTile>();
    const swfContexts: Array<{ swfPath: string; extractor: SwfExtractor; bitmapResolver: BitmapResolver; frameRate: number }> = [];

    for (const swfPath of config.swfFiles) {
      if (!fs.existsSync(swfPath)) {
        this.logger.warn(`SWF file not found: ${swfPath}`);
        continue;
      }

      this.logger.info(`📦 Processing ${path.basename(swfPath)}`);

      const swfData = fs.readFileSync(swfPath);
      const swf = Swf.fromBuffer(new Uint8Array(swfData), 0); // Ignore all errors
      const extractor = new SwfExtractor(swf);
      const frameRate = swf.header.frameRate;
      const priority = getSwfPriority(swfPath);

      // Preload all images for bitmap fills
      const imageMap = await extractor.preloadImages();
      const bitmapResolver = SwfExtractor.createBitmapResolver(imageMap);

      // Keep context for later rendering
      swfContexts.push({ swfPath, extractor, bitmapResolver, frameRate });

      for (const asset of extractor.exported()) {
        const tileId = parseInt(asset.name, 10);
        if (isNaN(tileId)) continue;

        // Filter if specified
        if (config.filterTileIds && !config.filterTileIds.includes(tileId)) {
          continue;
        }

        const existing = collectedTiles.get(tileId);
        // Only add/replace if this SWF has higher or equal priority
        if (!existing || priority >= existing.priority) {
          collectedTiles.set(tileId, {
            tileId,
            characterId: asset.id,
            swfPath,
            priority,
            extractor,
            bitmapResolver,
            frameRate,
          });
        }
      }
    }

    this.logger.info(`Collected ${collectedTiles.size} unique tiles to process`);

    // Phase 2: Process tiles in parallel with error handling
    const tileEntries = Array.from(collectedTiles.values());

    // Process in batches for parallelism
    const totalTiles = tileEntries.length;

    for (let i = 0; i < tileEntries.length; i += parallelism) {
      const batch = tileEntries.slice(i, i + parallelism);
      const batchStart = i;

      this.logger.info(`Processing batch ${Math.floor(i / parallelism) + 1}/${Math.ceil(totalTiles / parallelism)} (tiles ${batchStart + 1}-${Math.min(batchStart + parallelism, totalTiles)} of ${totalTiles})`);

      const results = await Promise.allSettled(
        batch.map(async (tile) => {
          return this.processTile(
            tile.extractor,
            tile.tileId,
            tile.characterId,
            config.tileType,
            tile.frameRate,
            outputDir,
            scales,
            quality,
            tile.bitmapResolver,
          );
        })
      );

      // Process results
      for (let j = 0; j < results.length; j++) {
        const result = results[j]!;
        const tile = batch[j]!;

        if (result.status === 'fulfilled') {
          const tileData = result.value;
          if (tileData) {
            tiles[tile.tileId] = tileData;
            stats.processed++;

            // Update stats
            if (tileData.isVector) stats.vector++;
            else stats.raster++;

            if (tileData.behavior === 'static') stats.static++;
            else if (tileData.behavior === 'animated') stats.animated++;
            else if (tileData.behavior === 'random') stats.random++;

            this.logger.debug(
              `  ✓ Tile #${tile.tileId}: ${tileData.frameCount} frames (${tileData.isVector ? 'Vector' : 'Raster'}, ${tileData.behavior})`
            );
          } else {
            stats.skipped++;
          }
        } else {
          // Tile processing failed - log but continue
          stats.failed++;
          const reason = result.reason?.message || String(result.reason);
          this.logger.error(
            `  ✗ Tile #${tile.tileId} FAILED: ${reason}`
          );
          failedTiles.push({
            tileId: tile.tileId,
            swfPath: tile.swfPath,
            swfName: path.basename(tile.swfPath),
            reason,
          });
        }
      }
    }

    // Build manifest
    const manifest: TileManifest = {
      type: config.tileType,
      tiles,
      metadata: {
        extractedAt: new Date().toISOString(),
        totalTiles: Object.keys(tiles).length,
        stats,
      },
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    this.logger.info(`✅ Manifest saved to: ${manifestPath}`);
    this.logger.info(`   Processed: ${stats.processed}, Skipped: ${stats.skipped}, Failed: ${stats.failed}`);

    // Save failed tiles to a separate file for retry/debugging
    if (failedTiles.length > 0) {
      const failedPath = path.join(outputDir, `failed-tiles.json`);
      fs.writeFileSync(failedPath, JSON.stringify(failedTiles, null, 2));
      this.logger.warn(`⚠️  ${failedTiles.length} failed tiles saved to: ${failedPath}`);
    }

    const duration = Date.now() - startTime;

    // Release worker pool reference (pool shuts down when all references released)
    releaseWorkerPool();

    return {
      tileType: config.tileType,
      swfFiles: config.swfFiles,
      outputDir,
      manifestPath,
      stats,
      manifest,
      duration,
      failedTiles,
    };
  }

  /**
   * Process a single tile.
   * Logs which tile/frame is being processed in case of crash (resvg panic).
   */
  private async processTile(
    extractor: SwfExtractor,
    tileId: number,
    characterId: number,
    tileType: 'ground' | 'objects',
    frameRate: number,
    outputDir: string,
    scales: number[],
    quality: number,
    bitmapResolver: BitmapResolver,
  ): Promise<TileData | null> {
    const drawable = extractor.getDrawable(characterId);
    if (!drawable) return null;

    const bounds = drawable.bounds();
    const width = (bounds.xMax - bounds.xMin) / 20;
    const height = (bounds.yMax - bounds.yMin) / 20;
    const offsetX = bounds.xMin / 20;
    const offsetY = bounds.yMin / 20;

    const frameCount = drawable.framesCount(true); // recursive
    const behavior = determineTileBehavior(drawable, frameCount, tileType);
    const tileIsVector = isVector(drawable, bitmapResolver);

    this.logger.info(`  → Tile #${tileId}: ${frameCount} frames, ${tileIsVector ? 'vector' : 'raster'}, ${behavior}`);

    const frames: TileFrame[] = [];

    // Pre-create directories for all scales
    for (const scale of scales) {
      const scaleKey = `${scale}x`;
      const tileDir = path.join(outputDir, scaleKey, `tile_${tileId}`);
      if (!fs.existsSync(tileDir)) {
        fs.mkdirSync(tileDir, { recursive: true });
      }
    }

    // Export each frame at each scale
    // Note: We render SVG at 1x and let resvg handle upscaling during rasterization.
    // Pre-scaling bitmaps doesn't help because the pattern viewBox dimensions stay at 1x,
    // causing the scaled bitmap to be squeezed back down. The resvg renderer handles
    // bitmap upscaling correctly when rendering at higher resolutions.
    const showProgress = frameCount > 10;
    for (let frameIdx = 0; frameIdx < frameCount; frameIdx++) {
      if (showProgress && frameIdx % 10 === 0) {
        this.logger.info(`    Tile #${tileId}: frame ${frameIdx + 1}/${frameCount}`);
      }
      const frameName = `${tileId}_${frameIdx}`;
      const frameScales: { [scaleKey: string]: string } = {};

      // Render SVG once at 1x scale (will be reused for all scale factors)
      let svg: string;
      try {
        const canvas = new SvgCanvas({ bitmapResolver, subpixelStrokeWidth: false });
        canvas.area(drawable.bounds());
        drawable.draw(canvas, frameIdx);
        svg = canvas.render();
      } catch (e) {
        this.logger.warn(`Tile #${tileId} frame ${frameIdx}: SVG render failed, skipping`);
        continue;
      }

      // Render all scales in parallel for better throughput
      const scaleResults = await Promise.allSettled(
        scales.map(async (scale) => {
          const scaleKey = `${scale}x`;
          const tileDir = path.join(outputDir, scaleKey, `tile_${tileId}`);
          const filename = `${tileId}_${frameIdx}.webp`;
          const filepath = path.join(tileDir, filename);

          // Convert SVG to WebP at scale
          const targetWidth = Math.round(width * scale);
          const targetHeight = Math.round(height * scale);

          const webpBuffer = await convertSvg(svg, ImageFormat.Webp, {
            width: targetWidth,
            height: targetHeight,
            quality,
          });

          // Skip saving empty frames (zero-size SVG)
          if (webpBuffer.length === 0) {
            return null;
          }

          fs.writeFileSync(filepath, webpBuffer);
          return { scaleKey, path: `${scaleKey}/tile_${tileId}/${filename}` };
        })
      );

      // Process scale results
      for (let i = 0; i < scaleResults.length; i++) {
        const result = scaleResults[i]!;
        const scale = scales[i]!;
        const scaleKey = `${scale}x`;

        if (result.status === 'fulfilled' && result.value) {
          frameScales[scaleKey] = result.value.path;
        } else if (result.status === 'rejected') {
          const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
          this.logger.warn(`Tile #${tileId} frame ${frameIdx} ${scaleKey}: conversion failed - ${errMsg}`);
        }
      }

      // Only add frame if at least one scale was successful
      if (Object.keys(frameScales).length > 0) {
        frames.push({ name: frameName, scales: frameScales });
      }
    }

    // If no frames were successfully rendered, return null to mark tile as failed
    if (frames.length === 0) {
      this.logger.warn(`Tile #${tileId}: All ${frameCount} frames failed to render`);
      return null;
    }

    if (showProgress) {
      this.logger.info(`    Tile #${tileId}: complete (${frames.length}/${frameCount} frames)`);
    }

    const tileData: TileData = {
      id: tileId,
      type: tileType,
      width,
      height,
      offsetX,
      offsetY,
      frameCount,
      isVector: tileIsVector,
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
   * Extract ground tiles
   */
  async extractGround(swfFiles: string[], outputDir: string): Promise<ExtractionResult> {
    return this.extract({
      swfFiles,
      outputDir: path.join(outputDir, 'ground'),
      tileType: 'ground',
    });
  }

  /**
   * Extract object tiles
   */
  async extractObjects(swfFiles: string[], outputDir: string): Promise<ExtractionResult> {
    return this.extract({
      swfFiles,
      outputDir: path.join(outputDir, 'objects'),
      tileType: 'objects',
    });
  }
}

/**
 * High-level function for quick tile extraction
 */
export async function extractTiles(
  swfFiles: string[],
  outputDir: string,
  tileType: 'ground' | 'objects' = 'ground'
): Promise<ExtractionResult> {
  const extractor = new TileExtractor();
  return extractor.extract({
    swfFiles,
    outputDir,
    tileType,
  });
}

/**
 * Batch extraction with both ground and objects
 */
export async function extractAllTiles(
  groundSwfs: string[],
  objectSwfs: string[],
  outputDir: string
): Promise<{ ground: ExtractionResult; objects: ExtractionResult }> {
  const logger = pino();
  const extractor = new TileExtractor();

  logger.info('Starting tile extraction: ground & objects');

  const [groundResult, objectsResult] = await Promise.all([
    extractor.extractGround(groundSwfs, outputDir),
    extractor.extractObjects(objectSwfs, outputDir),
  ]);

  logger.info(`Ground tiles: ${groundResult.stats.processed} processed in ${groundResult.duration}ms`);
  logger.info(`Object tiles: ${objectsResult.stats.processed} processed in ${objectsResult.duration}ms`);

  // Combine manifests
  const combinedManifest = {
    version: '1.0.0',
    extractedAt: new Date().toISOString(),
    ground: groundResult.manifest,
    objects: objectsResult.manifest,
  };

  const combinedPath = path.join(outputDir, 'manifest.json');
  fs.writeFileSync(combinedPath, JSON.stringify(combinedManifest, null, 2));

  logger.info(`Extraction complete. Combined manifest written to ${combinedPath}`);

  return { ground: groundResult, objects: objectsResult };
}

// ============================================================================
// KTX2 Atlas Packing
// ============================================================================

export interface AtlasPackConfig {
  /** Input directory containing extracted tiles (with scale subdirectories) */
  inputDir: string;
  /** Output directory for KTX2 atlases */
  outputDir: string;
  /** Tile type: 'ground' or 'objects' */
  tileType: 'ground' | 'objects';
  /** Tile metadata from extraction manifest (for game-compatible output) */
  tileMetadata?: { [tileId: string]: TileData };
  /** Maximum atlas size (default: 4096) */
  maxAtlasSize?: number;
  /** Padding between frames (default: 2) */
  padding?: number;
  /** UASTC quality level 0-4 (default: 2) */
  quality?: number;
  /** Enable RDO compression (default: false for max quality) */
  enableRdo?: boolean;
  /** RDO lambda value if enabled (default: 0.5) */
  rdoLambda?: number;
}

/** Frame position within a tile atlas */
export interface TileAtlasFrame {
  /** Frame index */
  frameIndex: number;
  /** Atlas index (for multi-atlas tiles) */
  atlasIndex: number;
  /** X position in atlas (after trim) */
  x: number;
  /** Y position in atlas (after trim) */
  y: number;
  /** Trimmed frame width */
  width: number;
  /** Trimmed frame height */
  height: number;
  /** Original frame width before trim */
  sourceWidth: number;
  /** Original frame height before trim */
  sourceHeight: number;
  /** Trim offset X (pixels removed from left) */
  trimOffsetX: number;
  /** Trim offset Y (pixels removed from top) */
  trimOffsetY: number;
  /** Whether this frame is rotated 90° in the atlas */
  rotated: boolean;
  /** If this is a duplicate, index of original frame */
  duplicateOf?: number;
}

/** Single atlas file info */
export interface AtlasFile {
  /** Filename (e.g., "tile_245_0.ktx2") */
  filename: string;
  /** Atlas width */
  width: number;
  /** Atlas height */
  height: number;
}

/** Per-tile atlas info */
export interface TileAtlasInfo {
  /** Tile ID */
  tileId: number;
  /** Atlas files for this tile */
  atlases: AtlasFile[];
  /** Frames in this tile (may span multiple atlases) */
  frames: TileAtlasFrame[];
  /** Number of unique frames (after deduplication) */
  uniqueFrameCount: number;
}

export interface ScaleManifest {
  /** Scale key (e.g., "3x") */
  scale: string;
  /** Tile atlases for this scale */
  tiles: { [tileId: string]: TileAtlasInfo };
}

// Game-compatible manifest format
export interface GameAtlasFrame {
  frame: number;
  x: number;
  y: number;
  w: number;
  h: number;
  trimX?: number;
  trimY?: number;
  origW?: number;
  origH?: number;
  atlas?: number;
}

export interface GameAtlasData {
  width: number;
  height: number;
  file: string;
  files?: string[];
  frames: GameAtlasFrame[];
}

export interface GameTileData {
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
  atlases: Record<string, GameAtlasData>;
}

export interface GameManifest {
  scales: number[];
  tiles: Record<string, GameTileData>;
}

export interface PackResult {
  scales: { [scaleKey: string]: ScaleManifest };
  manifestPath: string;
  /** Game-compatible manifest (if tileMetadata was provided) */
  gameManifest?: GameManifest;
  stats: {
    totalTiles: number;
    totalFrames: number;
    uniqueFrames: number;
    duplicateFrames: number;
    totalSizeBytes: number;
  };
}

/**
 * Pack tiles into KTX2 atlases - one atlas per tile containing all its frames.
 */
export async function packTilesToKtx2(config: AtlasPackConfig): Promise<PackResult> {
  const {
    inputDir,
    outputDir,
    tileType,
    tileMetadata,
    maxAtlasSize = 4096,
    padding = 2,
    quality = 2,
    enableRdo = false,
    rdoLambda = 0.5,
  } = config;

  const packLogger = pino({ name: 'ktx2-packer' });

  // Find all scale directories (e.g., "1.5x", "2x", "3x")
  const scaleKeys = fs.readdirSync(inputDir)
    .filter(name => /^[\d.]+x$/.test(name) && fs.statSync(path.join(inputDir, name)).isDirectory())
    .sort();

  if (scaleKeys.length === 0) {
    throw new Error(`No scale directories found in ${inputDir}`);
  }

  packLogger.info(`Found scales: ${scaleKeys.join(', ')}`);

  const result: PackResult = {
    scales: {},
    manifestPath: path.join(outputDir, 'atlas-manifest.json'),
    stats: {
      totalTiles: 0,
      totalFrames: 0,
      uniqueFrames: 0,
      duplicateFrames: 0,
      totalSizeBytes: 0,
    },
  };

  // Build game manifest if metadata provided
  const gameManifest: GameManifest | undefined = tileMetadata ? { scales: [], tiles: {} } : undefined;
  const scalesSet = new Set<number>();

  // Process each scale
  for (const scaleKey of scaleKeys) {
    const scaleDir = path.join(inputDir, scaleKey);
    const scaleOutputDir = path.join(outputDir, scaleKey);
    fs.mkdirSync(scaleOutputDir, { recursive: true });

    const scaleNum = parseFloat(scaleKey.replace('x', ''));
    scalesSet.add(scaleNum);

    packLogger.info(`Processing ${scaleKey}...`);

    // Find all tile directories
    const tileDirs = fs.readdirSync(scaleDir)
      .filter(name => name.startsWith('tile_') && fs.statSync(path.join(scaleDir, name)).isDirectory())
      .sort((a, b) => {
        const idA = parseInt(a.replace('tile_', ''), 10);
        const idB = parseInt(b.replace('tile_', ''), 10);
        return idA - idB;
      });

    packLogger.info(`  Found ${tileDirs.length} tiles`);

    const scaleManifest: ScaleManifest = {
      scale: scaleKey,
      tiles: {},
    };

    // Process each tile into its own atlas
    for (const tileDir of tileDirs) {
      const tileId = parseInt(tileDir.replace('tile_', ''), 10);
      const tilePath = path.join(scaleDir, tileDir);

      const tileAtlas = await packTileIntoAtlas(
        tileId,
        tilePath,
        scaleOutputDir,
        maxAtlasSize,
        padding,
        quality,
        enableRdo,
        rdoLambda,
        packLogger,
      );

      if (tileAtlas) {
        scaleManifest.tiles[tileId] = tileAtlas;
        result.stats.totalFrames += tileAtlas.frames.length;
        result.stats.uniqueFrames += tileAtlas.uniqueFrameCount;
        result.stats.duplicateFrames += tileAtlas.frames.length - tileAtlas.uniqueFrameCount;

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

            const gameFrames: GameAtlasFrame[] = tileAtlas.frames.map(f => {
              const frame: GameAtlasFrame = {
                frame: f.frameIndex,
                x: f.x,
                y: f.y,
                w: f.width,
                h: f.height,
              };
              if (f.trimOffsetX !== 0 || f.trimOffsetY !== 0) {
                frame.trimX = f.trimOffsetX;
                frame.trimY = f.trimOffsetY;
              }
              if (f.sourceWidth !== f.width || f.sourceHeight !== f.height) {
                frame.origW = f.sourceWidth;
                frame.origH = f.sourceHeight;
              }
              if (hasMultipleAtlases) {
                frame.atlas = f.atlasIndex;
              }
              return frame;
            });

            const atlasData: GameAtlasData = {
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

    result.scales[scaleKey] = scaleManifest;
    result.stats.totalTiles = Object.keys(scaleManifest.tiles).length;
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
      const files = fs.readdirSync(scaleOutputDir).filter(f => f.endsWith('.ktx2'));
      for (const file of files) {
        result.stats.totalSizeBytes += fs.statSync(path.join(scaleOutputDir, file)).size;
      }
    }
  }

  // Write manifest
  fs.writeFileSync(result.manifestPath, JSON.stringify(result, null, 2));
  packLogger.info(`Atlas manifest written to ${result.manifestPath}`);
  packLogger.info(`  Tiles: ${result.stats.totalTiles}, Frames: ${result.stats.totalFrames} (${result.stats.uniqueFrames} unique, ${result.stats.duplicateFrames} duplicates)`);
  packLogger.info(`  Size: ${(result.stats.totalSizeBytes / 1024 / 1024).toFixed(1)} MB`);

  return result;
}

interface TrimmedFrameInfo {
  frameIndex: number;
  filePath: string;
  /** Original width before trim */
  sourceWidth: number;
  /** Original height before trim */
  sourceHeight: number;
  /** Trimmed width */
  width: number;
  /** Trimmed height */
  height: number;
  /** Pixels removed from left */
  trimOffsetX: number;
  /** Pixels removed from top */
  trimOffsetY: number;
  /** Trimmed image buffer */
  trimmedBuffer: Buffer;
  /** Content hash for deduplication */
  hash: string;
}

/**
 * Pack a single tile's frames into an atlas and convert to KTX2.
 * Features: transparency trimming, frame deduplication, maxrects packing.
 */
async function packTileIntoAtlas(
  tileId: number,
  tilePath: string,
  outputDir: string,
  maxAtlasSize: number,
  padding: number,
  quality: number,
  enableRdo: boolean,
  rdoLambda: number,
  packLogger: pino.Logger,
): Promise<TileAtlasInfo | null> {
  const sharp = (await import('sharp')).default;

  // Find all frame files for this tile
  const frameFiles = fs.readdirSync(tilePath)
    .filter(name => name.endsWith('.webp') || name.endsWith('.png'))
    .sort((a, b) => {
      const idxA = parseInt(a.split('_')[1]?.split('.')[0] ?? '0', 10);
      const idxB = parseInt(b.split('_')[1]?.split('.')[0] ?? '0', 10);
      return idxA - idxB;
    });

  if (frameFiles.length === 0) {
    return null;
  }

  // Load and trim all frames
  const frames: TrimmedFrameInfo[] = [];
  for (const frameFile of frameFiles) {
    const framePath = path.join(tilePath, frameFile);
    const frameIndex = parseInt(frameFile.split('_')[1]?.split('.')[0] ?? '0', 10);

    // Get original dimensions
    const originalMeta = await sharp(framePath).metadata();
    const sourceWidth = originalMeta.width ?? 0;
    const sourceHeight = originalMeta.height ?? 0;

    // Get raw pixel data to find non-transparent bounding box
    const { data, info } = await sharp(framePath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Find bounding box of non-transparent pixels
    let minX = info.width;
    let minY = info.height;
    let maxX = 0;
    let maxY = 0;

    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const alphaIdx = (y * info.width + x) * 4 + 3; // RGBA, alpha is 4th channel
        if (data[alphaIdx]! > 0) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    // Handle fully transparent images
    let trimmedBuffer: Buffer;
    let trimmedWidth: number;
    let trimmedHeight: number;
    let trimOffsetX: number;
    let trimOffsetY: number;

    if (maxX < minX || maxY < minY) {
      // Fully transparent - keep 1x1 pixel
      trimmedBuffer = await sharp({
        create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      }).png().toBuffer();
      trimmedWidth = 1;
      trimmedHeight = 1;
      trimOffsetX = 0;
      trimOffsetY = 0;
    } else {
      // Extract the non-transparent region
      trimOffsetX = minX;
      trimOffsetY = minY;
      trimmedWidth = maxX - minX + 1;
      trimmedHeight = maxY - minY + 1;

      trimmedBuffer = await sharp(framePath)
        .extract({ left: minX, top: minY, width: trimmedWidth, height: trimmedHeight })
        .png()
        .toBuffer();
    }

    // Content hash for deduplication
    const hash = createHash('md5').update(trimmedBuffer).digest('hex');

    frames.push({
      frameIndex,
      filePath: framePath,
      sourceWidth,
      sourceHeight,
      width: trimmedWidth,
      height: trimmedHeight,
      trimOffsetX,
      trimOffsetY,
      trimmedBuffer,
      hash,
    });
  }

  // Deduplicate frames by content hash
  const hashToFrameIndex = new Map<string, number>();
  const uniqueFrames: TrimmedFrameInfo[] = [];
  const duplicateMap = new Map<number, number>(); // frameIndex -> originalFrameIndex

  for (const frame of frames) {
    const existingIndex = hashToFrameIndex.get(frame.hash);
    if (existingIndex !== undefined) {
      // This is a duplicate
      duplicateMap.set(frame.frameIndex, existingIndex);
    } else {
      // This is unique
      hashToFrameIndex.set(frame.hash, frame.frameIndex);
      uniqueFrames.push(frame);
    }
  }

  if (uniqueFrames.length === 0) {
    return null;
  }

  // basisu max is 16384x16384, use that as absolute max
  const BASISU_MAX = 16384;
  const effectiveMaxSize = Math.min(maxAtlasSize, BASISU_MAX);

  // Use maxrects-packer - it will create multiple bins if needed
  const packer = new MaxRectsPacker(effectiveMaxSize, effectiveMaxSize, padding, {
    smart: true,
    pot: true,
    square: false,
    allowRotation: false,
    border: 0,
  });

  // Add unique frames to packer
  for (const frame of uniqueFrames) {
    packer.add(frame.width, frame.height, frame);
  }

  if (packer.bins.length === 0) {
    packLogger.warn(`Tile ${tileId}: Failed to pack any frames`);
    return null;
  }

  if (packer.bins.length > 1) {
    packLogger.info(`Tile ${tileId}: Using ${packer.bins.length} atlases`);
  }

  // Build position map with atlas index
  const positionMap = new Map<number, { atlasIndex: number; x: number; y: number; rotated: boolean }>();
  const atlasFiles: AtlasFile[] = [];

  // Process each bin (atlas)
  for (let atlasIndex = 0; atlasIndex < packer.bins.length; atlasIndex++) {
    const bin = packer.bins[atlasIndex]!;

    // Build position map for this bin
    for (const rect of bin.rects) {
      const frame = rect.data as TrimmedFrameInfo;
      positionMap.set(frame.frameIndex, {
        atlasIndex,
        x: rect.x,
        y: rect.y,
        rotated: rect.rot ?? false,
      });
    }

    // Create composite image for this atlas
    const composites = bin.rects.map(rect => ({
      input: (rect.data as TrimmedFrameInfo).trimmedBuffer,
      left: rect.x,
      top: rect.y,
    }));

    const suffix = packer.bins.length > 1 ? `_${atlasIndex}` : '';
    const atlasFilename = `tile_${tileId}${suffix}.ktx2`;
    const pngPath = path.join(outputDir, `tile_${tileId}${suffix}.png`);
    const ktx2Path = path.join(outputDir, atlasFilename);

    await sharp({
      create: {
        width: bin.width,
        height: bin.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(composites)
      .png()
      .toFile(pngPath);

    // Convert to KTX2 using basisu
    const basisuArgs = [
      pngPath,
      '-output_file', ktx2Path,
      '-uastc',
      '-uastc_level', quality.toString(),
    ];

    if (enableRdo) {
      basisuArgs.push('-uastc_rdo_l', rdoLambda.toString());
    }

    try {
      execSync(`basisu ${basisuArgs.map(a => `"${a}"`).join(' ')}`, { stdio: 'pipe' });
    } catch (error) {
      packLogger.error(`Tile ${tileId}: Failed to create KTX2 for atlas ${atlasIndex}: ${error}`);
      fs.unlinkSync(pngPath);
      return null;
    }

    // Clean up PNG
    fs.unlinkSync(pngPath);

    atlasFiles.push({
      filename: atlasFilename,
      width: bin.width,
      height: bin.height,
    });
  }

  // Build frame list for ALL frames (including duplicates)
  const atlasFrames: TileAtlasFrame[] = frames
    .filter(frame => {
      const duplicateOfIndex = duplicateMap.get(frame.frameIndex);
      const posKey = duplicateOfIndex !== undefined ? duplicateOfIndex : frame.frameIndex;
      return positionMap.has(posKey);
    })
    .map(frame => {
      const duplicateOfIndex = duplicateMap.get(frame.frameIndex);
      const isDuplicate = duplicateOfIndex !== undefined;

      // Get position - either from this frame or the original if duplicate
      const posKey = isDuplicate ? duplicateOfIndex : frame.frameIndex;
      const pos = positionMap.get(posKey)!;

      return {
        frameIndex: frame.frameIndex,
        atlasIndex: pos.atlasIndex,
        x: pos.x,
        y: pos.y,
        width: frame.width,
        height: frame.height,
        sourceWidth: frame.sourceWidth,
        sourceHeight: frame.sourceHeight,
        trimOffsetX: frame.trimOffsetX,
        trimOffsetY: frame.trimOffsetY,
        rotated: pos.rotated,
        duplicateOf: isDuplicate ? duplicateOfIndex : undefined,
      };
    })
    .sort((a, b) => a.frameIndex - b.frameIndex);

  return {
    tileId,
    atlases: atlasFiles,
    frames: atlasFrames,
    uniqueFrameCount: positionMap.size,
  };
}


