import "reflect-metadata";

import { beforeEach, describe, expect, test } from "bun:test";

import type { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  EVICT_ACCOUNT_TAKEN_OVER,
  SessionEvictionService,
} from "@shared/gateway-adapter/session-eviction.service";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

type Order = { sessionId: string; reason: string };
type Closed = { sessionId: string; reason: string };

let events: EventEmitter2;
let registry: SessionRegistry;
let orders: Order[];
let closed: Closed[];
let eviction: SessionEvictionService;

beforeEach(() => {
  events = new EventEmitter2();
  registry = new SessionRegistry(events);
  orders = [];
  closed = [];

  events.on("session.closed", ({ session, reason }) =>
    closed.push({ sessionId: session.sessionId, reason })
  );

  const frames = {
    closeSession: (sessionId: string, reason: string) =>
      orders.push({ sessionId, reason }),
  } as unknown as GatewayFrameService;

  eviction = new SessionEvictionService(registry, frames);
});

function signIn(sessionId: string, accountId: string): void {
  registry.open({
    sessionId,
    accountId: "",
    characterId: "",
    remoteAddr: "10.0.0.1",
  });
  registry.attachAccount(sessionId, accountId);
}

describe("SessionEvictionService", () => {
  test("ends the other session on the account", () => {
    signIn("old", "acc-1");
    signIn("new", "acc-1");

    expect(eviction.evictAccount("acc-1", "new")).toBe(1);

    // The gateway owns the socket, so it gets an order; the core drops the
    // session itself, which is what makes the character leave the world
    // through the ordinary session.closed saga.
    expect(orders).toEqual([
      { sessionId: "old", reason: EVICT_ACCOUNT_TAKEN_OVER },
    ]);
    expect(closed).toEqual([
      { sessionId: "old", reason: EVICT_ACCOUNT_TAKEN_OVER },
    ]);
    expect(registry.get("old")).toBeUndefined();
  });

  test("never evicts the session that just authenticated", () => {
    signIn("new", "acc-1");

    expect(eviction.evictAccount("acc-1", "new")).toBe(0);
    expect(orders).toEqual([]);
    expect(registry.get("new")).toBeDefined();
  });

  test("leaves other accounts alone", () => {
    signIn("other", "acc-2");
    signIn("new", "acc-1");

    expect(eviction.evictAccount("acc-1", "new")).toBe(0);
    expect(orders).toEqual([]);
    expect(registry.get("other")).toBeDefined();
  });

  test("ends every stale session, not just the first", () => {
    signIn("old-a", "acc-1");
    signIn("old-b", "acc-1");
    signIn("new", "acc-1");

    expect(eviction.evictAccount("acc-1", "new")).toBe(2);
    expect(orders.map((o) => o.sessionId).sort()).toEqual(["old-a", "old-b"]);
  });
});
