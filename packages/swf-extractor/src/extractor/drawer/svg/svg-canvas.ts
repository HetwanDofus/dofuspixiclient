import type { Rectangle } from '@/parser/structure/record/rectangle.ts';
import type { Matrix } from '@/parser/structure/record/matrix.ts';
import type { Drawable } from '@/extractor/drawable.ts';
import type { ShapePath } from '@/extractor/shape/path.ts';
import type { Filter } from '@/parser/structure/record/filter/filter.ts';
import type { Drawer, Shape, ImageCharacter } from '@/extractor/drawer/drawer-interface.ts';
import { BlendMode, blendModeToCss } from '@/extractor/timeline/blend-mode.ts';
import { buildPathString } from '@/extractor/shape/path.ts';
import { FillStyleType, type FillStyle, type SolidFill, type GradientFill, type BitmapFill } from '@/parser/structure/record/fill-style.ts';
import { type LineStyle, type LineStyle2 } from '@/parser/structure/record/line-style.ts';
import { toHex, hasTransparency, getOpacity, type Rgba } from '@/parser/structure/record/color.ts';
import * as fs from 'fs';

console.error('DEBUG: svg-canvas.ts loaded');
fs.appendFileSync('/tmp/debug.log', 'svg-canvas.ts loaded\n');

/**
 * Format opacity value to match PHP's precision (14 decimal places).
 */
function formatOpacity(color: Rgba): string {
  const value = getOpacity(color);
  // PHP outputs 14 decimal places by default
  return value.toPrecision(14);
}
import { toSvgTransform } from '@/parser/structure/record/matrix.ts';
import { buildSvgFilter } from './filter/svg-filter-builder.ts';

/**
 * Bitmap resolver function type.
 * Returns an ImageCharacter for a given bitmap ID, or null if not found.
 */
export type BitmapResolver = (bitmapId: number) => ImageCharacter | null;

/**
 * SVG canvas options.
 */
export interface SvgCanvasOptions {
  /** Enable subpixel stroke width (default: true) */
  subpixelStrokeWidth?: boolean;
  /** Bitmap resolver for bitmap fills */
  bitmapResolver?: BitmapResolver;
}

/**
 * Abstract base class for SVG canvas implementations.
 * Provides common drawing functionality for shapes, paths, and gradients.
 */
abstract class AbstractSvgCanvas implements Drawer {
  protected readonly subpixelStrokeWidth: boolean;
  protected readonly bitmapResolver: BitmapResolver | null;
  protected readonly parts: string[] = [];
  protected readonly defsParts: string[] = [];
  protected bounds: Rectangle | null = null;
  protected activeClipPaths: Map<string, number> = new Map();
  protected readonly patternIds: Map<string, string> = new Map();

  constructor(subpixelStrokeWidth: boolean = false, bitmapResolver?: BitmapResolver) {
    this.subpixelStrokeWidth = subpixelStrokeWidth;
    this.bitmapResolver = bitmapResolver ?? null;
  }

  area(bounds: Rectangle): void {
    this.bounds = bounds;
    // Create a group with offset to normalize coordinates
    const offsetX = -bounds.xMin / 20;
    const offsetY = -bounds.yMin / 20;
    this.parts.push(`<g transform="matrix(1, 0, 0, 1, ${offsetX}, ${offsetY})">`);
  }

  shape(shape: Shape): void {
    // DEBUG: Write to file
    fs.appendFileSync('/tmp/debug.log', `AbstractSvgCanvas.shape(): class=${this.constructor.name}\n`);

    const offsetX = shape.xOffset / 20;
    const offsetY = shape.yOffset / 20;
    this.parts.push(`<g transform="translate(${offsetX}, ${offsetY})">`);
    for (const path of shape.paths) {
      this.path(path);
    }
    this.parts.push('</g>');
  }

  image(image: ImageCharacter): void {
    const bounds = image.bounds();
    const x = bounds.xMin / 20;
    const y = bounds.yMin / 20;
    const width = (bounds.xMax - bounds.xMin) / 20;
    const height = (bounds.yMax - bounds.yMin) / 20;

    this.parts.push(
      `<image x="${x}" y="${y}" width="${width}" height="${height}" xlink:href="${image.toBase64Data()}"/>`,
    );
  }

  include(
    object: Drawable,
    matrix: Matrix,
    frame: number = 0,
    filters: readonly Filter[] = [],
    blendMode: BlendMode = BlendMode.Normal,
    name?: string | null,
  ): void {
    // DEBUG: Write to file
    fs.appendFileSync('/tmp/debug.log', `AbstractSvgCanvas.include(): class=${this.constructor.name}, object=${object.constructor?.name || typeof object}\n`);

    // Create an included canvas to draw the object into defs
    const included = new IncludedSvgCanvas(this, this.subpixelStrokeWidth, this.bitmapResolver ?? undefined);
    object.draw(included, frame);
    included.finalize(); // Close any open groups

    const objBounds = object.bounds();
    const width = (objBounds.xMax - objBounds.xMin) / 20;
    const height = (objBounds.yMax - objBounds.yMin) / 20;

    // Add filter if needed
    let filterId: string | null = null;
    if (filters.length > 0 && included.ids.length > 0) {
      filterId = `filter-${included.ids[0]}`;
      this.addFilter(filters, filterId, width, height);
    }

    // Create use elements for each symbol
    for (const id of included.ids) {
      const attrs: string[] = [];
      attrs.push(`xlink:href="#${id}"`);
      attrs.push(`width="${width}"`);
      attrs.push(`height="${height}"`);

      const transform = toSvgTransform(matrix);
      if (transform) attrs.push(`transform="${transform}"`);
      if (name) attrs.push(`id="${name}"`);
      if (filterId) attrs.push(`filter="url(#${filterId})"`);

      const cssBlendMode = blendModeToCss(blendMode);
      if (cssBlendMode) attrs.push(`style="mix-blend-mode: ${cssBlendMode}"`);

      this.parts.push(`<use ${attrs.join(' ')}/>`);
    }
  }

  startClip(object: Drawable, matrix: Matrix, frame: number): string {
    const id = this.nextObjectId();
    const transform = toSvgTransform(matrix);

    // Create clipPath definition
    const clipPathDrawer = new ClipPathBuilder(this, this.subpixelStrokeWidth);
    object.draw(clipPathDrawer, frame);

    this.defsParts.push(`<clipPath id="${id}" transform="${transform}">`);
    this.defsParts.push(...clipPathDrawer.getPaths());
    this.defsParts.push('</clipPath>');

    // Start a group with this clip applied
    this.parts.push(`<g clip-path="url(#${id})">`);
    this.activeClipPaths.set(id, this.activeClipPaths.size);

    return id;
  }

  endClip(clipId: string): void {
    if (this.activeClipPaths.has(clipId)) {
      this.parts.push('</g>');
      this.activeClipPaths.delete(clipId);
    }
  }

  path(path: ShapePath): void {
    const d = buildPathString(path.segments, 1);
    if (!d) return;

    const attrs: string[] = [];

    if (path.fillStyle) {
      attrs.push('fill-rule="evenodd"');
      attrs.push(...this.getFillAttributes(path.fillStyle));
      if (!path.lineStyle) {
        attrs.push('stroke="none"');
      }
    } else {
      attrs.push('fill="none"');
    }

    if (path.lineStyle) {
      attrs.push(...this.getStrokeAttributes(path.lineStyle));
    }

    // d attribute goes at the end (matches PHP)
    attrs.push(`d="${d}"`);

    this.parts.push(`<path ${attrs.join(' ')}/>`);
  }

  abstract render(): string;
  abstract nextObjectId(): string;

  addDef(def: string): void {
    this.defsParts.push(def);
  }

  protected addFilter(filters: readonly Filter[], filterId: string, width: number, height: number): void {
    if (filters.length === 0) return;
    const filterSvg = buildSvgFilter(filters, filterId, width, height);
    this.defsParts.push(filterSvg);
  }

  protected getFillAttributes(fill: FillStyle): string[] {
    switch (fill.type) {
      case FillStyleType.Solid: {
        const color = (fill as SolidFill).color;
        const attrs = [`fill="${toHex(color)}"`];
        if (hasTransparency(color)) {
          attrs.push(`fill-opacity="${formatOpacity(color)}"`);
        }
        return attrs;
      }

      case FillStyleType.LinearGradient:
      case FillStyleType.RadialGradient:
      case FillStyleType.FocalRadialGradient:
        return [`fill="${this.createGradient(fill as GradientFill)}"`];

      case FillStyleType.RepeatingBitmap:
      case FillStyleType.ClippedBitmap:
      case FillStyleType.NonSmoothedRepeatingBitmap:
      case FillStyleType.NonSmoothedClippedBitmap:
        return [`fill="${this.createBitmapPattern(fill as BitmapFill)}"`];

      default:
        return ['fill="none"'];
    }
  }

  protected createBitmapPattern(fill: BitmapFill): string {
    if (!this.bitmapResolver) {
      // No resolver available, return gray placeholder
      return '#808080';
    }

    const bitmap = this.bitmapResolver(fill.bitmapId);
    if (!bitmap) {
      // Bitmap not found, return gray placeholder
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

    const patternId = `pattern-${this.nextObjectId()}`;
    this.patternIds.set(patternHash, patternId);

    const bounds = bitmap.bounds();
    const width = (bounds.xMax - bounds.xMin) / 20;
    const height = (bounds.yMax - bounds.yMin) / 20;

    // Build pattern transform from matrix
    const transform = toSvgTransform(fill.matrix);

    const patternAttrs = [
      `id="${patternId}"`,
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
    this.defsParts.push(
      `<pattern ${patternAttrs.join(' ')}>` +
        `<image width="${width}" height="${height}" xlink:href="${b64}"/>` +
        `</pattern>`,
    );

    return `url(#${patternId})`;
  }

  protected createGradient(fill: GradientFill): string {
    const id = this.nextObjectId();
    const gradient = fill.gradient;
    const isRadial = fill.type !== FillStyleType.LinearGradient;

    const stops = gradient.records
      .map((r) => {
        const offset = ((r.ratio / 255) * 100).toFixed(1);
        const color = toHex(r.color);
        if (hasTransparency(r.color)) {
          return `<stop offset="${offset}%" stop-color="${color}" stop-opacity="${formatOpacity(r.color)}"/>`;
        }
        return `<stop offset="${offset}%" stop-color="${color}"/>`;
      })
      .join('');

    if (isRadial) {
      this.defsParts.push(`<radialGradient id="${id}">${stops}</radialGradient>`);
    } else {
      this.defsParts.push(`<linearGradient id="${id}">${stops}</linearGradient>`);
    }

    return `url(#${id})`;
  }

  protected getStrokeAttributes(line: LineStyle | LineStyle2): string[] {
    const attrs: string[] = [];
    const width = line.width / 20;

    // Stroke color first (matches PHP order)
    if ('color' in line && line.color) {
      attrs.push(`stroke="${toHex(line.color)}"`);
      if (hasTransparency(line.color)) {
        attrs.push(`stroke-opacity="${formatOpacity(line.color)}"`);
      }
    }

    // Then stroke-width with vector-effect if needed
    if (this.subpixelStrokeWidth) {
      attrs.push(`stroke-width="${width}"`);
    } else {
      if (width < 1) {
        attrs.push('vector-effect="non-scaling-stroke"');
      }
      attrs.push(`stroke-width="${Math.max(1, width)}"`);
    }

    // Add stroke-linecap and stroke-linejoin for proper line rendering
    attrs.push('stroke-linecap="round"');
    attrs.push('stroke-linejoin="round"');

    return attrs;
  }
}

/**
 * SVG canvas for drawing SWF content.
 * This is the root canvas that creates the SVG element.
 */
export class SvgCanvas extends AbstractSvgCanvas {
  private lastId = -1;

  constructor(options: SvgCanvasOptions = {}) {
    // Default to false to match PHP behavior (minimum 1px stroke with non-scaling-stroke)
    super(options.subpixelStrokeWidth ?? false, options.bitmapResolver);
  }

  nextObjectId(): string {
    return `object-${++this.lastId}`;
  }

  render(): string {
    if (!this.bounds) {
      return '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    }

    const width = (this.bounds.xMax - this.bounds.xMin) / 20;
    const height = (this.bounds.yMax - this.bounds.yMin) / 20;

    const result: string[] = [];
    result.push('<?xml version="1.0"?>');
    // Match PHP: newline after XML declaration, no viewBox attribute
    result.push(`\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}px" height="${height}px">`);

    // Add content first (close the group opened in area())
    result.push(...this.parts);
    result.push('</g>');

    // Add defs after content (like PHP)
    if (this.defsParts.length > 0) {
      result.push('<defs>');
      result.push(...this.defsParts);
      result.push('</defs>');
    }

    result.push('</svg>');
    return result.join('');
  }
}

/**
 * Canvas for drawing included objects into the defs section.
 * Each drawn object gets a unique ID that can be referenced with <use>.
 *
 * This implementation uses a buffered approach to match PHP behavior:
 * - Child object definitions are added directly to defs (as siblings)
 * - Content for the current group (paths, use elements) is buffered
 * - At finalize(), the buffer is wrapped in a group with the proper ID and transform
 */
class IncludedSvgCanvas extends AbstractSvgCanvas {
  readonly ids: string[] = [];
  private readonly root: AbstractSvgCanvas;
  private readonly contentBuffer: string[] = [];
  private groupTransform: string = '';
  private hasGroup = false;

  constructor(root: AbstractSvgCanvas, subpixelStrokeWidth: boolean, bitmapResolver?: BitmapResolver) {
    super(subpixelStrokeWidth, bitmapResolver);
    this.root = root;
  }

  nextObjectId(): string {
    return this.root.nextObjectId();
  }

  private addContent(content: string): void {
    this.contentBuffer.push(content);
  }

  override area(bounds: Rectangle): void {
    this.bounds = bounds;
    // Reserve an ID for this group, but don't add to defs yet
    const id = this.nextObjectId();
    this.ids.push(id);

    const offsetX = -bounds.xMin / 20;
    const offsetY = -bounds.yMin / 20;

    this.groupTransform = `matrix(1, 0, 0, 1, ${offsetX}, ${offsetY})`;
    this.hasGroup = true;
  }

  override shape(shape: Shape): void {
    // Create a group with ID for the shape
    const id = this.nextObjectId();
    this.ids.push(id);

    const offsetX = Math.round((shape.xOffset / 20) * 10000) / 10000;
    const offsetY = Math.round((shape.yOffset / 20) * 10000) / 10000;

    // DEBUG: Write to file
    fs.appendFileSync('/tmp/debug.log', `IncludedSvgCanvas.shape(${id}): hasGroup=${this.hasGroup}, root=${this.root.constructor.name}\n`);

    // If we're inside a group context (sprite), add to content buffer
    // Otherwise add directly to defs
    if (this.hasGroup) {
      this.addContent(`<g transform="matrix(1, 0, 0, 1, ${offsetX}, ${offsetY})" id="${id}">`);
      for (const path of shape.paths) {
        const d = buildPathString(path.segments, 1);
        if (!d) continue;

        const attrs: string[] = [];
        if (path.fillStyle) {
          attrs.push('fill-rule="evenodd"');
          attrs.push(...this.getFillAttributes(path.fillStyle));
          if (!path.lineStyle) {
            attrs.push('stroke="none"');
          }
        } else {
          attrs.push('fill="none"');
        }
        if (path.lineStyle) {
          attrs.push(...this.getStrokeAttributes(path.lineStyle));
        }
        attrs.push(`d="${d}"`);
        this.addContent(`<path ${attrs.join(' ')}/>`);
      }
      this.addContent('</g>');
    } else {
      // Add the complete shape group directly to defs
      this.root.addDef(`<g transform="matrix(1, 0, 0, 1, ${offsetX}, ${offsetY})" id="${id}">`);

      for (const path of shape.paths) {
        this.pathToDefs(path);
      }

      this.root.addDef('</g>');
    }
  }

  override path(path: ShapePath): void {
    this.pathToDefs(path);
  }

  private pathToDefs(path: ShapePath): void {
    const d = buildPathString(path.segments, 1);
    if (!d) return;

    const attrs: string[] = [];

    if (path.fillStyle) {
      attrs.push('fill-rule="evenodd"');
      attrs.push(...this.getFillAttributes(path.fillStyle));
      if (!path.lineStyle) {
        attrs.push('stroke="none"');
      }
    } else {
      attrs.push('fill="none"');
    }

    if (path.lineStyle) {
      attrs.push(...this.getStrokeAttributes(path.lineStyle));
    }

    // d attribute goes at the end (matches PHP)
    attrs.push(`d="${d}"`);

    // If we have a group context, add to buffer; otherwise add directly
    if (this.hasGroup) {
      this.addContent(`<path ${attrs.join(' ')}/>`);
    } else {
      this.root.addDef(`<path ${attrs.join(' ')}/>`);
    }
  }

  override include(
    object: Drawable,
    matrix: Matrix,
    frame: number = 0,
    _filters: readonly Filter[] = [],
    blendMode: BlendMode = BlendMode.Normal,
    name?: string | null,
  ): void {
    // Recursively include nested objects - these go directly to defs as siblings
    const included = new IncludedSvgCanvas(this.root, this.subpixelStrokeWidth, this.bitmapResolver ?? undefined);
    object.draw(included, frame);
    included.finalize();

    const objBounds = object.bounds();
    const width = (objBounds.xMax - objBounds.xMin) / 20;
    const height = (objBounds.yMax - objBounds.yMin) / 20;

    // Create use elements for each symbol - these go into our content buffer
    for (const id of included.ids) {
      const attrs: string[] = [];
      attrs.push(`xlink:href="#${id}"`);
      attrs.push(`width="${width}"`);
      attrs.push(`height="${height}"`);

      const transform = toSvgTransform(matrix);
      if (transform) attrs.push(`transform="${transform}"`);
      if (name) attrs.push(`id="${name}"`);

      const cssBlendMode = blendModeToCss(blendMode);
      if (cssBlendMode) attrs.push(`style="mix-blend-mode: ${cssBlendMode}"`);

      this.addContent(`<use ${attrs.join(' ')}/>`);
    }
  }

  override startClip(object: Drawable, matrix: Matrix, frame: number): string {
    const id = this.nextObjectId();
    const transform = toSvgTransform(matrix);

    // Create clipPath definition - goes directly to defs
    const clipPathDrawer = new ClipPathBuilder(this.root, this.subpixelStrokeWidth);
    object.draw(clipPathDrawer, frame);

    this.root.addDef(`<clipPath id="${id}" transform="${transform}">`);
    for (const p of clipPathDrawer.getPaths()) {
      this.root.addDef(p);
    }
    this.root.addDef('</clipPath>');

    // Start a group with this clip applied - add to buffer
    this.addContent(`<g clip-path="url(#${id})">`);
    this.activeClipPaths.set(id, this.activeClipPaths.size);

    return id;
  }

  override endClip(clipId: string): void {
    if (this.activeClipPaths.has(clipId)) {
      this.addContent('</g>');
      this.activeClipPaths.delete(clipId);
    }
  }

  finalize(): void {
    // If we have a group context, wrap all buffered content in the group
    if (this.hasGroup && this.ids.length > 0) {
      const id = this.ids[0]; // The ID reserved in area()
      this.root.addDef(`<g transform="${this.groupTransform}" id="${id}">`);
      for (const content of this.contentBuffer) {
        this.root.addDef(content);
      }
      this.root.addDef('</g>');
    }
  }

  render(): string {
    this.finalize();
    return '';
  }
}

/**
 * Builder for clip paths - only collects path data.
 */
class ClipPathBuilder extends AbstractSvgCanvas {
  private readonly pathStrings: string[] = [];
  private readonly root: AbstractSvgCanvas;

  constructor(root: AbstractSvgCanvas, subpixelStrokeWidth: boolean) {
    super(subpixelStrokeWidth);
    this.root = root;
  }

  nextObjectId(): string {
    return this.root.nextObjectId();
  }

  override area(_bounds: Rectangle): void {
    // No-op for clip paths
  }

  override shape(shape: Shape): void {
    for (const path of shape.paths) {
      this.path(path);
    }
  }

  override path(path: ShapePath): void {
    const d = buildPathString(path.segments, 1);
    if (d) {
      this.pathStrings.push(`<path d="${d}" fill="black"/>`);
    }
  }

  override include(object: Drawable, _matrix: Matrix, frame: number): void {
    // For clip paths, we just collect the paths from the object
    object.draw(this, frame);
  }

  override startClip(): string {
    return '';
  }

  override endClip(): void {
    // No-op
  }

  getPaths(): string[] {
    return this.pathStrings;
  }

  render(): string {
    return '';
  }
}

