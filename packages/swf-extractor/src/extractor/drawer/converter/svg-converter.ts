import { execSync, spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { GifEncoder } from '@skyra/gifenc';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { buffer as streamToBuffer } from 'stream/consumers';
import { ImageFormat, type ImageFormatValue } from './image-format.ts';

/** Whether to use subprocess rendering to isolate resvg panics */
let useSubprocessRendering = false;

/** Number of workers in the pool */
let workerPoolSize = Math.max(4, os.cpus().length);

/**
 * Enable or disable subprocess rendering.
 * When enabled, resvg is run in a separate process to prevent panics from crashing the main process.
 * This is slower but safer for batch processing where some SVGs may cause crashes.
 */
export function setSubprocessRendering(enabled: boolean): void {
  useSubprocessRendering = enabled;
}

/**
 * Set the worker pool size (number of parallel render workers).
 * Default is the number of CPU cores.
 */
export function setWorkerPoolSize(size: number): void {
  workerPoolSize = Math.max(1, size);
}

// ========== Worker Pool Implementation ==========

interface RenderRequest {
  id: string;
  svgPath: string;
  pngPath: string;
  width: number;
  height: number;
}

interface RenderResponse {
  id: string;
  success: boolean;
  error?: string;
}

interface PendingRequest {
  resolve: (buffer: Buffer) => void;
  reject: (error: Error) => void;
  pngPath: string;
  tmpDir: string;
  timeoutId: NodeJS.Timeout;
}

const WORKER_TIMEOUT_MS = 30000; // 30 second timeout per render

interface WorkerInfo {
  process: ChildProcess;
  rl: readline.Interface;
  pending: Map<string, PendingRequest>;
  busy: boolean;
  ready: boolean;
}

let workers: WorkerInfo[] = [];
let workerQueue: Array<() => void> = [];
let nextRequestId = 0;
let poolInitialized = false;
let poolRefCount = 0; // Reference count for graceful shutdown

/**
 * Initialize the worker pool if not already done.
 */
function ensureWorkerPool(): void {
  if (poolInitialized) return;
  poolInitialized = true;

  const workerPath = path.join(__dirname, 'render-worker-pool.ts');

  for (let i = 0; i < workerPoolSize; i++) {
    const proc = spawn('bun', [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const rl = readline.createInterface({
      input: proc.stdout!,
      terminal: false,
    });

    const workerInfo: WorkerInfo = {
      process: proc,
      rl,
      pending: new Map(),
      busy: false,
      ready: false,
    };

    // Listen for responses
    rl.on('line', (line) => {
      try {
        const response = JSON.parse(line) as RenderResponse;
        const pending = workerInfo.pending.get(response.id);
        if (pending) {
          // Clear the timeout since we got a response
          clearTimeout(pending.timeoutId);

          workerInfo.pending.delete(response.id);
          workerInfo.busy = workerInfo.pending.size > 0;

          if (response.success) {
            try {
              const buffer = fs.readFileSync(pending.pngPath);
              fs.rmSync(pending.tmpDir, { recursive: true, force: true });
              pending.resolve(buffer);
            } catch (err) {
              fs.rmSync(pending.tmpDir, { recursive: true, force: true });
              pending.reject(new Error(`Failed to read output: ${err}`));
            }
          } else {
            fs.rmSync(pending.tmpDir, { recursive: true, force: true });
            pending.reject(new Error(response.error || 'Unknown error'));
          }

          // Process next queued request if any
          processQueue();
        } else {
          // Response for a timed-out request - worker is now available again
          workerInfo.ready = true;
          workerInfo.busy = false;
          processQueue();
        }
      } catch {
        // Ignore parse errors
      }
    });

    // Listen for worker ready signal
    proc.stderr?.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Worker ready')) {
        workerInfo.ready = true;
        processQueue();
      }
    });

    // Handle worker crash - just mark as not ready, don't restart
    // (simpler and avoids complexity of re-attaching event handlers)
    proc.on('exit', (code) => {
      // Reject all pending requests and clear their timeouts
      for (const pending of workerInfo.pending.values()) {
        clearTimeout(pending.timeoutId);
        fs.rmSync(pending.tmpDir, { recursive: true, force: true });
        pending.reject(new Error(`Worker crashed with code ${code}`));
      }
      workerInfo.pending.clear();
      workerInfo.ready = false;
      workerInfo.busy = false;

      // Process queue with remaining workers
      processQueue();
    });

    workers.push(workerInfo);
  }
}

/**
 * Process queued render requests.
 */
function processQueue(): void {
  while (workerQueue.length > 0) {
    // Find an available worker
    const worker = workers.find((w) => w.ready && !w.busy);
    if (!worker) break;

    const next = workerQueue.shift();
    if (next) {
      // Don't set busy here - execute() will set it after finding the worker
      next();
    }
  }
}

/**
 * Render SVG to PNG using worker pool (async).
 */
async function renderSvgToPngWorkerPool(
  svgContent: string,
  width: number,
  height: number,
): Promise<Buffer> {
  ensureWorkerPool();

  return new Promise<Buffer>((resolve, reject) => {
    const execute = () => {
      const availableWorkers = workers.filter((w) => w.ready && !w.busy);

      if (availableWorkers.length === 0) {
        // Queue this request
        workerQueue.push(execute);
        return;
      }

      const worker = availableWorkers[0]!
      const id = String(nextRequestId++);
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svg-render-'));
      const svgPath = path.join(tmpDir, 'input.svg');
      const pngPath = path.join(tmpDir, 'output.png');

      // Scale and sanitize SVG
      const scaledSvg = scaleSvg(svgContent, width, height);
      const sanitizedSvg = sanitizeSvg(scaledSvg);
      fs.writeFileSync(svgPath, sanitizedSvg);

      // Set up timeout to prevent hanging
      const timeoutId = setTimeout(() => {
        const pending = worker.pending.get(id);
        if (pending) {
          console.error(`[WorkerPool] Request ${id} timed out after ${WORKER_TIMEOUT_MS}ms - marking worker as unavailable`);
          worker.pending.delete(id);
          // Mark worker as not ready since it's still stuck processing
          // It will be marked ready again if it eventually responds
          worker.ready = false;
          worker.busy = false;
          fs.rmSync(tmpDir, { recursive: true, force: true });
          reject(new Error('Worker timeout'));
          processQueue();
        }
      }, WORKER_TIMEOUT_MS);

      worker.pending.set(id, { resolve, reject, pngPath, tmpDir, timeoutId });
      worker.busy = true;

      const request: RenderRequest = { id, svgPath, pngPath, width, height };
      worker.process.stdin?.write(JSON.stringify(request) + '\n');
    };

    execute();
  });
}

/**
 * Acquire a reference to the worker pool.
 * Call this before starting a batch of rendering operations.
 */
export function acquireWorkerPool(): void {
  poolRefCount++;
  ensureWorkerPool();
}

/**
 * Release a reference to the worker pool.
 * The pool is shut down when all references are released.
 */
export function releaseWorkerPool(): void {
  poolRefCount = Math.max(0, poolRefCount - 1);
  if (poolRefCount === 0) {
    shutdownWorkerPoolInternal();
  }
}

/**
 * Shutdown the worker pool (internal).
 */
function shutdownWorkerPoolInternal(): void {
  poolInitialized = false;
  for (const worker of workers) {
    worker.process.kill();
  }
  workers = [];
  workerQueue = [];
}

/**
 * Force shutdown the worker pool regardless of reference count.
 */
export function shutdownWorkerPool(): void {
  poolRefCount = 0;
  shutdownWorkerPoolInternal();
}

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
  // Extract the <svg> tag to check for existing viewBox and get dimensions
  const svgTagMatch = svgContent.match(/<svg[^>]*>/);
  if (!svgTagMatch) {
    return svgContent;
  }

  const svgTag = svgTagMatch[0];
  const widthMatch = svgTag.match(/width="([^"]+)"/);
  const heightMatch = svgTag.match(/height="([^"]+)"/);

  if (!widthMatch || !heightMatch) {
    return svgContent;
  }

  const origWidth = parseFloat(widthMatch[1]!);
  const origHeight = parseFloat(heightMatch[1]!);

  // Check if viewBox already exists on the root <svg> element (not nested elements)
  const hasViewBox = /viewBox\s*=/.test(svgTag);

  let result = svgContent;

  // Add viewBox if not present on root <svg>
  if (!hasViewBox) {
    result = result.replace(/<svg\s/, `<svg viewBox="0 0 ${origWidth} ${origHeight}" `);
  }

  // Update dimensions on root <svg> element
  result = result.replace(/(<svg[^>]*?)width="[^"]+"/, `$1width="${targetWidth}"`);
  result = result.replace(/(<svg[^>]*?)height="[^"]+"/, `$1height="${targetHeight}"`);

  return result;
}

/**
 * Sanitize SVG content to avoid resvg crashes.
 * Removes elements with zero dimensions that can cause geometry panics.
 */
function sanitizeSvg(svgContent: string): string {
  // Remove <use> elements with zero width or height (causes resvg panic)
  // These are empty placeholders that have no visual content
  return svgContent.replace(/<use[^>]*\s(?:width="0"|height="0")[^>]*\/>/g, '');
}



/**
 * Render SVG to PNG using resvg (high-quality Rust SVG renderer).
 * Now async to support worker pool.
 */
async function renderSvgToPng(svgContent: string, width: number, height: number): Promise<Buffer> {
  // Use worker pool if subprocess rendering is enabled (async, crash-isolated)
  if (useSubprocessRendering) {
    return renderSvgToPngWorkerPool(svgContent, width, height);
  }

  // Scale SVG to target dimensions before rendering so resvg renders at full resolution
  const scaledSvg = scaleSvg(svgContent, width, height);

  // Sanitize SVG to avoid resvg crashes with zero-dimension elements
  const sanitizedSvg = sanitizeSvg(scaledSvg);

  try {
    const resvg = new Resvg(sanitizedSvg, {
      fitTo: { mode: 'width', value: width },
    });

    const pngData = resvg.render();
    return Buffer.from(pngData.asPng());
  } catch (error) {
    // Write failing SVG to debug
    fs.writeFileSync('/tmp/failing-svg.svg', sanitizedSvg);
    throw error;
  }
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

  // Skip rendering if SVG has zero size
  if (origWidth <= 0 || origHeight <= 0) {
    return Buffer.alloc(0);
  }

  const targetWidth = options.width ?? Math.round(origWidth);
  const targetHeight = options.height ?? Math.round(origHeight);

  // Use resvg to render SVG to PNG (high-quality Rust renderer)
  const pngBuffer = await renderSvgToPng(svgContent, targetWidth, targetHeight);

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

