import type { Rectangle } from '@/parser/structure/record/rectangle.ts';
import type { ColorTransform } from '@/parser/structure/record/color.ts';
import type { Drawer } from '@/extractor/drawer/drawer-interface.ts';

/**
 * Interface for drawable objects (shapes, sprites, images).
 */
export interface Drawable {
  /**
   * Get the bounding rectangle in twips.
   */
  bounds(): Rectangle;

  /**
   * Get the number of frames.
   * @param recursive If true, include nested sprite frames.
   */
  framesCount(recursive?: boolean): number;

  /**
   * Draw the current character to the drawer.
   * @param drawer The drawer to use.
   * @param frame The frame to draw (0-based).
   */
  draw(drawer: Drawer, frame?: number): void;

  /**
   * Apply color transformation and return a new drawable.
   */
  transformColors(colorTransform: ColorTransform): Drawable;
}

/**
 * Create an empty rectangle.
 */
export function emptyRectangle(): Rectangle {
  return { xMin: 0, xMax: 0, yMin: 0, yMax: 0 };
}

/**
 * Get rectangle width in twips.
 */
export function rectangleWidth(rect: Rectangle): number {
  return rect.xMax - rect.xMin;
}

/**
 * Get rectangle height in twips.
 */
export function rectangleHeight(rect: Rectangle): number {
  return rect.yMax - rect.yMin;
}

/**
 * Transform a rectangle by a matrix.
 */
export function transformRectangle(
  rect: Rectangle,
  matrix: { scaleX: number; scaleY: number; rotateSkew0: number; rotateSkew1: number; translateX: number; translateY: number },
): Rectangle {
  // Get the four corners
  const x1 = rect.xMin;
  const y1 = rect.yMin;
  const x2 = rect.xMax;
  const y2 = rect.yMax;

  // Transform all four corners
  const corners = [
    transformPoint(x1, y1, matrix),
    transformPoint(x2, y1, matrix),
    transformPoint(x1, y2, matrix),
    transformPoint(x2, y2, matrix),
  ];

  // Find bounding box
  const first = corners[0]!;
  let xMin = first.x;
  let xMax = first.x;
  let yMin = first.y;
  let yMax = first.y;

  for (const corner of corners) {
    if (corner.x < xMin) xMin = corner.x;
    if (corner.x > xMax) xMax = corner.x;
    if (corner.y < yMin) yMin = corner.y;
    if (corner.y > yMax) yMax = corner.y;
  }

  return { xMin, xMax, yMin, yMax };
}

function transformPoint(
  x: number,
  y: number,
  matrix: { scaleX: number; scaleY: number; rotateSkew0: number; rotateSkew1: number; translateX: number; translateY: number },
): { x: number; y: number } {
  // Round to match PHP behavior - transformX and transformY return int
  return {
    x: Math.round(x * matrix.scaleX + y * matrix.rotateSkew1 + matrix.translateX),
    y: Math.round(x * matrix.rotateSkew0 + y * matrix.scaleY + matrix.translateY),
  };
}

