import type { SwfReader } from '@/parser/swf-reader.ts';
import { type Matrix, readMatrix } from '../record/matrix.ts';
import { type ColorTransform, readColorTransform, readColorTransformWithAlpha } from '../record/color.ts';
import { type ClipActions, readClipActions } from './clip-actions.ts';
import { type Filter, readFilterList } from '../record/filter/filter.ts';

/**
 * PlaceObject tag (all versions).
 */
export interface PlaceObject {
  /** Depth for this object */
  readonly depth: number;
  /** Character ID to place (if placing new object) */
  readonly characterId?: number;
  /** Transform matrix */
  readonly matrix?: Matrix;
  /** Color transform */
  readonly colorTransform?: ColorTransform;
  /** Morph ratio (0-65535) */
  readonly ratio?: number;
  /** Instance name */
  readonly name?: string;
  /** Clip depth for masking */
  readonly clipDepth?: number;
  /** Clip actions (PlaceObject2/3 with SWF >= 5) */
  readonly clipActions?: ClipActions;
  /** Surface filter list (PlaceObject3) */
  readonly filters?: readonly Filter[];
  /** Blend mode (PlaceObject3) */
  readonly blendMode?: number;
  /** Has image flag (PlaceObject3) */
  readonly hasImage?: boolean;
  /** Bitmap cache (PlaceObject3) */
  readonly bitmapCache?: number;
  /** Class name (PlaceObject3) */
  readonly className?: string;
  /** Is move operation */
  readonly isMove: boolean;
}

/**
 * Read PlaceObject tag (version 1).
 */
export function readPlaceObject(reader: SwfReader, tagEnd: number): PlaceObject {
  const characterId = reader.readUI16();
  const depth = reader.readUI16();
  const matrix = readMatrix(reader);

  let colorTransform: ColorTransform | undefined;
  if (reader.offset < tagEnd) {
    colorTransform = readColorTransform(reader);
  }

  return {
    depth,
    characterId,
    matrix,
    colorTransform,
    isMove: false,
  };
}

/**
 * Read PlaceObject2 tag.
 */
export function readPlaceObject2(reader: SwfReader, swfVersion: number): PlaceObject {
  const hasClipActions = reader.readBool();
  const hasClipDepth = reader.readBool();
  const hasName = reader.readBool();
  const hasRatio = reader.readBool();
  const hasColorTransform = reader.readBool();
  const hasMatrix = reader.readBool();
  const hasCharacter = reader.readBool();
  const isMove = reader.readBool();

  const depth = reader.readUI16();

  const result: PlaceObject = {
    depth,
    isMove,
    characterId: hasCharacter ? reader.readUI16() : undefined,
    matrix: hasMatrix ? readMatrix(reader) : undefined,
    colorTransform: hasColorTransform ? readColorTransformWithAlpha(reader) : undefined,
    ratio: hasRatio ? reader.readUI16() : undefined,
    name: hasName ? reader.readNullTerminatedString() : undefined,
    clipDepth: hasClipDepth ? reader.readUI16() : undefined,
    clipActions: hasClipActions && swfVersion >= 5 ? readClipActions(reader, swfVersion) : undefined,
  };

  return result;
}

/**
 * Read PlaceObject3 tag.
 */
export function readPlaceObject3(reader: SwfReader, swfVersion: number): PlaceObject {
  const hasClipActions = reader.readBool();
  const hasClipDepth = reader.readBool();
  const hasName = reader.readBool();
  const hasRatio = reader.readBool();
  const hasColorTransform = reader.readBool();
  const hasMatrix = reader.readBool();
  const hasCharacter = reader.readBool();
  const isMove = reader.readBool();

  reader.readUB(1); // Reserved
  const _hasOpaqueBackground = reader.readBool();
  const _hasVisible = reader.readBool();
  const hasImage = reader.readBool();
  const hasClassName = reader.readBool();
  const hasCacheAsBitmap = reader.readBool();
  const hasBlendMode = reader.readBool();
  const hasFilterList = reader.readBool();

  const depth = reader.readUI16();

  // Read className if present (before characterId)
  const className = hasClassName || (hasImage && hasCharacter) ? reader.readNullTerminatedString() : undefined;

  const result: PlaceObject = {
    depth,
    isMove,
    hasImage,
    className,
    characterId: hasCharacter ? reader.readUI16() : undefined,
    matrix: hasMatrix ? readMatrix(reader) : undefined,
    colorTransform: hasColorTransform ? readColorTransformWithAlpha(reader) : undefined,
    ratio: hasRatio ? reader.readUI16() : undefined,
    name: hasName ? reader.readNullTerminatedString() : undefined,
    clipDepth: hasClipDepth ? reader.readUI16() : undefined,
    filters: hasFilterList ? readFilterList(reader) : undefined,
    blendMode: hasBlendMode ? reader.readUI8() : undefined,
    bitmapCache: hasCacheAsBitmap ? reader.readUI8() : undefined,
    clipActions: hasClipActions && swfVersion >= 5 ? readClipActions(reader, swfVersion) : undefined,
  };

  return result;
}

