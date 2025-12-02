import type { FillStyle } from '@/parser/structure/record/fill-style.ts';
import type { LineStyle, LineStyle2 } from '@/parser/structure/record/line-style.ts';

/**
 * A point in the path.
 */
export interface PathPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * A segment in the path (straight or curved).
 */
export interface PathSegment {
  readonly type: 'move' | 'line' | 'curve';
  /** Starting X coordinate (from) */
  readonly fromX: number;
  /** Starting Y coordinate (from) */
  readonly fromY: number;
  /** Ending X coordinate (to) */
  readonly x: number;
  /** Ending Y coordinate (to) */
  readonly y: number;
  /** Control point X for curves */
  readonly cx?: number;
  /** Control point Y for curves */
  readonly cy?: number;
}

/**
 * A closed or open path with fill and/or line style.
 */
export interface ShapePath {
  readonly segments: readonly PathSegment[];
  readonly fillStyle?: FillStyle;
  readonly lineStyle?: LineStyle | LineStyle2;
}

/**
 * Build an SVG path string from segments.
 * Automatically adds move commands when the path is discontinuous.
 */
/**
 * Format a number for SVG path output.
 * Uses natural number formatting like PHP (no trailing zeros).
 */
function formatNum(n: number): string {
  // Round to avoid floating point issues, then convert to string
  // This matches PHP's behavior of simple division output
  const rounded = Math.round(n * 100000) / 100000;
  return String(rounded);
}

export function buildPathString(segments: readonly PathSegment[], scale: number = 1): string {
  let d = '';
  const s = scale / 20; // Convert from twips to pixels with scale
  let lastX: number | null = null;
  let lastY: number | null = null;

  for (const seg of segments) {
    // Check if we need a move command (path is discontinuous)
    if (seg.fromX !== lastX || seg.fromY !== lastY) {
      d += `M${formatNum(seg.fromX * s)} ${formatNum(seg.fromY * s)}`;
    }

    switch (seg.type) {
      case 'move':
        // Move is already handled above
        break;
      case 'line':
        d += `L${formatNum(seg.x * s)} ${formatNum(seg.y * s)}`;
        break;
      case 'curve':
        d += `Q${formatNum(seg.cx! * s)} ${formatNum(seg.cy! * s)} ${formatNum(seg.x * s)} ${formatNum(seg.y * s)}`;
        break;
    }

    lastX = seg.x;
    lastY = seg.y;
  }

  return d;
}

/**
 * Calculate the bounding box of a path.
 */
export function getPathBounds(
  segments: readonly PathSegment[],
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity,
    minY = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity;

  for (const seg of segments) {
    // Include from point
    minX = Math.min(minX, seg.fromX);
    minY = Math.min(minY, seg.fromY);
    maxX = Math.max(maxX, seg.fromX);
    maxY = Math.max(maxY, seg.fromY);

    // Include to point
    minX = Math.min(minX, seg.x);
    minY = Math.min(minY, seg.y);
    maxX = Math.max(maxX, seg.x);
    maxY = Math.max(maxY, seg.y);

    // Include control point for curves
    if (seg.cx !== undefined && seg.cy !== undefined) {
      minX = Math.min(minX, seg.cx);
      minY = Math.min(minY, seg.cy);
      maxX = Math.max(maxX, seg.cx);
      maxY = Math.max(maxY, seg.cy);
    }
  }

  return { minX, minY, maxX, maxY };
}

