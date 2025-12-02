/**
 * SWF Tag type constants.
 */
export const TagType = {
  End: 0,
  ShowFrame: 1,
  DefineShape: 2,
  PlaceObject: 4,
  RemoveObject: 5,
  DefineBits: 6,
  DefineButton: 7,
  JPEGTables: 8,
  SetBackgroundColor: 9,
  DefineFont: 10,
  DefineText: 11,
  DoAction: 12,
  DefineFontInfo: 13,
  DefineSound: 14,
  StartSound: 15,
  DefineButtonSound: 17,
  SoundStreamHead: 18,
  SoundStreamBlock: 19,
  DefineBitsLossless: 20,
  DefineBitsJPEG2: 21,
  DefineShape2: 22,
  DefineButtonCxform: 23,
  Protect: 24,
  PlaceObject2: 26,
  RemoveObject2: 28,
  DefineShape3: 32,
  DefineText2: 33,
  DefineButton2: 34,
  DefineBitsJPEG3: 35,
  DefineBitsLossless2: 36,
  DefineEditText: 37,
  DefineSprite: 39,
  FrameLabel: 43,
  SoundStreamHead2: 45,
  DefineMorphShape: 46,
  DefineFont2: 48,
  ExportAssets: 56,
  ImportAssets: 57,
  EnableDebugger: 58,
  DoInitAction: 59,
  DefineVideoStream: 60,
  VideoFrame: 61,
  DefineFontInfo2: 62,
  EnableDebugger2: 64,
  ScriptLimits: 65,
  SetTabIndex: 66,
  FileAttributes: 69,
  PlaceObject3: 70,
  ImportAssets2: 71,
  DefineFontAlignZones: 73,
  CSMTextSettings: 74,
  DefineFont3: 75,
  SymbolClass: 76,
  Metadata: 77,
  DefineScalingGrid: 78,
  DoABC: 82,
  DefineShape4: 83,
  DefineMorphShape2: 84,
  DefineSceneAndFrameLabelData: 86,
  DefineBinaryData: 87,
  DefineFontName: 88,
  StartSound2: 89,
  DefineBitsJPEG4: 90,
  DefineFont4: 91,
  EnableTelemetry: 93,
} as const;

export type TagTypeValue = (typeof TagType)[keyof typeof TagType];

/**
 * Tag types that define characters (have a character ID).
 */
export const DEFINITION_TAG_TYPES: readonly TagTypeValue[] = [
  TagType.DefineShape,
  TagType.DefineShape2,
  TagType.DefineShape3,
  TagType.DefineShape4,
  TagType.DefineBits,
  TagType.DefineBitsJPEG2,
  TagType.DefineBitsJPEG3,
  TagType.DefineBitsJPEG4,
  TagType.DefineBitsLossless,
  TagType.DefineBitsLossless2,
  TagType.DefineButton,
  TagType.DefineButton2,
  TagType.DefineEditText,
  TagType.DefineFont,
  TagType.DefineFont2,
  TagType.DefineFont3,
  TagType.DefineFont4,
  TagType.DefineMorphShape,
  TagType.DefineMorphShape2,
  TagType.DefineSprite,
  TagType.DefineText,
  TagType.DefineText2,
  TagType.DefineSound,
  TagType.DefineVideoStream,
  TagType.DefineBinaryData,
] as const;

/**
 * Check if a tag type is a definition tag.
 */
export function isDefinitionTag(type: TagTypeValue): boolean {
  return DEFINITION_TAG_TYPES.includes(type);
}

/**
 * Get tag type name for debugging.
 */
export function getTagTypeName(type: number): string {
  for (const [name, value] of Object.entries(TagType)) {
    if (value === type) return name;
  }
  return `Unknown(${type})`;
}

