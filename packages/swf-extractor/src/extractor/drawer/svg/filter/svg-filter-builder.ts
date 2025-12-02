/**
 * Builds SVG filters for Flash filters.
 *
 * This class is stateful, and directly modifies the SVG filter element.
 * So it must be recreated for each filter.
 */

import { match } from 'ts-pattern';
import type { Filter } from '@/parser/structure/record/filter/filter';
import { BLUR_FILTER_ID } from '@/parser/structure/record/filter/blur-filter';
import { COLOR_MATRIX_FILTER_ID } from '@/parser/structure/record/filter/color-matrix-filter';
import { DROP_SHADOW_FILTER_ID } from '@/parser/structure/record/filter/drop-shadow-filter';
import { GLOW_FILTER_ID } from '@/parser/structure/record/filter/glow-filter';
import { applyBlurFilter } from './svg-blur-filter';
import { applyColorMatrixFilter } from './svg-color-matrix-filter';
import { applyDropShadowFilter } from './svg-drop-shadow-filter';
import { applyGlowFilter } from './svg-glow-filter';

export class SvgFilterBuilder {
  private filterCount = 0;
  private lastResult = 'SourceGraphic';
  private xOffset = 0;
  private yOffset = 0;
  private readonly elements: string[] = [];

  private constructor(
    private readonly id: string,
    private readonly width: number,
    private readonly height: number,
  ) {}

  /**
   * Apply a new filter to the current filter builder.
   */
  apply(filter: Filter): void {
    this.lastResult = match(filter)
      .with({ type: COLOR_MATRIX_FILTER_ID }, (f) => applyColorMatrixFilter(this, f, this.lastResult))
      .with({ type: BLUR_FILTER_ID }, (f) => applyBlurFilter(this, f, this.lastResult))
      .with({ type: GLOW_FILTER_ID }, (f) => applyGlowFilter(this, f, this.lastResult))
      .with({ type: DROP_SHADOW_FILTER_ID }, (f) => applyDropShadowFilter(this, f, this.lastResult))
      .otherwise(() => this.lastResult);
  }

  /**
   * Add a filter element.
   */
  addFilter(element: string, attrs: Record<string, string>): void {
    const attrStr = Object.entries(attrs)
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');
    this.elements.push(`<${element} ${attrStr}/>`);
  }

  /**
   * Add a filter element with a result attribute.
   * Returns the result ID.
   */
  addResultFilter(element: string, inAttr: string | null, attrs: Record<string, string> = {}): string {
    const resultId = `filter${++this.filterCount}`;
    const allAttrs: Record<string, string> = { ...attrs, result: resultId, id: resultId };
    if (inAttr) {
      allAttrs.in = inAttr;
    }
    this.addFilter(element, allAttrs);
    return resultId;
  }

  /**
   * Add a composite filter element (like feMerge with children).
   */
  addCompositeFilter(element: string, attrs: Record<string, string>, children: string[]): string {
    const resultId = `filter${++this.filterCount}`;
    const allAttrs: Record<string, string> = { ...attrs, result: resultId };
    const attrStr = Object.entries(allAttrs)
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');
    this.elements.push(`<${element} ${attrStr}>${children.join('')}</${element}>`);
    return resultId;
  }

  /**
   * Increase the offset of the filter element.
   * The width and height of the filter will also be increased by the given offsets.
   */
  addOffset(x: number, y: number): void {
    this.xOffset += x;
    this.yOffset += y;
  }

  /**
   * Build the final filter element string.
   */
  build(): string {
    const attrs: string[] = [
      `id="${this.id}"`,
      'filterUnits="userSpaceOnUse"',
    ];

    if (this.xOffset > 0 || this.yOffset > 0) {
      attrs.push(`width="${this.width + this.xOffset * 2}"`);
      attrs.push(`height="${this.height + this.yOffset * 2}"`);
      attrs.push(`x="${-this.xOffset}"`);
      attrs.push(`y="${-this.yOffset}"`);
    }

    return `<filter ${attrs.join(' ')}>${this.elements.join('')}</filter>`;
  }

  /**
   * Create a new filter builder.
   */
  static create(id: string, width: number, height: number): SvgFilterBuilder {
    return new SvgFilterBuilder(id, width, height);
  }
}

/**
 * Build SVG filter string from a list of filters.
 */
export function buildSvgFilter(filters: readonly Filter[], id: string, width: number, height: number): string {
  const builder = SvgFilterBuilder.create(id, width, height);

  for (const filter of filters) {
    builder.apply(filter);
  }

  return builder.build();
}

