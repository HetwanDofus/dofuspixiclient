// Parser primitives ("templates") for the Dofus 1.29 wire protocol.
//
// AS2 callers use raw `String.split(sep)` followed by ad-hoc Number()
// / parseInt(..., 16) / "0"/"1" coercion. These helpers normalise that
// pattern so per-message files stay short and readable.
//
// Source references: assets/sources/client-code/dofus/aks/Account.as,
// Game.as, Chat.as.

export const SEP_PIPE = "|";
export const SEP_SEMI = ";";
export const SEP_BANG = "!";
export const SEP_COMMA = ",";
export const SEP_COLON = ":";

export const splitPipe = (s: string): string[] =>
  s.length === 0 ? [] : s.split(SEP_PIPE);
export const splitSemi = (s: string): string[] =>
  s.length === 0 ? [] : s.split(SEP_SEMI);
export const splitBang = (s: string): string[] =>
  s.length === 0 ? [] : s.split(SEP_BANG);
export const splitComma = (s: string): string[] =>
  s.length === 0 ? [] : s.split(SEP_COMMA);
export const splitColon = (s: string): string[] =>
  s.length === 0 ? [] : s.split(SEP_COLON);

/**
 * Base-10 integer parse with a default for empty / NaN inputs. AS2 uses
 * `Number(...)` which yields NaN for "" — we coerce that to 0 (or the
 * provided fallback) to match downstream code that treats undefined
 * counts as 0.
 */
export function parseInt10(s: string | undefined, fallback = 0): number {
  if (s === undefined || s === "") {
    return fallback;
  }

  const n = Number.parseInt(s, 10);

  return Number.isNaN(n) ? fallback : n;
}

/** Hex parse (AS2: `_global.parseInt(s, 16)`). Used by Account.as status codes. */
export function parseInt16(s: string | undefined, fallback = 0): number {
  if (s === undefined || s === "") {
    return fallback;
  }

  const n = Number.parseInt(s, 16);

  return Number.isNaN(n) ? fallback : n;
}

/**
 * 1.29's "0" / non-zero boolean convention. Empty string → false (no
 * data on the wire is treated as the negative case, mirroring
 * `_loc3_[1] != "0"`).
 */
export function parseBool01(s: string | undefined): boolean {
  return s !== undefined && s !== "" && s !== "0";
}

/** Optional string — empty string maps to undefined for nullable fields. */
export function parseOptString(s: string | undefined): string | undefined {
  return s === undefined || s === "" ? undefined : s;
}

/**
 * Split + map. Equivalent to `s.split(sep).map(item)` but skips empty
 * inputs entirely (AS2 frequently sends an empty payload for empty
 * lists, and `"".split("|")` yields `[""]` which would feed an empty
 * string to the item parser).
 */
export function parseList<T>(
  s: string | undefined,
  sep: string,
  item: (chunk: string, index: number) => T
): T[] {
  if (s === undefined || s === "") {
    return [];
  }

  return s.split(sep).map(item);
}

/**
 * For sub-tagged opcodes like `cMt<body>` where char 2 is a sub-type
 * and the rest is the body. Returns `{ tag: "t", body: "<body>" }`.
 */
export function parseTagged(s: string): { tag: string; body: string } {
  return { tag: s.charAt(0), body: s.slice(1) };
}

/**
 * Schema-driven struct parse. `schema` lists field names in wire
 * order; entries that should be skipped (reserved fields, etc.) can be
 * `null`. Returns a partial object — callers coerce types per-field
 * with the `Int10` / `Bool01` / etc. helpers.
 *
 * Example (chararacter entry, semicolon-separated):
 *   parseStruct(chunk, ";", ["id", "name", "level", "gfxId", "color1"])
 *   → { id: "...", name: "...", level: "...", gfxId: "...", color1: "..." }
 */
export function parseStruct<T extends object>(
  s: string,
  sep: string,
  schema: ReadonlyArray<keyof T | null>
): Partial<Record<keyof T, string>> {
  const parts = s.split(sep);
  const out: Partial<Record<keyof T, string>> = {};

  for (let i = 0; i < schema.length; i++) {
    const key = schema[i];

    if (key !== null && parts[i] !== undefined) {
      out[key] = parts[i] as string;
    }
  }

  return out;
}
