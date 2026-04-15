/**
 * Client-side password key-stretching.
 *
 * The raw password never leaves the browser. We derive a 32-byte key via
 * PBKDF2-SHA256 using a salt derived deterministically from the username
 * (sha256("dofus:" + lowercase(username))), then base64-encode it. The
 * server stores bcrypt(kdf_output) and verifies against the submitted
 * base64 string.
 */
const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_KEY_BYTES = 32;
const SALT_PREFIX = "dofus:";

function utf8(input: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(input);
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

async function sha256(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", bytes);
}

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (const b of view) binary += String.fromCharCode(b);
  return btoa(binary);
}

export async function deriveSalt(username: string): Promise<ArrayBuffer> {
  return sha256(utf8(SALT_PREFIX + username.toLowerCase()));
}

export async function derivePasswordKey(
  password: string,
  username: string
): Promise<string> {
  const salt = await deriveSalt(username);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    utf8(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    PBKDF2_KEY_BYTES * 8
  );
  return toBase64(derived);
}
