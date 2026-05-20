import { describe, expect, test } from "bun:test";
import {
  checksum,
  Crypto,
  cypher,
  d2h,
  decypher,
  postUnescape,
  preEscape,
  prepareKey,
} from "../transport/crypto";

describe("checksum", () => {
  test("empty string → '0'", () => {
    expect(checksum("")).toBe("0");
  });
  test("'A' (65) → 65%16=1 → '1'", () => {
    expect(checksum("A")).toBe("1");
  });
  test("'AB' (65+66=131%16=3) → '3'", () => {
    expect(checksum("AB")).toBe("3");
  });
  test("returns uppercase hex char", () => {
    // 16 chars that sum to e.g. 15*16=240, 240%16=0
    const c = checksum("\x0f\x0f\x0f\x0f\x0f\x0f\x0f\x0f\x0f\x0f\x0f\x0f\x0f\x0f\x0f\x0f");
    expect(c).toBe("0");
  });
});

describe("d2h", () => {
  test("0 → '00'", () => {
    expect(d2h(0)).toBe("00");
  });
  test("255 → 'FF'", () => {
    expect(d2h(255)).toBe("FF");
  });
  test("clamps over-large input", () => {
    expect(d2h(300)).toBe("FF");
  });
  test("16 → '10'", () => {
    expect(d2h(16)).toBe("10");
  });
});

describe("preEscape / postUnescape", () => {
  test("ASCII printable passes through unchanged", () => {
    expect(preEscape("Hello, World")).toBe("Hello, World");
  });
  test("'%' and '+' get escaped", () => {
    // '%' → %25, '+' → %2B
    expect(preEscape("a%b+c")).toBe("a%25b%2Bc");
  });
  test("control bytes get escaped", () => {
    // newline (0x0A) → %0A
    expect(preEscape("a\nb")).toBe("a%0Ab");
  });
  test("postUnescape inverts preEscape on printable inputs", () => {
    const s = "Hello, World";
    expect(postUnescape(preEscape(s))).toBe(s);
  });
});

describe("cypher / decypher round-trip", () => {
  test("plain text round-trip via 8-byte key", () => {
    const plain = "AccountName|hashedpw|0";
    const key = "abcdefgh";
    const offset = 0;
    const encoded = cypher(plain, key, offset);
    expect(decypher(encoded, key, offset)).toBe(plain);
  });
  test("offset propagates correctly", () => {
    const plain = "test data";
    const key = "XYZ12345";
    for (const offset of [0, 2, 6, 12, 22]) {
      const enc = cypher(plain, key, offset);
      expect(decypher(enc, key, offset)).toBe(plain);
    }
  });
  test("control / high bytes survive round-trip via escape", () => {
    const plain = "data\nwith\x01ctrls";
    const key = "key1234567";
    const enc = cypher(plain, key, 0);
    expect(decypher(enc, key, 0)).toBe(plain);
  });
});

describe("prepareKey", () => {
  test("decodes hex pairs to chars", () => {
    // "4865" → 0x48 0x65 → "He"
    expect(prepareKey("4865")).toBe("He");
  });
  test("handles URL-escaped sequences", () => {
    // "256E" → 0x25 0x6E → "%n" → unescape → "%n" (no decode of literal %)
    // "256E" decodes to "%n" which is a malformed escape — postUnescape returns "%n" unchanged via fallback.
    expect(prepareKey("256E").length).toBeGreaterThan(0);
  });
});

describe("Crypto class — prepareData / unprepareData round-trip", () => {
  test("no key set: passthrough", () => {
    const c = new Crypto();
    expect(c.prepareData("hello")).toBe("hello");
    expect(c.unprepareData("hello")).toBe("hello");
  });

  test("with key + selection: encrypt then decrypt matches", () => {
    const c = new Crypto();
    // Install a key — the prepareKey decoder treats this as 2-byte hex pairs.
    // Use a key with known printable plaintext after unescape.
    c.setKey(3, "61626364656667686970717273747576"); // "abcdefghipqrstuv"
    c.useKey(3);
    const original = "GC1|something";
    const encrypted = c.prepareData(original);
    expect(encrypted).not.toBe(original);
    // The encrypted output starts with HEX_CHARS[3] = '3' then the checksum hex char.
    expect(encrypted.charAt(0)).toBe("3");
    expect(c.unprepareData(encrypted)).toBe(original);
  });

  test("garbled ciphertext returns input unchanged (checksum miss)", () => {
    const c = new Crypto();
    c.setKey(3, "61626364656667686970717273747576");
    c.useKey(3);
    // Random garbage that won't checksum correctly after decypher.
    const garbage = "3FZZZZ";
    expect(c.unprepareData(garbage)).toBe(garbage);
  });

  test("reset clears state", () => {
    const c = new Crypto();
    c.setKey(1, "6162");
    c.useKey(1);
    expect(c.isActive()).toBe(true);
    c.reset();
    expect(c.isActive()).toBe(false);
    expect(c.prepareData("x")).toBe("x");
  });
});
