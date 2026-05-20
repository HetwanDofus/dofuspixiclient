// Webview-side transport. Implements the `TcpSocketHandle` interface
// that `dofus1-net.Client.connect` expects, but every operation
// proxies through electrobun's RPC bridge to the Bun main process —
// where the real `Bun.connect` lives.
//
// Wire up at app boot:
//
//   import { setTransportFactory } from "@dofus/dofus1-net";
//   import { initRpcTransport, openRpcSocket } from "@/game/net/rpc-transport";
//
//   initRpcTransport();
//   setTransportFactory(openRpcSocket);

import { createRPC, Electroview } from "electrobun/view";
import type {
  TcpSocketHandle,
  TcpSocketOptions,
} from "@dofus/dofus1-net";

import { createLogger } from "@/utils/logger";

const log = createLogger("net.rpc");

interface PendingSocket {
  onFrame: ((frame: string) => void) | null;
  onClose:
    | ((info: { byPeer: boolean; error?: unknown }) => void)
    | null;
}

const pending = new Map<number, PendingSocket>();

// Local schema mirrors the union from `@/shared/net-rpc`, but typed
// flat the way `createRPC` consumes it. We can't import the shared
// schema directly because `createRPC`'s `Schema` generic is keyed on
// requests/messages at the top level, not the bun/webview split.
type RpcShape = {
  requests: {
    // (Outgoing — invoked on the bun side)
    tcpConnect: {
      params: { host: string; port: number };
      response: { socketId: number };
    };
    tcpDisconnect: {
      params: { socketId: number };
      response: void;
    };
  };
  messages: {
    // (Incoming — fired by the bun side)
    tcpFrame: { socketId: number; frame: string };
    tcpClose: { socketId: number; byPeer: boolean; error?: string };
    // (Outgoing — sent to bun)
    tcpSend: { socketId: number; frame: string };
  };
};

type RpcInstance = ReturnType<typeof createRPC<RpcShape>> & {
  setTransport: (t: unknown) => void;
};

let rpc: RpcInstance | null = null;

/** Initialise the webview-side RPC binding. Idempotent. */
export function initRpcTransport(): void {
  if (rpc) {
    return;
  }
  const instance = createRPC<RpcShape>({}) as unknown as RpcInstance;

  // Electroview MUST run before any `addMessageListener` call —
  // `createRPC` starts with no transport, and the listener registry
  // refuses to bind until `setTransport` has installed one. The
  // constructor calls `init() → rpc.setTransport(...)` synchronously.
  new Electroview({
    rpc: instance as unknown as { setTransport: (t: unknown) => void },
  });

  // Message dispatcher — the bun side emits `tcpFrame` / `tcpClose`
  // messages that we route into the matching socket handle.
  const addListener = (
    instance as unknown as {
      addMessageListener: (
        name: string,
        handler: (payload: unknown) => void,
      ) => void;
    }
  ).addMessageListener;

  addListener("tcpFrame", (payload) => {
    const { socketId, frame } = payload as {
      socketId: number;
      frame: string;
    };
    pending.get(socketId)?.onFrame?.(frame);
  });
  addListener("tcpClose", (payload) => {
    const { socketId, byPeer, error } = payload as {
      socketId: number;
      byPeer: boolean;
      error?: string;
    };
    const s = pending.get(socketId);
    pending.delete(socketId);
    s?.onClose?.({
      byPeer,
      error: error ? new Error(error) : undefined,
    });
  });

  rpc = instance;
  log.info("RPC transport bound");
}

/** `TransportFactory` implementation. Pass to `setTransportFactory`
 *  from `@dofus/dofus1-net`. */
export async function openRpcSocket(
  opts: TcpSocketOptions,
): Promise<TcpSocketHandle> {
  if (!rpc) {
    throw new Error(
      "openRpcSocket: initRpcTransport() must be called first",
    );
  }
  const bound = rpc;
  const { socketId } = (await (
    bound as unknown as {
      request: (
        name: string,
        params: { host: string; port: number },
      ) => Promise<{ socketId: number }>;
    }
  ).request("tcpConnect", { host: opts.host, port: opts.port })) as {
    socketId: number;
  };
  const slot: PendingSocket = { onFrame: null, onClose: null };
  pending.set(socketId, slot);
  log.info(`tcpConnect ok socketId=${socketId} ${opts.host}:${opts.port}`);

  const sendMessage = (
    bound as unknown as {
      send: (name: string, payload: unknown) => void;
    }
  ).send;

  return {
    send(payload) {
      sendMessage("tcpSend", { socketId, frame: payload });
    },
    close() {
      void (
        bound as unknown as {
          request: (
            name: string,
            params: { socketId: number },
          ) => Promise<void>;
        }
      )
        .request("tcpDisconnect", { socketId })
        .catch(() => {
          // already closed
        });
    },
    onFrame(cb) {
      slot.onFrame = cb;
    },
    onClose(cb) {
      slot.onClose = cb;
    },
  };
}
