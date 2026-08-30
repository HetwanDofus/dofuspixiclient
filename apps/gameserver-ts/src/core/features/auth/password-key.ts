/**
 * The one place that knows what a Dofus password actually is on the wire.
 *
 * The plaintext never reaches this server. The client stretches it and
 * sends the base64 key as `AccountSendIdentity.encrypted_password`, and
 * `LoginHandler` runs `Bun.password.verify(thatKey, accounts.pwd_hash)` —
 * so `pwd_hash` is a hash *of the derived key*, never of the password.
 * Hashing the plaintext here would produce an account that can never log
 * in, which is the single easiest way to get this wrong.
 *
 * Keep the parameters in sync with `apps/electrobun/src/game/auth/pbkdf2.ts`,
 * which owns them on the client side.
 */
import { createHash, pbkdf2 as pbkdf2Cb } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2 = promisify(pbkdf2Cb);

export const PBKDF2_ITERATIONS = 600_000;
export const PBKDF2_KEY_BYTES = 32;

/**
 * A canonical base64 encoding of exactly {@link PBKDF2_KEY_BYTES} bytes:
 * 43 alphabet characters and one padding character, no whitespace, no
 * url-safe alphabet. Written as a shape check rather than a decode-only
 * check because `Buffer.from(x, "base64")` happily ignores garbage, and an
 * admin API that silently accepts a mistyped key provisions an account
 * nobody can log into.
 */
const CANONICAL_KEY = /^[A-Za-z0-9+/]{43}=$/;

export function passwordKeySalt(username: string): Buffer {
  return createHash("sha256")
    .update(`dofus:${username.toLowerCase()}`)
    .digest();
}

/** The client-side derivation, for seeds and tests that hold a plaintext. */
export async function derivePasswordKey(
  password: string,
  username: string
): Promise<string> {
  const derived = await pbkdf2(
    password,
    passwordKeySalt(username),
    PBKDF2_ITERATIONS,
    PBKDF2_KEY_BYTES,
    "sha256"
  );

  return derived.toString("base64");
}

export function isCanonicalPasswordKey(value: string): boolean {
  if (!CANONICAL_KEY.test(value)) {
    return false;
  }

  return Buffer.from(value, "base64").length === PBKDF2_KEY_BYTES;
}

/** What goes into `accounts.pwd_hash`. */
export function hashPasswordKey(passwordKey: string): Promise<string> {
  return Bun.password.hash(passwordKey);
}
