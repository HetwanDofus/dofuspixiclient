import { getDirection } from "@dofus/grid";

/**
 * Hash codec used by Dofus 1.29 for fight movement (GA1) — packs each
 * (direction, cellId) step into 3 ASCII chars: 1 for direction, 2 for
 * the 12-bit cell ID. Mirrors apps/gameserver/pkg/exploration/domain/
 * pathcodec.go (EncodeDirection / EncodeCell). The fight server still
 * decodes via DecodePath; only roleplay accepts the comma-separated
 * decimal form.
 */
const HASH_ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";

function encodeCell(cellId: number): string {
  const c = cellId & 0x0fff;
  return HASH_ALPHABET[Math.floor(c / 64)] + HASH_ALPHABET[c % 64];
}

function encodeDirection(direction: number): string {
  return HASH_ALPHABET[direction & 0x07];
}

/**
 * Encode a path as the hashed fight-movement wire form. `path[0]` is
 * the starting cell (current position); subsequent entries are the
 * cells walked through. Returns "" for a no-op.
 */
export function encodeFightPath(path: number[], mapWidth: number): string {
  if (path.length < 2) {
    return "";
  }
  let out = "";
  for (let i = 1; i < path.length; i++) {
    const direction = getDirection(path[i - 1], path[i], mapWidth);
    out += encodeDirection(direction) + encodeCell(path[i]);
  }
  return out;
}
