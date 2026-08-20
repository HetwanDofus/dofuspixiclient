import type { Socket } from "bun";

import { GatewayFrameSchema } from "@dofus/proto/gateway/v1/gateway_frame_pb";

import type { ClientOptions, FramedSocket, Logger } from "./types.ts";
import { encodeGatewayFrame, isOpen, WriteBuffer } from "./codec.ts";
import { FrameReader } from "./frame-reader.ts";

const silent: Logger = { warn: () => undefined, error: () => undefined };

export function connect(opts: ClientOptions): FramedSocket {
  const log = opts.logger ?? silent;
  const reconnectMs = opts.reconnectMs ?? 500;
  let reader = new FrameReader(GatewayFrameSchema);
  let wb = new WriteBuffer();
  let current: Socket<unknown> | null = null;
  let closed = false;

  const attempt = async (): Promise<void> => {
    if (closed) {
      return;
    }

    try {
      current = await Bun.connect({
        unix: opts.path,
        socket: {
          open(socket) {
            reader = new FrameReader(GatewayFrameSchema);
            wb = new WriteBuffer();
            // Publish the socket *before* onConnect: on a reconnect, `current`
            // still holds the dead socket (or null) until the awaited
            // Bun.connect() resolves, so anything the callback sends —
            // a buffer replay, typically — would be dropped on the floor.
            current = socket;
            opts.onConnect?.();
          },
          data(_s, chunk) {
            for (const frame of reader.push(new Uint8Array(chunk))) {
              opts.onFrame(frame);
            }
          },
          drain(s) {
            wb.flush(s);
          },
          close() {
            opts.onDisconnect?.();

            current = null;

            if (!closed) {
              setTimeout(attempt, reconnectMs);
            }
          },
          error(_s, err) {
            log.error(
              {
                err: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
                path: opts.path,
              },
              "uds client socket error"
            );
          },
        },
      });
    } catch (err) {
      log.warn(
        { err: (err as Error).message, path: opts.path, reconnectMs },
        "uds connect failed, retrying"
      );

      setTimeout(attempt, reconnectMs);
    }
  };

  void attempt();

  return {
    send: (frame) => {
      if (current && isOpen(current)) {
        wb.push(current, encodeGatewayFrame(frame));
      }
    },
    close: () => {
      closed = true;

      current?.end();
    },
    get closed() {
      return closed;
    },
  };
}
