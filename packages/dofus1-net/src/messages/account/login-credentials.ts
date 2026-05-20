// Login credentials — the first frame after HC (Account.as:44+58).
//
// Canonical wire (cross-verified against AraknemuHorizon's
// `Credentials` parser + `Crypt.as#cryptPassword`):
//
//   `<login>\n#<method><hash>`
//
// where:
//   - `method` is a single digit identifying the cypher in use:
//       `0` = NONE (cleartext) — only emulators / dev mode.
//       `1` = VIGENERE_BASE_64 (canonical 1.29 default).
//       `2` = MD5 — server-config opt-in (`CRYPTO_METHOD == 2`).
//   - `hash` is the cypher output. Vigenere output is 2 base64 chars
//     per password byte (no length cap — canonical AS2 walks the
//     whole string).
//
// AraknemuHorizon's parser hard-requires the `#<digit>` prefix; the
// canonical 1.29 client builds it inside `Crypt.cryptPassword`, so
// callers can pass a raw password into `buildLoginFrame` and get the
// `#1`-prefixed payload back automatically.

const HASH =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";

/**
 * Vigenere-over-base64 password cypher. Mirrors
 * `assets/sources/client-code/ank/utils/Crypt.as#cryptPassword`
 * exactly, including the leading `#1` method marker.
 *
 *   for each char c in password (1-based index i):
 *     k_i = connexionKey.charCodeAt(i % keyLen)
 *     hi  = floor(c / 16)
 *     lo  = c % 16
 *     emit HASH[(hi + k_i) % 64] + HASH[(lo + k_i) % 64]
 *
 * AS2 reads `key.charCodeAt(loop_index)` directly — if the key is
 * shorter than the password the read returns `NaN`. Real keys are
 * always at least as long as the password (canonical HC ships 32+
 * chars), so the wrap-on-modulo policy is a defensive matter, not a
 * canonical divergence.
 */
export function cryptPassword(password: string, connexionKey: string): string {
  if (connexionKey.length === 0) {
    throw new Error("cryptPassword: connexionKey is empty");
  }
  const keyLen = connexionKey.length;
  let out = "#1";
  for (let i = 0; i < password.length; i++) {
    const p = password.charCodeAt(i);
    const k = connexionKey.charCodeAt(i % keyLen);
    const hi = Math.floor(p / 16);
    const lo = p % 16;
    const kMod = k % HASH.length;
    out += HASH[(hi + kMod) % HASH.length] as string;
    out += HASH[(lo + kMod) % HASH.length] as string;
  }
  return out;
}

/**
 * Build the post-HC credentials frame. Pass the player's
 * `connexionKey` (HC body) to encrypt with the canonical Vigenere
 * cypher; omit it to send the password cleartext (development
 * convenience — AraknemuHorizon rejects clear passwords unless its
 * config explicitly enables them).
 */
export function buildLoginFrame(opts: {
  login: string;
  password: string;
  connexionKey?: string;
}): string {
  const pw =
    opts.connexionKey === undefined
      ? opts.password
      : cryptPassword(opts.password, opts.connexionKey);
  return opts.login + "\n" + pw;
}
