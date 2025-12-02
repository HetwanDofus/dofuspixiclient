import type { SwfReader } from '@/parser/swf-reader.ts';
import type { Rgba } from '@/parser/structure/record/color.ts';
import { readRgba } from '@/parser/structure/record/color.ts';

export const DROP_SHADOW_FILTER_ID = 0;

/**
 * Drop shadow filter.
 */
export interface DropShadowFilter {
  readonly type: typeof DROP_SHADOW_FILTER_ID;
  readonly dropShadowColor: Rgba;
  readonly blurX: number;
  readonly blurY: number;
  readonly angle: number;
  readonly distance: number;
  readonly strength: number;
  readonly innerShadow: boolean;
  readonly knockout: boolean;
  readonly compositeSource: boolean;
  readonly passes: number;
}

/**
 * Read a drop shadow filter from the reader.
 */
export function readDropShadowFilter(reader: SwfReader): DropShadowFilter {
  const dropShadowColor = readRgba(reader);
  const blurX = reader.readFixed();
  const blurY = reader.readFixed();
  const angle = reader.readFixed();
  const distance = reader.readFixed();
  const strength = reader.readFixed8();
  const innerShadow = reader.readBool();
  const knockout = reader.readBool();
  const compositeSource = reader.readBool();
  const passes = reader.readUB(5);

  return {
    type: DROP_SHADOW_FILTER_ID,
    dropShadowColor,
    blurX,
    blurY,
    angle,
    distance,
    strength,
    innerShadow,
    knockout,
    compositeSource,
    passes,
  };
}

