// Path codec — base64 cell-paths shared on the wire by the canonical
// Dofus 1.29 client and AraknemuHorizon. Ported from
// `assets/sources/client-code/ank/battlefield/utils/Compressor.as`:
// `compressPath` / `extractFullPath` / `makeFullPath`.
//
// Layout: each step is 3 base64 chars `<dir><high6><low6>`:
//   - `dir` is 0..7 (E/SE/S/SW/W/NW/N/NE in canonical isometric order)
//   - `(high << 6) | low` is the destination cell id
//
// `compressPath` emits the LIGHT path (only direction-change keyframes,
// matching `makeLightPath`). `decompressPath` expands a light path
// back into the full cell-by-cell walk via `makeFullPath`.

const ZK_ARRAY = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
const ZK_HASH: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < ZK_ARRAY.length; i++) m[ZK_ARRAY[i] as string] = i;
  return m;
})();

export function encode64(value: number): string {
  return ZK_ARRAY[value & 0x3f] as string;
}

export function decode64(ch: string): number {
  return ZK_HASH[ch] ?? 0;
}

export interface PathStep {
  num: number;
  dir: number;
}

/**
 * 4-way cardinal deltas + 4-way diagonal deltas in the canonical
 * direction order (0..7). Indexes into the array by `dir` to get the
 * cell-id delta for the given map width.
 */
function dirDeltas(width: number): number[] {
  return [
    1,                  // 0 — East
    width,              // 1 — SouthEast
    width * 2 - 1,      // 2 — South
    width - 1,          // 3 — SouthWest
    -1,                 // 4 — West
    -width,             // 5 — NorthWest
    -(width * 2) + 1,   // 6 — North
    -(width - 1),       // 7 — NorthEast
  ];
}

/**
 * Expand a 3-char-per-step LIGHT path string into the full cell-by-cell
 * sequence. `startCell` is the player's current cell (the first
 * keyframe; some emulators omit it and the caller must inject it).
 * `mapWidth` is the canonical map width (cells per row).
 *
 * Returns `null` when a step would step off-grid (server bug or
 * desynced state). The caller should drop the move and re-sync.
 */
export function decompressPath(
  compressed: string,
  _mapWidth: number,
  cellCount: number,
): PathStep[] | null {
  const out: PathStep[] = [];
  for (let i = 0; i + 2 < compressed.length; i += 3) {
    const dir = decode64(compressed[i] as string);
    const high = decode64(compressed[i + 1] as string);
    const low = decode64(compressed[i + 2] as string);
    const num = ((high & 0x0f) << 6) | low;
    if (num < 0 || num > cellCount) {
      return null;
    }
    out.push({ num, dir });
  }
  return out;
}

/**
 * Expand a LIGHT keyframe sequence into the full cell-by-cell path.
 * Mirrors AS2 `makeFullPath`: walks from each keyframe along its
 * direction until reaching the next keyframe's `num`. Stops with
 * `null` if the walk overshoots (impossible path → server desync).
 */
export function expandFullPath(
  light: PathStep[],
  mapWidth: number,
): number[] | null {
  if (light.length === 0) {
    return [];
  }
  const deltas = dirDeltas(mapWidth);
  const full: number[] = [light[0]?.num ?? 0];
  let cur = full[0] as number;
  const SAFETY = 2 * mapWidth + 1;
  for (let i = 1; i < light.length; i++) {
    const target = light[i]?.num ?? 0;
    const dir = light[i]?.dir ?? 0;
    const delta = deltas[dir];
    if (delta === undefined) {
      return null;
    }
    let guard = SAFETY;
    while (cur !== target) {
      cur += delta;
      full.push(cur);
      if (--guard < 0) {
        return null; // overshoot
      }
    }
  }
  return full;
}

/**
 * Compress a full cell path into the 3-char-per-step LIGHT form the
 * server expects. Mirrors AS2 `makeLightPath(_, undefined)` —
 * `bWithFirst` defaults to `false`, so the start cell is NOT
 * emitted; the server already knows the player's current cell and
 * uses it as the anchor in its own `Decoder.decode(compressed, start)`
 * (see Arakne `ArakneUtils/.../Decoder.java`).
 *
 * The result is a sequence of `(direction, destination)` triples,
 * one per direction-change run. Path `[337, 338, 339]` (two East
 * steps) compresses to a single keyframe `{dir: E, num: 339}` →
 * `"aft"`.
 *
 * Returns "" when the path has fewer than two cells (no actual
 * movement). Callers should not send empty paths.
 */
export function compressPath(full: number[], mapWidth: number): string {
  if (full.length < 2) {
    return "";
  }
  const deltas = dirDeltas(mapWidth);
  // Build per-step `{num, dir}` pairs, then collapse same-direction
  // runs by keeping only the LAST cell of each run.
  const keyframes: PathStep[] = [];
  let lastDir = -1;
  for (let i = 1; i < full.length; i++) {
    const a = full[i - 1] as number;
    const b = full[i] as number;
    const delta = b - a;
    let dir = -1;
    for (let d = 0; d < deltas.length; d++) {
      if (deltas[d] === delta) {
        dir = d;
        break;
      }
    }
    if (dir < 0) {
      // Non-adjacent step — caller error. Best-effort: emit as East
      // and hope the server tolerates.
      dir = 0;
    }
    if (dir !== lastDir) {
      keyframes.push({ num: b, dir });
      lastDir = dir;
    } else {
      // Same direction continues — overwrite the prior keyframe so
      // only the LAST cell in the run is emitted.
      keyframes[keyframes.length - 1] = { num: b, dir };
    }
  }
  let out = "";
  for (const step of keyframes) {
    out += encode64(step.dir & 7);
    out += encode64((step.num & 0xfc0) >> 6);
    out += encode64(step.num & 0x3f);
  }
  return out;
}
