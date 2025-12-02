import type { SwfReader } from '@/parser/swf-reader.ts';
import type { Rgba } from '@/parser/structure/record/color.ts';
import { readRgba } from '@/parser/structure/record/color.ts';

export const GRADIENT_BEVEL_FILTER_ID = 7;

/**
 * Gradient bevel filter.
 */
export interface GradientBevelFilter {
  readonly type: typeof GRADIENT_BEVEL_FILTER_ID;
  readonly numColors: number;
  readonly gradientColors: readonly Rgba[];
  readonly gradientRatio: readonly number[];
  readonly blurX: number;
  readonly blurY: number;
  readonly angle: number;
  readonly distance: number;
  readonly strength: number;
  readonly innerShadow: boolean;
  readonly knockout: boolean;
  readonly compositeSource: boolean;
  readonly onTop: boolean;
  readonly passes: number;
}

/**
 * Read a gradient bevel filter from the reader.
 */
export function readGradientBevelFilter(reader: SwfReader): GradientBevelFilter {
  const numColors = reader.readUI8();
  const gradientColors: Rgba[] = [];
  const gradientRatio: number[] = [];

  for (let i = 0; i < numColors; i++) {
    gradientColors.push(readRgba(reader));
  }

  for (let i = 0; i < numColors; i++) {
    gradientRatio.push(reader.readUI8());
  }

  const blurX = reader.readFixed();
  const blurY = reader.readFixed();
  const angle = reader.readFixed();
  const distance = reader.readFixed();
  const strength = reader.readFixed8();
  const innerShadow = reader.readBool();
  const knockout = reader.readBool();
  const compositeSource = reader.readBool();
  const onTop = reader.readBool();
  const passes = reader.readUB(4);

  return {
    type: GRADIENT_BEVEL_FILTER_ID,
    numColors,
    gradientColors,
    gradientRatio,
    blurX,
    blurY,
    angle,
    distance,
    strength,
    innerShadow,
    knockout,
    compositeSource,
    onTop,
    passes,
  };
}

