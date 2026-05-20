// Serializer primitives. The 1.29 send convention is pipe-separated
// ASCII concatenated after the 2-3 char opcode; numbers go via the
// platform's `String(...)` coercion.
//
// Example (Chat.as:88): `this.aks.send("BM" + sDest + "|" + sMessage)`
//   ↳ joinPipe([recipient, message]) → "<recipient>|<message>"

import {
  SEP_BANG,
  SEP_COLON,
  SEP_COMMA,
  SEP_PIPE,
  SEP_SEMI,
} from "./parse";

const joinWith =
  (sep: string) =>
  (parts: ReadonlyArray<string | number | boolean>): string =>
    parts
      .map((p) => (typeof p === "boolean" ? (p ? "1" : "0") : String(p)))
      .join(sep);

export const joinPipe = joinWith(SEP_PIPE);
export const joinSemi = joinWith(SEP_SEMI);
export const joinBang = joinWith(SEP_BANG);
export const joinComma = joinWith(SEP_COMMA);
export const joinColon = joinWith(SEP_COLON);
