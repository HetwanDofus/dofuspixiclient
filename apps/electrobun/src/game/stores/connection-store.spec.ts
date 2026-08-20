import { beforeEach, describe, expect, test } from "bun:test";

import {
  connectionStore,
  markConnected,
  markLost,
  markReconnecting,
  resetConnectionStore,
} from "./connection-store";

beforeEach(() => {
  resetConnectionStore();
});

describe("connectionStore", () => {
  test("tracks the ordinary connect → drop → reconnect cycle", () => {
    markConnected();
    expect(connectionStore.getSnapshot().status).toBe("connected");

    markReconnecting();
    expect(connectionStore.getSnapshot()).toEqual({
      status: "reconnecting",
      cause: null,
    });

    markConnected();
    expect(connectionStore.getSnapshot()).toEqual({
      status: "connected",
      cause: null,
    });
  });

  test("a lost session does not walk itself back to reconnecting", () => {
    markLost("core_restarted");
    markReconnecting();

    // The socket may well come back; the session behind it will not. Letting
    // this flip back would put a hopeful "Reconnexion…" over a dead world and
    // dismiss the dialog the player is meant to act on.
    expect(connectionStore.getSnapshot()).toEqual({
      status: "lost",
      cause: "core_restarted",
    });
  });

  test("a genuine reconnect after a loss still clears it", () => {
    markLost("unreachable");
    markConnected();

    expect(connectionStore.getSnapshot()).toEqual({
      status: "connected",
      cause: null,
    });
  });
});
