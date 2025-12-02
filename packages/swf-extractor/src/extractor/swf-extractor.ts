import type { Swf } from '@/parser/swf.ts';
import { TagType } from '@/parser/structure/tag-types.ts';
import { type DefineShape, readDefineShape1, readDefineShape2, readDefineShape3, readDefineShape4 } from '@/parser/structure/tag/define-shape.ts';
import { readDefineSprite } from '@/parser/structure/tag/define-sprite.ts';
import { readDefineBitsJpeg2, readDefineBitsJpeg3, readDefineBitsJpeg4, readDefineBitsLossless, readDefineBitsLossless2 } from '@/parser/structure/tag/define-bits.ts';
import { readDefineMorphShape, readDefineMorphShape2 } from '@/parser/structure/tag/define-morph-shape.ts';
import { type ExportedAsset, readExportAssets } from '@/parser/structure/tag/export-assets.ts';
import { type ShapeDefinition, createShapeDefinition } from './shape/shape-definition.ts';
import { type MorphShapeDefinition, createMorphShapeDefinition } from './shape/morph-shape-definition.ts';
import { type SpriteDefinition, createSpriteDefinition } from './sprite/sprite-definition.ts';
import { type ImageDefinition, extractJpeg2, extractJpeg3, extractJpeg4 } from './image/image-definition.ts';
import { extractLossless } from './image/lossless-image.ts';
import { ImageCharacterDefinition } from './image/image-character.ts';
import type { Drawable } from './drawable.ts';
import { Timeline } from './timeline/timeline.ts';
import { TimelineProcessor } from './timeline/timeline-processor.ts';

/**
 * Extracted character types.
 */
export type CharacterType = 'shape' | 'sprite' | 'image' | 'morph';

/**
 * SWF resource extractor.
 */
export class SwfExtractor {
  private readonly swf: Swf;
  private readonly shapeCache: Map<number, ShapeDefinition> = new Map();
  private readonly spriteCache: Map<number, SpriteDefinition> = new Map();
  private readonly morphShapeCache: Map<number, MorphShapeDefinition> = new Map();
  private readonly imageCache: Map<number, Promise<ImageDefinition>> = new Map();
  private readonly timelineProcessor: TimelineProcessor;

  constructor(swf: Swf) {
    this.swf = swf;
    this.timelineProcessor = new TimelineProcessor(this);
  }

  /**
   * Get the type of a character.
   */
  getCharacterType(id: number): CharacterType | null {
    const tag = this.swf.getCharacter(id);
    if (!tag) return null;

    switch (tag.type) {
      case TagType.DefineShape:
      case TagType.DefineShape2:
      case TagType.DefineShape3:
      case TagType.DefineShape4:
        return 'shape';

      case TagType.DefineSprite:
        return 'sprite';

      case TagType.DefineBits:
      case TagType.DefineBitsJPEG2:
      case TagType.DefineBitsJPEG3:
      case TagType.DefineBitsJPEG4:
      case TagType.DefineBitsLossless:
      case TagType.DefineBitsLossless2:
        return 'image';

      case TagType.DefineMorphShape:
      case TagType.DefineMorphShape2:
        return 'morph';

      default:
        return null;
    }
  }

  /**
   * Get all shape IDs.
   */
  *shapes(): Generator<number> {
    for (const tag of this.swf.tags) {
      if (
        tag.type === TagType.DefineShape ||
        tag.type === TagType.DefineShape2 ||
        tag.type === TagType.DefineShape3 ||
        tag.type === TagType.DefineShape4
      ) {
        yield tag.id!;
      }
    }
  }

  /**
   * Get all sprite IDs.
   */
  *sprites(): Generator<number> {
    for (const tag of this.swf.tags) {
      if (tag.type === TagType.DefineSprite) {
        yield tag.id!;
      }
    }
  }

  /**
   * Get all image IDs.
   */
  *images(): Generator<number> {
    for (const tag of this.swf.tags) {
      if (
        tag.type === TagType.DefineBitsJPEG2 ||
        tag.type === TagType.DefineBitsJPEG3 ||
        tag.type === TagType.DefineBitsJPEG4 ||
        tag.type === TagType.DefineBitsLossless ||
        tag.type === TagType.DefineBitsLossless2
      ) {
        yield tag.id!;
      }
    }
  }

  /**
   * Get all morph shape IDs.
   */
  *morphShapes(): Generator<number> {
    for (const tag of this.swf.tags) {
      if (tag.type === TagType.DefineMorphShape || tag.type === TagType.DefineMorphShape2) {
        yield tag.id!;
      }
    }
  }

  /**
   * Get exported assets.
   */
  *exported(): Generator<ExportedAsset> {
    for (const tag of this.swf.getTagsByType(TagType.ExportAssets)) {
      const reader = this.swf.getTagReader(tag);
      const { assets } = readExportAssets(reader);
      yield* assets;
    }
  }

  /**
   * Get a shape by ID.
   */
  getShape(id: number): ShapeDefinition | null {
    if (this.shapeCache.has(id)) {
      return this.shapeCache.get(id)!;
    }

    const tag = this.swf.getCharacter(id);
    if (!tag) return null;

    const reader = this.swf.getTagReader(tag);
    let shape: DefineShape;

    switch (tag.type) {
      case TagType.DefineShape:
        shape = readDefineShape1(reader);
        break;
      case TagType.DefineShape2:
        shape = readDefineShape2(reader);
        break;
      case TagType.DefineShape3:
        shape = readDefineShape3(reader);
        break;
      case TagType.DefineShape4:
        shape = readDefineShape4(reader);
        break;
      default:
        return null;
    }

    const definition = createShapeDefinition(shape);
    this.shapeCache.set(id, definition);
    return definition;
  }

  /**
   * Get an image by ID.
   */
  async getImage(id: number): Promise<ImageDefinition | null> {
    if (this.imageCache.has(id)) {
      return this.imageCache.get(id)!;
    }

    const tag = this.swf.getCharacter(id);
    if (!tag) return null;

    const reader = this.swf.getTagReader(tag);
    let promise: Promise<ImageDefinition>;

    switch (tag.type) {
      case TagType.DefineBitsJPEG2:
        promise = Promise.resolve(extractJpeg2(readDefineBitsJpeg2(reader)));
        break;
      case TagType.DefineBitsJPEG3:
        promise = extractJpeg3(readDefineBitsJpeg3(reader));
        break;
      case TagType.DefineBitsJPEG4:
        promise = extractJpeg4(readDefineBitsJpeg4(reader));
        break;
      case TagType.DefineBitsLossless:
        promise = extractLossless(readDefineBitsLossless(reader), false);
        break;
      case TagType.DefineBitsLossless2:
        promise = extractLossless(readDefineBitsLossless2(reader), true);
        break;
      default:
        return null;
    }

    this.imageCache.set(id, promise);
    return promise;
  }

  /**
   * Get an image character by ID (as a Drawable).
   */
  async getImageCharacter(id: number): Promise<ImageCharacterDefinition | null> {
    const image = await this.getImage(id);
    if (!image) return null;
    return new ImageCharacterDefinition(image);
  }

  /**
   * Get a sprite by ID.
   */
  getSprite(id: number): SpriteDefinition | null {
    if (this.spriteCache.has(id)) {
      return this.spriteCache.get(id)!;
    }

    const tag = this.swf.getCharacter(id);
    if (!tag || tag.type !== TagType.DefineSprite) return null;

    const reader = this.swf.getTagReader(tag);
    const sprite = readDefineSprite(reader);

    const definition = createSpriteDefinition(
      this.timelineProcessor,
      id,
      sprite,
      this.swf,
    );
    this.spriteCache.set(id, definition);
    return definition;
  }

  /**
   * Get a morph shape by ID.
   */
  getMorphShape(id: number): MorphShapeDefinition | null {
    if (this.morphShapeCache.has(id)) {
      return this.morphShapeCache.get(id)!;
    }

    const tag = this.swf.getCharacter(id);
    if (!tag) return null;

    const reader = this.swf.getTagReader(tag);
    let morphShape;

    switch (tag.type) {
      case TagType.DefineMorphShape:
        morphShape = readDefineMorphShape(reader);
        break;
      case TagType.DefineMorphShape2:
        morphShape = readDefineMorphShape2(reader);
        break;
      default:
        return null;
    }

    const definition = createMorphShapeDefinition(id, morphShape);
    this.morphShapeCache.set(id, definition);
    return definition;
  }

  /**
   * Get a drawable by character ID.
   * Returns shapes, sprites, images, or morph shapes as Drawable.
   */
  getDrawable(id: number): Drawable | null {
    // Try shape first (most common)
    const shape = this.getShape(id);
    if (shape) return shape;

    // Try sprite
    const sprite = this.getSprite(id);
    if (sprite) return sprite;

    // Try morph shape
    const morphShape = this.getMorphShape(id);
    if (morphShape) return morphShape;

    // Note: Images are async, so they can't be returned from this sync method
    // Use getImageAsync() for image characters
    return null;
  }

  /**
   * Get the root SWF timeline.
   */
  getTimeline(): Timeline {
    const { frames, bounds } = this.timelineProcessor.process(this.swf.tags, this.swf);
    return new Timeline(bounds, frames);
  }

  /**
   * Clear caches to free memory.
   */
  clearCaches(): void {
    this.shapeCache.clear();
    this.spriteCache.clear();
    this.morphShapeCache.clear();
    this.imageCache.clear();
  }
}

