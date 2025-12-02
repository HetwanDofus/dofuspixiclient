import type { ShapeDefinition } from '@/extractor/shape/shape-definition.ts';
import type { ShapePath } from '@/extractor/shape/path.ts';
import type { ImageCharacter } from '@/extractor/drawer/drawer-interface.ts';
import { buildPathString } from '@/extractor/shape/path.ts';
import { FillStyleType, type FillStyle, type SolidFill, type GradientFill, type BitmapFill } from '@/parser/structure/record/fill-style.ts';
import { type LineStyle, type LineStyle2 } from '@/parser/structure/record/line-style.ts';
import { type Rgba, toHex, toRgbaString } from '@/parser/structure/record/color.ts';
import type { Rectangle } from '@/parser/structure/record/rectangle.ts';
import { toSvgTransform } from '@/parser/structure/record/matrix.ts';

/**
 * Bitmap resolver function type.
 */
export type BitmapResolver = (bitmapId: number) => ImageCharacter | null;

/**
 * SVG drawing options.
 */
export interface SvgDrawerOptions {
  /** Scale factor (1 = original size) */
  scale?: number;
  /** Background color (null = transparent) */
  backgroundColor?: string | null;
  /** Include XML declaration */
  xmlDeclaration?: boolean;
  /** Bitmap resolver for bitmap fills */
  bitmapResolver?: BitmapResolver;
}

/**
 * SVG drawer for shapes.
 */
export class SvgDrawer {
  private readonly options: SvgDrawerOptions & { scale: number; backgroundColor: string | null; xmlDeclaration: boolean };
  private gradientId = 0;
  private patternId = 0;
  private readonly patternIds: Map<string, string> = new Map();

  constructor(options: SvgDrawerOptions = {}) {
    this.options = {
      scale: options.scale ?? 1,
      backgroundColor: options.backgroundColor ?? null,
      xmlDeclaration: options.xmlDeclaration ?? false,
      bitmapResolver: options.bitmapResolver,
    };
  }

  /**
   * Draw a shape definition to SVG.
   */
  drawShape(shape: ShapeDefinition): string {
    return this.drawPaths(shape.paths, shape.bounds());
  }

  /**
   * Draw paths with given bounds to SVG.
   */
  drawPaths(paths: readonly ShapePath[], bounds: Rectangle): string {
    const scale = this.options.scale;

    // Calculate dimensions in pixels
    const width = ((bounds.xMax - bounds.xMin) / 20) * scale;
    const height = ((bounds.yMax - bounds.yMin) / 20) * scale;
    const offsetX = bounds.xMin;
    const offsetY = bounds.yMin;

    const parts: string[] = [];
    const defs: string[] = [];

    if (this.options.xmlDeclaration) {
      parts.push('<?xml version="1.0" encoding="UTF-8"?>');
    }

    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(2)}" height="${height.toFixed(2)}" viewBox="${(offsetX / 20).toFixed(2)} ${(offsetY / 20).toFixed(2)} ${(width / scale).toFixed(2)} ${(height / scale).toFixed(2)}">`,
    );

    // Background
    if (this.options.backgroundColor) {
      parts.push(`<rect width="100%" height="100%" fill="${this.options.backgroundColor}"/>`);
    }

    // Draw paths
    for (const path of paths) {
      const pathStr = this.drawPath(path, scale, defs);
      if (pathStr) parts.push(pathStr);
    }

    // Add defs if any gradients were used
    if (defs.length > 0) {
      parts.splice(1, 0, '<defs>', ...defs, '</defs>');
    }

    parts.push('</svg>');
    return parts.join('\n');
  }

  private drawPath(path: ShapePath, scale: number, defs: string[]): string | null {
    const d = buildPathString(path.segments, scale);
    if (!d) return null;

    const attrs: string[] = [`d="${d}"`];

    if (path.fillStyle) {
      const fill = this.getFillAttribute(path.fillStyle, defs);
      attrs.push(`fill="${fill}"`);
    } else {
      attrs.push('fill="none"');
    }

    if (path.lineStyle) {
      const stroke = this.getStrokeAttributes(path.lineStyle, scale);
      attrs.push(...stroke);
    }

    return `<path ${attrs.join(' ')}/>`;
  }

  private getFillAttribute(fill: FillStyle, defs: string[]): string {
    switch (fill.type) {
      case FillStyleType.Solid:
        return this.colorToString((fill as SolidFill).color);

      case FillStyleType.LinearGradient:
      case FillStyleType.RadialGradient:
      case FillStyleType.FocalRadialGradient:
        return this.createGradient(fill as GradientFill, defs);

      case FillStyleType.RepeatingBitmap:
      case FillStyleType.ClippedBitmap:
      case FillStyleType.NonSmoothedRepeatingBitmap:
      case FillStyleType.NonSmoothedClippedBitmap:
        return this.createBitmapPattern(fill as BitmapFill, defs);

      default:
        return 'none';
    }
  }

  private createBitmapPattern(fill: BitmapFill, defs: string[]): string {
    if (!this.options.bitmapResolver) {
      return '#808080';
    }

    const bitmap = this.options.bitmapResolver(fill.bitmapId);
    if (!bitmap) {
      return '#808080';
    }

    // Create a unique hash for this pattern
    const smoothed = fill.type === FillStyleType.RepeatingBitmap || fill.type === FillStyleType.ClippedBitmap;
    const repeat = fill.type === FillStyleType.RepeatingBitmap || fill.type === FillStyleType.NonSmoothedRepeatingBitmap;
    const matrixStr = `${fill.matrix.scaleX},${fill.matrix.scaleY},${fill.matrix.rotateSkew0},${fill.matrix.rotateSkew1},${fill.matrix.translateX},${fill.matrix.translateY}`;
    const patternHash = `${repeat ? 'R' : 'C'}B${smoothed ? '' : 'N'}-${fill.bitmapId}-${matrixStr}`;

    // Check if we already have this pattern
    if (this.patternIds.has(patternHash)) {
      return `url(#${this.patternIds.get(patternHash)})`;
    }

    const patternIdStr = `pattern${++this.patternId}`;
    this.patternIds.set(patternHash, patternIdStr);

    const bounds = bitmap.bounds();
    const width = (bounds.xMax - bounds.xMin) / 20;
    const height = (bounds.yMax - bounds.yMin) / 20;

    // Build pattern transform from matrix
    const transform = toSvgTransform(fill.matrix);

    const patternAttrs = [
      `id="${patternIdStr}"`,
      'overflow="visible"',
      'patternUnits="userSpaceOnUse"',
      `width="${width}"`,
      `height="${height}"`,
      `viewBox="0 0 ${width} ${height}"`,
    ];

    if (transform) {
      patternAttrs.push(`patternTransform="${transform}"`);
    }

    if (!smoothed) {
      patternAttrs.push('image-rendering="optimizeSpeed"');
    }

    const b64 = bitmap.toBase64Data();
    defs.push(
      `<pattern ${patternAttrs.join(' ')}>` +
        `<image width="${width}" height="${height}" xlink:href="${b64}"/>` +
        `</pattern>`,
    );

    return `url(#${patternIdStr})`;
  }

  private colorToString(color: Rgba): string {
    if (color.a === 255) {
      return toHex(color);
    }
    return toRgbaString(color);
  }

  private createGradient(fill: GradientFill, defs: string[]): string {
    const id = `gradient${++this.gradientId}`;
    const gradient = fill.gradient;
    const isRadial = fill.type !== FillStyleType.LinearGradient;

    const stops = gradient.records
      .map((r) => `<stop offset="${(r.ratio / 255 * 100).toFixed(1)}%" stop-color="${this.colorToString(r.color)}"/>`)
      .join('');

    if (isRadial) {
      defs.push(`<radialGradient id="${id}">${stops}</radialGradient>`);
    } else {
      defs.push(`<linearGradient id="${id}">${stops}</linearGradient>`);
    }

    return `url(#${id})`;
  }

  private getStrokeAttributes(line: LineStyle | LineStyle2, scale: number): string[] {
    const attrs: string[] = [];
    const width = (line.width / 20) * scale;
    attrs.push(`stroke-width="${width.toFixed(2)}"`);

    if ('color' in line && line.color) {
      attrs.push(`stroke="${this.colorToString(line.color)}"`);
    }

    return attrs;
  }
}

