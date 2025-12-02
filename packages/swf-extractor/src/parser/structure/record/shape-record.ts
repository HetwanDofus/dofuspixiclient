import type { SwfReader } from '@/parser/swf-reader.ts';
import { type FillStyle, readFillStyleArrayShape1, readFillStyleArrayShape3 } from './fill-style.ts';
import {
  type LineStyle,
  type LineStyle2,
  readLineStyleArrayShape1,
  readLineStyleArrayShape3,
  readLineStyle2Array,
} from './line-style.ts';

/**
 * Shape record types.
 */
export const ShapeRecordType = {
  EndShape: 0,
  StyleChange: 1,
  StraightEdge: 2,
  CurvedEdge: 3,
} as const;

export type ShapeRecordTypeValue = (typeof ShapeRecordType)[keyof typeof ShapeRecordType];

/**
 * End of shape record.
 */
export interface EndShapeRecord {
  readonly type: typeof ShapeRecordType.EndShape;
}

/**
 * Style change record.
 */
export interface StyleChangeRecord {
  readonly type: typeof ShapeRecordType.StyleChange;
  readonly stateNewStyles: boolean;
  readonly stateLineStyle: boolean;
  readonly stateFillStyle1: boolean;
  readonly stateFillStyle0: boolean;
  readonly stateMoveTo: boolean;
  readonly moveDeltaX?: number;
  readonly moveDeltaY?: number;
  readonly fillStyle0?: number;
  readonly fillStyle1?: number;
  readonly lineStyle?: number;
  readonly fillStyles?: readonly FillStyle[];
  readonly lineStyles?: readonly (LineStyle | LineStyle2)[];
}

/**
 * Straight edge record.
 */
export interface StraightEdgeRecord {
  readonly type: typeof ShapeRecordType.StraightEdge;
  readonly deltaX: number;
  readonly deltaY: number;
}

/**
 * Curved edge record (quadratic bezier).
 */
export interface CurvedEdgeRecord {
  readonly type: typeof ShapeRecordType.CurvedEdge;
  readonly controlDeltaX: number;
  readonly controlDeltaY: number;
  readonly anchorDeltaX: number;
  readonly anchorDeltaY: number;
}

export type ShapeRecord = EndShapeRecord | StyleChangeRecord | StraightEdgeRecord | CurvedEdgeRecord;

/**
 * Shape record context for tracking fill/line bit counts.
 */
export interface ShapeContext {
  numFillBits: number;
  numLineBits: number;
  fillStyles: FillStyle[];
  lineStyles: (LineStyle | LineStyle2)[];
}

/**
 * Read a single shape record.
 */
export function readShapeRecord(
  reader: SwfReader,
  context: ShapeContext,
  shapeVersion: 1 | 2 | 3 | 4,
): ShapeRecord {
  const isEdge = reader.readBool();

  if (!isEdge) {
    // Non-edge record
    const stateNewStyles = reader.readBool();
    const stateLineStyle = reader.readBool();
    const stateFillStyle1 = reader.readBool();
    const stateFillStyle0 = reader.readBool();
    const stateMoveTo = reader.readBool();

    // End of shape
    if (!stateNewStyles && !stateLineStyle && !stateFillStyle1 && !stateFillStyle0 && !stateMoveTo) {
      reader.alignByte();
      return { type: ShapeRecordType.EndShape };
    }

    // Read optional fields
    let moveDeltaX: number | undefined;
    let moveDeltaY: number | undefined;
    let fillStyle0: number | undefined;
    let fillStyle1: number | undefined;
    let lineStyle: number | undefined;
    let fillStyles: FillStyle[] | undefined;
    let lineStyles: (LineStyle | LineStyle2)[] | undefined;

    if (stateMoveTo) {
      const moveBits = reader.readUB(5);
      moveDeltaX = reader.readSB(moveBits);
      moveDeltaY = reader.readSB(moveBits);
    }

    if (stateFillStyle0) {
      fillStyle0 = reader.readUB(context.numFillBits);
    }

    if (stateFillStyle1) {
      fillStyle1 = reader.readUB(context.numFillBits);
    }

    if (stateLineStyle) {
      lineStyle = reader.readUB(context.numLineBits);
    }

    if (stateNewStyles) {
      reader.alignByte();
      fillStyles =
        shapeVersion >= 3 ? readFillStyleArrayShape3(reader) : readFillStyleArrayShape1(reader);
      lineStyles =
        shapeVersion === 4
          ? readLineStyle2Array(reader)
          : shapeVersion === 3
            ? readLineStyleArrayShape3(reader)
            : readLineStyleArrayShape1(reader);

      context.fillStyles = fillStyles;
      context.lineStyles = lineStyles;

      context.numFillBits = reader.readUB(4);
      context.numLineBits = reader.readUB(4);
    }

    return {
      type: ShapeRecordType.StyleChange,
      stateNewStyles,
      stateLineStyle,
      stateFillStyle1,
      stateFillStyle0,
      stateMoveTo,
      moveDeltaX,
      moveDeltaY,
      fillStyle0,
      fillStyle1,
      lineStyle,
      fillStyles,
      lineStyles,
    };
  }

  // Edge record
  const isStraight = reader.readBool();
  const numBits = reader.readUB(4) + 2;

  if (isStraight) {
    const isGeneralLine = reader.readBool();

    if (isGeneralLine) {
      return {
        type: ShapeRecordType.StraightEdge,
        deltaX: reader.readSB(numBits),
        deltaY: reader.readSB(numBits),
      };
    }

    const isVertical = reader.readBool();
    if (isVertical) {
      return {
        type: ShapeRecordType.StraightEdge,
        deltaX: 0,
        deltaY: reader.readSB(numBits),
      };
    }

    return {
      type: ShapeRecordType.StraightEdge,
      deltaX: reader.readSB(numBits),
      deltaY: 0,
    };
  }

  // Curved edge
  return {
    type: ShapeRecordType.CurvedEdge,
    controlDeltaX: reader.readSB(numBits),
    controlDeltaY: reader.readSB(numBits),
    anchorDeltaX: reader.readSB(numBits),
    anchorDeltaY: reader.readSB(numBits),
  };
}

