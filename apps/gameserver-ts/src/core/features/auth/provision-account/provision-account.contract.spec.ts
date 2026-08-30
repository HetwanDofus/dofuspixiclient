import { describe, expect, test } from "bun:test";

import {
  fingerprintRequest,
  type ProvisionAccountRequest,
  parseProvisionAccountRequest,
} from "@features/auth/provision-account/provision-account.contract";
import { isProvisionError } from "@features/auth/provision-account/provision-account.errors";

/** 32 zero bytes, canonically encoded. */
const KEY = Buffer.alloc(32).toString("base64");

const body = (over: Record<string, unknown> = {}): unknown => ({
  username: "bot-astrub-01",
  passwordKey: KEY,
  pseudo: "Bot Astrub 01",
  serverId: 1,
  character: { name: "BotAstrub", breedId: 8, sex: 1 },
  ...over,
});

function refusal(input: unknown): { code: string; message: string } {
  try {
    parseProvisionAccountRequest(input);
  } catch (err) {
    if (isProvisionError(err)) {
      return { code: err.code, message: err.message };
    }

    throw err;
  }

  throw new Error("expected the body to be refused");
}

describe("parseProvisionAccountRequest", () => {
  test("accepts the documented body", () => {
    const parsed = parseProvisionAccountRequest(body());

    expect(parsed.username).toBe("bot-astrub-01");
    expect(parsed.character).toEqual({
      name: "BotAstrub",
      breedId: 8,
      sex: 1,
    });
  });

  test("serverId is optional", () => {
    const parsed = parseProvisionAccountRequest(
      body({ serverId: undefined })
    ) as ProvisionAccountRequest;

    expect(parsed.serverId).toBeUndefined();
  });

  test.each([
    [
      "a breed outside 1..12",
      { character: { name: "Bot", breedId: 13, sex: 0 } },
    ],
    ["a breed of 0", { character: { name: "Bot", breedId: 0, sex: 0 } }],
    [
      "a sex that is neither 0 nor 1",
      { character: { name: "Bot", breedId: 1, sex: 2 } },
    ],
    ["a username with a space", { username: "bot astrub" }],
    [
      "a character name with a digit",
      { character: { name: "Bot1", breedId: 1, sex: 0 } },
    ],
    ["an unknown field", { isAdmin: true }],
  ])("refuses %s with invalid_request", (_label, over) => {
    expect(refusal(body(over)).code).toBe("invalid_request");
  });

  test.each([
    ["url-safe base64", "abcd-_" + "A".repeat(37) + "="],
    ["a key of the wrong length", Buffer.alloc(16).toString("base64")],
    ["unpadded base64", Buffer.alloc(32).toString("base64").replace("=", "")],
    ["a plaintext password", "hunter2"],
  ])("refuses %s as a password key", (_label, passwordKey) => {
    expect(refusal(body({ passwordKey })).code).toBe("invalid_password_key");
  });

  // The whole point of taking a derived key rather than a password is that
  // the secret never lands anywhere it can be read back. An error message
  // is one of those places.
  test("never quotes the password key back", () => {
    const secret = Buffer.from("S".repeat(32)).toString("base64");

    for (const input of [
      body({ passwordKey: secret, username: "no spaces please" }),
      body({ passwordKey: `${secret}garbage` }),
      body({ passwordKey: 42 }),
    ]) {
      expect(refusal(input).message).not.toContain(secret.slice(0, 12));
    }
  });
});

describe("fingerprintRequest", () => {
  const base = parseProvisionAccountRequest(body());

  test("is stable across equal requests", () => {
    expect(fingerprintRequest(base)).toBe(
      fingerprintRequest(parseProvisionAccountRequest(body()))
    );
  });

  test.each([
    ["the username", { username: "bot-astrub-02" }],
    [
      "the password key",
      { passwordKey: Buffer.alloc(32, 1).toString("base64") },
    ],
    ["the pseudo", { pseudo: "Other" }],
    ["the server", { serverId: 2 }],
    ["the character", { character: { name: "Other", breedId: 8, sex: 1 } }],
  ])("changes when %s changes", (_label, over) => {
    expect(
      fingerprintRequest(parseProvisionAccountRequest(body(over)))
    ).not.toBe(fingerprintRequest(base));
  });

  test("is not the password key in disguise", () => {
    expect(fingerprintRequest(base)).not.toContain(KEY.slice(0, 8));
    expect(fingerprintRequest(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});
