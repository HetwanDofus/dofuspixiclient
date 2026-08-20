import "reflect-metadata";

import { beforeEach, describe, expect, test } from "bun:test";

import type { LoginRepository } from "@features/auth/login/login.repository";
import type { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { create } from "@bufbuild/protobuf";
import { AccountSendIdentitySchema } from "@dofus/proto/account_pb";
import { LoginHandler } from "@features/auth/login/login.handler";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { SessionEvictionService } from "@shared/gateway-adapter/session-eviction.service";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

const PASSWORD = "derived-key";

let registry: SessionRegistry;
let evicted: string[];
let handler: LoginHandler;
let account: { id: string; pwdHash: string; isBanned: boolean } | undefined;

beforeEach(async () => {
  registry = new SessionRegistry(new EventEmitter2());
  evicted = [];

  account = {
    id: "acc-1",
    // bcrypt at the lowest cost: this suite verifies who gets evicted, not the
    // hashing itself, and argon2 would dominate the runtime.
    pwdHash: await Bun.password.hash(PASSWORD, {
      algorithm: "bcrypt",
      cost: 4,
    }),
    isBanned: false,
  };

  const repo = {
    findByUsername: async () => account,
    markLoggedIn: async () => undefined,
  } as unknown as LoginRepository;

  const frames = {
    broadcast: () => undefined,
    closeSession: (sessionId: string) => evicted.push(sessionId),
  } as unknown as GatewayFrameService;

  handler = new LoginHandler(
    repo,
    registry,
    frames,
    new SessionEvictionService(registry, frames)
  );
});

function openSession(sessionId: string): void {
  registry.open({
    sessionId,
    accountId: "",
    characterId: "",
    remoteAddr: "10.0.0.1",
  });
}

const identity = (password: string) =>
  create(AccountSendIdentitySchema, {
    username: "dev",
    encryptedPassword: password,
  });

describe("LoginHandler — one session per account", () => {
  test("a successful login evicts the session already on the account", async () => {
    openSession("old");
    registry.attachAccount("old", "acc-1");
    openSession("new");

    await handler.handle({ sessionId: "new" }, identity(PASSWORD));

    expect(evicted).toEqual(["old"]);
    expect(registry.get("old")).toBeUndefined();
    expect(registry.get("new")?.accountId).toBe("acc-1");
  });

  test("a wrong password evicts nobody", async () => {
    openSession("old");
    registry.attachAccount("old", "acc-1");
    openSession("attacker");

    await handler.handle({ sessionId: "attacker" }, identity("wrong"));

    // The guard that matters: without it, knowing a username is enough to
    // disconnect that player at will.
    expect(evicted).toEqual([]);
    expect(registry.get("old")).toBeDefined();
  });

  test("a banned account evicts nobody", async () => {
    openSession("old");
    registry.attachAccount("old", "acc-1");
    openSession("new");

    if (account) {
      account.isBanned = true;
    }

    await handler.handle({ sessionId: "new" }, identity(PASSWORD));

    expect(evicted).toEqual([]);
    expect(registry.get("old")).toBeDefined();
  });

  test("an unknown username evicts nobody", async () => {
    openSession("old");
    registry.attachAccount("old", "acc-1");
    openSession("new");

    account = undefined;

    await handler.handle({ sessionId: "new" }, identity(PASSWORD));

    expect(evicted).toEqual([]);
    expect(registry.get("old")).toBeDefined();
  });
});
