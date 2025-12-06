import type { Rectangle } from '@/parser/structure/record/rectangle.ts';
import type { ColorTransform } from '@/parser/structure/record/color.ts';
import type { DefineSprite } from '@/parser/structure/tag/define-sprite.ts';
import type { Drawable } from '@/extractor/drawable.ts';
import type { Drawer } from '@/extractor/drawer/drawer-interface.ts';
import type { Timeline } from '@/extractor/timeline/timeline.ts';
import type { TimelineProcessor } from '@/extractor/timeline/timeline-processor.ts';
import type { Swf } from '@/parser/swf.ts';

/**
 * Sprite definition that wraps a DefineSprite tag.
 * Implements Drawable interface for rendering.
 */
export interface SpriteDefinition extends Drawable {
  readonly id: number;
  readonly tag: DefineSprite;
  timeline(): Timeline;
}

/**
 * Create a transformed sprite definition with a pre-computed timeline.
 * This is used when applying color transforms to sprites.
 */
function createTransformedSprite(
  id: number,
  tag: DefineSprite,
  timeline: Timeline,
): SpriteDefinition {
  return {
    id,
    tag,
    timeline: () => timeline,
    bounds(): Rectangle {
      return timeline.bounds;
    },
    framesCount(recursive?: boolean): number {
      return timeline.framesCount(recursive);
    },
    draw(drawer: Drawer, frame?: number): void {
      timeline.draw(drawer, frame ?? 0);
    },
    transformColors(colorTransform: ColorTransform): SpriteDefinition {
      const transformed = timeline.transformColors(colorTransform);
      // Recursively create a new transformed sprite
      return createTransformedSprite(id, tag, transformed);
    },
  };
}

/**
 * Create a sprite definition from a DefineSprite tag.
 * The timeline is processed lazily on first access.
 */
export function createSpriteDefinition(
  processor: TimelineProcessor,
  id: number,
  tag: DefineSprite,
  swf: Swf,
): SpriteDefinition {
  let cachedTimeline: Timeline | null = null;
  let processing = false;

  const getTimeline = (): Timeline => {
    if (cachedTimeline) {
      return cachedTimeline;
    }

    // Detect circular references
    if (processing) {
      // Return empty timeline to break the cycle
      const { Timeline } = require('@/extractor/timeline/timeline.ts');
      return Timeline.empty();
    }

    processing = true;
    try {
      const { frames, bounds } = processor.process(tag.controlTags, swf);
      const { Timeline } = require('@/extractor/timeline/timeline.ts');
      cachedTimeline = new Timeline(bounds, frames);
    } finally {
      processing = false;
    }

    return cachedTimeline!;
  };

  return {
    id,
    tag,
    timeline: getTimeline,
    bounds(): Rectangle {
      return getTimeline().bounds;
    },
    framesCount(recursive?: boolean): number {
      return getTimeline().framesCount(recursive);
    },
    draw(drawer: Drawer, frame?: number): void {
      getTimeline().draw(drawer, frame ?? 0);
    },
    transformColors(colorTransform: ColorTransform): SpriteDefinition {
      const transformed = getTimeline().transformColors(colorTransform);
      // Return a new sprite definition with the transformed timeline
      // Use a helper function to create the transformed sprite so that
      // chained transformColors calls work correctly
      return createTransformedSprite(id, tag, transformed);
    },
  };
}

