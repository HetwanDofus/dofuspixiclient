import type { SwfReader } from '@/parser/swf-reader.ts';
import { TagType, isDefinitionTag, type TagTypeValue } from './tag-types.ts';

/**
 * Raw SWF tag structure.
 */
export interface SwfTag {
  /** Tag type identifier */
  readonly type: TagTypeValue;
  /** Offset in the SWF data */
  readonly offset: number;
  /** Length of the tag data (not including header) */
  readonly length: number;
  /** Character ID (only for definition tags) */
  readonly id: number | null;
}

/**
 * Read a single tag header from the reader.
 * Returns null if at end of data.
 */
export function readTagHeader(reader: SwfReader): SwfTag | null {
  if (!reader.hasRemaining()) return null;

  const tagCodeAndLength = reader.readUI16();
  const type = (tagCodeAndLength >> 6) as TagTypeValue;
  let length = tagCodeAndLength & 0x3f;

  // Long tag format
  if (length === 0x3f) {
    length = reader.readUI32();
  }

  const offset = reader.offset;
  const id = isDefinitionTag(type) ? readCharacterId(reader, type) : null;

  // Reset to tag data start
  reader.offset = offset;

  return { type, offset, length, id };
}

/**
 * Read character ID from the start of a definition tag.
 */
function readCharacterId(reader: SwfReader, type: TagTypeValue): number | null {
  // Most definition tags have character ID as first 2 bytes
  switch (type) {
    case TagType.DefineShape:
    case TagType.DefineShape2:
    case TagType.DefineShape3:
    case TagType.DefineShape4:
    case TagType.DefineBits:
    case TagType.DefineBitsJPEG2:
    case TagType.DefineBitsJPEG3:
    case TagType.DefineBitsJPEG4:
    case TagType.DefineBitsLossless:
    case TagType.DefineBitsLossless2:
    case TagType.DefineButton:
    case TagType.DefineButton2:
    case TagType.DefineEditText:
    case TagType.DefineFont:
    case TagType.DefineFont2:
    case TagType.DefineFont3:
    case TagType.DefineFont4:
    case TagType.DefineMorphShape:
    case TagType.DefineMorphShape2:
    case TagType.DefineSprite:
    case TagType.DefineText:
    case TagType.DefineText2:
    case TagType.DefineSound:
    case TagType.DefineVideoStream:
    case TagType.DefineBinaryData:
      return reader.readUI16();
    default:
      return null;
  }
}

/**
 * Iterator for reading all tags from a reader.
 */
export function* readAllTags(reader: SwfReader): Generator<SwfTag, void, unknown> {
  while (reader.hasRemaining()) {
    const tag = readTagHeader(reader);
    if (tag === null || tag.type === TagType.End) break;

    yield tag;

    // Skip to next tag
    reader.offset = tag.offset + tag.length;
  }
}

/**
 * Get a chunk reader for the tag's data.
 */
export function getTagReader(reader: SwfReader, tag: SwfTag): SwfReader {
  return reader.chunk(tag.offset, tag.offset + tag.length);
}

