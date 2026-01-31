/**
 * SVG Spritesheet Generator Types
 */

/** Parsed SVG frame data */
export interface ParsedFrame {
  filename: string;
  animationName: string;
  frameIndex: number;
  viewBox: ViewBox;
  mainTransform: string;
  useElements: UseElement[];
  definitions: Definition[];
  rawContent?: string;
}

/** SVG viewBox dimensions */
export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A <use> element reference */
export interface UseElement {
  originalHref: string;
  canonicalHref?: string;
  transform?: string;
  width?: number;
  height?: number;
  attributes: Record<string, string>;
}

/** A definition element from <defs> */
export interface Definition {
  originalId: string;
  contentHash: string;
  canonicalId?: string;
  normalizedContent: string;
  tagName: string;
  size: number;
  nestedRefs: string[];
  isPattern: boolean;
  base64Data?: string;
}

/** Deduplication result */
export interface DeduplicationResult {
  canonicalDefs: Map<string, CanonicalDefinition>;
  idMapping: Map<string, Map<string, string>>;
  stats: DeduplicationStats;
}

/** Canonical definition after deduplication */
export interface CanonicalDefinition {
  id: string;
  hash: string;
  content: string;
  tagName: string;
  refCount: number;
  size: number;
  isPattern: boolean;
}

/** Deduplication statistics */
export interface DeduplicationStats {
  totalDefinitions: number;
  uniqueDefinitions: number;
  totalBytes: number;
  uniqueBytes: number;
  compressionRatio: number;
  patternCount: number;
  topDefinitions: Array<{ id: string; refCount: number; size: number }>;
}

/** Processed sprite for output */
export interface ProcessedSprite {
  id: string;
  animationName: string;
  frameIndex: number;
  viewBox: string;
  mainTransform: string;
  useElements: UseElement[];
  structureHash: string;
  duplicateOf?: string;
}

/** Output optimization options */
export interface OptimizationOptions {
  shortIds: boolean;
  minify: boolean;
  precision: number;
  stripDefaults: boolean;
}

/** Atlas frame data for runtime loading */
export interface AtlasFrame {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

/** Atlas manifest for runtime loading */
export interface AtlasManifest {
  version: number;
  animation: string;
  width: number;
  height: number;
  frames: AtlasFrame[];
  frameOrder: string[];
  duplicates: Record<string, string>;
  fps: number;
}

/** CLI compile options */
export interface CompileOptions {
  inputBase: string;
  outputBase: string;
  svgoConfig?: string;
  parallel: number;
}

/** Animation group for batch processing */
export interface AnimationGroup {
  name: string;
  files: string[];
}

/** Result of compiling a single sprite */
export interface CompileResult {
  spriteId: string;
  success: boolean;
  error?: string;
  inputSize?: number;
  outputSize?: number;
  animationCount?: number;
}

/** Combined manifest for all animations in a sprite */
export interface CombinedManifest {
  version: number;
  spriteId: string;
  generatedAt: string;
  totalAnimations: number;
  totalFrames: number;
  uniqueFrames: number;
  totalInputSize: number;
  totalOutputSize: number;
  compressionPercent: number;
  animations: Record<string, AnimationManifestEntry>;
}

/** Entry for a single animation in combined manifest */
export interface AnimationManifestEntry {
  frameCount: number;
  uniqueFrames: number;
  atlasWidth: number;
  atlasHeight: number;
  file: string;
  manifestFile: string;
}
