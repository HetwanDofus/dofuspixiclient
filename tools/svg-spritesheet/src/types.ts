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
  positioningOffset: PositioningOffset;
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

/** Positioning offset extracted from main transform */
export interface PositioningOffset {
  x: number;
  y: number;
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
  /** Hash of exported image file (if base64 was exported) */
  exportedImageHash?: string;
  /** Original base64 data URI (for replacement during content rebuild) */
  base64DataUri?: string;
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

/** Image export options for rasterized content deduplication */
export interface ImageExportOptions {
  enabled: boolean;
  outputDir: string;
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

/** Content bounds for bin-packing */
export interface ContentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

/** Packed frame position from bin-packing */
export interface PackedFrame {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  sourceFrame: ParsedFrame;
}

/** Atlas manifest for runtime loading */
export interface AtlasManifest {
  version: number;
  animation: string;
  width: number;
  height: number;
  /** Positioning offset for placing the sprite in the game world */
  offsetX: number;
  offsetY: number;
  frames: AtlasFrame[];
  frameOrder: string[];
  duplicates: Record<string, string>;
  fps: number;
  /** Element deduplication stats (informational) */
  elementDedup?: ElementDedupStats;
  /**
   * Base frame for base/delta splitting.
   * When present, each frame in `frames` contains only the changing (delta) elements.
   * The client must composite: render delta frame, then render baseFrame on top
   * (or vice versa depending on baseZOrder).
   */
  baseFrame?: AtlasFrame;
  /** Whether the base renders "above" or "below" the delta. Default "above". */
  baseZOrder?: "above" | "below";
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
  elementDedup?: { total: number; unique: number; pooled: number; base: number; flips: number };
}

/** Tile behavior classification */
export type TileBehavior = "static" | "slope" | "animated" | "random" | "resource";

/** Combined manifest for all animations in a sprite */
export interface CombinedManifest {
  version: number;
  spriteId: string;
  /** Tile behavior classification (when compiled with --tile-classifications) */
  behavior?: TileBehavior;
  /** Animation properties (only for animated/resource behaviors) */
  fps_hint?: number;
  autoplay?: boolean;
  loop?: boolean;
  animations: Record<string, AnimationManifestEntry>;
}

/** Entry for a single animation in combined manifest */
export interface AnimationManifestEntry {
  file: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  fps: number;
  frames: AtlasFrame[];
  frameOrder: string[];
  duplicates: Record<string, string>;
  /** Element deduplication stats (informational) */
  elementDedup?: ElementDedupStats;
  /** Base frame for base/delta compositing */
  baseFrame?: AtlasFrame;
  /** Whether the base renders "above" or "below" the delta */
  baseZOrder?: "above" | "below";
}

// ---------------------------------------------------------------------------
// Element-level deduplication
// ---------------------------------------------------------------------------

/** A unique (href, transform, width, height) use-element configuration */
export interface ElementInstance {
  /** Short id used in the SVG (e.g. "e0") */
  id: string;
  /** Canonical href (e.g. "#d5") */
  href: string;
  transform?: string;
  width?: number;
  height?: number;
  attributes: Record<string, string>;
  /** Content hash of this instance */
  hash: string;
  /** How many times this instance appears across all frames */
  occurrences: number;
  /** If this instance is the horizontal flip of another, the source's hash */
  flipSourceHash?: string;
}

/** Reference from a frame to an element instance */
export interface ElementRef {
  /** Hash of the element instance in the pool */
  hash: string;
  /** Whether this occurrence is the h-flipped version of the pool entry */
  flipped: boolean;
  /** True when the instance appears only once (not worth pooling — inline it) */
  inlined: boolean;
}

/** Result of element-level deduplication */
export interface ElementDeduplicationResult {
  /** Pool of unique element instances keyed by hash */
  pool: Map<string, ElementInstance>;
  /** Per-frame element references (sprite id → element refs in z-order) */
  frameElements: Map<string, ElementRef[]>;
  /** Hashes of elements present in ALL unique frames with identical config */
  baseElementHashes: Set<string>;
  /** Flip pairs: flipped element hash → source element hash */
  flipPairs: Map<string, string>;
  stats: ElementDedupStats;
}

/** Element dedup statistics */
export interface ElementDedupStats {
  totalElements: number;
  uniqueElements: number;
  pooledElements: number;
  baseElements: number;
  flipPairs: number;
}
