import type { Rectangle } from '@/parser/structure/record/rectangle.ts';
import type { ColorTransform, Rgba } from '@/parser/structure/record/color.ts';
import {
  type DefineMorphShape,
  type MorphFillStyle,
  type MorphLineStyle,
  type MorphGradient,
  MorphFillStyleType,
} from '@/parser/structure/tag/define-morph-shape.ts';
import type { Drawable } from '@/extractor/drawable.ts';
import type { Drawer, Shape } from '@/extractor/drawer/drawer-interface.ts';
import type { ShapePath, PathSegment } from './path.ts';
import { ShapeRecordType, type ShapeRecord } from '@/parser/structure/record/shape-record.ts';
import type { FillStyle, GradientFill, BitmapFill, SolidFill } from '@/parser/structure/record/fill-style.ts';
import { FillStyleType } from '@/parser/structure/record/fill-style.ts';
import type { LineStyle } from '@/parser/structure/record/line-style.ts';
import type { Gradient, FocalGradient, GradientRecord, SpreadModeValue, InterpolationModeValue } from '@/parser/structure/record/gradient.ts';
import type { Matrix } from '@/parser/structure/record/matrix.ts';

/**
 * Morph shape definition that can interpolate between start and end states.
 * Implements Drawable interface.
 */
export interface MorphShapeDefinition extends Drawable {
  readonly id: number;
  readonly tag: DefineMorphShape;
  pathsAtRatio(ratio: number): readonly ShapePath[];
  boundsAtRatio(ratio: number): Rectangle;
  ratio: number;
}

// Helper functions for interpolation
function lerp(start: number, end: number, ratio: number): number {
  return Math.round(start + (end - start) * ratio);
}

function lerpFloat(start: number, end: number, ratio: number): number {
  return start + (end - start) * ratio;
}

function interpolateColor(start: Rgba, end: Rgba, ratio: number): Rgba {
  return {
    r: lerp(start.r, end.r, ratio),
    g: lerp(start.g, end.g, ratio),
    b: lerp(start.b, end.b, ratio),
    a: lerp(start.a ?? 255, end.a ?? 255, ratio),
  };
}

function interpolateMatrix(start: Matrix, end: Matrix, ratio: number): Matrix {
  return {
    scaleX: lerpFloat(start.scaleX, end.scaleX, ratio),
    scaleY: lerpFloat(start.scaleY, end.scaleY, ratio),
    rotateSkew0: lerpFloat(start.rotateSkew0, end.rotateSkew0, ratio),
    rotateSkew1: lerpFloat(start.rotateSkew1, end.rotateSkew1, ratio),
    translateX: lerp(start.translateX, end.translateX, ratio),
    translateY: lerp(start.translateY, end.translateY, ratio),
  };
}

function interpolateGradient(morphGradient: MorphGradient, ratio: number): Gradient | FocalGradient {
  const records: GradientRecord[] = morphGradient.records.map((r) => ({
    ratio: lerp(r.startRatio, r.endRatio, ratio),
    color: interpolateColor(r.startColor, r.endColor, ratio),
  }));
  const base: Gradient = {
    spreadMode: morphGradient.spreadMode as SpreadModeValue,
    interpolationMode: morphGradient.interpolationMode as InterpolationModeValue,
    records,
  };
  if (morphGradient.focalPoint !== undefined) {
    return { ...base, focalPoint: morphGradient.focalPoint };
  }
  return base;
}

function createInterpolatedFillStyle(style: MorphFillStyle, ratio: number): FillStyle {
  switch (style.type) {
    case MorphFillStyleType.SOLID: {
      return {
        type: FillStyleType.Solid,
        color: interpolateColor(style.startColor!, style.endColor!, ratio),
      } as SolidFill;
    }
    case MorphFillStyleType.LINEAR_GRADIENT: {
      return {
        type: FillStyleType.LinearGradient,
        matrix: interpolateMatrix(style.startGradientMatrix!, style.endGradientMatrix!, ratio),
        gradient: interpolateGradient(style.gradient!, ratio),
      } as GradientFill;
    }
    case MorphFillStyleType.RADIAL_GRADIENT:
    case MorphFillStyleType.FOCAL_RADIAL_GRADIENT: {
      return {
        type: style.type === MorphFillStyleType.FOCAL_RADIAL_GRADIENT
          ? FillStyleType.FocalRadialGradient
          : FillStyleType.RadialGradient,
        matrix: interpolateMatrix(style.startGradientMatrix!, style.endGradientMatrix!, ratio),
        gradient: interpolateGradient(style.gradient!, ratio),
      } as GradientFill;
    }
    case MorphFillStyleType.REPEATING_BITMAP:
    case MorphFillStyleType.CLIPPED_BITMAP:
    case MorphFillStyleType.NON_SMOOTHED_REPEATING_BITMAP:
    case MorphFillStyleType.NON_SMOOTHED_CLIPPED_BITMAP: {
      const bitmapType =
        style.type === MorphFillStyleType.REPEATING_BITMAP ? FillStyleType.RepeatingBitmap :
        style.type === MorphFillStyleType.CLIPPED_BITMAP ? FillStyleType.ClippedBitmap :
        style.type === MorphFillStyleType.NON_SMOOTHED_REPEATING_BITMAP ? FillStyleType.NonSmoothedRepeatingBitmap :
        FillStyleType.NonSmoothedClippedBitmap;
      return {
        type: bitmapType,
        bitmapId: style.bitmapId!,
        matrix: interpolateMatrix(style.startBitmapMatrix!, style.endBitmapMatrix!, ratio),
      } as BitmapFill;
    }
    default:
      return { type: FillStyleType.Solid, color: { r: 0, g: 0, b: 0, a: 0 } } as SolidFill;
  }
}

function createInterpolatedLineStyle(style: MorphLineStyle, ratio: number): LineStyle {
  return {
    width: lerp(style.startWidth, style.endWidth, ratio),
    color: interpolateColor(style.startColor, style.endColor, ratio),
  };
}

/**
 * Active style info during path processing.
 */
interface ActiveStyle {
  fill?: FillStyle;
  line?: LineStyle;
  reverse: boolean;
}

/**
 * Path accumulator for building paths during processing.
 */
interface PathAccumulator {
  segments: PathSegment[];
  fillStyle?: FillStyle;
  lineStyle?: LineStyle;
}

/**
 * Get a unique hash for a style combination.
 * Note: reverse is NOT included in the hash - it's only used for edge direction.
 */
function styleHash(fill?: FillStyle, line?: LineStyle): string {
  return `${JSON.stringify(fill)}-${JSON.stringify(line)}`;
}

/**
 * Process morph shape edges to create paths at a specific ratio.
 */
function processMorphPaths(tag: DefineMorphShape, ratio: number): ShapePath[] {
  const fillStyles = tag.morphFillStyles;
  const lineStyles = tag.morphLineStyles;
  const startEdges = tag.startEdges;
  const endEdges = tag.endEdges;

  // Current position
  let startX = 0, startY = 0;
  let endX = 0, endY = 0;
  let endEdgeIndex = 0;

  // Active styles
  let fillStyle0: ActiveStyle | null = null;
  let fillStyle1: ActiveStyle | null = null;
  let lineStyle: ActiveStyle | null = null;

  // Path building
  const openPaths = new Map<string, PathAccumulator>();
  const closedPaths: PathAccumulator[] = [];
  const finalizedPaths: ShapePath[] = [];

  function addEdges(edges: PathSegment[]) {
    const styles = [fillStyle0, fillStyle1, lineStyle].filter((s): s is ActiveStyle => s !== null);
    for (const style of styles) {
      const toPush = style.reverse ? reverseEdges(edges) : edges;
      const hash = styleHash(style.fill, style.line);
      let path = openPaths.get(hash);
      if (!path) {
        path = { segments: [], fillStyle: style.fill, lineStyle: style.line };
        openPaths.set(hash, path);
      }
      path.segments.push(...toPush);
    }
  }

  function finalize() {
    // Close all open paths
    for (const path of openPaths.values()) {
      if (path.segments.length > 0) {
        closedPaths.push(path);
      }
    }
    openPaths.clear();
  }

  for (let i = 0; i < startEdges.length; i++) {
    const startShape = startEdges[i];
    if (!startShape) break;
    let endShape: ShapeRecord | undefined = endEdges[endEdgeIndex];

    if (startShape.type === ShapeRecordType.StyleChange) {
      // Handle style reset
      if (startShape.stateNewStyles || (startShape.stateMoveTo && (startShape.stateFillStyle0 || startShape.stateFillStyle1 || startShape.stateLineStyle))) {
        finalize();
      }

      if (startShape.stateLineStyle && startShape.lineStyle !== undefined) {
        const style = lineStyles[startShape.lineStyle - 1];
        lineStyle = style ? { line: createInterpolatedLineStyle(style, ratio), reverse: false } : null;
      }

      if (startShape.stateFillStyle0 && startShape.fillStyle0 !== undefined) {
        const style = fillStyles[startShape.fillStyle0 - 1];
        fillStyle0 = style ? { fill: createInterpolatedFillStyle(style, ratio), reverse: true } : null;
      }

      if (startShape.stateFillStyle1 && startShape.fillStyle1 !== undefined) {
        const style = fillStyles[startShape.fillStyle1 - 1];
        fillStyle1 = style ? { fill: createInterpolatedFillStyle(style, ratio), reverse: false } : null;
      }

      if (startShape.stateMoveTo && startShape.moveDeltaX !== undefined && startShape.moveDeltaY !== undefined) {
        startX = startShape.moveDeltaX;
        startY = startShape.moveDeltaY;

        // Find corresponding moveTo in end edges
        if (endShape && endShape.type === ShapeRecordType.StyleChange && endShape.stateMoveTo && endShape.moveDeltaX !== undefined && endShape.moveDeltaY !== undefined) {
          endX = endShape.moveDeltaX;
          endY = endShape.moveDeltaY;
          endEdgeIndex++;
        }
      }
      continue;
    }

    if (startShape.type === ShapeRecordType.EndShape) {
      break;
    }

    // Skip style changes in end edges
    while (endShape && endShape.type === ShapeRecordType.StyleChange) {
      if (endShape.stateMoveTo && endShape.moveDeltaX !== undefined && endShape.moveDeltaY !== undefined) {
        endX = endShape.moveDeltaX;
        endY = endShape.moveDeltaY;
      }
      endEdgeIndex++;
      endShape = endEdges[endEdgeIndex];
    }

    // Process edge records
    if (startShape.type === ShapeRecordType.StraightEdge) {
      const startToX = startX + startShape.deltaX;
      const startToY = startY + startShape.deltaY;
      let endToX = endX;
      let endToY = endY;

      if (endShape && endShape.type === ShapeRecordType.StraightEdge) {
        endToX = endX + endShape.deltaX;
        endToY = endY + endShape.deltaY;
        endEdgeIndex++;
      } else if (endShape && endShape.type === ShapeRecordType.CurvedEdge) {
        // Straight to curved: use curve interpolation
        const endControlX = endX + endShape.controlDeltaX;
        const endControlY = endY + endShape.controlDeltaY;
        endToX = endControlX + endShape.anchorDeltaX;
        endToY = endControlY + endShape.anchorDeltaY;
        const startMidX = (startX + startToX) / 2;
        const startMidY = (startY + startToY) / 2;

        addEdges([{
          type: 'curve',
          fromX: lerp(startX, endX, ratio),
          fromY: lerp(startY, endY, ratio),
          cx: lerp(startMidX, endControlX, ratio),
          cy: lerp(startMidY, endControlY, ratio),
          x: lerp(startToX, endToX, ratio),
          y: lerp(startToY, endToY, ratio),
        }]);
        startX = startToX; startY = startToY;
        endX = endToX; endY = endToY;
        endEdgeIndex++;
        continue;
      }

      addEdges([{
        type: 'line',
        fromX: lerp(startX, endX, ratio),
        fromY: lerp(startY, endY, ratio),
        x: lerp(startToX, endToX, ratio),
        y: lerp(startToY, endToY, ratio),
      }]);
      startX = startToX; startY = startToY;
      endX = endToX; endY = endToY;

    } else if (startShape.type === ShapeRecordType.CurvedEdge) {
      const startControlX = startX + startShape.controlDeltaX;
      const startControlY = startY + startShape.controlDeltaY;
      const startToX = startControlX + startShape.anchorDeltaX;
      const startToY = startControlY + startShape.anchorDeltaY;
      let endControlX = endX;
      let endControlY = endY;
      let endToX = endX;
      let endToY = endY;

      if (endShape && endShape.type === ShapeRecordType.CurvedEdge) {
        endControlX = endX + endShape.controlDeltaX;
        endControlY = endY + endShape.controlDeltaY;
        endToX = endControlX + endShape.anchorDeltaX;
        endToY = endControlY + endShape.anchorDeltaY;
        endEdgeIndex++;
      } else if (endShape && endShape.type === ShapeRecordType.StraightEdge) {
        // Curved to straight: use midpoint as control
        endToX = endX + endShape.deltaX;
        endToY = endY + endShape.deltaY;
        endControlX = (endX + endToX) / 2;
        endControlY = (endY + endToY) / 2;
        endEdgeIndex++;
      }

      addEdges([{
        type: 'curve',
        fromX: lerp(startX, endX, ratio),
        fromY: lerp(startY, endY, ratio),
        cx: lerp(startControlX, endControlX, ratio),
        cy: lerp(startControlY, endControlY, ratio),
        x: lerp(startToX, endToX, ratio),
        y: lerp(startToY, endToY, ratio),
      }]);
      startX = startToX; startY = startToY;
      endX = endToX; endY = endToY;
    }
  }

  // Export all paths
  for (const path of openPaths.values()) {
    if (path.segments.length > 0) {
      closedPaths.push(path);
    }
  }

  // Separate fill and line paths
  const fillPaths: ShapePath[] = [];
  const linePaths: ShapePath[] = [];

  for (const path of closedPaths) {
    const fixed = fixPath(path);
    if (fixed.lineStyle && fixed.lineStyle.width > 0) {
      linePaths.push(fixed);
    } else {
      fillPaths.push(fixed);
    }
  }

  return [...finalizedPaths, ...fillPaths, ...linePaths];
}

/**
 * Reverse edges.
 */
function reverseEdges(edges: PathSegment[]): PathSegment[] {
  return edges.slice().reverse().map((seg) => {
    if (seg.type === 'line') {
      return { type: 'line', fromX: seg.x, fromY: seg.y, x: seg.fromX, y: seg.fromY };
    } else if (seg.type === 'curve') {
      return { type: 'curve', fromX: seg.x, fromY: seg.y, cx: seg.cx!, cy: seg.cy!, x: seg.fromX, y: seg.fromY };
    }
    return seg;
  });
}

/**
 * Fix a path by reordering segments to form continuous paths.
 */
function fixPath(path: PathAccumulator): ShapePath {
  return {
    segments: fixSegments(path.segments),
    fillStyle: path.fillStyle,
    lineStyle: path.lineStyle,
  };
}

/**
 * Reorder segments to form continuous paths.
 */
function fixSegments(segments: PathSegment[]): PathSegment[] {
  if (segments.length <= 1) {
    return segments;
  }

  const remaining = new Set<number>();
  for (let i = 0; i < segments.length; i++) {
    remaining.add(i);
  }

  const result: PathSegment[] = [];

  while (remaining.size > 0) {
    const firstIdx = remaining.values().next().value as number;
    remaining.delete(firstIdx);
    let current: PathSegment = segments[firstIdx]!;
    result.push(current);

    let found = true;
    while (found && remaining.size > 0) {
      found = false;

      for (const idx of remaining) {
        const other = segments[idx]!;

        if (current.x === other.fromX && current.y === other.fromY) {
          result.push(other);
          remaining.delete(idx);
          current = other;
          found = true;
          break;
        }

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

/**
 * Create a morph shape definition from a DefineMorphShape tag.
 */
export function createMorphShapeDefinition(
  id: number,
  tag: DefineMorphShape,
  initialRatio: number = 0,
): MorphShapeDefinition {
  const pathsCache = new Map<string, readonly ShapePath[]>();

  const boundsAtRatio = (ratio: number): Rectangle => {
    ratio = Math.max(0, Math.min(1, ratio));
    const start = tag.startBounds;
    const end = tag.endBounds;

    return {
      xMin: Math.round(start.xMin + (end.xMin - start.xMin) * ratio),
      xMax: Math.round(start.xMax + (end.xMax - start.xMax) * ratio),
      yMin: Math.round(start.yMin + (end.yMin - start.yMin) * ratio),
      yMax: Math.round(start.yMax + (end.yMax - start.yMax) * ratio),
    };
  };

  const pathsAtRatio = (ratio: number): readonly ShapePath[] => {
    ratio = Math.max(0, Math.min(1, ratio));
    const cacheKey = ratio.toFixed(4);

    if (pathsCache.has(cacheKey)) {
      return pathsCache.get(cacheKey)!;
    }

    const paths = processMorphPaths(tag, ratio);
    pathsCache.set(cacheKey, paths);
    return paths;
  };

  return {
    id,
    tag,
    ratio: initialRatio,
    pathsAtRatio,
    boundsAtRatio,
    bounds(): Rectangle {
      const start = tag.startBounds;
      const end = tag.endBounds;
      return {
        xMin: Math.min(start.xMin, end.xMin),
        xMax: Math.max(start.xMax, end.xMax),
        yMin: Math.min(start.yMin, end.yMin),
        yMax: Math.max(start.yMax, end.yMax),
      };
    },
    framesCount(_recursive?: boolean): number {
      return 1;
    },
    draw(drawer: Drawer, _frame?: number): void {
      const paths = this.pathsAtRatio(this.ratio);
      const currentBounds = this.boundsAtRatio(this.ratio);
      const xOffset = -currentBounds.xMin;
      const yOffset = -currentBounds.yMin;
      const shape: Shape = { xOffset, yOffset, paths: paths as ShapePath[] };
      drawer.shape(shape);
    },
    transformColors(_colorTransform: ColorTransform): MorphShapeDefinition {
      return createMorphShapeDefinition(id, tag, this.ratio);
    },
  };
}

/**
 * A wrapper for MorphShapeDefinition that draws at a specific ratio.
 */
export function createMorphShapeAtRatio(morph: MorphShapeDefinition, ratio: number): Drawable {
  const paths = processMorphPaths(morph.tag, ratio);
  const currentBounds = morph.boundsAtRatio(ratio);
  const xOffset = -currentBounds.xMin;
  const yOffset = -currentBounds.yMin;

  return {
    bounds(): Rectangle {
      return currentBounds;
    },
    framesCount(_recursive?: boolean): number {
      return 1;
    },
    draw(drawer: Drawer, _frame?: number): void {
      const shape: Shape = { xOffset, yOffset, paths: paths as ShapePath[] };
      drawer.shape(shape);
    },
    transformColors(colorTransform: ColorTransform): Drawable {
      const transformedPaths = transformPaths(paths, colorTransform);
      return createTransformedMorphShape(currentBounds, xOffset, yOffset, transformedPaths);
    },
  };
}

/**
 * Helper to create a transformed morph shape drawable.
 */
function createTransformedMorphShape(
  shapeBounds: Rectangle,
  xOffset: number,
  yOffset: number,
  paths: ShapePath[],
): Drawable {
  return {
    bounds(): Rectangle {
      return shapeBounds;
    },
    framesCount(_recursive?: boolean): number {
      return 1;
    },
    draw(drawer: Drawer, _frame?: number): void {
      const shape: Shape = { xOffset, yOffset, paths };
      drawer.shape(shape);
    },
    transformColors(colorTransform: ColorTransform): Drawable {
      const transformedPaths = transformPaths(paths, colorTransform);
      return createTransformedMorphShape(shapeBounds, xOffset, yOffset, transformedPaths);
    },
  };
}

/**
 * Apply a color transform to a color.
 */
function applyColorTransform(color: Rgba, ct: ColorTransform): Rgba {
  const r = Math.max(0, Math.min(255, Math.round(color.r * ct.redMultTerm / 256 + ct.redAddTerm)));
  const g = Math.max(0, Math.min(255, Math.round(color.g * ct.greenMultTerm / 256 + ct.greenAddTerm)));
  const b = Math.max(0, Math.min(255, Math.round(color.b * ct.blueMultTerm / 256 + ct.blueAddTerm)));
  const a = Math.max(0, Math.min(255, Math.round((color.a ?? 255) * ct.alphaMultTerm / 256 + ct.alphaAddTerm)));
  return { r, g, b, a };
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
function transformLineStyle(line: LineStyle, ct: ColorTransform): LineStyle {
  if ('color' in line && line.color) {
    return { ...line, color: applyColorTransform(line.color, ct) };
  }
  return line;
}

/**
 * Transform paths by applying a color transform.
 */
function transformPaths(paths: readonly ShapePath[], colorTransform: ColorTransform): ShapePath[] {
  return paths.map((path) => ({
    segments: path.segments,
    fillStyle: path.fillStyle ? transformFillStyle(path.fillStyle, colorTransform) : undefined,
    lineStyle: path.lineStyle ? transformLineStyle(path.lineStyle, colorTransform) : undefined,
  }));
}
