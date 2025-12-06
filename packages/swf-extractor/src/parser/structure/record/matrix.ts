import type { SwfReader } from '@/parser/swf-reader.ts';

/**
 * 2D transformation matrix.
 * | scaleX  rotateSkew0  translateX |
 * | rotateSkew1  scaleY  translateY |
 */
export interface Matrix {
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotateSkew0: number;
  readonly rotateSkew1: number;
  readonly translateX: number;
  readonly translateY: number;
}

/**
 * Identity matrix.
 */
export const IDENTITY_MATRIX: Matrix = {
  scaleX: 1,
  scaleY: 1,
  rotateSkew0: 0,
  rotateSkew1: 0,
  translateX: 0,
  translateY: 0,
};

/**
 * Read a matrix record from the reader.
 */
export function readMatrix(reader: SwfReader): Matrix {
  let scaleX = 1,
    scaleY = 1;
  let rotateSkew0 = 0,
    rotateSkew1 = 0;

  const hasScale = reader.readBool();
  if (hasScale) {
    const numBits = reader.readUB(5);
    scaleX = reader.readFB(numBits);
    scaleY = reader.readFB(numBits);
  }

  const hasRotate = reader.readBool();
  if (hasRotate) {
    const numBits = reader.readUB(5);
    rotateSkew0 = reader.readFB(numBits);
    rotateSkew1 = reader.readFB(numBits);
  }

  const translateBits = reader.readUB(5);
  const translateX = reader.readSB(translateBits);
  const translateY = reader.readSB(translateBits);

  reader.alignByte();

  return { scaleX, scaleY, rotateSkew0, rotateSkew1, translateX, translateY };
}

/**
 * Round a number to 4 decimal places, matching PHP's round($value, 4).
 */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Convert matrix to SVG transform string.
 * Note: translateX and translateY are in twips, so divide by 20 for pixels.
 * SVG matrix order is: matrix(a, b, c, d, e, f) where:
 * a = scaleX, b = rotateSkew0, c = rotateSkew1, d = scaleY, e = translateX, f = translateY
 *
 * @param matrix The matrix to convert
 * @param undoTwipScale If true, divide scale and skew values by 20 (for bitmap patterns)
 */
export function toSvgTransform(matrix: Matrix, undoTwipScale: boolean = false): string {
  let scaleX = matrix.scaleX;
  let scaleY = matrix.scaleY;
  let rotateSkew0 = matrix.rotateSkew0;
  let rotateSkew1 = matrix.rotateSkew1;

  if (undoTwipScale) {
    scaleX /= 20;
    scaleY /= 20;
    rotateSkew0 /= 20;
    rotateSkew1 /= 20;
  }

  const a = round4(scaleX);
  const b = round4(rotateSkew0);
  const c = round4(rotateSkew1);
  const d = round4(scaleY);
  const e = round4(matrix.translateX / 20);
  const f = round4(matrix.translateY / 20);

  return `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`;
}

/**
 * Multiply two matrices.
 */
export function multiplyMatrix(a: Matrix, b: Matrix): Matrix {
  return {
    scaleX: a.scaleX * b.scaleX + a.rotateSkew0 * b.rotateSkew1,
    rotateSkew0: a.scaleX * b.rotateSkew0 + a.rotateSkew0 * b.scaleY,
    rotateSkew1: a.rotateSkew1 * b.scaleX + a.scaleY * b.rotateSkew1,
    scaleY: a.rotateSkew1 * b.rotateSkew0 + a.scaleY * b.scaleY,
    translateX: a.scaleX * b.translateX + a.rotateSkew0 * b.translateY + a.translateX,
    translateY: a.rotateSkew1 * b.translateX + a.scaleY * b.translateY + a.translateY,
  };
}

/**
 * Translate a matrix by x and y offsets.
 * The result translateX and translateY are rounded to integers to match PHP behavior.
 */
export function translateMatrix(matrix: Matrix, x: number, y: number): Matrix {
  return {
    scaleX: matrix.scaleX,
    scaleY: matrix.scaleY,
    rotateSkew0: matrix.rotateSkew0,
    rotateSkew1: matrix.rotateSkew1,
    translateX: Math.round(matrix.scaleX * x + matrix.rotateSkew1 * y + matrix.translateX),
    translateY: Math.round(matrix.rotateSkew0 * x + matrix.scaleY * y + matrix.translateY),
  };
}

/**
 * Transform a point using the matrix.
 */
export function transformPoint(matrix: Matrix, x: number, y: number): { x: number; y: number } {
  return {
    x: matrix.scaleX * x + matrix.rotateSkew0 * y + matrix.translateX,
    y: matrix.rotateSkew1 * x + matrix.scaleY * y + matrix.translateY,
  };
}

