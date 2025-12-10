import type { SwfReader } from '@/parser/swf-reader.ts';
import type { Rectangle } from '../record/rectangle.ts';
import { readRectangle } from '../record/rectangle.ts';
import { type ShapeRecord, type ShapeContext, ShapeRecordType, readShapeRecord } from '../record/shape-record.ts';
import { readMatrix, type Matrix } from '../record/matrix.ts';
import { readRgba, type Rgba } from '../record/color.ts';

/**
 * Morph gradient record.
 */
export interface MorphGradientRecord {
  readonly startRatio: number;
  readonly startColor: Rgba;
  readonly endRatio: number;
  readonly endColor: Rgba;
}

/**
 * Morph gradient.
 */
export interface MorphGradient {
  readonly spreadMode: number;
  readonly interpolationMode: number;
  readonly records: readonly MorphGradientRecord[];
  readonly focalPoint?: number;
}

/**
 * Morph fill style type constants.
 */
export const MorphFillStyleType = {
  SOLID: 0x00,
  LINEAR_GRADIENT: 0x10,
  RADIAL_GRADIENT: 0x12,
  FOCAL_RADIAL_GRADIENT: 0x13,
  REPEATING_BITMAP: 0x40,
  CLIPPED_BITMAP: 0x41,
  NON_SMOOTHED_REPEATING_BITMAP: 0x42,
  NON_SMOOTHED_CLIPPED_BITMAP: 0x43,
} as const;

/**
 * Morph fill style.
 */
export interface MorphFillStyle {
  readonly type: number;
  readonly startColor?: Rgba;
  readonly endColor?: Rgba;
  readonly startGradientMatrix?: Matrix;
  readonly endGradientMatrix?: Matrix;
  readonly gradient?: MorphGradient;
  readonly bitmapId?: number;
  readonly startBitmapMatrix?: Matrix;
  readonly endBitmapMatrix?: Matrix;
}

/**
 * Morph line style.
 */
export interface MorphLineStyle {
  readonly startWidth: number;
  readonly endWidth: number;
  readonly startColor: Rgba;
  readonly endColor: Rgba;
}

/**
 * Morph line style 2 (extended).
 */
export interface MorphLineStyle2 {
  readonly startWidth: number;
  readonly endWidth: number;
  readonly startCapStyle: number;
  readonly joinStyle: number;
  readonly hasFillFlag: boolean;
  readonly noHScaleFlag: boolean;
  readonly noVScaleFlag: boolean;
  readonly pixelHintingFlag: boolean;
  readonly noClose: boolean;
  readonly endCapStyle: number;
  readonly miterLimitFactor?: number;
  readonly startColor?: Rgba;
  readonly endColor?: Rgba;
  readonly fillStyle?: MorphFillStyle;
}

/**
 * Parsed DefineMorphShape tag.
 */
export interface DefineMorphShape {
  readonly id: number;
  readonly startBounds: Rectangle;
  readonly endBounds: Rectangle;
  readonly startEdgeBounds?: Rectangle;
  readonly endEdgeBounds?: Rectangle;
  readonly usesNonScalingStrokes?: boolean;
  readonly usesScalingStrokes?: boolean;
  readonly morphFillStyles: readonly MorphFillStyle[];
  readonly morphLineStyles: readonly (MorphLineStyle | MorphLineStyle2)[];
  readonly startEdges: readonly ShapeRecord[];
  readonly endEdges: readonly ShapeRecord[];
  readonly version: 1 | 2;
}

/**
 * Read DefineMorphShape tag.
 * DEBUG: 2025-12-07 timestamp
 */
export function readDefineMorphShape(reader: SwfReader): DefineMorphShape {
  const id = reader.readUI16();
  const startBounds = readRectangle(reader);
  const endBounds = readRectangle(reader);
  const endEdgesOffset = reader.readUI32();

  // Read morph fill styles
  const morphFillStyles = readMorphFillStyles(reader);
  const morphLineStyles = readMorphLineStyles(reader);

  // Read start edges
  const startContext: ShapeContext = {
    numFillBits: reader.readUB(4),
    numLineBits: reader.readUB(4),
    fillStyles: [],
    lineStyles: [],
  };
  const startEdges = readEdges(reader, startContext);

  // Read end edges
  reader.alignByte();
  const endContext: ShapeContext = {
    numFillBits: reader.readUB(4),
    numLineBits: reader.readUB(4),
    fillStyles: [],
    lineStyles: [],
  };
  const endEdges = readEdges(reader, endContext);

  return {
    id,
    startBounds,
    endBounds,
    morphFillStyles,
    morphLineStyles,
    startEdges,
    endEdges,
    version: 1,
  };
}

/**
 * Read DefineMorphShape2 tag.
 */
export function readDefineMorphShape2(reader: SwfReader): DefineMorphShape {
  const id = reader.readUI16();
  const startBounds = readRectangle(reader);
  const endBounds = readRectangle(reader);
  const startEdgeBounds = readRectangle(reader);
  const endEdgeBounds = readRectangle(reader);

  // Read flags byte (6 reserved bits + 2 flag bits)
  const flags = reader.readUI8();
  const usesNonScalingStrokes = (flags & 0b00000010) !== 0;
  const usesScalingStrokes = (flags & 0b00000001) !== 0;

  reader.readUI32(); // endEdgesOffset - not used

  const morphFillStyles = readMorphFillStyles(reader);
  const morphLineStyles = readMorphLineStyles2(reader);

  // Byte align before reading shape records
  reader.alignByte();

  const startContext: ShapeContext = {
    numFillBits: reader.readUB(4),
    numLineBits: reader.readUB(4),
    fillStyles: [],
    lineStyles: [],
  };
  const startEdges = readEdges(reader, startContext);

  reader.alignByte();
  const endContext: ShapeContext = {
    numFillBits: reader.readUB(4),
    numLineBits: reader.readUB(4),
    fillStyles: [],
    lineStyles: [],
  };
  const endEdges = readEdges(reader, endContext);

  return {
    id,
    startBounds,
    endBounds,
    startEdgeBounds,
    endEdgeBounds,
    usesNonScalingStrokes,
    usesScalingStrokes,
    morphFillStyles,
    morphLineStyles,
    startEdges,
    endEdges,
    version: 2,
  };
}

function readMorphFillStyles(reader: SwfReader): MorphFillStyle[] {
  let count = reader.readUI8();
  if (count === 0xff) count = reader.readUI16();

  const styles: MorphFillStyle[] = [];
  for (let i = 0; i < count; i++) {
    styles.push(readMorphFillStyle(reader));
  }
  return styles;
}

function readMorphFillStyle(reader: SwfReader): MorphFillStyle {
  const type = reader.readUI8();

  switch (type) {
    case MorphFillStyleType.SOLID:
      return {
        type,
        startColor: readRgba(reader),
        endColor: readRgba(reader),
      };

    case MorphFillStyleType.LINEAR_GRADIENT:
    case MorphFillStyleType.RADIAL_GRADIENT:
      return {
        type,
        startGradientMatrix: readMatrix(reader),
        endGradientMatrix: readMatrix(reader),
        gradient: readMorphGradient(reader, false),
      };

    case MorphFillStyleType.FOCAL_RADIAL_GRADIENT:
      return {
        type,
        startGradientMatrix: readMatrix(reader),
        endGradientMatrix: readMatrix(reader),
        gradient: readMorphGradient(reader, true),
      };

    case MorphFillStyleType.REPEATING_BITMAP:
    case MorphFillStyleType.CLIPPED_BITMAP:
    case MorphFillStyleType.NON_SMOOTHED_REPEATING_BITMAP:
    case MorphFillStyleType.NON_SMOOTHED_CLIPPED_BITMAP:
      return {
        type,
        bitmapId: reader.readUI16(),
        startBitmapMatrix: readMatrix(reader),
        endBitmapMatrix: readMatrix(reader),
      };

    default:
      // Unknown type, return empty style
      return { type };
  }
}

function readMorphGradient(reader: SwfReader, focal: boolean): MorphGradient {
  const spreadMode = reader.readUB(2);
  const interpolationMode = reader.readUB(2);
  const numGradients = reader.readUB(4);

  const records: MorphGradientRecord[] = [];
  for (let i = 0; i < numGradients; i++) {
    records.push({
      startRatio: reader.readUI8(),
      startColor: readRgba(reader),
      endRatio: reader.readUI8(),
      endColor: readRgba(reader),
    });
  }

  const focalPoint = focal ? reader.readFixed8() : undefined;

  return {
    spreadMode,
    interpolationMode,
    records,
    focalPoint,
  };
}

function readMorphLineStyles(reader: SwfReader): MorphLineStyle[] {
  let count = reader.readUI8();
  if (count === 0xff) count = reader.readUI16();

  const styles: MorphLineStyle[] = [];
  for (let i = 0; i < count; i++) {
    styles.push({
      startWidth: reader.readUI16(),
      endWidth: reader.readUI16(),
      startColor: readRgba(reader),
      endColor: readRgba(reader),
    });
  }
  return styles;
}

function readMorphLineStyles2(reader: SwfReader): MorphLineStyle2[] {
  let count = reader.readUI8();
  if (count === 0xff) count = reader.readUI16();

  const styles: MorphLineStyle2[] = [];
  for (let i = 0; i < count; i++) {
    const startWidth = reader.readUI16();
    const endWidth = reader.readUI16();

    // Read first flags byte
    const flags1 = reader.readUI8();
    const startCapStyle = (flags1 >> 6) & 3;
    const joinStyle = (flags1 >> 4) & 3;
    const hasFillFlag = (flags1 & 0b00001000) !== 0;
    const noHScaleFlag = (flags1 & 0b00000100) !== 0;
    const noVScaleFlag = (flags1 & 0b00000010) !== 0;
    const pixelHintingFlag = (flags1 & 0b00000001) !== 0;

    // Read second flags byte
    const flags2 = reader.readUI8();
    const noClose = (flags2 & 0b00000100) !== 0;
    const endCapStyle = (flags2 & 0b00000011);

    // Read miter limit factor if join style is miter (2)
    const miterLimitFactor = joinStyle === 2 ? reader.readFixed8() : undefined;

    // Read colors or fill style
    let startColor: Rgba | undefined;
    let endColor: Rgba | undefined;
    let fillStyle: MorphFillStyle | undefined;

    if (hasFillFlag) {
      fillStyle = readMorphFillStyle(reader);
    } else {
      startColor = readRgba(reader);
      endColor = readRgba(reader);
    }

    styles.push({
      startWidth,
      endWidth,
      startCapStyle,
      joinStyle,
      hasFillFlag,
      noHScaleFlag,
      noVScaleFlag,
      pixelHintingFlag,
      noClose,
      endCapStyle,
      miterLimitFactor,
      startColor,
      endColor,
      fillStyle,
    });
  }
  return styles;
}

function readEdges(reader: SwfReader, context: ShapeContext): ShapeRecord[] {
  const records: ShapeRecord[] = [];
  while (reader.hasRemaining()) {
    // Morph shapes always use version 1 for shape records
    const record = readShapeRecord(reader, context, 1);
    records.push(record);
    if (record.type === ShapeRecordType.EndShape) break;
  }
  return records;
}

