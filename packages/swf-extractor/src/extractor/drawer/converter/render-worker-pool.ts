/**
 * SVG to PNG render worker script for worker pool.
 * Stays alive and processes multiple render requests via stdin/stdout.
 *
 * Protocol:
 * - Input (stdin): JSON lines with { id, svgPath, pngPath, width, height }
 * - Output (stdout): JSON lines with { id, success, error? }
 *
 * Usage: bun render-worker-pool.ts
 */

import * as fs from 'fs';
import * as readline from 'readline';
import { Resvg } from '@resvg/resvg-js';

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

function sendResponse(response: RenderResponse): void {
  process.stdout.write(JSON.stringify(response) + '\n');
}

function processRequest(request: RenderRequest): void {
  const { id, svgPath, pngPath, width, height } = request;

  try {
    const svgContent = fs.readFileSync(svgPath, 'utf-8');

    // Sanitize SVG - remove <use> elements with zero dimensions
    const sanitizedSvg = svgContent.replace(/<use[^>]*\s(?:width="0"|height="0")[^>]*\/>/g, '');

    const resvg = new Resvg(sanitizedSvg, {
      fitTo: { mode: 'width', value: width },
    });

    const pngData = resvg.render();
    const pngBuffer = Buffer.from(pngData.asPng());

    fs.writeFileSync(pngPath, pngBuffer);
    sendResponse({ id, success: true });
  } catch (error) {
    sendResponse({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Set up readline to read JSON lines from stdin
// Note: Don't set output to stdout as it interferes with our JSON responses
const rl = readline.createInterface({
  input: process.stdin,
  terminal: false,
});

rl.on('line', (line) => {
  try {
    const request = JSON.parse(line) as RenderRequest;
    processRequest(request);
  } catch (error) {
    // Invalid JSON - send error response
    sendResponse({
      id: 'unknown',
      success: false,
      error: `Invalid request: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

// Keep the process alive
rl.on('close', () => {
  process.exit(0);
});

// Signal that worker is ready
console.error('Worker ready');

