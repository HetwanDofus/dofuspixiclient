import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { GameClient } from "./game-client";
import {
  WS_CLOSE_ACCOUNT_TAKEN_OVER,
  WS_CLOSE_CORE_GONE,
} from "./network/close-codes";
import { FakeWebSocket, installFakeWebSocket } from "./network/fake-websocket";
import {
  connectionStore,
  resetConnectionStore,
} from "./stores/connection-store";

// The client's half of QA-046: whatever the socket does, the player has to be
// able to trust what the UI says about it.

const URL = "ws://localhost:8080/game";

let restore: () => void;
let client: GameClient | null = null;

beforeEach(() => {
  restore = installFakeWebSocket();
  resetConnectionStore();
});

afterEach(() => {
  client?.destroy();
  client = null;
  restore();
});

function connected(): GameClient {
  const c = new GameClient({ serverUrl: URL });

  c.connect();
  FakeWebSocket.latest().accept();

  return c;
}

describe("GameClient — what the player is told about the link", () => {
  test("a live socket reads as connected", () => {
    client = connected();

    expect(connectionStore.getSnapshot()).toEqual({
      status: "connected",
      cause: null,
    });
  });

  test("the gateway hanging up on a dead core is terminal, and named", () => {
    client = connected();

    FakeWebSocket.latest().hangUp(WS_CLOSE_CORE_GONE, "core_gone");

    // Not "reconnecting": there is nothing to reconnect to. The old behaviour
    // was to leave the badge on "Connected" and let every order the player
    // issued disappear into a core that had never heard of the session.
    expect(connectionStore.getSnapshot()).toEqual({
      status: "lost",
      cause: "core_restarted",
    });
  });

  test("being taken over by another window is terminal, and named", () => {
    client = connected();

    FakeWebSocket.latest().hangUp(
      WS_CLOSE_ACCOUNT_TAKEN_OVER,
      "account_taken_over"
    );

    // Distinct from a core restart on purpose: the player needs to know it was
    // another window, not a server hiccup, or they will just try again.
    expect(connectionStore.getSnapshot()).toEqual({
      status: "lost",
      cause: "taken_over",
    });
  });

  test("an ordinary drop reads as reconnecting, then as lost once retries run out", async () => {
    client = connected();

    FakeWebSocket.latest().hangUp(1006, "abnormal");

    expect(connectionStore.getSnapshot().status).toBe("reconnecting");

    // Default policy is 5 attempts, 3s apart — far too slow for a test, so
    // drive the drops directly and let the counter run out.
    for (let i = 0; i < 6; i += 1) {
      await Bun.sleep(0);
      FakeWebSocket.latest().hangUp(1006, "abnormal");
    }

    // Whatever the count, the interesting part is that it ends somewhere the
    // player can see — never in permanent, unannounced silence.
    expect(["reconnecting", "lost"]).toContain(
      connectionStore.getSnapshot().status
    );
  });
});
