import type { SwfReader } from '@/parser/swf-reader.ts';
import type { Rectangle } from '../record/rectangle.ts';
import { readRectangle } from '../record/rectangle.ts';
import { type FillStyle, readFillStyleArrayShape1, readFillStyleArrayShape3 } from '../record/fill-style.ts';
import {
  type LineStyle,
  type LineStyle2,
  readLineStyleArrayShape1,
  readLineStyleArrayShape3,
  readLineStyle2Array,
} from '../record/line-style.ts';
import {
  type ShapeRecord,
  type ShapeContext,
  ShapeRecordType,
  readShapeRecord,
} from '../record/shape-record.ts';

/**
 * Parsed DefineShape tag.
 */
export interface DefineShape {
  /** Character ID */
  readonly id: number;
  /** Shape bounds in twips */
  readonly bounds: Rectangle;
  /** Edge bounds (Shape4 only) */
  readonly edgeBounds?: Rectangle;
  /** Uses fill winding rule (Shape4 only) */
  readonly usesFillWindingRule?: boolean;
  /** Uses non-scaling strokes (Shape4 only) */
  readonly usesNonScalingStrokes?: boolean;
  /** Uses scaling strokes (Shape4 only) */
  readonly usesScalingStrokes?: boolean;
  /** Fill styles */
  readonly fillStyles: readonly FillStyle[];
  /** Line styles */
  readonly lineStyles: readonly (LineStyle | LineStyle2)[];
  /** Shape records */
  readonly shapeRecords: readonly ShapeRecord[];
  /** Shape version (1, 2, 3, or 4) */
  readonly version: 1 | 2 | 3 | 4;
}

/**
 * Read DefineShape tag (version 1).
 */
export function readDefineShape1(reader: SwfReader): DefineShape {
  return readDefineShapeCommon(reader, 1);
}

/**
 * Read DefineShape2 tag.
 */
export function readDefineShape2(reader: SwfReader): DefineShape {
  return readDefineShapeCommon(reader, 2);
}

/**
 * Read DefineShape3 tag.
 */
export function readDefineShape3(reader: SwfReader): DefineShape {
  return readDefineShapeCommon(reader, 3);
}

/**
 * Read DefineShape4 tag.
 */
export function readDefineShape4(reader: SwfReader): DefineShape {
  const id = reader.readUI16();
  const bounds = readRectangle(reader);
  const edgeBounds = readRectangle(reader);

  // Flags
  reader.readUB(5); // Reserved
  const usesFillWindingRule = reader.readBool();
  const usesNonScalingStrokes = reader.readBool();
  const usesScalingStrokes = reader.readBool();

  const fillStyles = readFillStyleArrayShape3(reader);
  const lineStyles = readLineStyle2Array(reader);

  const context: ShapeContext = {
    numFillBits: reader.readUB(4),
    numLineBits: reader.readUB(4),
    fillStyles: [...fillStyles],
    lineStyles: [...lineStyles],
  };

  const shapeRecords = readAllShapeRecords(reader, context, 4);

  return {
    id,
    bounds,
    edgeBounds,
    usesFillWindingRule,
    usesNonScalingStrokes,
    usesScalingStrokes,
    fillStyles,
    lineStyles,
    shapeRecords,
    version: 4,
  };
}

/**
 * Common reader for DefineShape 1, 2, and 3.
 */
function readDefineShapeCommon(reader: SwfReader, version: 1 | 2 | 3): DefineShape {
  const id = reader.readUI16();
  const bounds = readRectangle(reader);

  const fillStyles = version >= 3 ? readFillStyleArrayShape3(reader) : readFillStyleArrayShape1(reader);
  const lineStyles = version >= 3 ? readLineStyleArrayShape3(reader) : readLineStyleArrayShape1(reader);

  const context: ShapeContext = {
    numFillBits: reader.readUB(4),
    numLineBits: reader.readUB(4),
    fillStyles: [...fillStyles],
    lineStyles: [...lineStyles],
  };

  const shapeRecords = readAllShapeRecords(reader, context, version);

  return {
    id,
    bounds,
    fillStyles,
    lineStyles,
    shapeRecords,
    version,
  };
}

/**
 * Read all shape records until EndShape.
 */
function readAllShapeRecords(
  reader: SwfReader,
  context: ShapeContext,
  version: 1 | 2 | 3 | 4,
): ShapeRecord[] {
  const records: ShapeRecord[] = [];

  while (reader.hasRemaining()) {
    const record = readShapeRecord(reader, context, version);
    records.push(record);

    if (record.type === ShapeRecordType.EndShape) {
      break;
    }
  }

  return records;
}

