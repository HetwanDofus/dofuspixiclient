import { AreaKind } from "./area.ts";

export interface DecodedZone {
  kind: AreaKind;
  size: number;
}

const SHAPE_LETTERS: Record<string, AreaKind> = {
  P: AreaKind.None,
  C: AreaKind.Circle,
  X: AreaKind.Cross,
  "+": AreaKind.PerpCross,
  T: AreaKind.PerpCross,
  L: AreaKind.Line,
  D: AreaKind.DiagonalLine,
  O: AreaKind.Ring,
  R: AreaKind.Square,
  Q: AreaKind.Sector,
};

function decodeSize(letter: string): number {
  if (letter === "_") {
    return 0;
  }
  const code = letter.charCodeAt(0);
  if (code >= 97 && code <= 122) {
    return code - 96;
  }
  if (code >= 65 && code <= 90) {
    return code - 64;
  }
  return 0;
}

export function decodeZonePair(pair: string): DecodedZone {
  if (pair.length !== 2) {
    return { kind: AreaKind.None, size: 0 };
  }
  const shapeChar = pair[0]!;
  const sizeChar = pair[1]!;
  const kind = SHAPE_LETTERS[shapeChar] ?? AreaKind.None;
  return { kind, size: decodeSize(sizeChar) };
}

export function decodeZones(zones: string, expected: number): DecodedZone[] {
  const out: DecodedZone[] = [];
  if (!zones || zones.length < 2) {
    for (let i = 0; i < expected; i++) {
      out.push({ kind: AreaKind.None, size: 0 });
    }
    return out;
  }
  for (let i = 0; i + 1 < zones.length; i += 2) {
    out.push(decodeZonePair(zones.slice(i, i + 2)));
  }
  while (out.length < expected) {
    out.push({ kind: AreaKind.None, size: 0 });
  }
  return out.slice(0, Math.max(expected, out.length));
}
