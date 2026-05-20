// Crypto layer ported from `assets/sources/client-code/dofus/aks/Aks.as`
// (lines 267-389). Algorithm:
//
//   prepareData(s):
//     if no key set, return s unchanged
//     prefix = HEX_CHARS[currentKey]            // 1 hex char identifying the key
//     cs     = checksum(s)                       // 1 hex char message checksum
//     return prefix + cs + cypher(s, key, parseInt(cs, 16) * 2)
//
//   unprepareData(s):
//     if no key set, return s
//     keyId = parseInt(s[0], 16)
//     key   = keys[keyId]
//     cs    = s[1].toUpperCase()
//     plain = decypher(s.substr(2), key, parseInt(cs, 16) * 2)
//     if checksum(plain) != cs: return s        // failed decode → pass through
//     return plain
//
//   cypher(d, k, c):
//     d' = preEscape(d)                          // URL-escape <32, >127, %, +
//     for each char i: emit d2h(d'[i] XOR k[(i+c) % k.length])
//
//   decypher(d, k, c):
//     for each hex pair (i): emit char(parseInt(pair,16) XOR k[(byteIdx+c) % k.length])
//     then unescape() the assembled string
//
// Per memory `feedback_as2_call_site_truth.md`: any future fork that
// changes the offset formula or escape policy MUST be cross-checked
// against the live caller, not the documented default.

const HEX_CHARS = "0123456789ABCDEF";

/** Single-char hex value 0-F, modulo 16, of the sum of (charCode % 16) over the string. */
export function checksum(s: string): string {
  let sum = 0;

  for (let i = 0; i < s.length; i++) {
    sum += s.charCodeAt(i) % 16;
  }

  return HEX_CHARS[sum % 16] as string;
}

/** Single-byte → 2-char uppercase hex. Clamped to 0xff (matches d2h in Aks.as). */
export function d2h(d: number): string {
  const clamped = d > 255 ? 255 : d;

  return (
    (HEX_CHARS[Math.floor(clamped / 16)] as string) +
    (HEX_CHARS[clamped % 16] as string)
  );
}

/**
 * URL-escape control bytes, high bytes, and the `%` / `+` literals.
 * Mirrors `Aks.preEscape` — uses ActionScript's `escape()` which
 * produces `%HH` sequences.
 */
export function preEscape(s: string): string {
  let out = "";

  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    const cc = s.charCodeAt(i);

    if (cc < 32 || cc > 127 || ch === "%" || ch === "+") {
      out += encodeURIComponent(ch).toUpperCase();
    } else {
      out += ch;
    }
  }

  return out;
}

/** Inverse of preEscape — `decodeURIComponent` matches AS2's `unescape`. */
export function postUnescape(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Decode a hex-encoded key. The HC handshake sends keys as ASCII hex
 * pairs (e.g. "4ABC10..."), which `prepareKey` decodes pair-by-pair
 * into bytes, then runs through `unescape` (URL-decode) to recover
 * the raw key string used as the XOR pad.
 */
export function prepareKey(hex: string): string {
  let buf = "";

  for (let i = 0; i + 1 < hex.length; i += 2) {
    const code = Number.parseInt(hex.substr(i, 2), 16);

    if (Number.isNaN(code)) {
      continue;
    }

    buf += String.fromCharCode(code);
  }

  return postUnescape(buf);
}

/** Encrypt — d:plaintext, k:key string, c:offset. Output is hex-encoded XOR. */
export function cypher(d: string, k: string, c: number): string {
  const escaped = preEscape(d);
  const klen = k.length;
  let out = "";

  for (let i = 0; i < escaped.length; i++) {
    const xor = escaped.charCodeAt(i) ^ k.charCodeAt((i + c) % klen);

    out += d2h(xor);
  }

  return out;
}

/** Decrypt — d:hex-encoded ciphertext, k:key, c:offset. Returns plaintext. */
export function decypher(d: string, k: string, c: number): string {
  const klen = k.length;
  let out = "";
  let byteIdx = 0;

  for (let i = 0; i + 1 < d.length; i += 2) {
    const byte = Number.parseInt(d.substr(i, 2), 16);

    if (Number.isNaN(byte)) {
      continue;
    }

    const xor = byte ^ k.charCodeAt((byteIdx + c) % klen);

    byteIdx++;

    out += String.fromCharCode(xor);
  }

  return postUnescape(out);
}

/**
 * Crypto context — holds the key array and current key index.
 * Passed into Client.send / Client receive paths once the server has
 * issued the network keys (`AK` / similar — caller-side wiring is in
 * the message handlers).
 */
export class Crypto {
  private keys: Array<string | undefined> = [];
  private currentKey = 0;

  /** Install a key at slot `id` (0-15). Hex input is decoded the same way `prepareKey` does. */
  setKey(id: number, hex: string): void {
    this.keys[id] = prepareKey(hex);
  }

  /** Select which key slot is used for outbound `prepareData`. */
  useKey(id: number): void {
    this.currentKey = id;
  }

  /** Clear all installed keys (run on disconnect). */
  reset(): void {
    this.keys = [];
    this.currentKey = 0;
  }

  /** True when at least one key has been installed AND `useKey` has been called with a non-zero id. */
  isActive(): boolean {
    return this.currentKey !== 0 && this.keys[this.currentKey] !== undefined;
  }

  prepareData(s: string): string {
    if (!this.isActive()) {
      return s;
    }

    const key = this.keys[this.currentKey];

    if (key === undefined) {
      return s;
    }

    const prefix = HEX_CHARS[this.currentKey] as string;
    const cs = checksum(s);

    return prefix + cs + cypher(s, key, Number.parseInt(cs, 16) * 2);
  }

  unprepareData(s: string): string {
    if (!this.isActive() || s.length < 2) {
      return s;
    }

    const keyId = Number.parseInt(s.charAt(0), 16);

    if (Number.isNaN(keyId)) {
      return s;
    }

    const key = this.keys[keyId];

    if (key === undefined) {
      return s;
    }

    const cs = s.charAt(1).toUpperCase();
    const plain = decypher(s.substr(2), key, Number.parseInt(cs, 16) * 2);

    if (checksum(plain) !== cs) {
      return s; // failed checksum → pass through (matches AS2 behavior)
    }

    return plain;
  }
}
