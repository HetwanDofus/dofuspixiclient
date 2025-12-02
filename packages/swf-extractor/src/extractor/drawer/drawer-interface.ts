import type { Rectangle } from '@/parser/structure/record/rectangle.ts';
import type { Matrix } from '@/parser/structure/record/matrix.ts';
import type { Drawable } from '@/extractor/drawable.ts';
import type { ShapePath } from '@/extractor/shape/path.ts';
import type { BlendMode } from '@/extractor/timeline/blend-mode.ts';
import type { Filter } from '@/parser/structure/record/filter/filter.ts';

/**
 * Shape with offset for drawing.
 */
export interface Shape {
  readonly xOffset: number;
  readonly yOffset: number;
  readonly paths: readonly ShapePath[];
}

/**
 * Image character interface for drawing.
 */
export interface ImageCharacter {
  bounds(): Rectangle;
  toBase64Data(): string;
}

/**
 * Base interface for drawing SWF shapes or sprites.
 */
export interface Drawer {
  /**
   * Start a new drawing area.
   */
  area(bounds: Rectangle): void;

  /**
   * Draw a shape.
   */
  shape(shape: Shape): void;

  /**
   * Draw a raster image.
   */
  image(image: ImageCharacter): void;

  /**
   * Include a sprite or shape in the current drawing.
   */
  include(
    object: Drawable,
    matrix: Matrix,
    frame?: number,
    filters?: readonly Filter[],
    blendMode?: BlendMode,
    name?: string | null,
  ): void;

  /**
   * Use the given object as a clipping mask.
   * Returns an id that can be used to end the clip later.
   */
  startClip(object: Drawable, matrix: Matrix, frame: number): string;

  /**
   * Stop the given clipping mask.
   */
  endClip(clipId: string): void;

  /**
   * Draw a path.
   */
  path(path: ShapePath): void;

  /**
   * Render the drawing.
   */
  render(): string;
}

