import { Swf } from './parser/swf.ts';
import { type SwfHeader } from './parser/structure/swf-header.ts';
import { type SwfTag } from './parser/structure/swf-tag.ts';
import { TagType } from './parser/structure/tag-types.ts';
import { type Rectangle, getRectangleDimensions } from './parser/structure/record/rectangle.ts';
import { type ExportedAsset, readExportAssets } from './parser/structure/tag/export-assets.ts';
import { readDoAction, readDoInitAction } from './parser/structure/tag/do-action.ts';
import { AvmProcessor } from './avm/processor.ts';
import { AvmState, type AvmValue } from './avm/state.ts';
import { type ErrorFlags, Errors } from './error/errors.ts';

/**
 * Maximum frame rate (clamp to prevent extreme values).
 */
export const MAX_FRAME_RATE = 120;

/**
 * High-level SWF file access.
 */
export class SwfFile {
  private readonly swf: Swf;
  private cachedExports?: readonly ExportedAsset[];
  private cachedVariables?: Record<string, AvmValue>;

  constructor(swf: Swf) {
    this.swf = swf;
  }

  /**
   * Check if the SWF is valid.
   */
  get valid(): boolean {
    return this.swf.header.frameCount > 0;
  }

  /**
   * Get the SWF header.
   */
  get header(): SwfHeader {
    return this.swf.header;
  }

  /**
   * Get display bounds in pixels.
   */
  get displayBounds(): { width: number; height: number } {
    return getRectangleDimensions(this.swf.header.frameSize);
  }

  /**
   * Get frame rate (clamped to MAX_FRAME_RATE).
   */
  get frameRate(): number {
    return Math.min(this.swf.header.frameRate, MAX_FRAME_RATE);
  }

  /**
   * Get all tags.
   */
  get tags(): readonly SwfTag[] {
    return this.swf.tags;
  }

  /**
   * Get the underlying Swf parser.
   */
  get parser(): Swf {
    return this.swf;
  }

  /**
   * Get exported assets.
   */
  get exportedAssets(): readonly ExportedAsset[] {
    if (this.cachedExports) return this.cachedExports;

    const exports: ExportedAsset[] = [];
    for (const tag of this.swf.getTagsByType(TagType.ExportAssets)) {
      const reader = this.swf.getTagReader(tag);
      const { assets } = readExportAssets(reader);
      exports.push(...assets);
    }

    this.cachedExports = exports;
    return exports;
  }

  /**
   * Get an asset by name.
   */
  assetByName(name: string): SwfTag | undefined {
    for (const asset of this.exportedAssets) {
      if (asset.name === name) {
        return this.swf.getCharacter(asset.id);
      }
    }
    return undefined;
  }

  /**
   * Get an asset by ID.
   */
  assetById(id: number): SwfTag | undefined {
    return this.swf.getCharacter(id);
  }

  /**
   * Execute ActionScript and get variables.
   */
  get variables(): Record<string, AvmValue> {
    if (this.cachedVariables) return this.cachedVariables;

    const processor = new AvmProcessor();

    // Execute DoAction tags
    for (const tag of this.swf.getTagsByType(TagType.DoAction)) {
      const reader = this.swf.getTagReader(tag);
      const { actions } = readDoAction(reader);
      processor.execute(actions);
    }

    // Execute DoInitAction tags
    for (const tag of this.swf.getTagsByType(TagType.DoInitAction)) {
      const reader = this.swf.getTagReader(tag);
      const { actions } = readDoInitAction(reader);
      processor.execute(actions);
    }

    this.cachedVariables = processor.getState().getVariablesObject();
    return this.cachedVariables;
  }

  /**
   * Parse SWF from buffer.
   */
  static fromBuffer(data: Uint8Array | ArrayBuffer | Buffer, errors: ErrorFlags = Errors.ALL): SwfFile {
    return new SwfFile(Swf.fromBuffer(data, errors));
  }

  /**
   * Parse SWF from file.
   */
  static async fromFile(path: string, errors: ErrorFlags = Errors.ALL): Promise<SwfFile> {
    return new SwfFile(await Swf.fromFile(path, errors));
  }

  /**
   * Synchronously parse SWF from file.
   */
  static fromFileSync(path: string, errors: ErrorFlags = Errors.ALL): SwfFile {
    return new SwfFile(Swf.fromFileSync(path, errors));
  }
}

