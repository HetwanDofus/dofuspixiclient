// Raw TCP socket wrapper. Built for Bun's native `Bun.connect` API so
// we can talk to a real Dofus 1.29 server (XMLSocket-compatible) from
// Electrobun's Bun-side process.
//
// API surface kept intentionally small: connect, send a frame, receive
// frames (already split by `FrameReader`), close. Higher-level
// reconnect / pivot logic lives in `client.ts`.

import { encodeFrame, FrameReader } from "./framing";

export interface TcpSocketHandle {
  /** Send one logical frame. The framing terminator is appended here. */
  send(payload: string): void;
  /** Close the socket. Triggers `onClose` once shutdown completes. */
  close(): void;
  /** Subscribe to received frames. Replaces any prior handler. */
  onFrame(cb: (frame: string) => void): void;
  /** Subscribe to close / disconnect. */
  onClose(cb: (info: { byPeer: boolean; error?: unknown }) => void): void;
}

export interface TcpSocketOptions {
  host: string;
  port: number;
}

/**
 * Connect a TCP socket. Resolves once the handshake is up. The frame
 * reader is owned internally — the caller only sees completed frames.
 *
 * Bun's `Bun.connect` returns a `Socket<T>`; we type-erase the data
 * generic since this layer is protocol-agnostic.
 */
export async function openTcpSocket(
  opts: TcpSocketOptions
): Promise<TcpSocketHandle> {
  const reader = new FrameReader();
  let frameHandler: ((frame: string) => void) | null = null;
  let closeHandler:
    | ((info: { byPeer: boolean; error?: unknown }) => void)
    | null = null;

  const socket = await Bun.connect({
    hostname: opts.host,
    port: opts.port,
    socket: {
      data(_socket, data) {
        const text =
          typeof data === "string" ? data : new TextDecoder().decode(data);

        const frames = reader.push(text);

        if (frameHandler) {
          for (const f of frames) {
            frameHandler(f);
          }
        }
      },
      close() {
        reader.reset();

        closeHandler?.({ byPeer: true });
      },
      error(_socket, error) {
        reader.reset();

        closeHandler?.({ byPeer: true, error });
      },
    },
  });

  const handle: TcpSocketHandle = {
    send(payload) {
      socket.write(encodeFrame(payload));
    },
    close() {
      socket.end();
      reader.reset();

      closeHandler?.({ byPeer: false });
    },
    onFrame(cb) {
      frameHandler = cb;
    },
    onClose(cb) {
      closeHandler = cb;
    },
  };

  return handle;
}
