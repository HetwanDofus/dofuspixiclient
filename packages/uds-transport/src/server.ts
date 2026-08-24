import type { Socket } from "bun";
import { statSync, unlinkSync } from "node:fs";

import {
  type GatewayFrame,
  GatewayFrameSchema,
} from "@dofus/proto/gateway/v1/gateway_frame_pb";

import type {
  ConnectionHandlers,
  FramedSocket,
  Logger,
  ServerOptions,
} from "./types.ts";
import { encodeGatewayFrame, isOpen, WriteBuffer } from "./codec.ts";
import { FrameReader } from "./frame-reader.ts";

const silent: Logger = { warn: () => undefined, error: () => undefined };

type Ctx = {
  reader: FrameReader<GatewayFrame>;
  handlers: ConnectionHandlers;
  wb: WriteBuffer;
};

function framed(socket: Socket<Ctx>, _log: Logger): FramedSocket {
  return {
    send: (frame) => socket.data.wb.push(socket, encodeGatewayFrame(frame)),
    close: () => socket.end(),
    get closed() {
      return !isOpen(socket);
    },
  };
}

// Bun.listen refuses to bind a unix path that still carries a file, and a core
// that went away without unlinking — `bun --watch` restarting it, a SIGKILL, a
// crash — leaves one behind. Without this every hot reload dies with
// EADDRINUSE while the gateway sits there buffering. Nothing live can own the
// path either: a blue/green handoff always brings the standby up on a
// *different* socket (see Upstream.handoffTo), so a file here is stale.
function unlinkStaleSocket(path: string, log: Logger) {
  try {
    if (!statSync(path).isSocket()) {
      return;
    }
  } catch {
    return; // pas de fichier : rien à nettoyer
  }

  try {
    unlinkSync(path);
    log.warn({ path }, "removed stale socket file before listening");
  } catch (err) {
    log.error({ path, err }, "could not remove stale socket file");
  }
}

export function listen(opts: ServerOptions) {
  const log = opts.logger ?? silent;

  unlinkStaleSocket(opts.path, log);

  return Bun.listen<Ctx>({
    unix: opts.path,
    socket: {
      open(socket) {
        socket.data = {
          reader: new FrameReader(GatewayFrameSchema),
          handlers: undefined as unknown as ConnectionHandlers,
          wb: new WriteBuffer(),
        };

        const handlers = opts.onConnection(framed(socket, log));
        socket.data.handlers = handlers;
      },
      data(socket, chunk) {
        for (const frame of socket.data.reader.push(new Uint8Array(chunk))) {
          socket.data.handlers.onFrame(frame);
        }
      },
      drain(socket) {
        socket.data.wb.flush(socket);
      },
      close(socket) {
        socket.data?.handlers.onClose();
      },
      error(socket, err) {
        log.error({ err, path: opts.path }, "uds server socket error");
        socket.data?.handlers.onClose();
      },
    },
  });
}
