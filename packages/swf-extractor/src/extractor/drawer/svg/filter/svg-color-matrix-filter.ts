/**
 * SVG color matrix filter implementation.
 */

import type { ColorMatrixFilter } from '@/parser/structure/record/filter/color-matrix-filter';
import type { SvgFilterBuilder } from './svg-filter-builder';

/**
 * Apply the color matrix effect to the given filter builder.
 */
export function applyColorMatrixFilter(
  builder: SvgFilterBuilder,
  filter: ColorMatrixFilter,
  inAttr: string,
): string {
  const values = filter.matrix
    .map((v, i) => {
      // Every 5th value (index 4, 9, 14, 19) is the offset, which needs to be divided by 255
      if (i % 5 === 4) {
        return v / 255;
      }
      return v;
    })
    .join(' ');

  return builder.addResultFilter('feColorMatrix', inAttr, {
    type: 'matrix',
    values,
    'color-interpolation-filters': 'sRGB',
  });
}

