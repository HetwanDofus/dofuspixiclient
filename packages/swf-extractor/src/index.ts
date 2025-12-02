// Main exports
export { SwfFile, MAX_FRAME_RATE } from './swf-file.ts';

// Parser exports
export { Swf } from './parser/swf.ts';
export { SwfReader } from './parser/swf-reader.ts';
export type { SwfHeader } from './parser/structure/swf-header.ts';
export type { SwfTag } from './parser/structure/swf-tag.ts';
export { TagType, getTagTypeName, isDefinitionTag } from './parser/structure/tag-types.ts';

// Record exports
export type { Rectangle } from './parser/structure/record/rectangle.ts';
export { readRectangle, twipsToPixels, getRectangleDimensions } from './parser/structure/record/rectangle.ts';
export type { Rgb, Rgba, ColorTransform } from './parser/structure/record/color.ts';
export { readRgb, readRgba, toHex, toRgbaString } from './parser/structure/record/color.ts';
export type { Matrix } from './parser/structure/record/matrix.ts';
export { readMatrix, toSvgTransform, multiplyMatrix, IDENTITY_MATRIX } from './parser/structure/record/matrix.ts';
export type { FillStyle, SolidFill, GradientFill, BitmapFill } from './parser/structure/record/fill-style.ts';
export { FillStyleType } from './parser/structure/record/fill-style.ts';
export type { LineStyle, LineStyle2 } from './parser/structure/record/line-style.ts';
export type { Gradient, GradientRecord, FocalGradient } from './parser/structure/record/gradient.ts';

// Tag exports
export type { DefineShape } from './parser/structure/tag/define-shape.ts';
export type { DefineSprite } from './parser/structure/tag/define-sprite.ts';
export type { DefineBitsJpeg2, DefineBitsJpeg3, DefineBitsLossless } from './parser/structure/tag/define-bits.ts';
export type { DefineMorphShape } from './parser/structure/tag/define-morph-shape.ts';
export type { PlaceObject } from './parser/structure/tag/place-object.ts';
export type { ExportedAsset } from './parser/structure/tag/export-assets.ts';
export type { DoAction, DoInitAction } from './parser/structure/tag/do-action.ts';

// Extractor exports
export { SwfExtractor, type CharacterType } from './extractor/swf-extractor.ts';
export type { ShapeDefinition } from './extractor/shape/shape-definition.ts';
export { createShapeDefinition } from './extractor/shape/shape-definition.ts';
export type { ShapePath, PathSegment } from './extractor/shape/path.ts';
export { buildPathString, getPathBounds } from './extractor/shape/path.ts';
export type { ImageDefinition } from './extractor/image/image-definition.ts';

// Timeline exports
export { Timeline } from './extractor/timeline/timeline.ts';
export type { Frame, FrameObject } from './extractor/timeline/frame.ts';

// Drawer exports
export { SvgDrawer, type SvgDrawerOptions } from './extractor/drawer/svg/svg-drawer.ts';
export { ImageFormat, getExtension, getMimeType, isRasterFormat, parseFormat } from './extractor/drawer/converter/image-format.ts';
export { convertSvg, convertToAnimation, type ConversionOptions } from './extractor/drawer/converter/svg-converter.ts';

// AVM exports
export { AvmProcessor } from './avm/processor.ts';
export { AvmState, type AvmValue, type AvmObject, type AvmArray } from './avm/state.ts';
export { ActionCode, PushType } from './parser/structure/action/opcodes.ts';

// Error exports
export { Errors, type ErrorFlags, ParserOutOfBoundException, ParserInvalidDataException } from './error/errors.ts';

// Console exports
export { runExtractCommand, createProgram } from './console/extract-command.ts';
export type { ExtractOptions, FrameFormat } from './console/extract-options.ts';
export { parseFrameFormat, parseNumberList } from './console/extract-options.ts';

