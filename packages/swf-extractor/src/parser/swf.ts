import { SwfReader } from './swf-reader.ts';
import { type SwfHeader, isValidSignature } from './structure/swf-header.ts';
import { readRectangle } from './structure/record/rectangle.ts';
import { type SwfTag, readAllTags, getTagReader } from './structure/swf-tag.ts';
import { type TagTypeValue } from './structure/tag-types.ts';
import { type ErrorFlags, Errors, ParserInvalidDataException } from '@/error/errors.ts';

/**
 * Parsed SWF file.
 */
export class Swf {
  /** Original binary data reader */
  public readonly reader: SwfReader;

  /** SWF header */
  public readonly header: SwfHeader;

  /** All tags in the SWF */
  public readonly tags: readonly SwfTag[];

  /** Character dictionary (character ID -> tag) */
  private readonly characters: Map<number, SwfTag>;

  constructor(reader: SwfReader, header: SwfHeader, tags: readonly SwfTag[]) {
    this.reader = reader;
    this.header = header;
    this.tags = tags;

    // Build character dictionary
    this.characters = new Map();
    for (const tag of tags) {
      if (tag.id !== null) {
        this.characters.set(tag.id, tag);
      }
    }
  }

  /**
   * Get a character by ID.
   */
  getCharacter(id: number): SwfTag | undefined {
    return this.characters.get(id);
  }

  /**
   * Check if character exists.
   */
  hasCharacter(id: number): boolean {
    return this.characters.has(id);
  }

  /**
   * Get all character IDs.
   */
  getCharacterIds(): number[] {
    return Array.from(this.characters.keys());
  }

  /**
   * Get a reader for a tag's data.
   */
  getTagReader(tag: SwfTag): SwfReader {
    return getTagReader(this.reader, tag);
  }

  /**
   * Get tags by type.
   */
  getTagsByType(type: TagTypeValue): SwfTag[] {
    return this.tags.filter((tag) => tag.type === type);
  }

  /**
   * Parse SWF from binary data.
   */
  static fromBuffer(data: Uint8Array | ArrayBuffer | Buffer, errors: ErrorFlags = Errors.ALL): Swf {
    let reader = new SwfReader(data, undefined, errors);

    // Read signature (3 bytes)
    const signature = reader.readBytesAsString(3);
    if (!isValidSignature(signature)) {
      throw new ParserInvalidDataException(`Invalid SWF signature: ${signature}`);
    }

    // Read version and file length
    const version = reader.readUI8();
    const fileLength = reader.readUI32();

    // Handle compression
    if (signature === 'CWS') {
      reader = reader.uncompressSync(fileLength);
    } else if (signature === 'ZWS') {
      // LZMA compression - not commonly used, skip for now
      throw new ParserInvalidDataException('LZMA-compressed SWF (ZWS) is not supported');
    }

    // Read frame size, rate, and count
    const frameSize = readRectangle(reader);
    const frameRate = reader.readUI16() / 256;
    const frameCount = reader.readUI16();

    const header: SwfHeader = {
      signature,
      version,
      fileLength,
      frameSize,
      frameRate,
      frameCount,
    };

    // Read all tags
    const tags = Array.from(readAllTags(reader));

    return new Swf(reader, header, tags);
  }

  /**
   * Parse SWF from file path.
   */
  static async fromFile(path: string, errors: ErrorFlags = Errors.ALL): Promise<Swf> {
    const file = Bun.file(path);
    const buffer = await file.arrayBuffer();
    return Swf.fromBuffer(new Uint8Array(buffer), errors);
  }

  /**
   * Synchronously parse SWF from file path.
   */
  static fromFileSync(path: string, errors: ErrorFlags = Errors.ALL): Swf {
    const buffer = require('fs').readFileSync(path);
    return Swf.fromBuffer(buffer, errors);
  }
}

