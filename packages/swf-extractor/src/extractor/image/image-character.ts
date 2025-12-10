import type { Rectangle } from '@/parser/structure/record/rectangle.ts';
import type { ColorTransform } from '@/parser/structure/record/color.ts';
import type { Drawable } from '@/extractor/drawable.ts';
import type { Drawer, ImageCharacter } from '@/extractor/drawer/drawer-interface.ts';
import type { ImageDefinition } from './image-definition.ts';
import { encodePng } from './png-encoder.ts';

/**
 * Image character that implements both Drawable and ImageCharacter interfaces.
 * This allows images to be used in the timeline and drawn to SVG.
 */
export class ImageCharacterDefinition implements Drawable, ImageCharacter {
  readonly id: number;
  private readonly definition: ImageDefinition;
  private base64Cache: string | null = null;
  private transformedCache: Map<string, ImageCharacterDefinition> | null = null;

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

  transformColors(colorTransform: ColorTransform): Drawable {
    // Identity transform - no change
    if (
      colorTransform.redMultTerm === 256 &&
      colorTransform.greenMultTerm === 256 &&
      colorTransform.blueMultTerm === 256 &&
      colorTransform.alphaMultTerm === 256 &&
      colorTransform.redAddTerm === 0 &&
      colorTransform.greenAddTerm === 0 &&
      colorTransform.blueAddTerm === 0 &&
      colorTransform.alphaAddTerm === 0
    ) {
      return this;
    }

    const rgba = this.definition.rgba;
    if (!rgba) {
      // No raw RGBA available for this image (e.g. plain JPEG or PNG kept as-is).
      // In this case we cannot safely apply a color transform, so match PHP by
      // leaving the bitmap unchanged.
      return this;
    }

    // Cache per ColorTransform to avoid recomputing the same transformed image.
    const key = [
      colorTransform.redMultTerm,
      colorTransform.greenMultTerm,
      colorTransform.blueMultTerm,
      colorTransform.alphaMultTerm,
      colorTransform.redAddTerm,
      colorTransform.greenAddTerm,
      colorTransform.blueAddTerm,
      colorTransform.alphaAddTerm,
    ].join(',');

    if (!this.transformedCache) {
      this.transformedCache = new Map();
    }

    const cached = this.transformedCache.get(key);
    if (cached) {
      return cached;
    }

    const width = this.definition.width;
    const height = this.definition.height;
    const outRgba = Buffer.allocUnsafe(rgba.length);

    // Apply SWF ColorTransform per pixel, matching shape-definition.ts logic.
    for (let i = 0; i < rgba.length; i += 4) {
      const r = rgba[i]!;
      const g = rgba[i + 1]!;
      const b = rgba[i + 2]!;
      const a = rgba[i + 3]!;

      const tr = (r * colorTransform.redMultTerm) / 256 + colorTransform.redAddTerm;
      const tg = (g * colorTransform.greenMultTerm) / 256 + colorTransform.greenAddTerm;
      const tb = (b * colorTransform.blueMultTerm) / 256 + colorTransform.blueAddTerm;
      const ta = (a * colorTransform.alphaMultTerm) / 256 + colorTransform.alphaAddTerm;

      outRgba[i] = Math.max(0, Math.min(255, Math.floor(tr)));
      outRgba[i + 1] = Math.max(0, Math.min(255, Math.floor(tg)));
      outRgba[i + 2] = Math.max(0, Math.min(255, Math.floor(tb)));
      outRgba[i + 3] = Math.max(0, Math.min(255, Math.floor(ta)));
    }

    const pngBuffer = encodePng(width, height, outRgba);

    const transformedDef: ImageDefinition = {
      id: this.definition.id,
      width,
      height,
      data: pngBuffer,
      format: 'png',
      rgba: outRgba,
    };

    const transformed = new ImageCharacterDefinition(transformedDef);
    this.transformedCache.set(key, transformed);
    return transformed;
  }

  /**
   * Get the best format for this image (JPEG or PNG).
   * Mirrors PHP's JpegImageDefinition::toBestFormat():
   * - JPEG without alpha -> JPEG
   * - JPEG with alpha -> PNG (JPEG + alpha composed)
   * - PNG / GIF89a -> PNG
   */
  private getBestFormat(): { format: 'jpeg' | 'png'; data: Buffer } {
    try {
      // If format is already PNG, use it as-is
      if (this.definition.format === 'png') {
        return { format: 'png', data: this.definition.data };
      }

      // For JPEG: check if alpha data was present in the original tag
      // Mirrors PHP: if (type === Jpeg && !isset(alphaData)) return JPEG, else return PNG
      if (this.definition.format === 'jpeg') {
        // If hasAlpha is explicitly false, keep as JPEG
        if (this.definition.hasAlpha === false) {
          return { format: 'jpeg', data: this.definition.data };
        }
        // If hasAlpha is true or undefined (for backward compatibility), convert to PNG
        if (this.definition.hasAlpha === true || this.definition.rgba) {
          // Convert RGBA to PNG
          const pngBuffer = encodePng(this.definition.width, this.definition.height, this.definition.rgba!);
          return { format: 'png', data: pngBuffer };
        }
        // Default: keep as JPEG
        return { format: 'jpeg', data: this.definition.data };
      }

      // Fallback to PNG
      return { format: 'png', data: this.definition.data };
    } catch (error) {
      console.error(`Error in getBestFormat for image ${this.definition.id}:`, error);
      // Fallback to original format
      return { format: this.definition.format, data: this.definition.data };
    }
  }

  toBase64Data(): string {
    if (this.base64Cache) {
      return this.base64Cache;
    }

    const best = this.getBestFormat();
    const mimeType = best.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const base64 = best.data.toString('base64');
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

