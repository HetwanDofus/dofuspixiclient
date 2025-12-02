import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import pino from 'pino';

import { AssetPack } from '@assetpack/core';
import { texturePacker, texturePackerCompress } from "@assetpack/core/texture-packer";

import { FrameDeduplicator } from '../../lib/frame-deduplicator';

const execAsync = promisify(exec);

export interface TileExtractionConfig {
  /** SWF files to extract */
  swfFiles: string[];
  /** Output directory */
  outputDir: string;
  /** Tile type: 'ground' or 'objects' */
  tileType: 'ground' | 'objects';
}

export interface ExtractionResult {
  tileType: 'ground' | 'objects';
  swfFiles: string[];
  outputDir: string;
  manifestPath: string;
  stats: {
    processed: number;
    skipped: number;
    vector: number;
    raster: number;
    static: number;
    animated: number;
    random: number;
  };
  manifest: any;
  duration: number;
}

/**
 * TypeScript wrapper for PHP TileExporter
 * Orchestrates tile extraction via CLI
 */
export class TileExtractor {
  private phpBin: string;
  private exporterScript: string;
  private logger: pino.Logger;

  constructor(phpBin: string = 'php') {
    this.phpBin = phpBin;
    this.exporterScript = path.join(__dirname, 'TileExporter.php');
    this.logger = pino();

    // Verify file exists
    if (!fs.existsSync(this.exporterScript)) {
      throw new Error(`TileExporter.php not found at ${this.exporterScript}`);
    }
  }

  /**
   * Extract tiles from SWF files
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

    const manifestPath = path.join(outputDir, 'manifest.json');

    this.logger.info(`Extracting ${config.tileType} tiles (${config.swfFiles.length} files)`);
    this.logger.debug({ swfFiles: config.swfFiles, output: outputDir });

    try {
      // Build PHP CLI command
      const args: string[] = [];

      // Add all SWF files
      for (const swfFile of config.swfFiles) {
        args.push('--swf', swfFile);
      }

      // Add output directory and type
      args.push('--output', outputDir);
      args.push('--type', config.tileType);

      // Escape arguments for shell
      const escapedArgs = args.map(arg => `"${arg.replace(/"/g, '\\"')}"`).join(' ');
      const command = `${this.phpBin} "${this.exporterScript}" ${escapedArgs}`;

      // Execute PHP CLI asynchronously
      const { stdout } = await execAsync(command, {
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      this.logger.trace(stdout);

      // Read manifest
      if (!fs.existsSync(manifestPath)) {
        throw new Error(`Manifest not generated at ${manifestPath}`);
      }

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

      const duration = Date.now() - startTime;

      return {
        tileType: config.tileType,
        swfFiles: config.swfFiles,
        outputDir,
        manifestPath,
        stats: manifest.metadata?.stats || {},
        manifest,
        duration,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error({ error: errorMsg }, `Tile extraction failed`);
      throw new Error(`Tile extraction failed: ${errorMsg}`);
    }
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

  /**
   * Check if PHP is available
   */
  static async checkPhpAvailable(phpBin: string = 'php'): Promise<boolean> {
    try {
      await execAsync(`${phpBin} -v`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get PHP version
   */
  static async getPhpVersion(phpBin: string = 'php'): Promise<string> {
    try {
      const { stdout } = await execAsync(`${phpBin} -v`);
      const match = stdout.match(/PHP (\d+\.\d+\.\d+)/);
      return match?.[1] ?? 'unknown';
    } catch {
      return 'unavailable';
    }
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

/**
 * Create texture atlases for tiles using PixiJS AssetPack
 * Packs tiles into atlases with WebP compression, processing each resolution separately
 */
export async function packTilesAtlases(
  tilesDir: string,
  outputDir: string
): Promise<{ manifest: any; duration: number }> {
  const logger = pino();
  const startTime = Date.now();

  logger.info(`Starting texture atlas packing from ${tilesDir}`);

  try {
    // Read the original tiles manifest
    const tilesManifestPath = path.join(tilesDir, 'manifest.json');
    let tilesManifest: any = {};

    if (fs.existsSync(tilesManifestPath)) {
      tilesManifest = JSON.parse(fs.readFileSync(tilesManifestPath, 'utf-8'));
      logger.info(`Tiles manifest loaded from ${tilesManifestPath}`);
    }

    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Find all resolution directories in input
    const resolutions = fs
      .readdirSync(tilesDir)
      .filter(file => /^\d+(\.\d+)?x$/.test(file))
      .sort();

    logger.info(`Found resolutions: ${resolutions}`);

    if (resolutions.length === 0) {
      throw new Error(`No resolution directories found in ${tilesDir}`);
    }

    // Pack each resolution separately
    const atlasManifests: { [resolution: string]: any } = {};

    for (const resolution of resolutions) {
      const resolutionInputDir = path.join(tilesDir, resolution);
      const resolutionOutputDir = path.join(outputDir, resolution);

      logger.info(`Packing resolution: ${resolution}`);

      // Create AssetPack instance for this resolution
      const assetpack = new AssetPack({
        entry: resolutionInputDir,
        output: resolutionOutputDir,
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

      // Run the asset pack build process for this resolution
      await assetpack.run();

      logger.info(`Completed packing for ${resolution}`);

      // Read generated manifest for this resolution
      const generatedManifestPath = path.join(resolutionOutputDir, 'manifest.json');
      if (fs.existsSync(generatedManifestPath)) {
        atlasManifests[resolution] = JSON.parse(
          fs.readFileSync(generatedManifestPath, 'utf-8')
        );
        logger.info(`Loaded atlas manifest for ${resolution}`);
      }
    }

    // Merge manifests
    const mergedManifest = {
      version: '1.0.0',
      generatedAt: new Date().toISOString(),
      tiles: tilesManifest,
      atlases: atlasManifests,
    };

    // Write merged manifest to root
    const finalManifestPath = path.join(outputDir, 'manifest.json');
    fs.writeFileSync(finalManifestPath, JSON.stringify(mergedManifest, null, 2));

    const duration = Date.now() - startTime;
    logger.info(`Atlas processing complete in ${duration}ms`);
    logger.info(`Final manifest: ${finalManifestPath}`);

    return {
      manifest: mergedManifest,
      duration,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMsg }, 'Texture atlas packing failed');
    throw new Error(`Texture atlas packing failed: ${errorMsg}`);
  }
}

/**
 * Complete pipeline: Extract tiles -> Deduplicate frames -> Pack atlases
 */
export async function processTilesCompletelyPipeline(
  swfSourcesDir: string,
  tilesOutputDir: string,
  assetsOutputDir: string
): Promise<{
  extraction: { ground: ExtractionResult; objects: ExtractionResult };
  deduplication: { ground: any; objects: any };
  atlases: { manifest: any; duration: number };
}> {
  const logger = pino();

  logger.info('Starting complete tiles processing pipeline');

  // Step 1: Find SWF files
  logger.info(`Looking for SWF files in ${swfSourcesDir}`);

  const swfFiles = fs
    .readdirSync(swfSourcesDir)
    .filter(file => file.endsWith('.swf'))
    .map(file => path.join(swfSourcesDir, file));

  if (swfFiles.length === 0) {
    throw new Error(`No SWF files found in ${swfSourcesDir}`);
  }

  logger.info(`Found ${swfFiles.length} SWF files`);

  // Step 2: Extract tiles (ground and objects)
  logger.info('Step 1/4: Extracting tiles from SWF files');

  const grounds = swfFiles.filter(file => {
    const fileName = path.basename(file);

    return fileName.startsWith('g');
  });
  const objects = swfFiles.filter(file => {
    const fileName = path.basename(file);

    return fileName.startsWith('o');
  });
  
  const extraction = await extractAllTiles(grounds, objects, tilesOutputDir);

  // Step 3: Deduplicate frames for each type
  logger.info('Step 2/4: Deduplicating frames');
  const deduplicationResult = {
    ground: {} as any,
    objects: {} as any,
  };

  // Deduplicate ground tiles
  const groundTilesDir = path.join(tilesOutputDir, 'ground');
  if (fs.existsSync(groundTilesDir)) {
    const groundDedupResult = FrameDeduplicator.deduplicateFrames(groundTilesDir);
    deduplicationResult.ground = {
      totalFrames: groundDedupResult.totalFrames,
      uniqueFrames: groundDedupResult.uniqueFrames,
      duplicateFrames: groundDedupResult.duplicateFrames,
      deduplicationRate: ((groundDedupResult.duplicateFrames / (groundDedupResult.totalFrames || 1)) * 100).toFixed(2),
      duplicateMap: Object.fromEntries(groundDedupResult.duplicateMap),
    };
    logger.info(
      `Ground: ${groundDedupResult.uniqueFrames}/${groundDedupResult.totalFrames} unique frames (${deduplicationResult.ground.deduplicationRate}% duplicates)`
    );
  }

  // Deduplicate object tiles
  const objectTilesDir = path.join(tilesOutputDir, 'objects');
  if (fs.existsSync(objectTilesDir)) {
    const objectDedupResult = FrameDeduplicator.deduplicateFrames(objectTilesDir);
    deduplicationResult.objects = {
      totalFrames: objectDedupResult.totalFrames,
      uniqueFrames: objectDedupResult.uniqueFrames,
      duplicateFrames: objectDedupResult.duplicateFrames,
      deduplicationRate: ((objectDedupResult.duplicateFrames / (objectDedupResult.totalFrames || 1)) * 100).toFixed(2),
      duplicateMap: Object.fromEntries(objectDedupResult.duplicateMap),
    };
    logger.info(
      `Objects: ${objectDedupResult.uniqueFrames}/${objectDedupResult.totalFrames} unique frames (${deduplicationResult.objects.deduplicationRate}% duplicates)`
    );
  }

  // Step 4: Pack atlases
  logger.info('Step 3/4: Creating texture atlases');
  const atlases = await packTilesAtlases(tilesOutputDir, assetsOutputDir);

  // Step 5: Update final manifest with deduplication data
  logger.info('Step 4/4: Finalizing manifest');
  
  const finalManifestPath = path.join(assetsOutputDir, 'manifest.json');
  const finalManifest = {
    ...atlases.manifest,
    deduplication: deduplicationResult,
    pipeline: {
      completedAt: new Date().toISOString(),
      duration: extraction.ground.duration + extraction.objects.duration + atlases.duration,
    },
  };

  fs.writeFileSync(finalManifestPath, JSON.stringify(finalManifest, null, 2));

  logger.info('Pipeline complete!');
  logger.info(`Final manifest: ${finalManifestPath}`);

  return {
    extraction,
    deduplication: deduplicationResult,
    atlases,
  };
}
