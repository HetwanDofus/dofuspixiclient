import type { SwfReader } from '@/parser/swf-reader.ts';
import { match } from 'ts-pattern';
import { readDropShadowFilter, type DropShadowFilter, DROP_SHADOW_FILTER_ID } from './drop-shadow-filter.ts';
import { readBlurFilter, type BlurFilter, BLUR_FILTER_ID } from './blur-filter.ts';
import { readGlowFilter, type GlowFilter, GLOW_FILTER_ID } from './glow-filter.ts';
import { readBevelFilter, type BevelFilter, BEVEL_FILTER_ID } from './bevel-filter.ts';
import { readGradientGlowFilter, type GradientGlowFilter, GRADIENT_GLOW_FILTER_ID } from './gradient-glow-filter.ts';
import { readConvolutionFilter, type ConvolutionFilter, CONVOLUTION_FILTER_ID } from './convolution-filter.ts';
import { readColorMatrixFilter, type ColorMatrixFilter, COLOR_MATRIX_FILTER_ID } from './color-matrix-filter.ts';
import { readGradientBevelFilter, type GradientBevelFilter, GRADIENT_BEVEL_FILTER_ID } from './gradient-bevel-filter.ts';

/**
 * Union of all filter types.
 */
export type Filter =
  | DropShadowFilter
  | BlurFilter
  | GlowFilter
  | BevelFilter
  | GradientGlowFilter
  | ConvolutionFilter
  | ColorMatrixFilter
  | GradientBevelFilter;

/**
 * Read a collection of filters from the SWF reader.
 * The collection size is provided by the first byte.
 */
export function readFilterList(reader: SwfReader): Filter[] {
  const count = reader.readUI8();
  const filters: Filter[] = [];
  const end = reader.end;

  for (let i = 0; i < count && reader.offset < end; i++) {
    const filterId = reader.readUI8();
    const filter = readFilter(reader, filterId);
    if (filter !== null) {
      filters.push(filter);
    }
  }

  return filters;
}

/**
 * Read a single filter based on its ID.
 */
function readFilter(reader: SwfReader, filterId: number): Filter | null {
  return match(filterId)
    .with(DROP_SHADOW_FILTER_ID, () => readDropShadowFilter(reader))
    .with(BLUR_FILTER_ID, () => readBlurFilter(reader))
    .with(GLOW_FILTER_ID, () => readGlowFilter(reader))
    .with(BEVEL_FILTER_ID, () => readBevelFilter(reader))
    .with(GRADIENT_GLOW_FILTER_ID, () => readGradientGlowFilter(reader))
    .with(CONVOLUTION_FILTER_ID, () => readConvolutionFilter(reader))
    .with(COLOR_MATRIX_FILTER_ID, () => readColorMatrixFilter(reader))
    .with(GRADIENT_BEVEL_FILTER_ID, () => readGradientBevelFilter(reader))
    .otherwise(() => null);
}

// Re-export all filter types
export type { DropShadowFilter } from './drop-shadow-filter.ts';
export type { BlurFilter } from './blur-filter.ts';
export type { GlowFilter } from './glow-filter.ts';
export type { BevelFilter } from './bevel-filter.ts';
export type { GradientGlowFilter } from './gradient-glow-filter.ts';
export type { ConvolutionFilter } from './convolution-filter.ts';
export type { ColorMatrixFilter } from './color-matrix-filter.ts';
export type { GradientBevelFilter } from './gradient-bevel-filter.ts';

