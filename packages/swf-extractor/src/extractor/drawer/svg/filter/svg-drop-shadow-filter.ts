/**
 * SVG drop shadow filter implementation.
 */

import type { Rgba } from '@/parser/structure/record/color';
import type { DropShadowFilter } from '@/parser/structure/record/filter/drop-shadow-filter';
import type { SvgFilterBuilder } from './svg-filter-builder';
import { blur } from './svg-blur-filter';

/**
 * Apply the drop shadow effect to the given filter builder.
 */
export function applyDropShadowFilter(
  builder: SvgFilterBuilder,
  filter: DropShadowFilter,
  inAttr: string,
): string {
  if (filter.innerShadow) {
    // Inner shadow is not supported
    return inAttr;
  }

  return outerDropShadow(
    builder,
    filter.dropShadowColor,
    filter.distance,
    filter.angle,
    filter.strength,
    filter.blurX,
    filter.blurY,
    filter.passes,
    filter.knockout,
    inAttr,
  );
}

export function outerDropShadow(
  builder: SvgFilterBuilder,
  color: Rgba,
  distance: number,
  angle: number,
  strength: number,
  blurX: number,
  blurY: number,
  passes: number,
  knockout: boolean,
  inAttr: string,
): string {
  const dx = distance * Math.cos(angle);
  const dy = distance * Math.sin(angle);

  let resultId = inAttr;

  if (dx !== 0 || dy !== 0) {
    resultId = builder.addResultFilter('feOffset', inAttr, {
      dx: String(dx),
      dy: String(dy),
    });
  }

  // Create the shadow color
  const opacity = color.a / 255;
  resultId = builder.addResultFilter('feColorMatrix', resultId, {
    type: 'matrix',
    values: [
      `0 0 0 0 ${color.r / 255}`,
      `0 0 0 0 ${color.g / 255}`,
      `0 0 0 0 ${color.b / 255}`,
      `0 0 0 ${opacity * strength} 0`,
    ].join(' '),
  });

  // Apply a blur on the shadow color
  resultId = blur(builder, blurX, blurY, passes, resultId);

  if (knockout) {
    return resultId;
  }

  // Merge the shadow with the original shape
  return builder.addCompositeFilter('feMerge', {}, [
    `<feMergeNode in="${resultId}"/>`,
    `<feMergeNode in="${inAttr}"/>`,
  ]);
}

