import { describe, expect, test } from "bun:test";

import { GRID_VERSION } from "@dofus/grid";
import { PROTO_VERSION } from "@dofus/proto";
import type { DofusMessage } from "@dofus/proto/server_messages_pb";
import type { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";

import { LoginHandshake } from "./login.handshake";
import { loadServerContract } from "./server-contract";

describe("LoginHandshake", () => {
  test("announces package versions and the published navigation revision", () => {
    let sent: DofusMessage | undefined;
    const frames = {
      broadcast: (_sessions: readonly string[], message: DofusMessage) => {
        sent = message;
      },
    } as GatewayFrameService;

    new LoginHandshake(frames).onSessionOpened({
      sessionId: "session-1",
      accountId: "",
      characterId: "",
      remoteAddr: "127.0.0.1",
      openedAt: 0,
    });

    expect(sent?.payload.case).toBe("handshakeConnectionKey");
    if (sent?.payload.case !== "handshakeConnectionKey") {
      throw new Error("handshake was not sent");
    }

    const expected = loadServerContract();
    expect(sent.payload.value).toMatchObject({
      protoVersion: PROTO_VERSION,
      gridVersion: GRID_VERSION,
      navigationSchemaVersion: expected.navigationSchemaVersion,
      navigationWorldRevision: expected.navigationWorldRevision,
    });
  });
});
