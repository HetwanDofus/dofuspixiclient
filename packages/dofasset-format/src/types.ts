// ===== SVG Path Segments =====

export type PathCommandType = "M" | "L" | "Q" | "C" | "Z";

export interface PathSegment {
  type: PathCommandType;
  coords: number[]; // M=2, L=2, Q=4, C=6, Z=0
}

// ===== Draw Commands =====

export const enum DrawCommandType {
  Fill = 0,
  Stroke = 1,
  PatternFill = 2,
  GradientFill = 3,
}

export const enum StrokeWidthMode {
  Fixed = 0,
  /** Legacy `stroke-width="__RESOLUTION__"` placeholder. Flash-twip max rule. */
  Resolution = 1,
  /** `vector-effect="non-scaling-stroke"`. Flash-twip max rule with original width. */
  NonScaling = 2,
}

export const enum FillRule {
  NonZero = 0,
  EvenOdd = 1,
}

export interface Color {
  r: number;
  g: number;
  b: number;
  a: number; // 0-255
}

export interface FillDrawCommand {
  type: DrawCommandType.Fill;
  pathId: number;
  fillRule: FillRule;
  color: Color;
  colorZoneId: number; // 0 = none, 1-3 = zone
  transform: AffineTransform;
  /**
   * 1-based index into `CompiledAsset.clipMasks`, or 0 = no clip.
   * Set when this draw command originates from a path/use wrapped in
   * `<g clip-path="url(#X)">` (a SWF clipDepth mask). The runtime
   * (Vello) is expected to push_layer with the referenced mask
   * geometry before rasterising this command and pop_layer after.
   *
   * Multiple commands may share the same clipMaskId — the runtime can
   * batch consecutive same-mask commands inside a single push/pop pair.
   */
  clipMaskId: number;
}

export interface StrokeDrawCommand {
  type: DrawCommandType.Stroke;
  pathId: number;
  fillRule: FillRule;
  color: Color;
  colorZoneId: number;
  widthMode: StrokeWidthMode;
  width: number;
  opacity: number;
  lineCap: number; // 0=butt, 1=round, 2=square
  lineJoin: number; // 0=miter, 1=round, 2=bevel
  transform: AffineTransform;
  /** See FillDrawCommand.clipMaskId. */
  clipMaskId: number;
}

export interface PatternFillDrawCommand {
  type: DrawCommandType.PatternFill;
  pathId: number;
  fillRule: FillRule;
  imageId: number;
  patternTransform: AffineTransform;
  transform: AffineTransform;
  /** See FillDrawCommand.clipMaskId. */
  clipMaskId: number;
}

export interface GradientStop {
  offset: number; // 0-1
  color: Color;
}

export interface GradientFillDrawCommand {
  type: DrawCommandType.GradientFill;
  pathId: number;
  fillRule: FillRule;
  gradientType: number; // 0 = radial, 1 = linear
  cx: number;
  cy: number;
  fx: number;
  fy: number;
  r: number;
  gradientTransform: AffineTransform;
  stops: GradientStop[];
  transform: AffineTransform;
  /** See FillDrawCommand.clipMaskId. */
  clipMaskId: number;
}

// ===== Clip Masks =====

/**
 * SWF clipDepth mask geometry, referenced from DrawCommands via
 * `clipMaskId` (1-based index into `CompiledAsset.clipMasks`).
 *
 * The mask is a single-path polygon (or compound path) defining the
 * visible region. The runtime applies it via `push_layer(default,
 * default, 1.0, mask_transform, &mask_path)` before rasterising any
 * commands referencing this mask, and `pop_layer()` after.
 *
 * Stored as `PathSegment[]` so the renderer can reuse its existing
 * path tessellation code instead of needing a separate mask
 * representation. The transform is the `<clipPath>`'s own `transform`
 * attribute (Arakne emits one per mask) — applied OUTSIDE the masked
 * draw command's own transform, matching SVG's clip-path semantics.
 */
export interface ClipMask {
  /** 1-based id (0 means "no mask" — never assigned to a real entry). */
  id: number;
  segments: PathSegment[];
  transform: AffineTransform;
}

export type DrawCommand = FillDrawCommand | StrokeDrawCommand | PatternFillDrawCommand | GradientFillDrawCommand;

// ===== Transforms =====

/** [a, b, c, d, tx, ty] - 2D affine transform matrix */
export type AffineTransform = [number, number, number, number, number, number];

export const IDENTITY_TRANSFORM: AffineTransform = [1, 0, 0, 1, 0, 0];

// ===== Body Parts =====

export interface BodyPart {
  id: number;
  drawCommandIds: number[];
}

// ===== Images =====

export interface ExtractedImage {
  id: number;
  width: number;
  height: number;
  pngBytes: Uint8Array;
  contentHash: string;
}

// ===== Color Zones =====

/**
 * How the runtime should interpret `player_colors[]` when applying an HSL
 * replacement for this zone. Kept as a tight u8 enum so the binary can carry
 * per-zone mode without growing the ColorZoneTable layout.
 */
export const enum TintMode {
  /** Default — 3-color player look (body, trim, accent). */
  Player = 0,
  /** 2-color guild emblem (background, foreground). */
  Guild = 1,
  /** 1-color alignment-level ramp (level + side external to binary). */
  AlignmentLevel = 2,
  /** 1-color spell tint (single hue). */
  Spell = 3,
}

export interface ColorZone {
  zoneId: number; // 1-3 for player, 1-2 for guild, 1 for alignment/spell
  playerColorIndex: number; // which slot in player_colors[] to sample from
  tintMode: TintMode;
  originalColors: Color[];
}

// ===== Frames =====

export interface PartInstance {
  bodyPartId: number;
  transformId: number;
}

export interface AccessorySlot {
  slotId: number; // 0-4
  depthIndex: number;
  transformId: number;
  /**
   * Accessory-local frame name to `gotoAndStop` (e.g. "R", "L", "RR").
   * Empty string means "no override" — the renderer falls back to its
   * direction truth table.
   */
  side: string;
}

export interface Frame {
  clipRect: [number, number, number, number]; // x, y, w, h
  offsetX: number;
  offsetY: number;
  parts: PartInstance[];
  accessorySlots: AccessorySlot[];
  /** Transform ID for the frame's SVG offset (used for accessory positioning) */
  frameTransformId: number;
}

// ===== Animations =====

export interface Animation {
  name: string;
  fps: number;
  offsetX: number;
  offsetY: number;
  frameIds: number[]; // indices into global frame table (handles duplicates)
  /** Global frame ID for the base frame, or -1 if none */
  baseFrameId: number;
  /** 0 = below (base renders first), 1 = above */
  baseZOrder: number;
}

// ===== Atlas JSON (input format) =====

export interface AtlasFrame {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

export interface AtlasJson {
  version: number;
  animation: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  frames: AtlasFrame[];
  frameOrder: string[];
  duplicates: Record<string, string>;
  fps: number;
  baseFrame?: AtlasFrame;
  baseZOrder?: string;
}

// ===== Metadata JSON (color zones) =====

/**
 * Per-frame accessory attachment as extracted by the PHP sprite-metadata
 * command. `slot` is the Dofus slot ordinal (0 weapon, 1 hat, 2 cape, 3 pet,
 * 4 shield); `depth` tells the renderer where in the draw order the
 * accessory plugs in; `matrix` is the 6-component affine Flash builds for
 * the accessory (rotation + scale + position), or null when none was set.
 * `side` is the third arg of the AS2 `applyAccessory(mc, slot, side, ...)`
 * call — a short string like "R", "L", "RR", "WL" that names the frame the
 * accessory's own timeline must `gotoAndStop` to. When present it overrides
 * the renderer's direction-fallback truth table, which can pick the wrong
 * face on asymmetric poses (turn frames, emotes).
 */
export interface MetadataAccessory {
  slot: number;
  depth: number;
  x: number;
  y: number;
  matrix?: [number, number, number, number, number, number] | null;
  side?: string;
}

/**
 * `metadata.json` emitted per character sprite. The `animations` block is
 * indexed by animation name → array of per-frame entries. Frame-direct
 * compile pulls `accessories` off each frame to populate ParsedFrame slots
 * (the per-frame SVGs don't carry them); `parts` mirrors the body-part use
 * order inside the per-frame SVG with each entry's Flash display-list
 * `depth` so accessories can be threaded back into the body-part stack at
 * the correct z-position (otherwise a cape at depth 3 ends up in front of
 * the torso at depth 45, etc).
 */
export interface SpriteMetadata {
  colorZones: Record<string, string[]>;
  colorMapping: Record<string, number>;
  animations?: Record<
    string,
    Array<{
      accessories?: MetadataAccessory[];
      parts?: Array<{ depth: number }>;
    }>
  >;
  /**
   * Per-animation `applyEnd` frame (0-based index into the inner
   * timeline). Extracted from each animation's wrapper → inner
   * sprite by scanning frame DoAction tags for `GAC.applyEnd(this)` —
   * the canonical AS call that routes through
   * `GlobalSpriteHandler.applyEnd` (line 430) to
   * `sequencer.onActionEnd()`, advancing the sprite-sequencer past
   * the blocking setAnim step.
   *
   * For displayType-30 spell casts (SpriteHandler.as:782-791), this
   * is what fires action 20 (addEffect) and launches the spell visual
   * — NOT the 1000ms `Sequencer(1000)` fallback. Per-class examples:
   *
   *   sprite 10 (Feca):  anim1R = 30 (= AS frame_31) → 517 ms @ 60 fps
   *
   * Indexed by exported animation name (anim1R, anim1L, hitR, …).
   */
  applyEndFrames?: Record<string, number>;
}

// ===== SVG Parser Output =====

export interface ParsedPath {
  segments: PathSegment[];
  fill: string | null; // hex color or "url(#patternId)" or "none"
  fillOpacity: number;
  fillRule: FillRule;
  stroke: string | null;
  strokeOpacity: number;
  strokeWidth: string | null; // "__RESOLUTION__" or numeric
  strokeLinecap: string;
  strokeLinejoin: string;
  /** SVG `vector-effect` attribute (e.g. "non-scaling-stroke"), inherited. */
  vectorEffect: string | null;
  transform: AffineTransform;
}

export interface ParsedGroup {
  id: string;
  children: ParsedNode[];
  transform: AffineTransform;
  /**
   * Original `clip-path="url(#X)"` reference id from the source SVG (just
   * `X`, no `url()` wrapper). Set when the `<g>` had a `clip-path`
   * attribute. Lookup against `ParsedSvg.clipShapes` to resolve to a
   * ClipMask record during compile.
   */
  clipPathRef?: string;
}

export interface ParsedUse {
  href: string;
  transform: AffineTransform;
}

export type ParsedNode =
  | { type: "path"; data: ParsedPath }
  | { type: "group"; data: ParsedGroup }
  | { type: "use"; data: ParsedUse };

export interface ParsedPattern {
  id: string;
  imageDataUri: string;
  patternTransform: AffineTransform;
  width: number;
  height: number;
}

export interface ParsedGradientStop {
  offset: number;
  color: string; // hex
  opacity: number;
}

export interface ParsedGradient {
  id: string;
  type: "radial" | "linear";
  cx: number;
  cy: number;
  fx: number;
  fy: number;
  r: number;
  gradientTransform: AffineTransform;
  stops: ParsedGradientStop[];
}

export interface ParsedClipRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Non-rectangular `<clipPath>` content from the source SVG. Carries the
 * mask geometry verbatim so the compile step can build a `ClipMask`
 * record. Atlas frame boundaries (rect-shaped clipPaths emitted by
 * svg-spritesheet) end up in `clipPaths: Map<string, ParsedClipRect>`
 * instead — the two pools are mutually exclusive by id.
 */
export interface ParsedClipShape {
  id: string;
  segments: PathSegment[];
  transform: AffineTransform;
}

export interface ParsedFrameUse {
  href: string;
  transform: AffineTransform;
}

export interface ParsedAccessorySlot {
  slotId: number;
  tx: number;
  ty: number;
  matrix: AffineTransform | null;
  depth: number;
  /** Index into the uses array: this slot renders after uses[insertAfterPart - 1] */
  insertAfterPart: number;
  /**
   * Authoritative frame name the accessory's own timeline must `gotoAndStop`
   * to, captured from the SWF's `applyAccessory(mc, slot, side, …)` call.
   * `null` falls back to the renderer's direction truth table.
   */
  side?: string | null;
}

export interface ParsedFrame {
  clipPathId: string;
  clipRect: ParsedClipRect;
  offsetTransform: AffineTransform;
  uses: ParsedFrameUse[];
  accessorySlots: ParsedAccessorySlot[];
}

export interface ParsedSvg {
  width: number;
  height: number;
  definitions: Map<string, ParsedNode>;
  clipPaths: Map<string, ParsedClipRect>;
  /**
   * Non-rect `<clipPath>` defs (SWF clipDepth masks). Indexed by source
   * id. Compiles into `CompiledAsset.clipMasks` after dedup.
   */
  clipShapes: Map<string, ParsedClipShape>;
  patterns: ParsedPattern[];
  gradients: ParsedGradient[];
  frames: ParsedFrame[];
}

// ===== Compiled Asset =====

export interface ExtrasPayload {
  kind: ExtrasKind;
  /** JSON-serialisable payload; serialized as UTF-8 bytes inside the section. */
  data: unknown;
}

export interface CompiledAsset {
  assetId: number;
  paths: PathSegment[][];
  drawCommands: DrawCommand[];
  bodyParts: BodyPart[];
  transforms: AffineTransform[];
  images: ExtractedImage[];
  colorZones: ColorZone[];
  animations: Animation[];
  frames: Frame[];
  /**
   * SWF clipDepth masks. Empty when the asset has no `<g clip-path>`
   * wrappers. DrawCommands reference entries via 1-based `clipMaskId`.
   */
  clipMasks: ClipMask[];
  extras?: ExtrasPayload;
}

// ===== Binary Format Constants =====

export const MAGIC = new Uint8Array([0x44, 0x41, 0x53, 0x46]); // "DASF"
/**
 * Format version. Bumped 1→2 when SWF clipDepth masks became a
 * first-class type:
 *   - new ClipMaskTable section (id 10),
 *   - DrawCommand records gain a trailing `clipMaskId: u32` field.
 *
 * v1 readers refuse v2 binaries (and vice-versa) — there is no
 * cross-version compatibility shim. Recompile every asset with the
 * matching pipeline.
 */
export const FORMAT_VERSION = 2;

export const enum AssetType {
  Sprite = 0,
}

export const enum SectionType {
  PathTable = 0,
  DrawCmdTable = 1,
  BodyPartTable = 2,
  TransformTable = 3,
  ImageTable = 4,
  ColorZoneTable = 5,
  StringTable = 6,
  AnimationTable = 7,
  FrameTable = 8,
  /**
   * Category-specific opaque metadata (UTF-8 JSON). Replaces sidecar
   * manifest.json for spells (sound triggers, lifecycle frames), tiles
   * (behavior, fps_hint, autoplay, loop), and future asset kinds. Layout:
   *   kind: u16       — 0=None, 1=Spell, 2=Tile, 3=Sprite
   *   len:  u32       — JSON byte length
   *   bytes: u8[len]  — UTF-8 JSON
   */
  Extras = 9,
  /**
   * SWF clipDepth masks. Layout:
   *   count: u32
   *   for each mask:
   *     u32        id (1-based, sequential)
   *     f32×6      transform
   *     u32        segmentCount
   *     for each segment:
   *       u8     command (0=M, 1=L, 2=Q, 3=C, 4=Z)
   *       f32×N  coords (M=2, L=2, Q=4, C=6, Z=0)
   * DrawCommand records reference these via a trailing `clipMaskId`
   * field (0 = no mask).
   */
  ClipMaskTable = 10,
}

export const enum ExtrasKind {
  None = 0,
  Spell = 1,
  Tile = 2,
  Sprite = 3,
}
