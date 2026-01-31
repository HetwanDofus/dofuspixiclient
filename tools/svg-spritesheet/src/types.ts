/**
 * SVG Spritesheet Generator Types
 */

/** Parsed SVG frame data */
export interface ParsedFrame {
  /** Original filename (e.g., "anim0L_0.svg") */
  filename: string;
  /** Animation name extracted from filename */
  animationName: string;
  /** Frame index within animation */
  frameIndex: number;
  /** Original viewBox values */
  viewBox: ViewBox;
  /** Main group transform (character positioning) */
  mainTransform: string;
  /** Use elements with their references and transforms */
  useElements: UseElement[];
  /** Definition elements extracted from <defs> */
  definitions: Definition[];
  /** Raw SVG content for debugging */
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
  /** Original href (e.g., "#a") */
  originalHref: string;
  /** Canonical href after deduplication (e.g., "defs.svg#def_abc123") */
  canonicalHref?: string;
  /** Transform attribute */
  transform?: string;
  /** Width attribute (if present) */
  width?: number;
  /** Height attribute (if present) */
  height?: number;
  /** Other attributes */
  attributes: Record<string, string>;
}

/** A definition element from <defs> */
export interface Definition {
  /** Original ID (e.g., "a", "av", "at") */
  originalId: string;
  /** Content hash (MD5) */
  contentHash: string;
  /** Canonical ID after deduplication (e.g., "def_abc123") */
  canonicalId?: string;
  /** Normalized SVG content */
  normalizedContent: string;
  /** Element tag name (g, path, pattern, use, etc.) */
  tagName: string;
  /** Size in bytes */
  size: number;
  /** Nested definition references */
  nestedRefs: string[];
  /** Whether this is a pattern with base64 image */
  isPattern: boolean;
  /** Base64 image data (for patterns) */
  base64Data?: string;
}

/** Deduplication result */
export interface DeduplicationResult {
  /** Map from content hash to canonical definition */
  canonicalDefs: Map<string, CanonicalDefinition>;
  /** Map from original ID (per-frame) to canonical ID */
  idMapping: Map<string, Map<string, string>>;
  /** Statistics */
  stats: DeduplicationStats;
}

/** Canonical definition after deduplication */
export interface CanonicalDefinition {
  /** Canonical ID (e.g., "def_abc123") */
  id: string;
  /** Content hash */
  hash: string;
  /** Normalized SVG content */
  content: string;
  /** Element tag name */
  tagName: string;
  /** Reference count (how many frames use this) */
  refCount: number;
  /** Size in bytes */
  size: number;
  /** Whether this is a shared pattern */
  isPattern: boolean;
}

/** Deduplication statistics */
export interface DeduplicationStats {
  /** Total definitions across all frames (before dedup) */
  totalDefinitions: number;
  /** Unique definitions (after dedup) */
  uniqueDefinitions: number;
  /** Total bytes before dedup */
  totalBytes: number;
  /** Total bytes after dedup */
  uniqueBytes: number;
  /** Compression ratio */
  compressionRatio: number;
  /** Patterns found */
  patternCount: number;
  /** Top definitions by reference count */
  topDefinitions: Array<{ id: string; refCount: number; size: number }>;
}

/** Processed sprite for output */
export interface ProcessedSprite {
  /** Symbol ID (same as original filename without extension) */
  id: string;
  /** Animation name */
  animationName: string;
  /** Frame index */
  frameIndex: number;
  /** ViewBox string */
  viewBox: string;
  /** Main transform */
  mainTransform: string;
  /** Use elements with canonical hrefs */
  useElements: UseElement[];
  /** Hash of entire frame structure (for frame-level dedup) */
  structureHash: string;
  /** If duplicate, reference to original frame */
  duplicateOf?: string;
}

/** Output manifest */
export interface Manifest {
  /** Version number */
  version: number;
  /** Sprite/character ID */
  spriteId: string;
  /** Animations metadata */
  animations: Record<string, AnimationMetadata>;
  /** Processing statistics */
  stats: ManifestStats;
  /** Output files */
  files: {
    /** Combined spritesheet (main output file) */
    spritesheet: string;
    /** Definitions only (for reference) */
    defs: string;
    /** Symbols only (for reference) */
    sprites: string;
    /** This manifest */
    manifest: string;
  };
}

/** Animation metadata */
export interface AnimationMetadata {
  /** Animation name */
  name: string;
  /** Frame count */
  frameCount: number;
  /** Frame IDs in order */
  frames: string[];
  /** Duplicate frames mapping */
  duplicates: Record<string, string>;
}

/** Manifest statistics */
export interface ManifestStats {
  /** Total frames */
  totalFrames: number;
  /** Unique frames (after frame-level dedup) */
  uniqueFrames: number;
  /** Duplicate frames */
  duplicateFrames: number;
  /** Input size in bytes */
  inputSize: number;
  /** Output size in bytes */
  outputSize: number;
  /** Compression percentage */
  compressionPercent: number;
  /** Deduplication stats */
  deduplication: DeduplicationStats;
}

/** Output optimization options */
export interface OptimizationOptions {
  /** Use short sequential IDs (d0, d1) instead of hash-based IDs */
  shortIds: boolean;
  /** Minify output (remove whitespace/newlines) */
  minify: boolean;
  /** Numeric precision for coordinates (default: 2) */
  precision: number;
  /** Remove redundant/default attributes */
  stripDefaults: boolean;
}

/** CLI pack options */
export interface PackOptions {
  /** Input directory path */
  input: string;
  /** Output directory path */
  output: string;
  /** Numeric precision for transforms (default: 2) */
  precision: number;
  /** Inline definitions smaller than this size */
  inlineThreshold: number;
  /** Dry run - analyze only, don't write output */
  dryRun: boolean;
  /** Optimization options */
  optimize: OptimizationOptions;
}

/** CLI analyze options */
export interface AnalyzeOptions {
  /** Input directory path */
  input: string;
  /** Show detailed stats */
  detailed: boolean;
}

/** Atlas frame data for runtime loading */
export interface AtlasFrame {
  /** Frame ID */
  id: string;
  /** X position in atlas */
  x: number;
  /** Y position in atlas */
  y: number;
  /** Width */
  width: number;
  /** Height */
  height: number;
  /** Original viewBox minX (for positioning) */
  offsetX: number;
  /** Original viewBox minY (for positioning) */
  offsetY: number;
}

/** Atlas manifest for runtime loading */
export interface AtlasManifest {
  /** Version */
  version: number;
  /** Animation name */
  animation: string;
  /** Atlas dimensions */
  width: number;
  height: number;
  /** Frame data */
  frames: AtlasFrame[];
  /** Frame order (includes duplicates referencing originals) */
  frameOrder: string[];
  /** Duplicate mappings */
  duplicates: Record<string, string>;
  /** FPS */
  fps: number;
}
