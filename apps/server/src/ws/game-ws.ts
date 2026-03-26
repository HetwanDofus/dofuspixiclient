import { Elysia } from "elysia";
import { match } from "ts-pattern";

import {
  handleCharacterSelect,
  handleLogin,
  handleLogout,
} from "../handlers/auth.ts";
import { handleMapChange } from "../handlers/map.ts";
import {
  clearPendingTransition,
  handleMoveEnd,
  handleMovement,
} from "../handlers/movement.ts";
import { handleBoostStat, handleDebugGiveCapital } from "../handlers/stats.ts";
import { decodeClientMessage, encodeServerMessage } from "../protocol/codec.ts";
import {
  ClientMessageType,
  type ClientPayloadMap,
  ServerMessageType,
} from "../protocol/types.ts";
import {
  createSession,
  getSession,
  removeSession,
  type WsHandle,
} from "./client-session.ts";
import { createLogger } from "../utils/logger.ts";

const log = createLogger("WS");

/** Type-safe payload extraction from a decoded client message. */
function payload<T extends keyof ClientPayloadMap>(
  msg: { payload: unknown },
): ClientPayloadMap[T] {
  return msg.payload as ClientPayloadMap[T];
}

let sessionCounter = 0;

export const gameWs = new Elysia().ws("/game", {
  open(ws) {
    const sessionId = `s${++sessionCounter}_${Date.now()}`;
    (ws.data as Record<string, unknown>).sessionId = sessionId;
    createSession(ws.raw as unknown as WsHandle, sessionId);
    log.info(`Client connected: ${sessionId}`);
  },

  async message(ws, data) {
    const sessionId = (ws.data as Record<string, unknown>).sessionId as string;
    const session = getSession(sessionId);
    if (!session) return;

    try {
      const raw =
        data instanceof ArrayBuffer
          ? data
          : data instanceof Uint8Array
            ? data.buffer
            : typeof data === "object" && data !== null && "buffer" in data
              ? (data as { buffer: ArrayBuffer }).buffer
              : data;

      const msg = decodeClientMessage(raw as ArrayBuffer);

      await match(msg.type)
        .with(ClientMessageType.AUTH_LOGIN, () =>
          handleLogin(session, payload<typeof ClientMessageType.AUTH_LOGIN>(msg)))
        .with(ClientMessageType.AUTH_LOGOUT, () =>
          handleLogout(session))
        .with(ClientMessageType.CHARACTER_SELECT, () =>
          handleCharacterSelect(session, payload<typeof ClientMessageType.CHARACTER_SELECT>(msg)))
        .with(ClientMessageType.CHARACTER_MOVE, () =>
          handleMovement(session, payload<typeof ClientMessageType.CHARACTER_MOVE>(msg)))
        .with(ClientMessageType.CHARACTER_MOVE_END, () =>
          handleMoveEnd(session))
        .with(ClientMessageType.MAP_CHANGE, () =>
          handleMapChange(session, payload<typeof ClientMessageType.MAP_CHANGE>(msg)))
        .with(ClientMessageType.CHARACTER_BOOST_STAT, () =>
          handleBoostStat(session, payload<typeof ClientMessageType.CHARACTER_BOOST_STAT>(msg)))
        .with(ClientMessageType.DEBUG_GIVE_CAPITAL, () =>
          handleDebugGiveCapital(session, payload<typeof ClientMessageType.DEBUG_GIVE_CAPITAL>(msg)))
        .with(ClientMessageType.PING, () => {
          ws.raw.send(encodeServerMessage(ServerMessageType.PONG, { time: Date.now() }));
        })
        .otherwise((type) => {
          log.warn(`Unknown message type: 0x${type.toString(16)}`);
        });
    } catch (err) {
      log.error(`Message handling error:`, err);
    }
  },

  async close(ws) {
    const sessionId = (ws.data as Record<string, unknown>).sessionId as string;
    const session = getSession(sessionId);
    if (session) {
      clearPendingTransition(sessionId);
      await handleLogout(session);
      removeSession(sessionId);
    }
    log.info(`Client disconnected: ${sessionId}`);
  },
});
