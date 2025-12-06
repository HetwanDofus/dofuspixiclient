import type { Rectangle } from '@/parser/structure/record/rectangle.ts';
import type { DefineShape } from '@/parser/structure/tag/define-shape.ts';
import type { FillStyle, SolidFill, GradientFill } from '@/parser/structure/record/fill-style.ts';
import { FillStyleType } from '@/parser/structure/record/fill-style.ts';
import type { LineStyle, LineStyle2 } from '@/parser/structure/record/line-style.ts';
import type { ColorTransform, Rgba } from '@/parser/structure/record/color.ts';
import { ShapeRecordType, type StyleChangeRecord } from '@/parser/structure/record/shape-record.ts';
import { type ShapePath, type PathSegment } from './path.ts';
import type { Drawable } from '@/extractor/drawable.ts';
import type { Drawer, Shape } from '@/extractor/drawer/drawer-interface.ts';
import type { Gradient, FocalGradient, GradientRecord } from '@/parser/structure/record/gradient.ts';

/**
 * Processed shape definition ready for rendering.
 * Implements Drawable interface.
 */
export interface ShapeDefinition extends Drawable {
  readonly id: number;
  readonly paths: readonly ShapePath[];
  readonly xOffset: number;
  readonly yOffset: number;
}

/**
 * Apply color transform to a color.
 * Multiplier terms should be divided by 256 (as per SWF spec).
 */
function applyColorTransform(color: Rgba, ct: ColorTransform): Rgba {
  // PHP: $red = $color->red * $this->redMult / 256 + $this->redAdd;
  const r = (color.r * ct.redMultTerm) / 256 + ct.redAddTerm;
  const g = (color.g * ct.greenMultTerm) / 256 + ct.greenAddTerm;
  const b = (color.b * ct.blueMultTerm) / 256 + ct.blueAddTerm;
  const a = (color.a * ct.alphaMultTerm) / 256 + ct.alphaAddTerm;

  return {
    r: Math.max(0, Math.min(255, Math.floor(r))),
    g: Math.max(0, Math.min(255, Math.floor(g))),
    b: Math.max(0, Math.min(255, Math.floor(b))),
    a: Math.max(0, Math.min(255, Math.floor(a))),
  };
}

/**
 * Transform a gradient record with color transformation.
 */
function transformGradientRecord(record: GradientRecord, ct: ColorTransform): GradientRecord {
  return {
    ratio: record.ratio,
    color: applyColorTransform(record.color, ct),
  };
}

/**
 * Transform a gradient with color transformation.
 */
function transformGradient(gradient: Gradient | FocalGradient, ct: ColorTransform): Gradient | FocalGradient {
  const transformedRecords = gradient.records.map((r) => transformGradientRecord(r, ct));
  const base: Gradient = {
    spreadMode: gradient.spreadMode,
    interpolationMode: gradient.interpolationMode,
    records: transformedRecords,
  };
  if ('focalPoint' in gradient) {
    return { ...base, focalPoint: gradient.focalPoint };
  }
  return base;
}

/**
 * Transform a fill style with color transformation.
 */
function transformFillStyle(fill: FillStyle, ct: ColorTransform): FillStyle {
  if (fill.type === FillStyleType.Solid) {
    const solid = fill as SolidFill;
    return {
      type: FillStyleType.Solid,
      color: applyColorTransform(solid.color, ct),
    };
  }

  // Handle gradient fills
  if (
    fill.type === FillStyleType.LinearGradient ||
    fill.type === FillStyleType.RadialGradient ||
    fill.type === FillStyleType.FocalRadialGradient
  ) {
    const gradientFill = fill as GradientFill;
    return {
      type: gradientFill.type,
      matrix: gradientFill.matrix,
      gradient: transformGradient(gradientFill.gradient, ct),
    };
  }

  // Bitmap fills don't have colors to transform
  return fill;
}

/**
 * Transform a line style with color transformation.
 */
function transformLineStyle(line: LineStyle | LineStyle2, ct: ColorTransform): LineStyle | LineStyle2 {
  if ('color' in line && line.color) {
    return { ...line, color: applyColorTransform(line.color, ct) };
  }
  return line;
}

/**
 * Transform paths with color transformation.
 */
function transformPaths(paths: readonly ShapePath[], ct: ColorTransform): ShapePath[] {
  return paths.map((path) => ({
    segments: path.segments,
    fillStyle: path.fillStyle ? transformFillStyle(path.fillStyle, ct) : undefined,
    lineStyle: path.lineStyle ? transformLineStyle(path.lineStyle, ct) : undefined,
  }));
}

/**
 * Create a ShapeDefinition from pre-processed paths.
 */
function createShapeDefinitionFromPaths(
  id: number,
  paths: ShapePath[],
  xOffset: number,
  yOffset: number,
  shapeBounds: Rectangle,
): ShapeDefinition {
  return {
    id,
    paths,
    xOffset,
    yOffset,
    bounds(): Rectangle {
      return shapeBounds;
    },
    framesCount(_recursive?: boolean): number {
      return 1;
    },
    draw(drawer: Drawer, _frame?: number): void {
      const s: Shape = { xOffset, yOffset, paths };
      drawer.shape(s);
    },
    transformColors(colorTransform: ColorTransform): ShapeDefinition {
      const transformedPaths = transformPaths(paths, colorTransform);
      return createShapeDefinitionFromPaths(id, transformedPaths, xOffset, yOffset, shapeBounds);
    },
  };
}

/**
 * Convert DefineShape to ShapeDefinition with processed paths.
 */
export function createShapeDefinition(shape: DefineShape): ShapeDefinition {
  const paths = extractPaths(shape);
  const shapeBounds = shape.bounds;
  const xOffset = -shapeBounds.xMin;
  const yOffset = -shapeBounds.yMin;

  return createShapeDefinitionFromPaths(shape.id, paths, xOffset, yOffset, shapeBounds);
}

/**
 * Create a hash for a fill style to group edges with the same visual style.
 */
function fillStyleHash(style: FillStyle): string {
  if (style.type === FillStyleType.Solid) {
    const solid = style as SolidFill;
    return `solid:${solid.color.r},${solid.color.g},${solid.color.b},${solid.color.a}`;
  }
  // For gradients and bitmaps, use JSON stringify as a simple hash
  return JSON.stringify(style);
}

/**
 * Create a hash for a line style to group edges with the same visual style.
 */
function lineStyleHash(style: LineStyle | LineStyle2): string {
  if ('color' in style && style.color) {
    return `line:${style.width},${style.color.r},${style.color.g},${style.color.b},${style.color.a}`;
  }
  return JSON.stringify(style);
}

/**
 * Path accumulator that groups edges by style hash.
 */
interface PathAccumulator {
  segments: PathSegment[];
  fillStyle?: FillStyle;
  lineStyle?: LineStyle | LineStyle2;
}

/**
 * Active style for path building.
 * Matches PHP's PathStyle concept.
 */
interface ActiveStyle {
  readonly hash: string;
  readonly fillStyle?: FillStyle;
  readonly lineStyle?: LineStyle | LineStyle2;
  readonly reverse: boolean;
}

/**
 * Extract paths from shape records.
 * Uses style hashes to merge paths with the same visual style.
 * Matches PHP's ShapeProcessor and PathsBuilder behavior.
 */
function extractPaths(shape: DefineShape): ShapePath[] {
  // Current position
  let x = 0,
    y = 0;

  // Current styles
  let fillStyles = shape.fillStyles;
  let lineStyles = shape.lineStyles;

  // Active styles (like PHP's $fillStyle0, $fillStyle1, $lineStyle)
  let fillStyle0: ActiveStyle | null = null;
  let fillStyle1: ActiveStyle | null = null;
  let lineStyle: ActiveStyle | null = null;

  // Accumulated edges (like PHP's $edges array)
  let edges: PathSegment[] = [];

  // Open paths indexed by style hash
  const openPaths: Map<string, PathAccumulator> = new Map();
  // Closed paths ready for export
  const closedPaths: PathAccumulator[] = [];
  // Finalized paths (already fixed)
  const finalizedPaths: ShapePath[] = [];

  /**
   * Merge accumulated edges into paths for all active styles.
   * Matches PHP's PathsBuilder::merge() method.
   */
  function mergeEdges(): void {
    if (edges.length === 0) return;

    const activeStyles = [fillStyle0, fillStyle1, lineStyle].filter((s): s is ActiveStyle => s !== null);

    for (const style of activeStyles) {
      // For reversed styles (fillStyle0), reverse both the order and each edge
      // This matches PHP's PathsBuilder::reserveEdges()
      const toPush = style.reverse ? reverseEdges(edges) : edges;

      let path = openPaths.get(style.hash);
      if (!path) {
        path = { segments: [], fillStyle: style.fillStyle, lineStyle: style.lineStyle };
        openPaths.set(style.hash, path);
      }
      path.segments.push(...toPush);
    }

    edges = [];
  }

  /**
   * Close all open paths (move to closed paths).
   */
  function closePaths(): void {
    for (const path of openPaths.values()) {
      closedPaths.push(path);
    }
    openPaths.clear();
  }

  /**
   * Finalize all closed paths (fix segments and add to finalized paths).
   */
  function finalizePaths(): void {
    // Separate fill and line paths
    const fillPaths: ShapePath[] = [];
    const linePaths: ShapePath[] = [];

    for (const path of closedPaths) {
      if (path.segments.length === 0) continue;

      // Fix segments to form continuous paths
      const fixedSegments = fixSegments(path.segments);

      if (path.lineStyle) {
        linePaths.push({ segments: fixedSegments, lineStyle: path.lineStyle });
      } else if (path.fillStyle) {
        fillPaths.push({ segments: fixedSegments, fillStyle: path.fillStyle });
      }
    }

    // Line paths should be drawn after fill paths
    finalizedPaths.push(...fillPaths, ...linePaths);
    closedPaths.length = 0;
  }

  /**
   * Reverse edges: reverse the order AND swap from/to for each edge.
   * Matches PHP's PathsBuilder::reserveEdges() method.
   */
  function reverseEdges(edgesToReverse: PathSegment[]): PathSegment[] {
    const reversed: PathSegment[] = [];
    for (let i = edgesToReverse.length - 1; i >= 0; i--) {
      const seg = edgesToReverse[i]!;
      if (seg.type === 'curve') {
        reversed.push({
          type: 'curve',
          fromX: seg.x,
          fromY: seg.y,
          x: seg.fromX,
          y: seg.fromY,
          cx: seg.cx,
          cy: seg.cy,
        });
      } else {
        reversed.push({
          type: seg.type,
          fromX: seg.x,
          fromY: seg.y,
          x: seg.fromX,
          y: seg.fromY,
        });
      }
    }
    return reversed;
  }

  for (const record of shape.shapeRecords) {
    if (record.type === ShapeRecordType.EndShape) {
      // Merge remaining edges before ending
      mergeEdges();
      break;
    }

    if (record.type === ShapeRecordType.StyleChange) {
      const change = record as StyleChangeRecord;

      // Merge accumulated edges before processing style change
      mergeEdges();

      // Check if this is a full reset (all state flags set)
      // Matches PHP's StyleChangeRecord::reset() method
      const isReset = change.stateNewStyles && change.stateLineStyle && change.stateFillStyle0 && change.stateFillStyle1 && change.stateMoveTo;

      if (isReset) {
        // Finalize all paths (like PHP's PathsBuilder::finalize())
        closePaths();
        finalizePaths();
      }

      if (change.stateNewStyles) {
        // Close all open paths when styles change (like PHP's PathsBuilder::close())
        closePaths();

        fillStyles = change.fillStyles ?? [];
        lineStyles = change.lineStyles ?? [];
      }

      // Update fillStyle0
      if (change.stateFillStyle0) {
        const idx = change.fillStyle0 ?? 0;
        const style = idx > 0 ? fillStyles[idx - 1] : undefined;
        if (style) {
          fillStyle0 = {
            hash: 'f:' + fillStyleHash(style),
            fillStyle: style,
            reverse: true,
          };
        } else {
          fillStyle0 = null;
        }
      }

      // Update fillStyle1
      if (change.stateFillStyle1) {
        const idx = change.fillStyle1 ?? 0;
        const style = idx > 0 ? fillStyles[idx - 1] : undefined;
        if (style) {
          fillStyle1 = {
            hash: 'f:' + fillStyleHash(style),
            fillStyle: style,
            reverse: false,
          };
        } else {
          fillStyle1 = null;
        }
      }

      // Update lineStyle
      if (change.stateLineStyle) {
        const idx = change.lineStyle ?? 0;
        const style = idx > 0 ? lineStyles[idx - 1] : undefined;
        if (style) {
          lineStyle = {
            hash: 'l:' + lineStyleHash(style),
            lineStyle: style,
            reverse: false,
          };
        } else {
          lineStyle = null;
        }
      }

      if (change.stateMoveTo) {
        x = change.moveDeltaX ?? 0;
        y = change.moveDeltaY ?? 0;
      }

      continue;
    }

    // Edge records - accumulate edges (like PHP does)
    const fromX = x,
      fromY = y;

    if (record.type === ShapeRecordType.StraightEdge) {
      x += record.deltaX;
      y += record.deltaY;
      edges.push({ type: 'line', fromX, fromY, x, y });
    } else if (record.type === ShapeRecordType.CurvedEdge) {
      const cx = fromX + record.controlDeltaX;
      const cy = fromY + record.controlDeltaY;
      x = cx + record.anchorDeltaX;
      y = cy + record.anchorDeltaY;
      edges.push({ type: 'curve', fromX, fromY, x, y, cx, cy });
    }
  }

  // Finalize remaining paths
  closePaths();
  finalizePaths();

  return finalizedPaths;
}
/**
 * Reorder segments to form continuous paths.
 * This algorithm tries to connect edges by matching toX/toY with fromX/fromY.
 * Similar to the PHP Path::fix() method.
 */
function fixSegments(segments: PathSegment[]): PathSegment[] {
  if (segments.length <= 1) {
    return segments;
  }

  // Create a set of segments (using index as identifier)
  const remaining = new Set<number>();
  for (let i = 0; i < segments.length; i++) {
    remaining.add(i);
  }

  const result: PathSegment[] = [];

  while (remaining.size > 0) {
    // Pop the first remaining segment
    const firstIdx = remaining.values().next().value as number;
    remaining.delete(firstIdx);
    let current: PathSegment = segments[firstIdx]!;
    result.push(current);

    // Try to find connected segments
    let found = true;
    while (found && remaining.size > 0) {
      found = false;

      for (const idx of remaining) {
        const other = segments[idx]!;

        // Check if other starts where current ends
        if (current.x === other.fromX && current.y === other.fromY) {
          result.push(other);
          remaining.delete(idx);
          current = other;
          found = true;
          break;
        }

        // Check if other ends where current ends (need to reverse)
        if (current.x === other.x && current.y === other.y) {
          const reversed = reverseSegment(other);
          result.push(reversed);
          remaining.delete(idx);
          current = reversed;
          found = true;
          break;
        }
      }
    }
  }

  return result;
}

function reverseSegment(seg: PathSegment): PathSegment {
  if (seg.type === 'curve') {
    return {
      type: 'curve' as const,
      fromX: seg.x,
      fromY: seg.y,
      x: seg.fromX,
      y: seg.fromY,
      cx: seg.cx,
      cy: seg.cy,
    };
  }
  return {
    type: seg.type,
    fromX: seg.x,
    fromY: seg.y,
    x: seg.fromX,
    y: seg.fromY,
  };
}

function reverseSegments(segments: PathSegment[]): PathSegment[] {
  // Reverse segments and swap from/to coordinates
  return segments.map((seg) => {
    if (seg.type === 'curve') {
      return {
        type: 'curve' as const,
        fromX: seg.x,
        fromY: seg.y,
        x: seg.fromX,
        y: seg.fromY,
        cx: seg.cx,
        cy: seg.cy,
      };
    }
    return {
      type: seg.type,
      fromX: seg.x,
      fromY: seg.y,
      x: seg.fromX,
      y: seg.fromY,
    };
  }).reverse();
}

