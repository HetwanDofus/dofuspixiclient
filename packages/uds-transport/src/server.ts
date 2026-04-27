import type { Socket } from "bun";

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

export function listen(opts: ServerOptions) {
  const log = opts.logger ?? silent;

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
