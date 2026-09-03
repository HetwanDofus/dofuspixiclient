import { ExtrasKind, MAGIC, SectionType } from "./types.ts";

/**
 * Lightweight reader for values the client needs to pull out of a .dofasset
 * at runtime without materialising the full CompiledAsset. Right now: the
 * Extras section (section 9), which carries what used to live in sidecar
 * manifest.json files.
 *
 * The .dofasset header layout (kept stable; see SectionType):
 *
 *   u8[4] magic = "DASF"
 *   u16   version
 *   u16   assetType
 *   u32   assetId
 *   u16   sectionCount
 *   u16   flags
 *   u32   reserved
 *   (sectionCount × 10 bytes) directory: {u16 type, u32 offset, u32 length}
 */

const HEADER_SIZE = 20;
const DIRECTORY_ENTRY_SIZE = 10;

export interface DofassetHeader {
  version: number;
  assetType: number;
  assetId: number;
  sectionCount: number;
}

function assertMagic(view: DataView): void {
  for (let i = 0; i < 4; i++) {
    if (view.getUint8(i) !== MAGIC[i]) {
      throw new Error("Not a .dofasset (bad magic)");
    }
  }
}

export function readHeader(bytes: Uint8Array): DofassetHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assertMagic(view);
  return {
    version: view.getUint16(4, true),
    assetType: view.getUint16(6, true),
    assetId: view.getUint32(8, true),
    sectionCount: view.getUint16(12, true),
  };
}

interface SectionRange {
  type: number;
  offset: number;
  length: number;
}

function directory(bytes: Uint8Array): SectionRange[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assertMagic(view);
  const sectionCount = view.getUint16(12, true);
  const out: SectionRange[] = [];
  for (let i = 0; i < sectionCount; i++) {
    const base = HEADER_SIZE + i * DIRECTORY_ENTRY_SIZE;
    out.push({
      type: view.getUint16(base, true),
      offset: view.getUint32(base + 2, true),
      length: view.getUint32(base + 6, true),
    });
  }
  return out;
}

export interface ReadExtrasResult {
  kind: ExtrasKind;
  data: unknown;
}

/**
 * Find and decode the Extras section from a loaded .dofasset, returning
 * `null` when the binary does not carry one.
 */
export function readExtras(bytes: Uint8Array): ReadExtrasResult | null {
  const section = directory(bytes).find((s) => s.type === SectionType.Extras);
  if (!section) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kind = view.getUint16(section.offset, true) as ExtrasKind;
  const len = view.getUint32(section.offset + 2, true);
  const payloadStart = section.offset + 6;
  const jsonBytes = bytes.subarray(payloadStart, payloadStart + len);
  const json = new TextDecoder("utf-8").decode(jsonBytes);
  return { kind, data: json.length > 0 ? JSON.parse(json) : null };
}

/**
 * Typed helpers for the two shapes the pipeline writes today.
 */
export interface SpellExtrasAnimation {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  fps: number;
}

export interface SpellExtras {
  fps: number;
  mainTimelineScale: number;
  requiresTypeScript: boolean;
  sounds: { frame: number; soundId: string }[];
  animationMeta: Record<
    string,
    {
      stopFrame?: number;
      fadingFrame?: number;
      isComposite?: boolean;
      hasMorphShapes?: boolean;
    }
  >;
  /** Per-animation canvas dims + offsets the client needs to position sprites. */
  animations: Record<string, SpellExtrasAnimation>;
}

export interface TileExtrasAnimation {
  animation: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  fps: number;
  frames: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
    page?: number;
  }>;
  frameOrder?: string[];
  duplicates?: Record<string, string>;
  baseFrame?: {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
    page?: number;
  };
  baseZOrder?: "above" | "below";
  pages?: Array<{ file: string; width: number; height: number }>;
}

/**
 * One state of an interactive element, as a run of the tile's frames.
 *
 * A tree, a vein or a crop is a state machine the server drives with
 * `GDF;<cell>;<frame>`: `frame` is that 1-based number, and the run it names
 * is either a single resting image (`count === 1`) or the transition into
 * that state — the tree falling, the crop growing back — whose last frame is
 * where the element comes to rest.
 */
export interface TileExtrasState {
  frame: number;
  start: number;
  count: number;
}

export interface TileExtras {
  version: number;
  spriteId: string;
  behavior: "static" | "slope" | "animated" | "random" | "resource";
  fpsHint?: number;
  autoplay?: boolean;
  loop?: boolean;
  /** Present on interactive elements only — see {@link TileExtrasState}. */
  states?: TileExtrasState[];
  animations: Record<string, TileExtrasAnimation>;
}

export function readSpellExtras(bytes: Uint8Array): SpellExtras | null {
  const extras = readExtras(bytes);
  if (!extras || extras.kind !== ExtrasKind.Spell) return null;
  return extras.data as SpellExtras;
}

export function readTileExtras(bytes: Uint8Array): TileExtras | null {
  const extras = readExtras(bytes);
  if (!extras || extras.kind !== ExtrasKind.Tile) return null;
  return extras.data as TileExtras;
}
