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
  /** SWF clip-mask `<clipPath>` defs the parser kept from this frame's source. */
  clipMasks: ClipMaskDefinition[];
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
  /**
   * Original clip-path id this `<use>` (or any ancestor `<g>`) was wrapped by
   * in the source SVG, e.g. `"object-clip-3"`. Set when the input SVG carried
   * a `clip-path="url(#…)"` attribute and the referenced `<clipPath>` is a
   * SWF mask (non-rect geometry — see `ClipMaskDefinition`). The atlas
   * generator will rewrite this to the canonical `swfclip-N` id and emit a
   * `clip-path="url(#swfclip-N)"` attribute on the resulting `<use>`.
   *
   * Atlas-frame rectangular clip-paths are NOT tracked here — they're emitted
   * by the generator itself for tile boundaries and live in a separate
   * namespace.
   */
  clipMaskRef?: string;
}

/**
 * A `<clipPath>` def from the source SVG that contains non-rectangular
 * geometry — i.e. an authored SWF clipDepth mask, not a synthetic atlas
 * frame boundary. Carries the path geometry verbatim so downstream
 * (dofasset-format → Vello) can rasterise the mask shape.
 *
 * Rect-shaped clipPaths are intentionally NOT modelled here — they are
 * either Arakne emitting a rect for cheap full-frame clipping (effectively
 * a no-op the parser drops) or our own atlas-cell boundaries (added later
 * by the generator).
 */
export interface ClipMaskDefinition {
  /** Original id from the source SVG, e.g. `"object-clip-3"`. */
  originalId: string;
  /** Hash of the normalised inner geometry; same key used to dedupe across frames. */
  contentHash: string;
  /** Rewritten `swfclip-N` id assigned by the generator. */
  canonicalId?: string;
  /**
   * Inner geometry exactly as it appeared in the source `<clipPath>`. Usually
   * a single `<path d="...">` but kept as a string slice so any structure
   * (multiple paths, transforms, even nested groups) survives without
   * Cheerio re-serialisation drift. The wrapping `<clipPath>` tag itself is
   * stripped — the generator re-wraps with the canonical id.
   */
  innerContent: string;
  /** Optional `transform` attribute on the original `<clipPath>` element. */
  transform?: string;
}

/** A definition element from <defs> */
export interface Definition {
  originalId: string;
  contentHash: string;
  canonicalId?: string;
  /**
   * Aggressively normalized content used only for content hashing during dedup.
   * Numbers are rounded here to tolerate float noise when merging equivalent defs.
   * Do NOT write this to the output — use `originalContent` instead.
   */
  normalizedContent: string;
  /**
   * The full-precision content of the definition (IDs still present).
   * This is what must be used when rebuilding the atlas output so that
   * gradientTransform matrices and path coordinates retain their original
   * precision. Rebuild steps (strip nested ids, rewrite refs, add canonical
   * id) operate on this string.
   */
  originalContent: string;
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
  /** For multi-page atlases: index into the pages[] array. Absent or 0 = first/only page. */
  page?: number;
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
  /** Multi-page atlas: list of page SVG files with their dimensions. Absent = single atlas.svg. */
  pages?: Array<{ file: string; width: number; height: number }>;
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
  /** Multi-page atlas: list of page SVG files with their dimensions. Absent = single file. */
  pages?: Array<{ file: string; width: number; height: number }>;
}

// ---------------------------------------------------------------------------
// Element-level deduplication
// ---------------------------------------------------------------------------

/** A unique (href, transform, width, height, clipMaskRef) use-element configuration */
export interface ElementInstance {
  /** Short id used in the SVG (e.g. "e0") */
  id: string;
  /** Canonical href (e.g. "#d5") */
  href: string;
  transform?: string;
  width?: number;
  height?: number;
  attributes: Record<string, string>;
  /**
   * Canonical SWF clip-mask id (e.g. `"swfclip-3"`) inherited from the
   * source `<g clip-path>` wrapper. Two visually-identical use elements
   * with different masks must NOT dedupe to the same instance — the mask
   * is a real difference in render output. Folded into `hash` so equality
   * checks naturally diverge.
   */
  clipMaskRef?: string;
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
