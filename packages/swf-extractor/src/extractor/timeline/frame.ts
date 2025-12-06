import type { Matrix } from '@/parser/structure/record/matrix.ts';
import type { ColorTransform } from '@/parser/structure/record/color.ts';
import type { Rectangle } from '@/parser/structure/record/rectangle.ts';
import type { Drawable } from '@/extractor/drawable.ts';
import type { Drawer } from '@/extractor/drawer/drawer-interface.ts';
import { BlendMode } from './blend-mode.ts';
import type { Filter } from '@/parser/structure/record/filter/index.ts';
import type { DoAction } from '@/parser/structure/tag/do-action.ts';
import { type MorphShapeDefinition, createMorphShapeAtRatio } from '@/extractor/shape/morph-shape-definition.ts';

/**
 * An object placed on a frame at a specific depth.
 */
export interface FrameObject {
  /** Character ID of the placed object */
  readonly characterId: number;
  /** Depth in the display list */
  readonly depth: number;
  /** The drawable object */
  readonly object: Drawable;
  /** Bounds after matrix transformation */
  readonly bounds: Rectangle;
  /** Transform matrix */
  readonly matrix: Matrix;
  /** Color transform from PlaceObject tag */
  readonly colorTransform?: ColorTransform;
  /** Instance name */
  readonly name?: string;
  /** Clip depth for masking */
  readonly clipDepth?: number;
  /** Morph ratio for morph shapes (0-65535) */
  readonly ratio?: number;
  /** Filters applied to this object */
  readonly filters: readonly Filter[];
  /** Blend mode */
  readonly blendMode: BlendMode;
  /** Frame when this object was first placed */
  readonly startFrame: number;
  /**
   * Color transformations accumulated from parent sprites.
   * Applied after colorTransform, in order.
   * This is filled by Timeline.transformColors() for lazy application.
   */
  readonly colorTransforms?: readonly ColorTransform[];
}

/**
 * A single frame in the timeline.
 */
export interface Frame {
  /** Frame index (0-based) */
  readonly index: number;
  /** Frame label (if any) */
  readonly label?: string;
  /** Bounds of the frame */
  readonly bounds: Rectangle;
  /** Objects placed on this frame, sorted by depth */
  readonly objects: readonly FrameObject[];
  /** ActionScript actions for this frame */
  readonly actions: readonly DoAction[];
}

/**
 * Create a copy of a frame object with updated properties.
 */
export function mergeFrameObject(
  existing: FrameObject,
  update: Partial<Omit<FrameObject, 'depth'>>,
): FrameObject {
  return {
    characterId: update.characterId ?? existing.characterId,
    depth: existing.depth,
    object: update.object ?? existing.object,
    bounds: update.bounds ?? existing.bounds,
    matrix: update.matrix ?? existing.matrix,
    colorTransform: update.colorTransform ?? existing.colorTransform,
    name: update.name ?? existing.name,
    clipDepth: update.clipDepth ?? existing.clipDepth,
    ratio: update.ratio ?? existing.ratio,
    filters: update.filters ?? existing.filters,
    blendMode: update.blendMode ?? existing.blendMode,
    startFrame: update.startFrame ?? existing.startFrame,
    colorTransforms: update.colorTransforms ?? existing.colorTransforms,
  };
}

/**
 * Compute the relative frame for nested sprite animation.
 * Uses global frame with modulo to match Flash Player behavior.
 */
export function computeRelativeFrame(object: FrameObject, globalFrame: number): number {
  const objectFrameCount = object.object.framesCount(false);
  if (objectFrameCount <= 1) {
    return 0;
  }
  return globalFrame % objectFrameCount;
}

/**
 * Check if object is a MorphShapeDefinition.
 */
function isMorphShapeDefinition(obj: Drawable): obj is MorphShapeDefinition {
  return 'pathsAtRatio' in obj && 'boundsAtRatio' in obj && 'tag' in obj;
}

/**
 * Get a transformed drawable with color transform applied.
 * Also handles morph shapes by applying the ratio.
 *
 * Color transforms are applied in order:
 * 1. First the colorTransform from PlaceObject tag
 * 2. Then each transform in colorTransforms array (from parent sprites)
 *
 * This matches PHP's FrameObject::object() method behavior.
 */
export function getTransformedObject(object: FrameObject): Drawable {
  let drawable: Drawable = object.object;

  // For morph shapes, get the shape at the correct ratio
  if (isMorphShapeDefinition(drawable) && object.ratio !== undefined) {
    // Ratio is 0-65535, convert to 0.0-1.0
    const ratioFloat = object.ratio / 65535.0;
    drawable = createMorphShapeAtRatio(drawable, ratioFloat);
  }

  // Apply the colorTransform from PlaceObject tag first
  if (object.colorTransform) {
    drawable = drawable.transformColors(object.colorTransform);
  }

  // Apply each color transformation from parent sprites
  // Note: it's not possible to create a single composite color transformation
  // because of clamping values to [0-255] after each transformation
  if (object.colorTransforms) {
    for (const transform of object.colorTransforms) {
      drawable = drawable.transformColors(transform);
    }
  }

  return drawable;
}

/**
 * Draw a frame to a drawer.
 */
export function drawFrame(frame: Frame, drawer: Drawer, globalFrame: number = 0): void {
  drawer.area(frame.bounds);

  // Map of active clip ids. Key is the clip id, value is the clip depth.
  const activeClips = new Map<string, number>();

  for (const object of frame.objects) {
    const relativeFrame = computeRelativeFrame(object, globalFrame);

    // Handle clipping masks
    if (object.clipDepth !== undefined) {
      const clipId = drawer.startClip(object.object, object.matrix, relativeFrame);
      activeClips.set(clipId, object.clipDepth);
      continue;
    }

    // End clips that are no longer active
    for (const [clipId, clipDepth] of activeClips) {
      if (clipDepth < object.depth) {
        drawer.endClip(clipId);
        activeClips.delete(clipId);
      }
    }

    // Draw the object
    drawer.include(
      getTransformedObject(object),
      object.matrix,
      relativeFrame,
      object.filters,
      object.blendMode,
      object.name,
    );
  }
}

