// Raw frame → typed event. Mirrors the canonical 2-char opcode +
// optional "E" error flag layout used by `DataProcessor.as#process`.
//
// Wire shape:
//   <head><action>[E]<body>
//
//   head    = raw.charAt(0)
//   action  = raw.charAt(1)
//   error   = raw.charAt(2) === "E"
//   body    = error ? raw.slice(3) : raw.slice(2)
//
// AS2 also has some single-char opcodes ("p" = Pong) — those have no
// action char and no error flag, and the body is `raw.slice(1)`. We
// detect those at lookup time: if a single-char def exists for
// `head`, prefer it over a 2-char miss.

import { getMessageByOpcode, type MessageDef } from "./registry";

export interface DispatchResult<T = unknown> {
  /** Matched opcode string (1 or 2 chars). Falls back to head+action if no def matches. */
  opcode: string;
  /** True when the 3rd char was "E" — server-side rejection. */
  errorFlag: boolean;
  /** Raw body string (everything after opcode + optional error flag). */
  body: string;
  /** Decoded payload — present when a def with `parse` was matched. */
  payload?: T;
  /** Matched registry def — present when an opcode was registered. */
  def?: MessageDef<T>;
  /** Set when a registered def's parser threw. */
  parseError?: unknown;
}

export function dispatch(raw: string): DispatchResult {
  if (raw.length === 0) {
    return { opcode: "", errorFlag: false, body: "" };
  }
  // Opcode lookup precedence: 3-char → 2-char → 1-char. AS2's
  // DataProcessor switches on charAt(0) + charAt(1), then sub-dispatches
  // on charAt(2) for many cases (GTS, GDM, etc.) — modelling those as
  // distinct 3-char opcodes in our registry is closer to the wire shape
  // and keeps per-message files cohesive.
  if (raw.length >= 3) {
    const threeChar = raw.slice(0, 3);
    const threeDef = getMessageByOpcode(threeChar);
    if (threeDef) {
      const offset = threeDef.bodyOffset ?? 3;
      return runParse(threeDef, threeChar, false, raw.slice(offset));
    }
  }
  if (raw.length >= 2) {
    const twoChar = raw.slice(0, 2);
    const twoDef = getMessageByOpcode(twoChar);
    if (twoDef) {
      // errorFlag is computed per AS2 DataProcessor#process — char at index 2.
      const errorFlag = raw.charAt(2) === "E";
      const offset = twoDef.bodyOffset ?? 2;
      const body = raw.slice(offset);
      return runParse(twoDef, twoChar, errorFlag, body);
    }
  }
  // Single-char fallback (p, q, r, M, k).
  const oneChar = raw.charAt(0);
  const oneDef = getMessageByOpcode(oneChar);
  if (oneDef) {
    const offset = oneDef.bodyOffset ?? 1;
    return runParse(oneDef, oneChar, false, raw.slice(offset));
  }
  // Unknown — return conservative slice.
  if (raw.length < 2) {
    return { opcode: raw, errorFlag: false, body: "" };
  }
  return {
    opcode: raw.slice(0, 2),
    errorFlag: raw.charAt(2) === "E",
    body: raw.slice(2),
  };
}

function runParse(
  def: MessageDef<unknown>,
  opcode: string,
  errorFlag: boolean,
  body: string
): DispatchResult {
  if (!def.parse) {
    return { opcode, errorFlag, body, def };
  }
  try {
    const payload = def.parse(body, errorFlag);
    return { opcode, errorFlag, body, payload, def };
  } catch (parseError) {
    return { opcode, errorFlag, body, def, parseError };
  }
}
