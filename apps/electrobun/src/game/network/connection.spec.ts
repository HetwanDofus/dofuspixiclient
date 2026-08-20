import { afterEach, describe, expect, test } from "bun:test";

import {
  WS_CLOSE_ACCOUNT_TAKEN_OVER,
  WS_CLOSE_CORE_GONE,
  WS_CLOSE_NORMAL,
} from "./close-codes";
import { Connection, type ConnectionEvent } from "./connection";
import { FakeWebSocket, installFakeWebSocket } from "./fake-websocket";

const URL = "ws://localhost:8080/game";

let restore: (() => void) | null = null;

function connection(
  overrides: Partial<{ retries: number; delay: number }> = {}
) {
  restore?.();
  restore = installFakeWebSocket();

  const events: ConnectionEvent[] = [];
  const conn = new Connection({
    url: URL,
    reconnectInterval: overrides.delay ?? 5,
    maxReconnectAttempts: overrides.retries ?? 3,
  });

  conn.addEventListener((e) => events.push(e));
  conn.connect();
  FakeWebSocket.latest().accept();

  return { conn, events };
}

const types = (events: ConnectionEvent[]) => events.map((e) => e.type);

afterEach(() => {
  restore?.();
  restore = null;
});

describe("Connection — retry policy", () => {
  test("gives up immediately when the gateway says the core is gone", async () => {
    const { conn, events } = connection();

    FakeWebSocket.latest().hangUp(WS_CLOSE_CORE_GONE, "core_gone");

    // Long enough for several reconnect delays to have fired.
    await Bun.sleep(40);

    // Reconnecting would succeed at the socket level and change nothing: the
    // core behind the session is gone. A retry loop here is what let the client
    // look busy while being permanently useless (QA-046).
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(types(events)).toEqual(["connected", "disconnected"]);
    expect(conn.getState()).toBe("disconnected");
  });

  test("gives up immediately when another window takes the account over", async () => {
    const { events } = connection();

    FakeWebSocket.latest().hangUp(
      WS_CLOSE_ACCOUNT_TAKEN_OVER,
      "account_taken_over"
    );

    await Bun.sleep(40);

    // Retrying here would be worse than useless: a new socket would reconnect
    // and, on the next login, evict the window that legitimately took over.
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(types(events)).toEqual(["connected", "disconnected"]);
  });

  test("does not retry a clean close either", async () => {
    const { events } = connection();

    FakeWebSocket.latest().hangUp(WS_CLOSE_NORMAL, "bye");
    await Bun.sleep(40);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(types(events)).toEqual(["connected", "disconnected"]);
  });

  test("still retries an abnormal close", async () => {
    const { events } = connection();

    FakeWebSocket.latest().hangUp(1006, "abnormal");
    await Bun.sleep(40);

    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
    expect(types(events)).toContain("reconnecting");
  });

  test("says so out loud once the retries are spent", async () => {
    const { events } = connection({ retries: 2, delay: 5 });

    // One close per attempt: the initial drop, then each retry failing.
    for (let i = 0; i < 3; i += 1) {
      FakeWebSocket.latest().hangUp(1006, "abnormal");
      await Bun.sleep(20);
    }

    // Before this event the caller got a `disconnected`, then silence — which
    // reads exactly like a healthy idle link.
    const failed = events.find((e) => e.type === "failed");

    expect(failed).toEqual({ type: "failed", attempts: 2 });
  });
});
