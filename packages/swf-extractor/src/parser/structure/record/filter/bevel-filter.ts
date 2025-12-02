import type { SwfReader } from '@/parser/swf-reader.ts';
import type { Rgba } from '@/parser/structure/record/color.ts';
import { readRgba } from '@/parser/structure/record/color.ts';

export const BEVEL_FILTER_ID = 3;

/**
 * Bevel filter.
 */
export interface BevelFilter {
  readonly type: typeof BEVEL_FILTER_ID;
  /**
   * Note: The documentation seems to be incorrect, highlightColor is before shadowColor
   */
  readonly highlightColor: Rgba;
  readonly shadowColor: Rgba;
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
 * Read a bevel filter from the reader.
 */
export function readBevelFilter(reader: SwfReader): BevelFilter {
  const highlightColor = readRgba(reader);
  const shadowColor = readRgba(reader);
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
    type: BEVEL_FILTER_ID,
    highlightColor,
    shadowColor,
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

