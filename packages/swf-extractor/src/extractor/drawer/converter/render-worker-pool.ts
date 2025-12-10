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
import { execSync } from 'child_process';

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
    // Use rsvg-convert to render SVG to PNG (matches PHP implementation)
    // Note: Don't scale the SVG dimensions - let rsvg-convert handle scaling via -w/-h
    const cmd = `rsvg-convert -w ${width} -h ${height} -f png -b transparent -o "${pngPath}" "${svgPath}"`;
    execSync(cmd, { stdio: 'pipe' });

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

