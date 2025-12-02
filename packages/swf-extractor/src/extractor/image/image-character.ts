import type { Rectangle } from '@/parser/structure/record/rectangle.ts';
import type { ColorTransform } from '@/parser/structure/record/color.ts';
import type { Drawable } from '@/extractor/drawable.ts';
import type { Drawer, ImageCharacter } from '@/extractor/drawer/drawer-interface.ts';
import type { ImageDefinition } from './image-definition.ts';

/**
 * Image character that implements both Drawable and ImageCharacter interfaces.
 * This allows images to be used in the timeline and drawn to SVG.
 */
export class ImageCharacterDefinition implements Drawable, ImageCharacter {
  readonly id: number;
  private readonly definition: ImageDefinition;
  private base64Cache: string | null = null;

  constructor(definition: ImageDefinition) {
    this.id = definition.id;
    this.definition = definition;
  }

  bounds(): Rectangle {
    // Images have no offset, bounds are (0, 0, width, height) in twips
    return {
      xMin: 0,
      xMax: this.definition.width * 20,
      yMin: 0,
      yMax: this.definition.height * 20,
    };
  }

  framesCount(_recursive?: boolean): number {
    return 1;
  }

  draw(drawer: Drawer, _frame?: number): void {
    drawer.image(this);
  }

  transformColors(_colorTransform: ColorTransform): Drawable {
    // For now, return self - full implementation would apply color transform to image
    // This would require re-encoding the image with the color transform applied
    return this;
  }

  toBase64Data(): string {
    if (this.base64Cache) {
      return this.base64Cache;
    }

    const mimeType = this.definition.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const base64 = this.definition.data.toString('base64');
    this.base64Cache = `data:${mimeType};base64,${base64}`;
    return this.base64Cache;
  }

  toPng(): Buffer {
    if (this.definition.format === 'png') {
      return this.definition.data;
    }
    // Would need to convert JPEG to PNG
    throw new Error('JPEG to PNG conversion not implemented');
  }

  toJpeg(): Buffer {
    if (this.definition.format === 'jpeg') {
      return this.definition.data;
    }
    // Would need to convert PNG to JPEG
    throw new Error('PNG to JPEG conversion not implemented');
  }

  get width(): number {
    return this.definition.width;
  }

  get height(): number {
    return this.definition.height;
  }

  get format(): 'jpeg' | 'png' {
    return this.definition.format;
  }

  get data(): Buffer {
    return this.definition.data;
  }
}

