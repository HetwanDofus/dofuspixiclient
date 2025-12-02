import { ImageFormat, parseFormat, type ImageFormatValue } from '@/extractor/drawer/converter/image-format.ts';

/**
 * Default output filename pattern.
 */
export const DEFAULT_OUTPUT_FILENAME = '{basename}/{name}{_frame}.{ext}';

/**
 * Frame format specification.
 */
export interface FrameFormat {
  /** Output format */
  format: ImageFormatValue;
  /** Width (null = auto) */
  width: number | null;
  /** Height (null = auto) */
  height: number | null;
  /** Prefix for output files */
  prefix: string;
  /** Use lossless quality */
  lossless: boolean;
}

/**
 * Parsed CLI options.
 */
export interface ExtractOptions {
  /** Input SWF file(s) */
  files: string[];
  /** Output directory */
  output: string;
  /** Output filename pattern */
  outputFilename: string;
  /** Character IDs to extract (null = all) */
  characters: number[] | null;
  /** Export names to extract (null = all) */
  exportedNames: string[] | null;
  /** Frame indices to extract (null = all) */
  frames: number[] | null;
  /** Extract full animations */
  fullAnimation: boolean;
  /** Extract all sprites */
  allSprites: boolean;
  /** Extract all exported assets */
  allExported: boolean;
  /** Extract main timeline */
  timeline: boolean;
  /** Extract variables */
  variables: boolean;
  /** Frame output formats */
  frameFormats: FrameFormat[];
  /** Animation output format */
  animationFormat: ImageFormatValue;
  /** Parallel processing count */
  parallel: number;
  /** Scale factors */
  scales: number[];
  /** Skip empty frames */
  skipEmptyFrames: boolean;
  /** Generate manifest JSON */
  manifest: boolean;
  /** Tile type for manifest */
  tileType: string | null;
  /** Subtype for manifest */
  subtype: string | null;
  /** Verbose output */
  verbose: boolean;
  /** Print help */
  help: boolean;
}

/**
 * Default options.
 */
export const DEFAULT_OPTIONS: ExtractOptions = {
  files: [],
  output: '.',
  outputFilename: DEFAULT_OUTPUT_FILENAME,
  characters: null,
  exportedNames: null,
  frames: null,
  fullAnimation: false,
  allSprites: false,
  allExported: false,
  timeline: false,
  variables: false,
  frameFormats: [{ format: ImageFormat.Svg, width: null, height: null, prefix: '', lossless: false }],
  animationFormat: ImageFormat.Gif,
  parallel: 1,
  scales: [1],
  skipEmptyFrames: true,
  manifest: false,
  tileType: null,
  subtype: null,
  verbose: false,
  help: false,
};

/**
 * Parse frame format string.
 * Format: [prefix:]format[@WxH][:lossless]
 * Examples: svg, png@128x128, a:webp@64x64:lossless
 */
export function parseFrameFormat(str: string): FrameFormat {
  let format: ImageFormatValue = ImageFormat.Svg;
  let width: number | null = null;
  let height: number | null = null;
  let prefix = '';
  let lossless = false;

  const parts = str.split(':');
  for (const part of parts) {
    if (part === 'lossless') {
      lossless = true;
      continue;
    }

    const sizeMatch = part.match(/^([a-z]+)@(\d+)x(\d+)$/i);
    if (sizeMatch) {
      const fmt = parseFormat(sizeMatch[1]!);
      if (fmt) format = fmt;
      width = parseInt(sizeMatch[2]!, 10);
      height = parseInt(sizeMatch[3]!, 10);
      continue;
    }

    const fmt = parseFormat(part);
    if (fmt) {
      format = fmt;
      continue;
    }

    // Must be a prefix
    if (part.length === 1) {
      prefix = part;
    }
  }

  return { format, width, height, prefix, lossless };
}

/**
 * Parse number list (e.g., "1,2,3" or "1-5").
 */
export function parseNumberList(str: string): number[] {
  const result: number[] = [];
  for (const part of str.split(',')) {
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1]!, 10);
      const end = parseInt(rangeMatch[2]!, 10);
      for (let i = start; i <= end; i++) {
        result.push(i);
      }
    } else {
      result.push(parseInt(part, 10));
    }
  }
  return result;
}

/**
 * Parameters for resolving output filename pattern.
 */
export interface FilenameParams {
  /** Base name of the SWF file (without extension) */
  basename: string;
  /** Directory name of the SWF file */
  dirname: string;
  /** Name or ID of the character/exported symbol */
  name: string;
  /** File extension (without dot) */
  ext: string;
  /** Frame number (1-based, null if not applicable) */
  frame: number | null;
  /** Scale factor (null if not applicable) */
  scale: number | null;
}

/**
 * Format a scale value for display (removes trailing .0 for integers).
 * E.g., 1.0 -> "1", 1.5 -> "1.5", 2.0 -> "2"
 */
export function formatScale(scale: number): string {
  return scale === Math.floor(scale) ? String(scale) : scale.toFixed(1);
}

/**
 * Resolve output filename pattern with given parameters.
 */
export function resolveFilename(pattern: string, params: FilenameParams): string {
  const scaleStr = params.scale !== null ? formatScale(params.scale) : '1';

  return pattern
    .replace(/\{basename\}/g, params.basename)
    .replace(/\{dirname\}/g, params.dirname)
    .replace(/\{name\}/g, params.name)
    .replace(/\{ext\}/g, params.ext)
    .replace(/\{frame\}/g, params.frame !== null ? String(params.frame) : '')
    .replace(/\{_frame\}/g, params.frame !== null ? `_${params.frame}` : '')
    .replace(/\{scale\}/g, scaleStr)
    .replace(/\{_scale\}/g, params.scale !== null ? `_${scaleStr}x` : '')
    .replace(/\{scale\}x/g, `${scaleStr}x`);
}

