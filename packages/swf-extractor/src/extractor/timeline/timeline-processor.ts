import type { SwfTag } from '@/parser/structure/swf-tag.ts';
import type { Swf } from '@/parser/swf.ts';
import type { Rectangle } from '@/parser/structure/record/rectangle.ts';
import type { Matrix } from '@/parser/structure/record/matrix.ts';
import { translateMatrix } from '@/parser/structure/record/matrix.ts';
import type { SwfExtractor } from '@/extractor/swf-extractor.ts';
import type { Frame, FrameObject } from './frame.ts';
import { TagType } from '@/parser/structure/tag-types.ts';
import { readPlaceObject, readPlaceObject2, readPlaceObject3 } from '@/parser/structure/tag/place-object.ts';
import { type DoAction, readDoAction } from '@/parser/structure/tag/do-action.ts';
import { BlendMode, parseBlendMode } from './blend-mode.ts';
import { emptyRectangle, transformRectangle } from '@/extractor/drawable.ts';

/**
 * Maximum bounds size for a sprite (8192 pixels in twips).
 */
const MAX_BOUNDS = 163_840;

/**
 * Process timeline tags into frames.
 */
export class TimelineProcessor {
  constructor(private readonly extractor: SwfExtractor) {}

  /**
   * Process tags into a list of frames.
   */
  process(tags: readonly SwfTag[], swf: Swf): { frames: Frame[]; bounds: Rectangle } {
    const displayList = new Map<number, FrameObject>();
    const frames: Frame[] = [];
    let currentLabel: string | undefined;
    let currentActions: DoAction[] = [];
    let frameIndex = 0;

    // Bounds tracking
    let xMin = Number.MAX_SAFE_INTEGER;
    let yMin = Number.MAX_SAFE_INTEGER;
    let xMax = Number.MIN_SAFE_INTEGER;
    let yMax = Number.MIN_SAFE_INTEGER;
    let empty = true;

    for (const tag of tags) {
      if (tag.type === TagType.End) break;

      if (tag.type === TagType.ShowFrame) {
        // Sort by depth and create frame
        const sortedObjects = Array.from(displayList.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([_, obj]) => obj);

        const frameBounds = empty ? emptyRectangle() : { xMin, xMax, yMin, yMax };
        frames.push({
          index: frameIndex,
          label: currentLabel,
          bounds: frameBounds,
          objects: sortedObjects,
          actions: currentActions,
        });
        frameIndex++;
        currentLabel = undefined;
        currentActions = [];
        continue;
      }

      if (tag.type === TagType.DoAction) {
        const reader = swf.getTagReader(tag);
        currentActions.push(readDoAction(reader));
        continue;
      }

      if (tag.type === TagType.FrameLabel) {
        const reader = swf.getTagReader(tag);
        currentLabel = reader.readNullTerminatedString();
        continue;
      }

      if (tag.type === TagType.RemoveObject || tag.type === TagType.RemoveObject2) {
        const reader = swf.getTagReader(tag);
        if (tag.type === TagType.RemoveObject) {
          reader.readUI16(); // characterId
        }
        const depth = reader.readUI16();
        displayList.delete(depth);
        continue;
      }

      if (tag.type === TagType.PlaceObject || tag.type === TagType.PlaceObject2 || tag.type === TagType.PlaceObject3) {
        const reader = swf.getTagReader(tag);
        const place =
          tag.type === TagType.PlaceObject
            ? readPlaceObject(reader, tag.offset + tag.length)
            : tag.type === TagType.PlaceObject2
              ? readPlaceObject2(reader, swf.header.version)
              : readPlaceObject3(reader, swf.header.version);

        const isNewObject = !place.isMove;
        const existing = displayList.get(place.depth);

        if (isNewObject && place.characterId !== undefined) {
          // New object
          const frameObj = this.placeNewObject(place, frameIndex);
          if (frameObj) {
            displayList.set(place.depth, frameObj);
            this.updateBounds(frameObj.bounds, { xMin, xMax, yMin, yMax }, (b) => {
              xMin = b.xMin;
              xMax = b.xMax;
              yMin = b.yMin;
              yMax = b.yMax;
              empty = false;
            });
          }
        } else if (existing) {
          // Modify existing
          const modified = this.modifyObject(place, existing, frameIndex);
          displayList.set(place.depth, modified);
          this.updateBounds(modified.bounds, { xMin, xMax, yMin, yMax }, (b) => {
            xMin = b.xMin;
            xMax = b.xMax;
            yMin = b.yMin;
            yMax = b.yMax;
            empty = false;
          });
        }
      }
    }

    const spriteBounds = empty ? emptyRectangle() : { xMin, xMax, yMin, yMax };

    // Update all frames to use consistent bounds
    const finalFrames = frames.map((f) => ({
      ...f,
      bounds: spriteBounds,
    }));

    return { frames: finalFrames, bounds: spriteBounds };
  }

  private placeNewObject(
    place: { characterId?: number; depth: number; matrix?: Matrix; colorTransform?: any; clipDepth?: number; name?: string; ratio?: number; blendMode?: number; filters?: readonly any[] },
    frameIndex: number,
  ): FrameObject | null {
    if (place.characterId === undefined) return null;

    const drawable = this.extractor.getDrawable(place.characterId);
    if (!drawable) return null;

    const objectBounds = drawable.bounds();

    // Use translateMatrix to match PHP behavior (rounds translateX/Y to integers)
    const finalMatrix: Matrix = place.matrix
      ? translateMatrix(place.matrix, objectBounds.xMin, objectBounds.yMin)
      : {
          scaleX: 1,
          scaleY: 1,
          rotateSkew0: 0,
          rotateSkew1: 0,
          translateX: objectBounds.xMin,
          translateY: objectBounds.yMin,
        };

    const transformedBounds = place.matrix ? transformRectangle(objectBounds, place.matrix) : objectBounds;

    return {
      characterId: place.characterId,
      depth: place.depth,
      object: drawable,
      bounds: transformedBounds,
      matrix: finalMatrix,
      colorTransform: place.colorTransform,
      clipDepth: place.clipDepth,
      name: place.name,
      ratio: place.ratio,
      filters: place.filters ?? [],
      blendMode: parseBlendMode(place.blendMode),
      startFrame: frameIndex,
    };
  }

  private modifyObject(
    place: { characterId?: number; depth: number; matrix?: Matrix; colorTransform?: any; clipDepth?: number; name?: string; ratio?: number; blendMode?: number; filters?: readonly any[] },
    existing: FrameObject,
    frameIndex: number,
  ): FrameObject {
    // If new character ID provided, replace the object
    if (place.characterId !== undefined) {
      const drawable = this.extractor.getDrawable(place.characterId);
      if (drawable) {
        const oldBounds = existing.object.bounds();
        const newBounds = drawable.bounds();
        // Use translateMatrix to match PHP behavior (rounds translateX/Y to integers)
        const matrix = place.matrix
          ? translateMatrix(place.matrix, newBounds.xMin, newBounds.yMin)
          : {
              ...existing.matrix,
              translateX: existing.matrix.translateX - oldBounds.xMin + newBounds.xMin,
              translateY: existing.matrix.translateY - oldBounds.yMin + newBounds.yMin,
            };

        return {
          ...existing,
          characterId: place.characterId,
          object: drawable,
          bounds: transformRectangle(newBounds, place.matrix ?? existing.matrix),
          matrix,
          startFrame: frameIndex,
          colorTransform: place.colorTransform ?? existing.colorTransform,
          clipDepth: place.clipDepth ?? existing.clipDepth,
          name: place.name ?? existing.name,
          ratio: place.ratio ?? existing.ratio,
          filters: place.filters ?? existing.filters,
          blendMode: place.blendMode !== undefined ? parseBlendMode(place.blendMode) : existing.blendMode,
        };
      }
    }

    // Just modify properties
    let result = existing;

    if (place.matrix) {
      const objectBounds = existing.object.bounds();
      // Use translateMatrix to match PHP behavior (rounds translateX/Y to integers)
      result = {
        ...result,
        bounds: transformRectangle(objectBounds, place.matrix),
        matrix: translateMatrix(place.matrix, objectBounds.xMin, objectBounds.yMin),
      };
    }

    if (place.colorTransform !== undefined) {
      result = { ...result, colorTransform: place.colorTransform };
    }
    if (place.clipDepth !== undefined) {
      result = { ...result, clipDepth: place.clipDepth };
    }
    if (place.name !== undefined) {
      result = { ...result, name: place.name };
    }
    if (place.ratio !== undefined) {
      result = { ...result, ratio: place.ratio };
    }
    if (place.blendMode !== undefined) {
      result = { ...result, blendMode: parseBlendMode(place.blendMode) };
    }
    if (place.filters !== undefined) {
      result = { ...result, filters: place.filters };
    }

    return result;
  }

  private updateBounds(
    objectBounds: Rectangle,
    currentBounds: { xMin: number; xMax: number; yMin: number; yMax: number },
    update: (bounds: { xMin: number; xMax: number; yMin: number; yMax: number }) => void,
  ): void {
    // Skip objects that are too large
    const width = objectBounds.xMax - objectBounds.xMin;
    const height = objectBounds.yMax - objectBounds.yMin;
    if (width > MAX_BOUNDS || height > MAX_BOUNDS) {
      return;
    }

    // Check if adding this object would make bounds too large
    if (
      currentBounds.xMin !== Number.MAX_SAFE_INTEGER &&
      (objectBounds.xMax - currentBounds.xMin > MAX_BOUNDS ||
        objectBounds.yMax - currentBounds.yMin > MAX_BOUNDS ||
        currentBounds.xMax - objectBounds.xMin > MAX_BOUNDS ||
        currentBounds.yMax - objectBounds.yMin > MAX_BOUNDS)
    ) {
      return;
    }

    const xMin = Math.min(currentBounds.xMin, objectBounds.xMin);
    const xMax = Math.max(currentBounds.xMax, objectBounds.xMax);
    const yMin = Math.min(currentBounds.yMin, objectBounds.yMin);
    const yMax = Math.max(currentBounds.yMax, objectBounds.yMax);

    update({ xMin, xMax, yMin, yMax });
  }
}
