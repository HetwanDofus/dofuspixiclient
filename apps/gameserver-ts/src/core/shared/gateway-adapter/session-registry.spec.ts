import "reflect-metadata";

import { beforeEach, describe, expect, test } from "bun:test";

import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  type Session,
  SessionRegistry,
} from "@shared/gateway-adapter/session-registry";

// The account index is what makes "is this account already connected?"
// answerable at all. Before it, nothing stopped one account from opening two
// windows, because there was nowhere to look.

let events: EventEmitter2;
let registry: SessionRegistry;

beforeEach(() => {
  events = new EventEmitter2();
  registry = new SessionRegistry(events);
});

function open(sessionId: string, accountId = ""): void {
  registry.open({
    sessionId,
    accountId,
    characterId: "",
    remoteAddr: "10.0.0.1",
  });
}

const ids = (sessions: Session[]): string[] =>
  sessions.map((s) => s.sessionId).sort();

describe("SessionRegistry — account index", () => {
  test("an anonymous session is not indexed", () => {
    open("s1");

    // Sessions open unauthenticated: the gateway's public route announces them
    // with an empty accountId. Indexing "" would lump every visitor together.
    expect(registry.sessionsForAccount("")).toEqual([]);
    expect(registry.sessionsForAccount("acc-1")).toEqual([]);
  });

  test("authenticating puts a session on its account", () => {
    open("s1");
    registry.attachAccount("s1", "acc-1");

    expect(ids(registry.sessionsForAccount("acc-1"))).toEqual(["s1"]);
  });

  test("two windows on one account are both visible", () => {
    open("s1");
    open("s2");
    registry.attachAccount("s1", "acc-1");
    registry.attachAccount("s2", "acc-1");

    expect(ids(registry.sessionsForAccount("acc-1"))).toEqual(["s1", "s2"]);
  });

  test("the caller can exclude itself", () => {
    open("s1");
    open("s2");
    registry.attachAccount("s1", "acc-1");
    registry.attachAccount("s2", "acc-1");

    // How an evictor asks "who else is on this account?" without shooting the
    // session that just authenticated.
    expect(ids(registry.sessionsForAccount("acc-1", "s2"))).toEqual(["s1"]);
  });

  test("closing a session takes it out of the index", () => {
    open("s1");
    registry.attachAccount("s1", "acc-1");
    registry.close("s1", "client_close");

    expect(registry.sessionsForAccount("acc-1")).toEqual([]);
  });

  test("re-authenticating onto another account moves the session", () => {
    open("s1");
    registry.attachAccount("s1", "acc-1");
    registry.attachAccount("s1", "acc-2");

    expect(registry.sessionsForAccount("acc-1")).toEqual([]);
    expect(ids(registry.sessionsForAccount("acc-2"))).toEqual(["s1"]);
  });

  test("the index survives a handoff", () => {
    open("s1");
    registry.attachAccount("s1", "acc-1");

    const restored = new SessionRegistry(new EventEmitter2());
    restored.restore(registry.serialize());

    // A handoff that restored the sessions but not the index would silently
    // stop detecting double connections — invisible until someone opened a
    // second window after a blue/green deploy.
    expect(ids(restored.sessionsForAccount("acc-1"))).toEqual(["s1"]);
  });
});
