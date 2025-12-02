import type { SwfReader } from '@/parser/swf-reader.ts';

export const COLOR_MATRIX_FILTER_ID = 6;

/**
 * Color matrix filter.
 * The matrix has 20 elements (4x5 matrix for RGBA transformation).
 */
export interface ColorMatrixFilter {
  readonly type: typeof COLOR_MATRIX_FILTER_ID;
  readonly matrix: readonly number[];
}

/**
 * Read a color matrix filter from the reader.
 */
export function readColorMatrixFilter(reader: SwfReader): ColorMatrixFilter {
  const matrix: number[] = [];

  for (let i = 0; i < 20; i++) {
    matrix.push(reader.readFloat());
  }

  return {
    type: COLOR_MATRIX_FILTER_ID,
    matrix,
  };
}

