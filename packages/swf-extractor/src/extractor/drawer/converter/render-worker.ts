/**
 * SVG to PNG render worker script.
 * Run in a subprocess to isolate resvg panics from crashing the main process.
 *
 * Usage: bun render-worker.ts <svg-path> <output-path> <width> <height>
 * Reads SVG from <svg-path>, renders to PNG, writes to <output-path>
 * Exit code 0 = success, non-zero = failure
 */

import * as fs from 'fs';
import { Resvg } from '@resvg/resvg-js';

const args = process.argv.slice(2);

if (args.length < 4) {
  console.error('Usage: bun render-worker.ts <svg-path> <output-path> <width> <height>');
  process.exit(1);
}

const [svgPath, outputPath, widthStr, heightStr] = args;
const width = parseInt(widthStr!, 10);
const height = parseInt(heightStr!, 10);

if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
  console.error('Invalid dimensions');
  process.exit(1);
}

try {
  const svgContent = fs.readFileSync(svgPath!, 'utf-8');

  // Sanitize SVG - remove <use> elements with zero dimensions
  const sanitizedSvg = svgContent.replace(/<use[^>]*\s(?:width="0"|height="0")[^>]*\/>/g, '');

  const resvg = new Resvg(sanitizedSvg, {
    fitTo: { mode: 'width', value: width },
  });

  const pngData = resvg.render();
  const pngBuffer = Buffer.from(pngData.asPng());

  fs.writeFileSync(outputPath!, pngBuffer);
  process.exit(0);
} catch (error) {
  console.error('Render failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}

