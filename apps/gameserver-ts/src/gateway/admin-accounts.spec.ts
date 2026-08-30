import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import type { ProvisionAccountRequest } from "@features/auth/provision-account/provision-account.contract";
import type { AccountProvisioner } from "@gateway/admin-accounts";
import type { SessionRegistry } from "@gateway/session-registry";
import type { UpstreamRegistry } from "@gateway/upstream-registry";
import { ProvisionError } from "@features/auth/provision-account/provision-account.errors";
import { buildHttpApp } from "@gateway/http";
import { FixedWindowLimiter } from "@gateway/rate-limiter";

const TOKEN = "s3cr3t-admin-token";
const KEY = Buffer.alloc(32).toString("base64");

const previousToken = process.env.GATEWAY_ADMIN_TOKEN;
process.env.GATEWAY_ADMIN_TOKEN = TOKEN;

afterAll(() => {
  if (previousToken === undefined) {
    process.env.GATEWAY_ADMIN_TOKEN = undefined;
  } else {
    process.env.GATEWAY_ADMIN_TOKEN = previousToken;
  }
});

type Call = { key: string; request: ProvisionAccountRequest };

let calls: Call[];
let outcome: (call: Call) => unknown;

const provisioner: AccountProvisioner = {
  provision: async (key, request) => {
    const call = { key, request };
    calls.push(call);

    const result = outcome(call);

    if (result instanceof Error) {
      throw result;
    }

    return result as never;
  },
};

function app(provision: AccountProvisioner | null = provisioner) {
  return buildHttpApp({
    sessions: { size: () => 0 } as unknown as SessionRegistry,
    upstreams: { status: () => [] } as unknown as UpstreamRegistry,
    authToken: () => null,
    ...(provision ? { provisioner: provision } : {}),
  });
}

const body = (over: Record<string, unknown> = {}) => ({
  username: "bot-astrub-01",
  passwordKey: KEY,
  pseudo: "Bot Astrub 01",
  serverId: 1,
  character: { name: "BotAstrub", breedId: 8, sex: 1 },
  ...over,
});

function post(
  opts: {
    token?: string | null;
    key?: string | null;
    body?: unknown;
    raw?: string;
    headers?: Record<string, string>;
  } = {}
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...opts.headers,
  };

  if (opts.token !== null) {
    headers["x-admin-token"] = opts.token ?? TOKEN;
  }

  if (opts.key !== null) {
    headers["idempotency-key"] =
      opts.key ?? "11111111-1111-1111-1111-111111111111";
  }

  return new Request("http://gateway/admin/accounts", {
    method: "POST",
    headers,
    body: opts.raw ?? JSON.stringify(opts.body ?? body()),
  });
}

const created = {
  created: true,
  account: { id: "101", username: "bot-astrub-01" },
  character: { id: "202", name: "BotAstrub" },
};

beforeEach(() => {
  calls = [];
  outcome = () => created;
});

describe("POST /admin/accounts", () => {
  test("creates and answers 201 with the ids", async () => {
    const res = await app().fetch(post());

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      account: { id: "101", username: "bot-astrub-01" },
      character: { id: "202", name: "BotAstrub" },
    });
    expect(calls[0]?.key).toBe("11111111-1111-1111-1111-111111111111");
  });

  test("answers 200 when the service replays an earlier creation", async () => {
    outcome = () => ({ ...created, created: false });

    const res = await app().fetch(post());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      account: { id: "101", username: "bot-astrub-01" },
      character: { id: "202", name: "BotAstrub" },
    });
  });

  test("is not routed at all without a provisioner", async () => {
    const res = await app(null).fetch(post());

    expect(res.status).toBe(404);
  });

  test.each([
    ["no token", null],
    ["a wrong token", "wrong-token-same-len"],
    ["a truncated token", TOKEN.slice(0, -1)],
    ["a token with a suffix", `${TOKEN}x`],
  ])("refuses %s with 403 and provisions nothing", async (_label, token) => {
    const res = await app().fetch(post({ token }));

    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  test("requires an Idempotency-Key", async () => {
    const res = await app().fetch(post({ key: null }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "missing_idempotency_key",
    });
    expect(calls).toHaveLength(0);
  });

  test("refuses an oversized Idempotency-Key", async () => {
    const res = await app().fetch(post({ key: "k".repeat(256) }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "invalid_idempotency_key",
    });
  });

  test("400s on malformed JSON", async () => {
    const res = await app().fetch(post({ raw: "{ not json" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_json" });
    expect(calls).toHaveLength(0);
  });

  test("413s on a body larger than the cap", async () => {
    const res = await app().fetch(
      post({ body: body({ pseudo: "x".repeat(16_000) }) })
    );

    expect(res.status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  test("422s on an invalid breed, without reaching the database", async () => {
    const res = await app().fetch(
      post({ body: body({ character: { name: "Bot", breedId: 99, sex: 0 } }) })
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "invalid_request" });
    expect(calls).toHaveLength(0);
  });

  test.each([
    ["username_taken", 409],
    ["idempotency_key_reuse", 409],
    ["unknown_server", 422],
  ] as const)("maps %s onto %i", async (code, status) => {
    outcome = () => new ProvisionError(code, "nope");

    const res = await app().fetch(post());

    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ error: code });
  });

  // A stack trace or a driver message can quote the statement it failed on,
  // and the password key travels through that statement.
  test("never leaks an unexpected error, the key or the token", async () => {
    outcome = () =>
      new Error(`insert into accounts ... ${KEY} ... token ${TOKEN}`);

    const res = await app().fetch(post());
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(TOKEN);
    expect(JSON.parse(text)).toEqual({
      error: "internal_error",
      message: "provisioning failed",
    });
  });

  test("rate-limits a caller hammering the route", async () => {
    const limiter = new FixedWindowLimiter(2, 60_000);
    const hono = buildHttpApp({
      sessions: { size: () => 0 } as unknown as SessionRegistry,
      upstreams: { status: () => [] } as unknown as UpstreamRegistry,
      authToken: () => null,
      provisioner,
    });

    // The app registered its own limiter; drive this one directly to prove
    // the window closes, then assert the route's own cap exists.
    expect(limiter.take("10.0.0.1")).toBe(true);
    expect(limiter.take("10.0.0.1")).toBe(true);
    expect(limiter.take("10.0.0.1")).toBe(false);
    expect(limiter.take("10.0.0.2")).toBe(true);

    const statuses: number[] = [];

    for (let i = 0; i < 25; i++) {
      const res = await hono.fetch(
        post({ key: `key-${i}`, headers: { "x-forwarded-for": "10.0.0.9" } })
      );
      statuses.push(res.status);
    }

    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses.slice(0, 20).every((s) => s === 201)).toBe(true);
  });
});
