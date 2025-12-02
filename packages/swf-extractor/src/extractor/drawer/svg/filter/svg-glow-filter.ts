/**
 * SVG glow filter implementation.
 */

import type { Rgba } from '@/parser/structure/record/color';
import type { GlowFilter } from '@/parser/structure/record/filter/glow-filter';
import type { SvgFilterBuilder } from './svg-filter-builder';
import { outerDropShadow } from './svg-drop-shadow-filter';

/**
 * Apply the glow effect to the given filter builder.
 */
export function applyGlowFilter(
  builder: SvgFilterBuilder,
  filter: GlowFilter,
  inAttr: string,
): string {
  if (filter.innerGlow) {
    // Inner glow is not supported
    return inAttr;
  }

  return outerGlow(
    builder,
    filter.glowColor,
    filter.blurX,
    filter.blurY,
    filter.passes,
    filter.knockout,
    inAttr,
  );
}

export function outerGlow(
  builder: SvgFilterBuilder,
  color: Rgba,
  blurX: number,
  blurY: number,
  passes: number,
  knockout: boolean,
  inAttr: string,
): string {
  return outerDropShadow(
    builder,
    color,
    0, // distance
    0, // angle
    1.0, // strength
    blurX,
    blurY,
    passes,
    knockout,
    inAttr,
  );
}

