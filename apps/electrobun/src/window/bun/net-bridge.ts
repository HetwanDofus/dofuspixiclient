// Bun-side implementation of the TCP bridge declared in
// `@/shared/net-rpc.ts`. Holds a small registry of open sockets keyed
// by integer ids and exposes the RPC handler shape that the
// `BrowserWindow` `rpc` config can splat in.

import {
  encodeFrame,
  FrameReader,
} from "@dofus/dofus1-net";

import type { NetRPCSchema } from "@/shared/net-rpc";

interface OpenSocket {
  socket: { write(s: string): unknown; end(): unknown };
  reader: FrameReader;
}

/**
 * RPC handlers + a message-sender getter. Wire up like:
 *
 *   const bridge = createNetBridge();
 *   const window = new BrowserWindow({
 *     rpc: defineElectrobunRPC<NetRPCSchema, "bun">("bun", {
 *       handlers: { requests: bridge.requests, messages: bridge.messages },
 *     }),
 *   });
 *   bridge.attach(window.rpc);
 */
export function createNetBridge(): {
  requests: NetBridgeRequests;
  messages: NetBridgeMessages;
  attach(rpc: NetBridgeAttachable): void;
} {
  const sockets = new Map<number, OpenSocket>();
  let nextId = 1;
  let sendToWebview: NetBridgeSender | null = null;

  function send<K extends keyof NetRPCSchema["webview"]["messages"]>(
    name: K,
    payload: NetRPCSchema["webview"]["messages"][K],
  ): void {
    sendToWebview?.(name, payload);
  }

  const requests: NetBridgeRequests = {
    tcpConnect: async ({ host, port }) => {
      const socketId = nextId++;
      const reader = new FrameReader();
      const handle = await Bun.connect({
        hostname: host,
        port,
        socket: {
          data(_s, data) {
            const text =
              typeof data === "string"
                ? data
                : new TextDecoder().decode(data);
            const frames = reader.push(text);
            for (const f of frames) {
              send("tcpFrame", { socketId, frame: f });
            }
          },
          close() {
            sockets.delete(socketId);
            reader.reset();
            send("tcpClose", { socketId, byPeer: true });
          },
          error(_s, error) {
            sockets.delete(socketId);
            reader.reset();
            send("tcpClose", {
              socketId,
              byPeer: true,
              error: String(error),
            });
          },
        },
      });
      sockets.set(socketId, { socket: handle, reader });
      return { socketId };
    },
    tcpDisconnect: async ({ socketId }) => {
      const s = sockets.get(socketId);
      if (!s) {
        return;
      }
      sockets.delete(socketId);
      try {
        s.socket.end();
      } catch {
        // socket already closed
      }
      // Echo the close back so the webview's handle fires `onClose`
      // even on a user-initiated close (matches the Bun-only
      // `openTcpSocket` behaviour).
      send("tcpClose", { socketId, byPeer: false });
    },
  };

  const messages: NetBridgeMessages = {
    tcpSend: ({ socketId, frame }) => {
      const s = sockets.get(socketId);
      if (!s) {
        return;
      }
      s.socket.write(encodeFrame(frame));
    },
  };

  return {
    requests,
    messages,
    attach(rpc) {
      sendToWebview = (name, payload) => {
        // Electrobun RPC exposes `send.<messageName>(payload)`.
        // Cast through unknown — schema generics don't flow through
        // the bridge boundary.
        (rpc.send as Record<string, (p: unknown) => void>)[name as string]?.(
          payload as unknown,
        );
      };
    },
  };
}

type NetBridgeRequests = {
  [K in keyof NetRPCSchema["bun"]["requests"]]: (
    params: NetRPCSchema["bun"]["requests"][K]["params"],
  ) => Promise<NetRPCSchema["bun"]["requests"][K]["response"]>;
};

type NetBridgeMessages = {
  [K in keyof NetRPCSchema["bun"]["messages"]]: (
    payload: NetRPCSchema["bun"]["messages"][K],
  ) => void;
};

type NetBridgeSender = <K extends keyof NetRPCSchema["webview"]["messages"]>(
  name: K,
  payload: NetRPCSchema["webview"]["messages"][K],
) => void;

interface NetBridgeAttachable {
  send: Record<string, (payload: unknown) => void>;
}
