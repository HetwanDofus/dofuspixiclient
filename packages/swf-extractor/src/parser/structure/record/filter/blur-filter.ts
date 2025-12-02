import type { SwfReader } from '@/parser/swf-reader.ts';

export const BLUR_FILTER_ID = 1;

/**
 * Blur filter.
 */
export interface BlurFilter {
  readonly type: typeof BLUR_FILTER_ID;
  readonly blurX: number;
  readonly blurY: number;
  readonly passes: number;
}

/**
 * Read a blur filter from the reader.
 */
export function readBlurFilter(reader: SwfReader): BlurFilter {
  const blurX = reader.readFixed();
  const blurY = reader.readFixed();
  // 5 bits for passes, 3 bits reserved
  const passes = (reader.readUI8() >> 3) & 31;

  return {
    type: BLUR_FILTER_ID,
    blurX,
    blurY,
    passes,
  };
}

