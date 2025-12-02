import type { SwfReader } from '@/parser/swf-reader.ts';
import type { Rgba } from '@/parser/structure/record/color.ts';
import { readRgba } from '@/parser/structure/record/color.ts';

export const CONVOLUTION_FILTER_ID = 5;

/**
 * Convolution filter.
 */
export interface ConvolutionFilter {
  readonly type: typeof CONVOLUTION_FILTER_ID;
  readonly matrixX: number;
  readonly matrixY: number;
  readonly divisor: number;
  readonly bias: number;
  readonly matrix: readonly number[];
  readonly defaultColor: Rgba;
  readonly clamp: boolean;
  readonly preserveAlpha: boolean;
}

/**
 * Read a convolution filter from the reader.
 */
export function readConvolutionFilter(reader: SwfReader): ConvolutionFilter {
  const matrixX = reader.readUI8();
  const matrixY = reader.readUI8();
  const divisor = reader.readFloat();
  const bias = reader.readFloat();
  const matrix: number[] = [];

  for (let i = 0; i < matrixX * matrixY; i++) {
    matrix.push(reader.readFloat());
  }

  const defaultColor = readRgba(reader);
  const flags = reader.readUI8();
  // 6 bits reserved (should be 0)
  const clamp = (flags & 0b00000010) !== 0;
  const preserveAlpha = (flags & 0b00000001) !== 0;

  return {
    type: CONVOLUTION_FILTER_ID,
    matrixX,
    matrixY,
    divisor,
    bias,
    matrix,
    defaultColor,
    clamp,
    preserveAlpha,
  };
}

