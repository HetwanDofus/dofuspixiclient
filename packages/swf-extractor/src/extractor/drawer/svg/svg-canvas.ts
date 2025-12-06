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
import { toSvgTransform } from '@/parser/structure/record/matrix.ts';
import { buildSvgFilter } from './filter/svg-filter-builder.ts';

/**
 * Format opacity value to match PHP's precision (14 decimal places).
 */
function formatOpacity(color: Rgba): string {
  const value = getOpacity(color);
  return value.toPrecision(14);
}

/**
 * Simple hash function for deduplication (similar to PHP's crc32/md5).
 * Returns a numeric hash as a string.
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash >>> 0; // Convert to unsigned
}

/**
 * Bitmap resolver function type.
 */
export type BitmapResolver = (bitmapId: number) => ImageCharacter | null;

/**
 * Pre-scaled bitmap data.
 * Maps bitmap ID to pre-scaled base64 data.
 */
export type ScaledBitmaps = Map<number, string>;

/**
 * SVG canvas options.
 */
export interface SvgCanvasOptions {
  subpixelStrokeWidth?: boolean;
  bitmapResolver?: BitmapResolver;
  /**
   * Pre-scaled bitmap data.
   * When provided, these will be used instead of the original bitmap data.
   * This allows rendering at higher resolutions without pixelation.
   */
  scaledBitmaps?: ScaledBitmaps;
}

/**
 * Simple DOM-like element for building SVG.
 * Matches PHP's SimpleXMLElement behavior.
 */
class SvgElement {
  readonly tag: string;
  readonly attributes: Map<string, string> = new Map();
  readonly children: (SvgElement | string)[] = [];
  readonly namespaces: Map<string, string> = new Map();

  constructor(tag: string) {
    this.tag = tag;
  }

  addAttribute(name: string, value: string, namespace?: string): void {
    if (namespace) {
      const prefix = this.getNamespacePrefix(namespace);
      this.attributes.set(`${prefix}:${name}`, value);
    } else {
      this.attributes.set(name, value);
    }
  }

  private getNamespacePrefix(ns: string): string {
    if (ns === 'http://www.w3.org/1999/xlink') return 'xlink';
    return 'ns';
  }

  addChild(tag: string): SvgElement {
    const child = new SvgElement(tag);
    this.children.push(child);
    return child;
  }

  addText(text: string): void {
    this.children.push(text);
  }

  toXml(): string {
    const attrs: string[] = [];
    for (const [key, value] of this.attributes) {
      attrs.push(`${key}="${this.escapeAttr(value)}"`);
    }

    const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

    if (this.children.length === 0) {
      return `<${this.tag}${attrStr}/>`;
    }

    const childrenStr = this.children.map(c =>
      typeof c === 'string' ? c : c.toXml()
    ).join('');

    return `<${this.tag}${attrStr}>${childrenStr}</${this.tag}>`;
  }

  private escapeAttr(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

const XLINK_NS = 'http://www.w3.org/1999/xlink';

/**
 * Helper class to build SVG elements (matches PHP's SvgBuilder).
 * Uses DOM-like approach with SvgElement.
 */
class SvgBuilder {
  readonly subpixelStrokeWidth: boolean;
  private readonly svg: SvgElement;
  private readonly _bitmapResolver: BitmapResolver | null;
  private readonly _scaledBitmaps: ScaledBitmaps | null;
  private readonly patternIds: Map<string, string> = new Map();
  private readonly gradientIds: Map<string, string> = new Map();
  private readonly imageIds: Map<string, string> = new Map();
  private readonly getNextId: () => string;

  constructor(
    svg: SvgElement,
    subpixelStrokeWidth: boolean,
    bitmapResolver: BitmapResolver | null,
    getNextId: () => string,
    scaledBitmaps: ScaledBitmaps | null = null,
  ) {
    this.svg = svg;
    this.subpixelStrokeWidth = subpixelStrokeWidth;
    this._bitmapResolver = bitmapResolver;
    this.getNextId = getNextId;
    this._scaledBitmaps = scaledBitmaps;
  }

  get bitmapResolver(): BitmapResolver | null {
    return this._bitmapResolver;
  }

  get scaledBitmaps(): ScaledBitmaps | null {
    return this._scaledBitmaps;
  }

  addGroup(bounds: Rectangle): SvgElement {
    const g = this.svg.addChild('g');
    const offsetX = -bounds.xMin / 20;
    const offsetY = -bounds.yMin / 20;
    g.addAttribute('transform', `matrix(1, 0, 0, 1, ${offsetX}, ${offsetY})`);
    return g;
  }

  addGroupWithOffset(offsetX: number, offsetY: number): SvgElement {
    const g = this.svg.addChild('g');
    const ox = offsetX / 20;
    const oy = offsetY / 20;
    g.addAttribute('transform', `matrix(1, 0, 0, 1, ${ox}, ${oy})`);
    return g;
  }

  addPath(g: SvgElement, path: ShapePath): SvgElement | null {
    const d = buildPathString(path.segments, 1);
    if (!d) return null;

    const pathEl = g.addChild('path');

    if (path.fillStyle) {
      pathEl.addAttribute('fill-rule', 'evenodd');
      this.applyFillStyle(pathEl, path.fillStyle);
      if (!path.lineStyle) {
        pathEl.addAttribute('stroke', 'none');
      }
    } else {
      pathEl.addAttribute('fill', 'none');
    }

    if (path.lineStyle) {
      this.applyStrokeStyle(pathEl, path.lineStyle);
    }

    pathEl.addAttribute('d', d);
    return pathEl;
  }

  addFilter(filters: readonly Filter[], filterId: string, width: number, height: number): void {
    if (filters.length === 0) return;
    const filterSvg = buildSvgFilter(filters, filterId, width, height);
    this.svg.addText(filterSvg);
  }

  private applyFillStyle(el: SvgElement, fill: FillStyle): void {
    this.applyFillStyleForAttribute(el, fill, 'fill');
  }

  private applyStrokeStyle(el: SvgElement, line: LineStyle | LineStyle2): void {
    const width = line.width / 20;

    // Check for line fill (LineStyle2 with fillType)
    if ('fillType' in line && line.fillType) {
      // Apply the fill style to the stroke attribute
      this.applyFillStyleForAttribute(el, line.fillType, 'stroke');
    } else if ('color' in line && line.color) {
      el.addAttribute('stroke', toHex(line.color));
      if (hasTransparency(line.color)) {
        el.addAttribute('stroke-opacity', formatOpacity(line.color));
      }
    } else {
      el.addAttribute('stroke', 'none');
    }

    if (width > 0) {
      if (this.subpixelStrokeWidth) {
        el.addAttribute('stroke-width', String(width));
      } else {
        if (width < 1) {
          el.addAttribute('vector-effect', 'non-scaling-stroke');
        }
        el.addAttribute('stroke-width', String(Math.max(1, width)));
      }

      el.addAttribute('stroke-linecap', 'round');
      el.addAttribute('stroke-linejoin', 'round');
    }
  }

  /**
   * Apply a fill style to an element for a given attribute (fill or stroke).
   */
  private applyFillStyleForAttribute(el: SvgElement, fill: FillStyle, attribute: 'fill' | 'stroke'): void {
    switch (fill.type) {
      case FillStyleType.Solid: {
        const color = (fill as SolidFill).color;
        el.addAttribute(attribute, toHex(color));
        if (hasTransparency(color)) {
          el.addAttribute(`${attribute}-opacity`, formatOpacity(color));
        }
        break;
      }
      case FillStyleType.LinearGradient:
      case FillStyleType.RadialGradient:
      case FillStyleType.FocalRadialGradient:
        el.addAttribute(attribute, this.createGradient(fill as GradientFill));
        break;
      case FillStyleType.RepeatingBitmap:
      case FillStyleType.ClippedBitmap:
      case FillStyleType.NonSmoothedRepeatingBitmap:
      case FillStyleType.NonSmoothedClippedBitmap:
        el.addAttribute(attribute, this.createBitmapPattern(fill as BitmapFill));
        break;
      default:
        el.addAttribute(attribute, 'none');
    }
  }

  private createBitmapPattern(fill: BitmapFill): string {
    if (!this.bitmapResolver) return '#808080';
    const bitmap = this.bitmapResolver(fill.bitmapId);
    if (!bitmap) return '#808080';

    const smoothed = fill.type === FillStyleType.RepeatingBitmap || fill.type === FillStyleType.ClippedBitmap;
    const repeat = fill.type === FillStyleType.RepeatingBitmap || fill.type === FillStyleType.NonSmoothedRepeatingBitmap;
    // Use undoTwipScale=true for bitmap patterns like PHP does
    const transform = toSvgTransform(fill.matrix, true);
    // Include whether we have scaled bitmaps in the hash to avoid conflicts
    const hasScaled = this.scaledBitmaps?.has(fill.bitmapId) ?? false;
    // Match PHP's hash format: prefix + bitmapId + '-' + crc32(transform)
    const prefix = (repeat ? 'R' : 'C') + 'B' + (smoothed ? '' : 'N');
    const patternHash = `pattern-${prefix}${fill.bitmapId}-${simpleHash(transform)}${hasScaled ? '-scaled' : ''}`;

    if (this.patternIds.has(patternHash)) {
      return `url(#${this.patternIds.get(patternHash)})`;
    }

    this.patternIds.set(patternHash, patternHash);

    const bounds = bitmap.bounds();
    const width = (bounds.xMax - bounds.xMin) / 20;
    const height = (bounds.yMax - bounds.yMin) / 20;

    const pattern = this.svg.addChild('pattern');
    pattern.addAttribute('id', patternHash);
    pattern.addAttribute('overflow', 'visible');
    pattern.addAttribute('patternUnits', 'userSpaceOnUse');
    pattern.addAttribute('width', String(width));
    pattern.addAttribute('height', String(height));
    pattern.addAttribute('viewBox', `0 0 ${width} ${height}`);
    pattern.addAttribute('patternTransform', transform);
    if (!smoothed) pattern.addAttribute('image-rendering', 'optimizeSpeed');

    // Use pre-scaled bitmap if available, otherwise use original
    const imageData = this.scaledBitmaps?.get(fill.bitmapId) ?? bitmap.toBase64Data();

    // Deduplicate images: if the same image data is used in multiple patterns, reuse it
    const imageHash = `image-${simpleHash(imageData)}`;
    if (this.imageIds.has(imageHash)) {
      // Image already exists, use a <use> reference
      const use = pattern.addChild('use');
      use.addAttribute('href', `#${this.imageIds.get(imageHash)}`, XLINK_NS);
    } else {
      // First time seeing this image, create it with an ID
      this.imageIds.set(imageHash, imageHash);
      const img = pattern.addChild('image');
      img.addAttribute('href', imageData, XLINK_NS);
      img.addAttribute('id', imageHash);
    }

    return `url(#${patternHash})`;
  }

  private createGradient(fill: GradientFill): string {
    const gradient = fill.gradient;
    const isRadial = fill.type !== FillStyleType.LinearGradient;

    // Create a hash for deduplication (like PHP does)
    // PHP uses: 'gradient-' . hash('xxh128', json_encode($this))
    // We'll use a simpler hash based on the gradient properties
    const prefix = isRadial ? 'R' : 'L';
    const matrixStr = toSvgTransform(fill.matrix);
    const recordsStr = gradient.records.map(r => `${r.ratio}:${toHex(r.color)}:${r.color.a}`).join(',');
    const focalStr = 'focalPoint' in gradient && gradient.focalPoint ? `:${gradient.focalPoint}` : '';
    const hashInput = `${prefix}${matrixStr}${recordsStr}${focalStr}`;
    const gradientId = `gradient-${prefix}${simpleHash(hashInput).toString(16)}`;

    // Check if we already have this gradient
    if (this.gradientIds.has(gradientId)) {
      return `url(#${gradientId})`;
    }

    this.gradientIds.set(gradientId, gradientId);

    const gradEl = this.svg.addChild(isRadial ? 'radialGradient' : 'linearGradient');

    // Apply gradient transformation from the fill's matrix
    gradEl.addAttribute('gradientTransform', toSvgTransform(fill.matrix));
    gradEl.addAttribute('gradientUnits', 'userSpaceOnUse');
    gradEl.addAttribute('spreadMethod', 'pad');
    gradEl.addAttribute('id', gradientId);

    // All gradients are defined in a standard space called the gradient square.
    // The gradient square is centered at (0,0), and extends from (-16384,-16384) to (16384,16384).
    if (isRadial) {
      gradEl.addAttribute('cx', '0');
      gradEl.addAttribute('cy', '0');
      gradEl.addAttribute('r', '819.2');

      // Handle focal point for focal radial gradients
      if ('focalPoint' in gradient && gradient.focalPoint) {
        gradEl.addAttribute('fx', '0');
        gradEl.addAttribute('fy', String(gradient.focalPoint * 819.2));
      }
    } else {
      gradEl.addAttribute('x1', '-819.2');
      gradEl.addAttribute('x2', '819.2');
    }

    for (const r of gradient.records) {
      const stop = gradEl.addChild('stop');
      stop.addAttribute('offset', String(r.ratio / 255));
      stop.addAttribute('stop-color', toHex(r.color));
      // For linear gradients, PHP always adds stop-opacity
      // For radial gradients, PHP only adds it when there's transparency
      if (isRadial) {
        if (hasTransparency(r.color)) {
          stop.addAttribute('stop-opacity', formatOpacity(r.color));
        }
      } else {
        stop.addAttribute('stop-opacity', formatOpacity(r.color));
      }
    }

    return `url(#${gradientId})`;
  }
}

/**
 * Abstract base class for SVG canvas implementations.
 * Matches PHP's AbstractSvgCanvas with DOM-based approach.
 */
abstract class AbstractSvgCanvas implements Drawer {
  protected readonly builder: SvgBuilder;

  /**
   * The current drawing root element (group created by area()).
   * Will be created on first call to area().
   */
  private currentGroup: SvgElement | null = null;

  /**
   * The current target group element.
   * Depends on active clips - each clip creates a nested group.
   * If null, next drawing will resolve a new target via target().
   */
  private currentTarget: SvgElement | null = null;

  /**
   * Bounds of the current drawing area.
   */
  private bounds: Rectangle | null = null;

  /**
   * Active clipPath ids. Key = id, value = id.
   */
  private activeClipPaths: Map<string, string> = new Map();

  constructor(builder: SvgBuilder) {
    this.builder = builder;
  }

  area(bounds: Rectangle): void {
    this.currentTarget = this.currentGroup = this.newGroup(this.builder, bounds);
    this.bounds = bounds;
  }

  shape(shape: Shape): void {
    this.currentTarget = this.newGroupWithOffset(this.builder, shape.xOffset, shape.yOffset);
    for (const path of shape.paths) {
      this.path(path);
    }
  }

  image(image: ImageCharacter): void {
    const g = this.currentTarget = this.newGroup(this.builder, image.bounds());
    const imgEl = g.addChild('image');
    imgEl.addAttribute('href', image.toBase64Data(), XLINK_NS);
  }

  include(
    object: Drawable,
    matrix: Matrix,
    frame: number = 0,
    filters: readonly Filter[] = [],
    blendMode: BlendMode = BlendMode.Normal,
    name?: string | null,
  ): void {
    const included = new IncludedSvgCanvas(this, this.getDefs(), this.builder.subpixelStrokeWidth, this.builder.bitmapResolver, this.builder.scaledBitmaps);
    object.draw(included, frame);

    const g = this.target(object.bounds());
    const objBounds = object.bounds();
    const width = (objBounds.xMax - objBounds.xMin) / 20;
    const height = (objBounds.yMax - objBounds.yMin) / 20;

    let filterId: string | null = null;
    if (filters.length > 0 && included.ids.length > 0) {
      filterId = `filter-${included.ids[0]}`;
      this.builder.addFilter(filters, filterId, width, height);
    }

    for (const id of included.ids) {
      const use = g.addChild('use');
      use.addAttribute('href', `#${id}`, XLINK_NS);
      use.addAttribute('width', String(width));
      use.addAttribute('height', String(height));
      use.addAttribute('transform', toSvgTransform(matrix) || '');
      if (name) use.addAttribute('id', name);
      if (filterId) use.addAttribute('filter', `url(#${filterId})`);
      const cssBlendMode = blendModeToCss(blendMode);
      if (cssBlendMode) use.addAttribute('style', `mix-blend-mode: ${cssBlendMode}`);
    }
  }

  startClip(object: Drawable, matrix: Matrix, frame: number): string {
    const group = this.currentGroup;
    if (!group) throw new Error('No group defined for clipping');

    const clipPath = group.addChild('clipPath');
    const id = this.nextObjectId();
    clipPath.addAttribute('id', id);
    clipPath.addAttribute('transform', toSvgTransform(matrix) || '');

    const clipPathDrawer = new ClipPathBuilder(clipPath, this.builder);
    object.draw(clipPathDrawer, frame);

    this.activeClipPaths.set(id, id);
    // Reset target so next drawing will apply the clip
    this.currentTarget = null;

    return id;
  }

  endClip(clipId: string): void {
    this.activeClipPaths.delete(clipId);
    // Reset target so next drawing will rebuild clip structure
    this.currentTarget = null;
  }

  path(path: ShapePath): void {
    const g = this.currentTarget;
    if (!g) throw new Error('No group defined');
    this.builder.addPath(g, path);
  }

  /**
   * Get or create the current target element, applying active clips.
   * This is the lazy clip handling from PHP's target() method.
   */
  private target(bounds: Rectangle): SvgElement {
    if (this.currentTarget !== null) {
      return this.currentTarget;
    }

    const rootGroup = this.currentGroup ?? (this.currentGroup = this.newGroup(this.builder, this.bounds ?? bounds));

    // No clipping: use the root group
    if (this.activeClipPaths.size === 0) {
      return this.currentTarget = rootGroup;
    }

    // Create nested groups for each active clip
    let target = rootGroup;
    for (const [id] of this.activeClipPaths) {
      const clipG = target.addChild('g');
      clipG.addAttribute('clip-path', `url(#${id})`);
      target = clipG;
    }

    return this.currentTarget = target;
  }

  abstract render(): string;
  abstract nextObjectId(): string;
  protected abstract getDefs(): SvgElement;
  protected abstract newGroup(builder: SvgBuilder, bounds: Rectangle): SvgElement;
  protected abstract newGroupWithOffset(builder: SvgBuilder, offsetX: number, offsetY: number): SvgElement;
}

/**
 * SVG canvas for drawing SWF content.
 * This is the root canvas - matches PHP's SvgCanvas.
 */
export class SvgCanvas extends AbstractSvgCanvas {
  private readonly root: SvgElement;
  private defs: SvgElement | null = null;
  private lastId = -1;
  private boundsSet = false;

  constructor(options: SvgCanvasOptions = {}) {
    const root = new SvgElement('svg');
    root.addAttribute('xmlns', 'http://www.w3.org/2000/svg');
    root.addAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

    const subpixelStrokeWidth = options.subpixelStrokeWidth ?? false;
    const bitmapResolver = options.bitmapResolver ?? null;
    const scaledBitmaps = options.scaledBitmaps ?? null;
    const builder = new SvgBuilder(root, subpixelStrokeWidth, bitmapResolver, () => this.nextObjectId(), scaledBitmaps);

    super(builder);
    this.root = root;
  }

  override area(bounds: Rectangle): void {
    if (!this.boundsSet) {
      const width = (bounds.xMax - bounds.xMin) / 20;
      const height = (bounds.yMax - bounds.yMin) / 20;
      this.root.addAttribute('width', `${width}px`);
      this.root.addAttribute('height', `${height}px`);
      this.boundsSet = true;
    }
    super.area(bounds);
  }

  nextObjectId(): string {
    return `object-${++this.lastId}`;
  }

  render(): string {
    if (!this.boundsSet) {
      return '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    }
    return `<?xml version="1.0"?>\n${this.root.toXml()}`;
  }

  protected getDefs(): SvgElement {
    if (!this.defs) {
      this.defs = this.root.addChild('defs');
    }
    return this.defs;
  }

  protected newGroup(builder: SvgBuilder, bounds: Rectangle): SvgElement {
    return builder.addGroup(bounds);
  }

  protected newGroupWithOffset(builder: SvgBuilder, offsetX: number, offsetY: number): SvgElement {
    return builder.addGroupWithOffset(offsetX, offsetY);
  }
}

/**
 * Canvas for drawing included objects into the defs section.
 * Matches PHP's IncludedSvgCanvas.
 */
class IncludedSvgCanvas extends AbstractSvgCanvas {
  readonly ids: string[] = [];
  private readonly root: AbstractSvgCanvas;
  private readonly defs: SvgElement;

  constructor(root: AbstractSvgCanvas, defs: SvgElement, subpixelStrokeWidth: boolean, bitmapResolver: BitmapResolver | null, scaledBitmaps: ScaledBitmaps | null = null) {
    const builder = new SvgBuilder(defs, subpixelStrokeWidth, bitmapResolver, () => root.nextObjectId(), scaledBitmaps);
    super(builder);
    this.root = root;
    this.defs = defs;
  }

  nextObjectId(): string {
    return this.root.nextObjectId();
  }

  render(): string {
    throw new Error('IncludedSvgCanvas cannot render directly');
  }

  protected getDefs(): SvgElement {
    return this.defs;
  }

  protected newGroup(builder: SvgBuilder, bounds: Rectangle): SvgElement {
    const group = builder.addGroup(bounds);
    const id = this.nextObjectId();
    group.addAttribute('id', id);
    this.ids.push(id);
    return group;
  }

  protected newGroupWithOffset(builder: SvgBuilder, offsetX: number, offsetY: number): SvgElement {
    const group = builder.addGroupWithOffset(offsetX, offsetY);
    const id = this.nextObjectId();
    group.addAttribute('id', id);
    this.ids.push(id);
    return group;
  }
}

/**
 * Builder for clip paths - collects paths into a clipPath element.
 * Matches PHP's ClipPathBuilder.
 */
class ClipPathBuilder implements Drawer {
  private readonly clipPath: SvgElement;
  private readonly builder: SvgBuilder;
  private readonly transforms: Matrix[];

  constructor(clipPath: SvgElement, builder: SvgBuilder, transforms: Matrix[] = []) {
    this.clipPath = clipPath;
    this.builder = builder;
    this.transforms = transforms;
  }

  area(_bounds: Rectangle): void {
    // No-op
  }

  shape(shape: Shape): void {
    // Use builder.addPath like PHP does for proper fill/stroke styling
    for (const path of shape.paths) {
      const pathEl = this.builder.addPath(this.clipPath, path);
      if (!pathEl) continue;

      // Apply accumulated transforms and shape offset
      const transformStrs: string[] = [];
      for (const matrix of this.transforms) {
        transformStrs.push(toSvgTransform(matrix) || '');
      }
      transformStrs.push(`translate(${shape.xOffset / 20},${shape.yOffset / 20})`);
      pathEl.addAttribute('transform', transformStrs.join(' '));
    }
  }

  image(_image: ImageCharacter): void {
    // No-op for clip paths
  }

  include(object: Drawable, matrix: Matrix, frame: number): void {
    // Pass accumulated transforms to nested ClipPathBuilder like PHP does
    object.draw(new ClipPathBuilder(this.clipPath, this.builder, [...this.transforms, matrix]), frame);
  }

  startClip(_object: Drawable, _matrix: Matrix, _frame: number): string {
    return '';
  }

  endClip(_clipId: string): void {
    // No-op
  }

  path(_path: ShapePath): void {
    // No-op - paths are handled in shape() method
  }

  render(): string {
    return '';
  }
}
