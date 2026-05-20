// Al — Account Login result (Account.as:275, DataProcessor.as:196).
//
//   success:  "Al<flag>"    — flag '1' authorized, '0' restricted.
//                              AraknemuHorizon also emits the success via
//                              the `GMLevel` message which encodes as
//                              `AlK<0|1>` (charAt(2)='K' != 'E' → not an
//                              error path).
//   failure:  "AlE<char>"    — single error char. Canonical 1.29 codes
//                              include both hex digits (a/b/c/d/f) AND
//                              non-hex letters (k/m/o/r/s/w/i/O/e). We
//                              expose BOTH the raw char and a hex
//                              decode for legacy consumers.

import { WireIn } from "../../wire";

export const AL_ERROR_LABELS: Record<string, string> = {
  a: "ALREADY_LOGGED",
  b: "BANNED",
  c: "ALREADY_LOGGED_GAME_SERVER",
  d: "U_DISCONNECT_ACCOUNT",
  e: "OLD_ACCOUNT_USE_NEW",
  f: "LOGIN_ERROR",
  i: "ANONYMOUS_IP",
  k: "KICKED",
  m: "MAINTAIN_ACCOUNT",
  o: "OLD_ACCOUNT",
  O: "OTP_TIME_FAILED",
  r: "NICK_REQUIRED",
  s: "NICK_ALREADY_USED",
  w: "SERVER_FULL",
};

@WireIn({
  opcode: "Al",
  bodyOffset: 3,
  parse(body, errorFlag) {
    const inst = new Al();
    if (errorFlag) {
      inst.ok = false;
      const ch = body.charAt(0) || "";
      inst.errorChar = ch;
      inst.errorLabel = AL_ERROR_LABELS[ch] ?? `UNKNOWN(${ch})`;
      const n = Number.parseInt(ch || "0", 16);
      inst.code = Number.isNaN(n) ? -1 : n;
    } else {
      inst.ok = true;
      inst.errorChar = "";
      inst.errorLabel = "";
      const n = Number.parseInt(body, 10);
      inst.flags = Number.isNaN(n) ? 0 : n;
    }
    return inst;
  },
})
export class Al {
  ok: boolean;
  /** Authorisation flag — set when ok=true. */
  flags?: number;
  /** Single error char from the wire (`a`,`b`,…,`s`,`w`). Empty on success. */
  errorChar: string;
  /** Canonical AS2 label for the error code (e.g. "BANNED"). Empty on success. */
  errorLabel: string;
  /** Best-effort hex decode of `errorChar` (10 for 'a', 15 for 'f', …).
   *  `-1` when the char isn't a hex digit (e.g. 'k' KICKED). Use
   *  `errorChar` / `errorLabel` for the canonical mapping. */
  code?: number;
}
