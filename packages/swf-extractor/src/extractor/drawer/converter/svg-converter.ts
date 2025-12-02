import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GifEncoder } from '@skyra/gifenc';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { buffer as streamToBuffer } from 'stream/consumers';
import { ImageFormat, type ImageFormatValue } from './image-format.ts';

/**
 * Options for SVG to raster conversion.
 */
export interface ConversionOptions {
  /** Output width in pixels (null = auto) */
  width?: number | null;
  /** Output height in pixels (null = auto) */
  height?: number | null;
  /** Background color (null = transparent for PNG/WebP, white for JPEG) */
  background?: string | null;
  /** Quality for lossy formats (0-100) */
  quality?: number;
}

/**
 * Scale SVG dimensions by modifying width/height and adding viewBox.
 * This allows librsvg to render at the target resolution natively.
 */
function scaleSvg(svgContent: string, targetWidth: number, targetHeight: number): string {
  // Extract current dimensions
  const widthMatch = svgContent.match(/width="([^"]+)"/);
  const heightMatch = svgContent.match(/height="([^"]+)"/);

  if (!widthMatch || !heightMatch) {
    return svgContent;
  }

  const origWidth = parseFloat(widthMatch[1]!);
  const origHeight = parseFloat(heightMatch[1]!);

  // Check if viewBox already exists
  const hasViewBox = /viewBox\s*=/.test(svgContent);

  let result = svgContent;

  // Add viewBox if not present
  if (!hasViewBox) {
    result = result.replace(/<svg\s/, `<svg viewBox="0 0 ${origWidth} ${origHeight}" `);
  }

  // Update dimensions
  result = result.replace(/width="[^"]+"/, `width="${targetWidth}"`);
  result = result.replace(/height="[^"]+"/, `height="${targetHeight}"`);

  return result;
}

/**
 * Render SVG to PNG using resvg (high-quality Rust SVG renderer).
 */
function renderSvgToPng(svgContent: string, width: number, height: number): Buffer {
  // Scale SVG to target dimensions before rendering so resvg renders at full resolution
  const scaledSvg = scaleSvg(svgContent, width, height);

  const resvg = new Resvg(scaledSvg, {
    fitTo: { mode: 'width', value: width },
  });
  const pngData = resvg.render();
  return Buffer.from(pngData.asPng());
}

/**
 * Convert SVG to raster image format.
 */
export async function convertSvg(
  svg: string | Buffer,
  format: ImageFormatValue,
  options: ConversionOptions = {},
): Promise<Buffer> {
  if (format === ImageFormat.Svg) {
    return Buffer.from(typeof svg === 'string' ? svg : svg.toString('utf-8'));
  }

  let svgContent = typeof svg === 'string' ? svg : svg.toString('utf-8');

  // Get original dimensions
  const widthMatch = svgContent.match(/width="([^"]+)"/);
  const heightMatch = svgContent.match(/height="([^"]+)"/);
  const origWidth = widthMatch ? parseFloat(widthMatch[1]!) : 100;
  const origHeight = heightMatch ? parseFloat(heightMatch[1]!) : 100;

  const targetWidth = options.width ?? Math.round(origWidth);
  const targetHeight = options.height ?? Math.round(origHeight);

  // Use resvg to render SVG to PNG (high-quality Rust renderer)
  const pngBuffer = renderSvgToPng(svgContent, targetWidth, targetHeight);

  // For PNG, return directly
  if (format === ImageFormat.Png) {
    return pngBuffer;
  }

  // For other formats, convert from PNG using sharp
  const image = sharp(pngBuffer);

  switch (format) {
    case ImageFormat.Jpeg:
      return image
        .flatten({
          background: options.background ?? { r: 255, g: 255, b: 255 },
        })
        .jpeg({
          quality: options.quality ?? 90,
        })
        .toBuffer();

    case ImageFormat.Webp:
      return image
        .webp({
          quality: options.quality ?? 90,
          lossless: options.quality === 100,
        })
        .toBuffer();

    case ImageFormat.Gif:
      return image.gif().toBuffer();

    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

/**
 * Convert multiple SVGs to animated GIF or WebP.
 */
export async function convertToAnimation(
  frames: (string | Buffer)[],
  format: ImageFormatValue,
  options: ConversionOptions & { delay?: number } = {},
): Promise<Buffer> {
  if (frames.length === 0) {
    throw new Error('No frames provided');
  }

  if (frames.length === 1) {
    return convertSvg(frames[0]!, format, options);
  }

  const delay = options.delay ?? 100;

  // Convert all frames to PNG first with the specified size
  const pngFrames = await Promise.all(
    frames.map((frame) => convertSvg(frame, ImageFormat.Png, options)),
  );

  // Get dimensions from first frame metadata
  const firstFrameMeta = await sharp(pngFrames[0]).metadata();
  const width = options.width ?? firstFrameMeta.width ?? 100;
  const height = options.height ?? firstFrameMeta.height ?? 100;

  if (format === ImageFormat.Gif) {
    // Create animated GIF by joining frames
    const composite = sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    });

    // Use sharp's composite for animation
    return sharp(pngFrames[0], { animated: false, pages: pngFrames.length })
      .gif({
        delay: pngFrames.map(() => delay),
        loop: 0,
      })
      .toBuffer()
      .catch(async () => {
        // Fallback: manually create animation frame by frame
        // Sharp doesn't natively support creating multi-frame from separate buffers
        // Use a workaround with raw frame concatenation
        return createAnimatedImage(pngFrames, format, width, height, delay, options.quality ?? 90);
      });
  }

  if (format === ImageFormat.Webp) {
    // Create animated WebP by joining frames
    return createAnimatedImage(pngFrames, format, width, height, delay, options.quality ?? 90);
  }

  throw new Error(`Format ${format} does not support animation`);
}

/**
 * Create an animated image from PNG frames.
 * For WebP: uses img2webp command for direct animated WebP creation.
 * For GIF: uses @skyra/gifenc.
 */
async function createAnimatedImage(
  pngFrames: Buffer[],
  format: ImageFormatValue,
  width: number,
  height: number,
  delay: number,
  quality: number,
): Promise<Buffer> {
  // Frames are already at the correct size from SVG scaling
  const resizedPngs = pngFrames;

  if (format === ImageFormat.Webp) {
    // Use img2webp to create animated WebP directly from PNG frames
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webp-anim-'));
    try {
      // Write PNG frames to temp files
      const framePaths: string[] = [];
      for (let i = 0; i < resizedPngs.length; i++) {
        const framePath = path.join(tmpDir, `frame_${i.toString().padStart(4, '0')}.png`);
        fs.writeFileSync(framePath, resizedPngs[i]!);
        framePaths.push(framePath);
      }

      const outputPath = path.join(tmpDir, 'output.webp');

      // Build img2webp command: -d delay -lossy -q quality for each frame
      // -m 6 = slowest/best compression method
      // -lossy = use lossy compression (VP8) instead of lossless (VP8L)
      const args = ['-loop', '0', '-m', '6'];
      for (const framePath of framePaths) {
        args.push('-d', delay.toString(), '-lossy', '-q', quality.toString(), framePath);
      }
      args.push('-o', outputPath);

      execSync(`img2webp ${args.join(' ')}`, { stdio: 'pipe' });

      return fs.readFileSync(outputPath);
    } finally {
      // Cleanup temp directory
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  if (format === ImageFormat.Gif) {
    // Get raw RGBA data for GIF encoder
    const rawFrames = await Promise.all(
      resizedPngs.map(async (png) => {
        return sharp(png).ensureAlpha().raw().toBuffer();
      }),
    );

    const encoder = new GifEncoder(width, height)
      .setRepeat(0)
      .setDelay(delay)
      .setQuality(10);

    const stream = encoder.createReadStream();
    encoder.start();

    for (const frame of rawFrames) {
      encoder.addFrame(new Uint8ClampedArray(frame));
    }

    encoder.finish();
    return streamToBuffer(stream);
  }

  throw new Error(`Format ${format} does not support animation`);
}

