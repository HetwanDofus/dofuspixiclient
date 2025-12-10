import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { match } from 'ts-pattern';
import { SwfFile } from '@/swf-file.ts';
import { SwfExtractor } from '@/extractor/swf-extractor.ts';
import { SvgDrawer } from '@/extractor/drawer/svg/svg-drawer.ts';
import { SvgCanvas } from '@/extractor/drawer/svg/svg-canvas.ts';
import { convertSvg, convertToAnimation } from '@/extractor/drawer/converter/svg-converter.ts';
import { ImageFormat, getExtension } from '@/extractor/drawer/converter/image-format.ts';
import {
  type ExtractOptions,
  DEFAULT_OUTPUT_FILENAME,
  parseFrameFormat,
  parseNumberList,
  resolveFilename,
} from './extract-options.ts';
import { Errors } from '@/error/errors.ts';
import { drawFrame } from '@/extractor/timeline/frame.ts';
import { generateManifest } from './manifest.ts';
import { Timeline } from '@/extractor/timeline/timeline.ts';

/**
 * Create the CLI program.
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name('swf-extract')
    .description('Extract assets from SWF files')
    .version('1.0.0')
    .argument('<files...>', 'SWF files to process')
    .option('-o, --output <dir>', 'Output directory', '.')
    .option('--output-filename <pattern>', 'Output filename pattern', DEFAULT_OUTPUT_FILENAME)
    .option('-c, --characters <ids>', 'Extract specific character IDs (e.g., "1,2,3" or "1-10")')
    .option('-n, --names <names>', 'Extract exported assets by name (comma-separated)')
    .option('-f, --frames <frames>', 'Extract specific frames (e.g., "0,1,2" or "0-5")')
    .option('-F, --full-animation', 'Export full animations', false)
    .option('-s, --sprites', 'Extract all sprites', false)
    .option('-e, --exported', 'Extract all exported assets', false)
    .option('-t, --timeline', 'Extract main timeline', false)
    .option('-v, --variables', 'Extract ActionScript variables', false)
    .option('--format <fmt...>', 'Frame format: svg, png, jpg, webp, gif (can include size: png@128x128)')
    .option('--animation-format <fmt>', 'Animation format: gif, webp', 'gif')
    .option('-p, --parallel <n>', 'Number of parallel workers', '1')
    .option('--scale <scales>', 'Scale factors (comma-separated)', '1')
    .option('--keep-empty', 'Keep empty frames', false)
    .option('--manifest', 'Generate manifest JSON', false)
    .option('--tile-type <type>', 'Tile type for manifest')
    .option('--subtype <type>', 'Subtype for manifest')
    .option('--verbose', 'Verbose output', false)
    .action(async (files: string[], opts) => {
      const options = parseOptions(files, opts);
      await runExtraction(options);
    });

  return program;
}

interface CommanderOptions {
  output: string;
  outputFilename: string;
  characters?: string;
  names?: string;
  frames?: string;
  fullAnimation: boolean;
  sprites: boolean;
  exported: boolean;
  timeline: boolean;
  variables: boolean;
  format?: string[];
  animationFormat: string;
  parallel: string;
  scale: string;
  keepEmpty: boolean;
  manifest: boolean;
  tileType?: string;
  subtype?: string;
  verbose: boolean;
}

/**
 * Parse commander options into ExtractOptions.
 */
function parseOptions(files: string[], opts: CommanderOptions): ExtractOptions {
  const frameFormats = opts.format?.map(parseFrameFormat) ?? [
    { format: ImageFormat.Svg, width: null, height: null, prefix: '', lossless: false },
  ];

  return {
    files,
    output: opts.output,
    outputFilename: opts.outputFilename,
    characters: opts.characters ? parseNumberList(opts.characters) : null,
    exportedNames: opts.names ? opts.names.split(',') : null,
    frames: opts.frames ? parseNumberList(opts.frames) : null,
    fullAnimation: opts.fullAnimation,
    allSprites: opts.sprites,
    allExported: opts.exported,
    timeline: opts.timeline,
    variables: opts.variables,
    frameFormats,
    animationFormat: opts.animationFormat === 'webp' ? ImageFormat.Webp : ImageFormat.Gif,
    parallel: parseInt(opts.parallel, 10),
    scales: opts.scale.split(',').map((s) => parseFloat(s)),
    skipEmptyFrames: !opts.keepEmpty,
    manifest: opts.manifest,
    tileType: opts.tileType ?? null,
    subtype: opts.subtype ?? null,
    verbose: opts.verbose,
    help: false,
  };
}

/**
 * Run the extract command (for programmatic use).
 */
export async function runExtractCommand(args: string[]): Promise<void> {
  const program = createProgram();
  await program.parseAsync(args, { from: 'user' });
}

/**
 * Run the extraction process.
 */
async function runExtraction(options: ExtractOptions): Promise<void> {
  // Create output directory
  fs.mkdirSync(options.output, { recursive: true });

  // Manifest mode: generate tile metadata for game export
  if (options.manifest) {
    await runManifestExtraction(options);
    return;
  }

  // Use parallel processing if requested
  if (options.parallel > 1 && options.files.length > 1) {
    await runParallelExtraction(options);
  } else {
    await runSequentialExtraction(options);
  }
}

/**
 * Run manifest extraction mode.
 */
async function runManifestExtraction(options: ExtractOptions): Promise<void> {
  const total = options.files.length;
  let success = true;

  for (let i = 0; i < options.files.length; i++) {
    const file = options.files[i]!;
    console.log(`[${i + 1}/${total}] Generating manifest for: ${file}`);

    try {
      const result = await generateManifest(file, options);
      if (!result) {
        success = false;
      }
      console.log('done');
    } catch (e) {
      console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
      success = false;
    }
  }

  if (!success) {
    console.error('Some errors occurred during manifest generation.');
    process.exit(1);
  }

  console.log('All manifests generated successfully.');
}

/**
 * Run extraction sequentially.
 */
async function runSequentialExtraction(options: ExtractOptions): Promise<void> {
  const total = options.files.length;
  let success = true;

  for (let i = 0; i < options.files.length; i++) {
    const file = options.files[i]!;
    console.log(`[${i + 1}/${total}] Processing file: ${file}`);

    try {
      await processFile(file, options);
      console.log('done');
    } catch (e) {
      console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
      success = false;
    }
  }

  if (!success) {
    console.error('Some errors occurred during the extraction process.');
    process.exit(1);
  }

  console.log('All files processed successfully.');
}

/**
 * Run extraction in parallel using worker chunks.
 */
async function runParallelExtraction(options: ExtractOptions): Promise<void> {
  const workers = options.parallel;
  const files = options.files;
  const totalFiles = files.length;

  console.log(`Starting parallel extraction with ${workers} workers for ${totalFiles} files...`);

  // Split files into chunks for each worker
  const chunkSize = Math.ceil(totalFiles / workers);
  const chunks: string[][] = [];
  for (let i = 0; i < files.length; i += chunkSize) {
    chunks.push(files.slice(i, i + chunkSize));
  }

  // Process chunks in parallel
  const results = await Promise.allSettled(
    chunks.map(async (chunk, workerIndex) => {
      for (const file of chunk) {
        console.log(`[Worker ${workerIndex}] Processing: ${file}`);
        try {
          await processFile(file, options);
          console.log(`[Worker ${workerIndex}] done: ${file}`);
        } catch (e) {
          console.error(`[Worker ${workerIndex}] error: ${file} - ${e instanceof Error ? e.message : String(e)}`);
          throw e;
        }
      }
    }),
  );

  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    console.error('Some errors occurred during the extraction process.');
    process.exit(1);
  }

  console.log('All files processed successfully.');
}

async function processFile(filePath: string, options: ExtractOptions): Promise<void> {
  if (options.verbose) {
    console.log(`Processing: ${filePath}`);
  }

  const swfFile = SwfFile.fromFileSync(filePath, Errors.IGNORE_INVALID_TAG);
  const extractor = new SwfExtractor(swfFile.parser);
  const baseName = path.basename(filePath, '.swf');
  const frameRate = swfFile.frameRate;

  // Preload bitmaps once for this file so that SVG exports can use
  // proper bitmap fills instead of the gray fallback.
  // If loading fails for some images, they will simply render as gray.
  const imageMap = await extractor.preloadImages();
  const bitmapResolver = SwfExtractor.createBitmapResolver(imageMap);

  // Extract variables
  if (options.variables) {
    const vars = swfFile.variables;
    const outPath = path.join(options.output, `${baseName}_variables.json`);
    fs.writeFileSync(outPath, JSON.stringify(vars, null, 2));
    if (options.verbose) {
      console.log(`  Variables: ${outPath}`);
    }
  }

  // Extract exported assets
  if (options.allExported || options.exportedNames) {
    for (const asset of extractor.exported()) {
      if (options.exportedNames && !options.exportedNames.includes(asset.name)) {
        continue;
      }
      await extractCharacter(filePath, baseName, extractor, asset.id, asset.name, options, frameRate, bitmapResolver);
    }
  }

  // Extract by character ID
  if (options.characters) {
    for (const id of options.characters) {
      await extractCharacter(filePath, baseName, extractor, id, `char_${id}`, options, frameRate, bitmapResolver);
    }
  }

  // Extract all shapes
  if (options.allSprites) {
    for (const id of extractor.shapes()) {
      await extractCharacter(filePath, baseName, extractor, id, `shape_${id}`, options, frameRate, bitmapResolver);
    }
    for (const id of extractor.sprites()) {
      await extractCharacter(filePath, baseName, extractor, id, `sprite_${id}`, options, frameRate, bitmapResolver);
    }
  }

  // Extract timeline
  if (options.timeline) {
    await extractTimeline(filePath, extractor, baseName, options, frameRate, bitmapResolver);
  }

  extractor.clearCaches();
}

/**
 * Extract a character (shape, sprite, or image).
 */
async function extractCharacter(
  filePath: string,
  baseName: string,
  extractor: SwfExtractor,
  id: number,
  name: string,
  options: ExtractOptions,
  frameRate: number,
  bitmapResolver: ReturnType<typeof SwfExtractor.createBitmapResolver>,
): Promise<void> {
  const charType = extractor.getCharacterType(id);
  if (!charType) return;

  await match(charType)
    .with('shape', () => extractShape(filePath, baseName, extractor, id, name, options, bitmapResolver))
    .with('image', () => extractImage(filePath, baseName, extractor, id, name, options))
    .with('sprite', () => extractSprite(filePath, baseName, extractor, id, name, options, frameRate, bitmapResolver))
    .with('morph', () => extractMorph(filePath, baseName, extractor, id, name, options, bitmapResolver))
    .exhaustive();
}

/**
 * Extract a shape.
 */
async function extractShape(
  filePath: string,
  baseName: string,
  extractor: SwfExtractor,
  id: number,
  name: string,
  options: ExtractOptions,
  bitmapResolver: ReturnType<typeof SwfExtractor.createBitmapResolver>,
): Promise<void> {
  const shape = extractor.getShape(id);
  if (!shape) return;

  for (const scale of options.scales) {
    const drawer = new SvgDrawer({ scale, bitmapResolver });
    const svg = drawer.drawShape(shape);

    for (const fmt of options.frameFormats) {
      const ext = getExtension(fmt.format);
      const filename = resolveFilename(options.outputFilename, {
        basename: baseName,
        dirname: path.basename(path.dirname(filePath)),
        name,
        ext,
        frame: null,
        scale: scale !== 1 ? scale : null,
      });
      const outPath = path.join(options.output, filename);

      // Ensure output directory exists
      const outputDir = path.dirname(outPath);
      await fs.promises.mkdir(outputDir, { recursive: true });

      if (fmt.format === ImageFormat.Svg) {
        await fs.promises.writeFile(outPath, svg);
      } else {
        const buffer = await convertSvg(svg, fmt.format, {
          width: fmt.width,
          height: fmt.height,
        });
        await fs.promises.writeFile(outPath, buffer);
      }

      if (options.verbose) {
        console.log(`  Shape: ${outPath}`);
      }
    }
  }
}

/**
 * Extract an image.
 */
async function extractImage(
  filePath: string,
  baseName: string,
  extractor: SwfExtractor,
  id: number,
  name: string,
  options: ExtractOptions,
): Promise<void> {
  const image = await extractor.getImage(id);
  if (!image) return;

  const ext = image.format === 'jpeg' ? 'jpg' : 'png';
  const filename = resolveFilename(options.outputFilename, {
    basename: baseName,
    dirname: path.basename(path.dirname(filePath)),
    name,
    ext,
    frame: null,
    scale: null,
  });
  const outPath = path.join(options.output, filename);

  // Ensure output directory exists
  const outputDir = path.dirname(outPath);
  await fs.promises.mkdir(outputDir, { recursive: true });

  await fs.promises.writeFile(outPath, image.data);

  if (options.verbose) {
    console.log(`  Image: ${outPath}`);
  }
}

/**
 * Extract a sprite (as timeline frames).
 */
async function extractSprite(
  filePath: string,
  baseName: string,
  extractor: SwfExtractor,
  id: number,
  name: string,
  options: ExtractOptions,
  frameRate: number,
  bitmapResolver: ReturnType<typeof SwfExtractor.createBitmapResolver>,
): Promise<void> {
  const sprite = extractor.getSprite(id);
  if (!sprite) return;

  const timeline = sprite.timeline();
  await extractSpriteTimeline(filePath, baseName, timeline, name, options, frameRate, bitmapResolver);
}

/**
 * Extract a morph shape.
 */
async function extractMorph(
  filePath: string,
  baseName: string,
  extractor: SwfExtractor,
  id: number,
  name: string,
  options: ExtractOptions,
  bitmapResolver: ReturnType<typeof SwfExtractor.createBitmapResolver>,
): Promise<void> {
  const morph = extractor.getMorphShape(id);
  if (!morph) return;

  // For morph shapes, we extract frames at different ratios
  const frameCount = options.fullAnimation ? morph.framesCount(true) : 1;
  const steps = Math.min(frameCount, 100); // Cap at 100 frames

  for (let i = 0; i < steps; i++) {
    const ratio = steps > 1 ? i / (steps - 1) : 0;
    const paths = morph.pathsAtRatio(ratio);

    for (const scale of options.scales) {
      const drawer = new SvgDrawer({ scale, bitmapResolver });
      const svg = drawer.drawPaths(paths, morph.bounds());

      for (const fmt of options.frameFormats) {
        const ext = getExtension(fmt.format);
        const filename = resolveFilename(options.outputFilename, {
          basename: baseName,
          dirname: path.basename(path.dirname(filePath)),
          name,
          ext,
          frame: steps > 1 ? i + 1 : null,
          scale: scale !== 1 ? scale : null,
        });
        const outputPath = path.join(options.output, filename);

        // Ensure output directory exists
        const outputDir = path.dirname(outputPath);
        await fs.promises.mkdir(outputDir, { recursive: true });

        if (fmt.format === ImageFormat.Svg) {
          await fs.promises.writeFile(outputPath, svg);
        } else {
          const buffer = await convertSvg(svg, fmt.format, {
            width: fmt.width ? fmt.width * scale : undefined,
            height: fmt.height ? fmt.height * scale : undefined,
          });
          await fs.promises.writeFile(outputPath, buffer);
        }

        if (options.verbose) {
          console.log(`  Morph frame ${i}: ${outputPath}`);
        }
      }
    }
  }
}

/**
 * Extract sprite timeline frames.
 */
async function extractSpriteTimeline(
  filePath: string,
  baseName: string,
  timeline: Timeline,
  name: string,
  options: ExtractOptions,
  frameRate: number,
  bitmapResolver: ReturnType<typeof SwfExtractor.createBitmapResolver>,
): Promise<void> {
  // Get actual frame count (recursive when fullAnimation is enabled)
  const totalFrameCount = options.fullAnimation
    ? timeline.framesCount(true)
    : timeline.frameCount;
  const frameIndices = options.frames ?? Array.from({ length: totalFrameCount }, (_, i) => i);
  const allFrameSvgs: string[] = [];

  for (const idx of frameIndices) {
    // For recursive animation, use timeline.draw which handles nested frames
    const canvas = new SvgCanvas({ bitmapResolver });
    timeline.draw(canvas, idx);
    const svg = canvas.render();

    // Skip empty frames if requested
    if (options.skipEmptyFrames && svg.includes('<g></g>')) {
      continue;
    }

    allFrameSvgs.push(svg);

    // Process each frame format and scale (for individual frame output)
    for (const frameFormat of options.frameFormats) {
      for (const scale of options.scales) {
        const ext = getExtension(frameFormat.format);
        const filename = resolveFilename(options.outputFilename, {
          basename: baseName,
          dirname: path.basename(path.dirname(filePath)),
          name,
          ext,
          frame: totalFrameCount > 1 ? idx + 1 : null,
          scale: scale !== 1 ? scale : null,
        });
        const outputPath = path.join(options.output, filename);

        // Ensure output directory exists
        const outputDir = path.dirname(outputPath);
        await fs.promises.mkdir(outputDir, { recursive: true });

        // Convert and save
        if (frameFormat.format === ImageFormat.Svg) {
          await fs.promises.writeFile(outputPath, svg);
        } else {
          // Get base dimensions from SVG if not explicitly set
          const svgMatch = svg.match(/width="([0-9.]+)(?:px)?" height="([0-9.]+)(?:px)?"/);
          const baseWidth = svgMatch ? parseFloat(svgMatch[1]!) : 100;
          const baseHeight = svgMatch ? parseFloat(svgMatch[2]!) : 100;

          const conversionOptions = {
            width: Math.round((frameFormat.width ?? baseWidth) * scale),
            height: Math.round((frameFormat.height ?? baseHeight) * scale),
          };
          const buffer = await convertSvg(svg, frameFormat.format, conversionOptions);
          await fs.promises.writeFile(outputPath, buffer);
        }

        if (options.verbose) {
          console.log(`    Frame ${idx} -> ${outputPath}`);
        }
      }
    }
  }

  // Generate animation if requested and we have multiple frames
  if (allFrameSvgs.length > 1 && options.animationFormat) {
    const delay = Math.round(1000 / frameRate); // Convert FPS to milliseconds per frame

    for (const scale of options.scales) {
      // Get dimensions from first frame SVG
      const svgMatch = allFrameSvgs[0]!.match(/width="([0-9.]+)(?:px)?" height="([0-9.]+)(?:px)?"/);
      const baseWidth = svgMatch ? parseFloat(svgMatch[1]!) : 100;
      const baseHeight = svgMatch ? parseFloat(svgMatch[2]!) : 100;

      const ext = getExtension(options.animationFormat);
      const filename = resolveFilename(options.outputFilename, {
        basename: baseName,
        dirname: path.basename(path.dirname(filePath)),
        name,
        ext,
        frame: null,
        scale: scale !== 1 ? scale : null,
      });
      const outputPath = path.join(options.output, filename);

      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      await fs.promises.mkdir(outputDir, { recursive: true });

      const buffer = await convertToAnimation(allFrameSvgs, options.animationFormat, {
        width: Math.round(baseWidth * scale),
        height: Math.round(baseHeight * scale),
        delay,
      });
      await fs.promises.writeFile(outputPath, buffer);

      if (options.verbose) {
        console.log(`  Animation: ${allFrameSvgs.length} frames -> ${outputPath}`);
      }
    }
  }
}

/**
 * Extract timeline frames.
 */
async function extractTimeline(
	  filePath: string,
	  extractor: SwfExtractor,
	  baseName: string,
	  options: ExtractOptions,
	  frameRate: number,
	  bitmapResolver: ReturnType<typeof SwfExtractor.createBitmapResolver>,
	): Promise<void> {
	  const timeline = extractor.getTimeline();
	  await extractSpriteTimeline(filePath, baseName, timeline, 'timeline', options, frameRate, bitmapResolver);
	}
