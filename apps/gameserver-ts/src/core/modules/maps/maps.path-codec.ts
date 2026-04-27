// Port of apps/gameserver/pkg/exploration/domain/pathcodec.go — decodes the
// Dofus 1.29 GA1 (movement) path encoding. Two chars per cell (12-bit id),
// one char per direction (0..7). The decimal form used by the modern TS
// client is also accepted; direction is reconstructed from grid adjacency
// at parse time so the validator can treat every step as authoritative.

import { directionOffsets } from "@modules/maps/maps.edge";

const HASH_ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";

const HASH_INDEX = (() => {
  const table = new Int8Array(256).fill(-1);

  for (let i = 0; i < HASH_ALPHABET.length; i++) {
    table[HASH_ALPHABET.charCodeAt(i)] = i;
  }

  return table;
})();

export class MalformedPathError extends Error {
  constructor(message: string) {
    super(`path-codec: ${message}`);
    this.name = "MalformedPathError";
  }
}

export interface PathStep {
  direction: number;
  cell: number;
}

function hashIndex(code: number): number {
  const idx = HASH_INDEX[code];

  if (idx === undefined || idx < 0) {
    throw new MalformedPathError(`invalid HASH_CELL char code ${code}`);
  }

  return idx;
}

export function decodeCell(s: string): number {
  if (s.length < 2) {
    throw new MalformedPathError("cell segment shorter than 2 chars");
  }

  return hashIndex(s.charCodeAt(0)) * 64 + hashIndex(s.charCodeAt(1));
}

export function decodePath(s: string): PathStep[] {
  if (s.length === 0) {
    return [];
  }

  if (s.length % 3 !== 0) {
    throw new MalformedPathError("encoded length not a multiple of 3");
  }

  const steps: PathStep[] = [];

  for (let i = 0; i < s.length; i += 3) {
    const dir = hashIndex(s.charCodeAt(i));

    if (dir > 7) {
      throw new MalformedPathError(`invalid direction char at ${i}`);
    }

    steps.push({ direction: dir, cell: decodeCell(s.slice(i + 1, i + 3)) });
  }

  return steps;
}

// Decimal form: "fromCell,c1,c2,..." — first element is the starting cell
// (used to anchor direction inference). Each subsequent step's direction is
// derived from the cell-id delta against the previous cell; non-adjacent
// pairs are rejected rather than silently defaulting.
export function decodePathDecimal(s: string, mapWidth: number): PathStep[] {
  if (s.length === 0) {
    return [];
  }

  const parts = s.split(",");

  if (parts.length < 2) {
    return [];
  }

  const cells: number[] = [];

  for (const raw of parts) {
    const cell = Number.parseInt((raw ?? "").trim(), 10);

    if (!Number.isFinite(cell)) {
      throw new MalformedPathError(`non-numeric cell ${JSON.stringify(raw)}`);
    }

    cells.push(cell);
  }

  const offsets = directionOffsets(mapWidth);
  const steps: PathStep[] = [];

  for (let i = 1; i < cells.length; i++) {
    const prev = cells[i - 1] as number;
    const next = cells[i] as number;
    const direction = offsets.indexOf(next - prev);

    if (direction < 0) {
      throw new MalformedPathError(`step ${i} not adjacent: ${prev} → ${next}`);
    }

    steps.push({ direction, cell: next });
  }

  return steps;
}

// Disambiguate between the two encodings by a character the hash alphabet
// cannot contain ("," is outside a..z A..Z 0..9 - _).
export function decodePathParams(s: string, mapWidth: number): PathStep[] {
  return s.includes(",") ? decodePathDecimal(s, mapWidth) : decodePath(s);
}
