// Map asset loader. Ports the canonical Dofus 1.29 path from
// `dofus/managers/MapsServersManager.as` + `ank/battlefield/utils/Compressor.as`:
//
//   1. Server emits `GDM|<mapId>|<date>|<key>`.
//   2. Client fetches `/maps/<mapId>_<date>X.swf` (the `X` suffix is
//      present whenever the GDM key is non-empty).
//   3. The SWF is a zlib-compressed AS2 stub that, at run-time, sets
//      `id`, `width`, `height`, `mapData`, etc. on a target object via
//      a sequence of `ActionPush <value>` + `ActionPush "field"` +
//      `ActionSetMember` triples drawing on a `ConstantPool`.
//   4. We walk the SWF tags, decode the ConstantPool, and replay the
//      action stack to build the same `oData` object the canonical
//      client receives.
//   5. `mapData` is XOR-encrypted (per-byte hex string). We decrypt
//      with the prepared key from GDM and the canonical checksum-based
//      offset (`parseInt(checksum(key), 16) * 2`).
//   6. Each cell is 10 base64 chars; `decodeCell` unpacks the bitfield
//      to the same shape the renderer expects (`CellData`).

import { decypher, prepareKey, checksum } from "@dofus/dofus1-net";
import { unzlibSync } from "fflate";

import type { CellData } from "@/game/datacenter/cell";
import type { MapData } from "@/game/datacenter/map";

/** Map-asset descriptor extracted from the SWF, pre-decrypt. */
export interface RawMapAsset {
  id: number;
  width: number;
  height: number;
  backgroundNum: number;
  ambianceId?: number;
  musicId?: number;
  bOutdoor?: number;
  capabilities?: number;
  canAggro?: number;
  canUseInventory?: number;
  canUseObject?: number;
  canChangeCharac?: number;
  /** Still encrypted at this stage — feed to `decryptMapData` next. */
  mapData: string;
}

/**
 * High-level entry point: fetch + decrypt + decode in one call.
 * Resolves with the same `MapData` shape the battlefield expects.
 *
 * `key` may be empty for unencrypted maps (rare in practice — the
 * server omits the key only for the legacy "free maps"). When empty,
 * the embedded `mapData` is already plaintext.
 */
export async function loadMap(
  mapId: string,
  date: string,
  key: string,
  baseUrl = "",
): Promise<MapData> {
  const filename = `${mapId}_${date}${key.length > 0 ? "X" : ""}.swf`;
  const url = `${baseUrl}/maps/${filename}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`map fetch ${url} → HTTP ${resp.status}`);
  }
  const bytes = new Uint8Array(await resp.arrayBuffer());
  const raw = parseMapSwf(bytes);

  const plaintext =
    key.length > 0 ? decryptMapData(raw.mapData, key) : raw.mapData;

  const cells = decodeCells(plaintext);
  return {
    id: raw.id,
    width: raw.width,
    height: raw.height,
    backgroundNum: raw.backgroundNum,
    cells,
  };
}

/**
 * Mirrors `Aks.decypherData`: XOR each hex-byte against the rotated
 * key (offset = `parseInt(checksum(key), 16) * 2`), then `unescape`
 * the result.
 *
 * The key arriving over GDM is "hex-coded escaped key bytes" — same
 * format as the AK frame on the auth socket. `prepareKey` decodes
 * it back to the raw XOR-pad.
 */
export function decryptMapData(encrypted: string, gdmKey: string): string {
  const prepared = prepareKey(gdmKey);
  const offset = (Number.parseInt(checksum(prepared), 16) || 0) * 2;
  return decypher(encrypted, prepared, offset);
}

// ────────────────────────────── SWF parser ──────────────────────────────

/**
 * Parse a Dofus map SWF and return the runtime `oData` object the
 * `MapsServersManager#parseMap` consumes. The parser only knows the
 * narrow subset of SWF needed by these maps:
 *
 *   - `CWS` zlib-compressed payload (verified for every 1.29 map blob)
 *   - One `DoAction` (tag type 12)
 *   - One `ActionConstantPool` (op 0x88)
 *   - A sequence of `ActionPush` (op 0x96) and `ActionSetMember`
 *     (op 0x4F) — Push leaves a value on the stack; SetMember pops
 *     `(value, field, object)` and assigns.
 *   - We track only `id/width/height/backgroundNum/ambianceId/...
 *     /mapData/canAggro/...` writes; everything else (`System.security
 *     .allowDomain`, frame setup, etc.) is ignored.
 */
export function parseMapSwf(swfBytes: Uint8Array): RawMapAsset {
  const sig = String.fromCharCode(swfBytes[0]!, swfBytes[1]!, swfBytes[2]!);
  const compressed = swfBytes.subarray(8);
  let body: Uint8Array;
  if (sig === "CWS") {
    body = unzlibSync(compressed);
  } else if (sig === "FWS") {
    body = compressed;
  } else {
    throw new Error(`unsupported SWF signature ${sig}`);
  }

  const reader = new SwfReader(body);
  // Skip frame rect (variable length — first byte tells us the bit count).
  reader.skipRect();
  reader.skipBytes(2); // frame rate (fixed16)
  reader.skipBytes(2); // frame count

  // Walk tags.
  let strings: string[] = [];
  const out: Partial<RawMapAsset> = {};
  // SetMember consumes three stack entries:
  //   - object (we ignore; canonical pushes a reference to the map root)
  //   - field name (string)
  //   - value (string | number | constant)
  // ActionPush events push onto `stack`; we don't faithfully model the
  // entire AS2 VM, just the assignment pattern.
  const stack: unknown[] = [];

  while (!reader.eof()) {
    const tag = reader.readUI16();
    const type = tag >>> 6;
    let length = tag & 0x3f;
    if (length === 0x3f) {
      length = reader.readUI32();
    }
    const tagEnd = reader.cursor + length;
    if (type === 0) {
      // End tag
      break;
    }
    if (type === 12) {
      // DoAction — the body we actually care about.
      runActions(reader, tagEnd, strings, stack, out, (sp) => {
        strings = sp;
      });
    } else {
      reader.cursor = tagEnd;
    }
  }

  // The SWF *always* sets these — anything missing is a parser bug.
  for (const f of ["id", "width", "height", "mapData"] as const) {
    if (out[f] === undefined) {
      throw new Error(`map SWF missing required field "${f}"`);
    }
  }
  return {
    id: out.id as number,
    width: out.width as number,
    height: out.height as number,
    backgroundNum: out.backgroundNum ?? 0,
    ambianceId: out.ambianceId,
    musicId: out.musicId,
    bOutdoor: out.bOutdoor,
    capabilities: out.capabilities,
    canAggro: out.canAggro,
    canUseInventory: out.canUseInventory,
    canUseObject: out.canUseObject,
    canChangeCharac: out.canChangeCharac,
    mapData: out.mapData as string,
  };
}

function runActions(
  reader: SwfReader,
  end: number,
  initialStrings: string[],
  stack: unknown[],
  out: Partial<RawMapAsset>,
  setStrings: (s: string[]) => void,
): void {
  let strings = initialStrings;
  while (reader.cursor < end) {
    const op = reader.readUI8();
    if (op === 0) {
      // ActionEndFlag
      break;
    }
    let payloadLen = 0;
    if (op >= 0x80) {
      payloadLen = reader.readUI16();
    }
    const payloadEnd = reader.cursor + payloadLen;
    if (op === 0x88) {
      // ActionConstantPool
      const count = reader.readUI16();
      const pool: string[] = [];
      for (let i = 0; i < count; i++) {
        pool.push(reader.readString());
      }
      strings = pool;
      setStrings(pool);
    } else if (op === 0x96) {
      // ActionPush — sequence of (type, value) pairs.
      while (reader.cursor < payloadEnd) {
        const t = reader.readUI8();
        switch (t) {
          case 0: // string (null-terminated)
            stack.push(reader.readString());
            break;
          case 1: // float32
            stack.push(reader.readFloat32());
            reader.cursor += 0;
            break;
          case 2: // null
            stack.push(null);
            break;
          case 3: // undefined
            stack.push(undefined);
            break;
          case 4: // register
            stack.push({ register: reader.readUI8() });
            break;
          case 5: // boolean
            stack.push(reader.readUI8() !== 0);
            break;
          case 6: // float64 (low 32 then high 32 — SWF quirk)
            stack.push(reader.readFloat64Swf());
            break;
          case 7: // int32
            stack.push(reader.readInt32());
            break;
          case 8: // constant8
            stack.push(strings[reader.readUI8()] ?? "");
            break;
          case 9: // constant16
            stack.push(strings[reader.readUI16()] ?? "");
            break;
          default:
            // Unknown push type — drop the rest of this push action.
            reader.cursor = payloadEnd;
            break;
        }
      }
    } else if (op === 0x4f) {
      // ActionSetMember: stack = [..., object, name, value]
      const value = stack.pop();
      const name = stack.pop();
      stack.pop(); // discard object
      if (typeof name === "string" && isMapField(name)) {
        assignMapField(out, name, value);
      }
    } else if (op === 0x1d) {
      // ActionSetVariable: stack = [..., name, value]
      const value = stack.pop();
      const name = stack.pop();
      if (typeof name === "string" && isMapField(name)) {
        assignMapField(out, name, value);
      }
    } else if (op === 0x1c) {
      // ActionGetVariable — pop name, push value. We don't track
      // variables, so push undefined; SetMember below will see the
      // current `name` string regardless.
      stack.pop();
      stack.push(undefined);
    } else if (op === 0x17) {
      // ActionPop
      stack.pop();
    } else {
      // Skip any other action's payload.
      reader.cursor = payloadEnd;
      continue;
    }
    if (op >= 0x80) {
      reader.cursor = payloadEnd;
    }
  }
}

const MAP_FIELDS = new Set([
  "id",
  "width",
  "height",
  "backgroundNum",
  "ambianceId",
  "musicId",
  "bOutdoor",
  "capabilities",
  "canAggro",
  "canUseInventory",
  "canUseObject",
  "canChangeCharac",
  "mapData",
]);

function isMapField(name: string): boolean {
  return MAP_FIELDS.has(name);
}

function assignMapField(
  out: Partial<RawMapAsset>,
  name: string,
  value: unknown,
): void {
  if (name === "mapData") {
    out.mapData = String(value ?? "");
    return;
  }
  // All other tracked fields are numeric in canonical AS2; values
  // may arrive as string constants (from ConstantPool) so coerce.
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(n)) {
    (out as Record<string, number>)[name] = n;
  }
}

class SwfReader {
  cursor = 0;
  constructor(private readonly buf: Uint8Array) {}

  eof(): boolean {
    return this.cursor >= this.buf.length;
  }
  readUI8(): number {
    return this.buf[this.cursor++] ?? 0;
  }
  readUI16(): number {
    const v =
      (this.buf[this.cursor] ?? 0) | ((this.buf[this.cursor + 1] ?? 0) << 8);
    this.cursor += 2;
    return v;
  }
  readUI32(): number {
    const v =
      ((this.buf[this.cursor] ?? 0) |
        ((this.buf[this.cursor + 1] ?? 0) << 8) |
        ((this.buf[this.cursor + 2] ?? 0) << 16) |
        ((this.buf[this.cursor + 3] ?? 0) << 24)) >>>
      0;
    this.cursor += 4;
    return v;
  }
  readInt32(): number {
    return this.readUI32() | 0;
  }
  readFloat32(): number {
    const dv = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    const v = dv.getFloat32(this.cursor, true);
    this.cursor += 4;
    return v;
  }
  readFloat64Swf(): number {
    // SWF stores f64 as two halves swapped relative to little-endian.
    const lo = this.readUI32();
    const hi = this.readUI32();
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setUint32(0, lo, true);
    view.setUint32(4, hi, true);
    return view.getFloat64(0, true);
  }
  readString(): string {
    let end = this.cursor;
    while (end < this.buf.length && this.buf[end] !== 0) {
      end++;
    }
    const bytes = this.buf.subarray(this.cursor, end);
    this.cursor = end + 1; // skip the null terminator
    return new TextDecoder("latin1").decode(bytes);
  }
  skipBytes(n: number): void {
    this.cursor += n;
  }
  /** Skip an SWF RECT: first 5 bits = nBits, then 4 × nBits-bit signed
   *  fields for xMin/xMax/yMin/yMax. We just skip the bytes. */
  skipRect(): void {
    const first = this.buf[this.cursor] ?? 0;
    const nBits = first >>> 3;
    const totalBits = 5 + 4 * nBits;
    const totalBytes = Math.ceil(totalBits / 8);
    this.cursor += totalBytes;
  }
}

// ────────────────────────── Cell decoder ────────────────────────────

const HASH_CODES: Record<string, number> = (() => {
  const arr =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
  const m: Record<string, number> = {};
  for (let i = 0; i < arr.length; i++) m[arr[i] as string] = i;
  return m;
})();

function decode64(ch: string): number {
  return HASH_CODES[ch] ?? 0;
}

/**
 * Walk the decrypted cell string. Each cell is 10 base64 chars.
 * Mirrors `Compressor.uncompressCell`:
 *
 *   v[0..9] = decoded base64 ints
 *   active        = (v[0] & 0x20) !== 0
 *   lineOfSight   = (v[0] & 1) !== 0
 *   layerGroundRot= (v[1] & 0x30) >> 4
 *   groundLevel   = v[1] & 0x0F
 *   movement      = (v[2] & 0x38) >> 3
 *   layerGroundNum = ((v[0] & 0x18) << 6) + ((v[2] & 7) << 6) + v[3]
 *   groundSlope   = (v[4] & 0x3C) >> 2
 *   layerGroundFlip = (v[4] & 2) !== 0
 *   layerObject1Num = ((v[0] & 4) << 11) + ((v[4] & 1) << 12) + (v[5] << 6) + v[6]
 *   layerObject1Rot = (v[7] & 0x30) >> 4
 *   layerObject1Flip = (v[7] & 8) !== 0
 *   layerObject2Flip = (v[7] & 4) !== 0
 *   layerObject2Interactive = (v[7] & 2) !== 0
 *   layerObject2Num = ((v[0] & 2) << 12) + ((v[7] & 1) << 12) + (v[8] << 6) + v[9]
 */
export function decodeCells(sData: string): CellData[] {
  const out: CellData[] = [];
  for (let i = 0, id = 0; i + 9 < sData.length; i += 10, id++) {
    const v: number[] = [];
    for (let j = 0; j < 10; j++) {
      v.push(decode64(sData.charAt(i + j)));
    }
    const active = (v[0]! & 0x20) !== 0;
    const lineOfSight = (v[0]! & 1) !== 0;
    const layerGroundRot = (v[1]! & 0x30) >> 4;
    const groundLevel = v[1]! & 0x0f;
    const movement = (v[2]! & 0x38) >> 3;
    const layerGroundNum = ((v[0]! & 0x18) << 6) + ((v[2]! & 7) << 6) + v[3]!;
    const groundSlope = (v[4]! & 0x3c) >> 2;
    const layerGroundFlip = (v[4]! & 2) !== 0;
    const layerObject1Num =
      ((v[0]! & 4) << 11) + ((v[4]! & 1) << 12) + (v[5]! << 6) + v[6]!;
    const layerObject1Rot = (v[7]! & 0x30) >> 4;
    const layerObject1Flip = (v[7]! & 8) !== 0;
    const layerObject2Flip = (v[7]! & 4) !== 0;
    const layerObject2Num =
      ((v[0]! & 2) << 12) + ((v[7]! & 1) << 12) + (v[8]! << 6) + v[9]!;
    out.push({
      id,
      active,
      ground: layerGroundNum,
      layer1: layerObject1Num,
      layer2: layerObject2Num,
      groundLevel,
      groundSlope,
      walkable: movement > 1,
      movement,
      lineOfSight,
      layerGroundRot,
      layerGroundFlip,
      layerObject1Rot,
      layerObject1Flip,
      layerObject2Rot: 0,
      layerObject2Flip,
    });
  }
  return out;
}
