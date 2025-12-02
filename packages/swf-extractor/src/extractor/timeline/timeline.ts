import type { Rectangle } from '@/parser/structure/record/rectangle.ts';
import type { Frame, FrameObject } from './frame.ts';
import { drawFrame } from './frame.ts';
import type { Drawer } from '@/extractor/drawer/drawer-interface.ts';
import type { ColorTransform } from '@/parser/structure/record/color.ts';
import { emptyRectangle } from '@/extractor/drawable.ts';

/**
 * Timeline containing all frames.
 */
export class Timeline {
  readonly frames: readonly Frame[];
  readonly frameCount: number;
  readonly bounds: Rectangle;

  constructor(bounds: Rectangle, frames: readonly Frame[]) {
    this.bounds = bounds;
    this.frames = frames;
    this.frameCount = frames.length;
  }

  /**
   * Get frame by index.
   */
  getFrame(index: number): Frame | undefined {
    return this.frames[index];
  }

  /**
   * Get frame by label.
   */
  getFrameByLabel(label: string): Frame | undefined {
    return this.frames.find((f) => f.label === label);
  }

  /**
   * Get the number of frames.
   * @param recursive If true, include nested sprite frames.
   */
  framesCount(recursive: boolean = false): number {
    if (!recursive) {
      return this.frameCount;
    }

    // When recursive, find the maximum frame count across all frames
    let maxNestedCount = 0;
    for (const frame of this.frames) {
      const frameCount = frameFramesCount(frame, true);
      if (frameCount > maxNestedCount) {
        maxNestedCount = frameCount;
      }
    }

    return Math.max(this.frameCount, maxNestedCount);
  }

  /**
   * Draw the timeline at a specific frame.
   */
  draw(drawer: Drawer, frame: number = 0): void {
    const currentFrame = Math.min(frame, this.frameCount - 1);
    const frameData = this.frames[currentFrame];
    if (frameData) {
      drawFrame(frameData, drawer, frame);
    }
  }

  /**
   * Apply color transformation to all frames.
   */
  transformColors(colorTransform: ColorTransform): Timeline {
    const transformedFrames = this.frames.map((frame) => ({
      ...frame,
      objects: frame.objects.map((obj): FrameObject => ({
        ...obj,
        object: obj.object.transformColors(colorTransform),
      })),
    }));
    return new Timeline(this.bounds, transformedFrames);
  }

  /**
   * Create an empty timeline with no frames and size of 0x0.
   * Used as fallback when an error occurs during timeline parsing.
   */
  static empty(): Timeline {
    const emptyBounds = emptyRectangle();
    const emptyFrame: Frame = {
      index: 0,
      bounds: emptyBounds,
      objects: [],
      actions: [],
    };
    return new Timeline(emptyBounds, [emptyFrame]);
  }
}

/**
 * Get the number of frames in a frame (for recursive counting).
 */
function frameFramesCount(frame: Frame, recursive: boolean): number {
  if (!recursive) {
    return 1;
  }

  let count = 1;
  for (const object of frame.objects) {
    const objectFramesCount = object.object.framesCount(true);
    if (objectFramesCount > count) {
      count = objectFramesCount;
    }
  }

  return count;
}

