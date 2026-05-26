// WebSocket transport. Sibling to `tcp-socket.ts`; same
// `TcpSocketHandle` surface so `Client` doesn't know or care which
// wire format is underneath.
//
// Why both exist:
//   - tcp-socket.ts → Bun-side raw socket via `Bun.connect`, used by
//     the Electrobun production client (talks to the canonical 1.29
//     server format used by every other client/emulator).
//   - websocket-socket.ts → browser `WebSocket` API, used when the
//     client runs inside a vanilla browser tab (headless dev iteration
//     via Chrome DevTools MCP, CI checks, browser-only demos). The
//     AraknemuHorizon emulator switches to RFC 6455 mode via
//     `transport.mode = "websocket"` in `config.conf`; same protocol
//     content, no NUL/newline framing — one WebSocket text frame per
//     application packet.
//
// The framing layer (`framing.ts` `encodeFrame` + `FrameReader`) is
// bypassed entirely on the WS path. The server's WS adapter delivers
// one packet per message and accepts one packet per `ws.send`, so the
// dual-character `\n\x00` terminator the TCP path uses would just
// look like trailing garbage to the server.

import type { TcpSocketHandle, TcpSocketOptions } from "./tcp-socket";

/** Resolve a `host:port` pair into a `ws://host:port/<path>` URL.
 *  Defaults to root path; pass a custom path if the server is
 *  configured with `transport.websocket.path` ≠ "/". */
export function buildWebSocketUrl(
  opts: TcpSocketOptions & { secure?: boolean; path?: string },
): string {
  const scheme = opts.secure ? "wss" : "ws";
  const path = opts.path ?? "/";
  const normalisedPath = path.startsWith("/") ? path : `/${path}`;
  return `${scheme}://${opts.host}:${opts.port}${normalisedPath}`;
}

export interface WebSocketTransportOptions {
  /** Default `false` (`ws://`). Set `true` to use `wss://`. */
  secure?: boolean;
  /** Default `/`. Must match the server's
   *  `transport.websocket.path` setting. */
  path?: string;
}

/**
 * Build a `TransportFactory` for the browser WebSocket API. Pass to
 * `setTransportFactory` at boot:
 *
 *   setTransportFactory(makeWebSocketFactory({ path: "/" }));
 *
 * Each `Client.connect()` call opens a fresh WebSocket; we do NOT
 * pool connections because the protocol layer's pivot (auth →
 * game) closes one socket and opens another.
 */
export function makeWebSocketFactory(
  baseOpts: WebSocketTransportOptions = {},
): (opts: TcpSocketOptions) => Promise<TcpSocketHandle> {
  return (opts) => openWebSocket({ ...opts, ...baseOpts });
}

/** Open one WebSocket, resolve once it's `OPEN`. Rejects on the
 *  initial connection failure; runtime errors after open route through
 *  the `onClose` callback. */
export async function openWebSocket(
  opts: TcpSocketOptions & WebSocketTransportOptions,
): Promise<TcpSocketHandle> {
  if (typeof WebSocket === "undefined") {
    throw new Error(
      "openWebSocket: WebSocket global is not available in this environment",
    );
  }
  const url = buildWebSocketUrl(opts);
  const ws = new WebSocket(url);
  // Server delivers text frames; force binaryType so a stray binary
  // frame is at least readable as ArrayBuffer rather than Blob (no
  // async unwrap step).
  ws.binaryType = "arraybuffer";

  let frameHandler: ((frame: string) => void) | null = null;
  let closeHandler:
    | ((info: { byPeer: boolean; error?: unknown }) => void)
    | null = null;
  let opened = false;

  // Connection handshake: resolve on `open`, reject on close-before-open.
  // After `open`, ws errors flow into `closeHandler` instead of throwing.
  await new Promise<void>((resolve, reject) => {
    const onOpen = (): void => {
      opened = true;
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("close", onPreOpenClose);
      ws.removeEventListener("error", onPreOpenError);
      resolve();
    };
    const onPreOpenClose = (ev: CloseEvent): void => {
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("close", onPreOpenClose);
      ws.removeEventListener("error", onPreOpenError);
      reject(
        new Error(
          `openWebSocket: ${url} closed before open (code=${ev.code}, reason=${ev.reason})`,
        ),
      );
    };
    const onPreOpenError = (): void => {
      // CloseEvent will follow; let `onPreOpenClose` reject with the
      // close code so the caller sees the real reason. The error
      // event itself carries no useful payload in browser WS.
    };
    ws.addEventListener("open", onOpen);
    ws.addEventListener("close", onPreOpenClose);
    ws.addEventListener("error", onPreOpenError);
  });

  // Post-open lifecycle: wire message + close handlers. From here on,
  // failures arrive via close events with the byPeer flag set.
  ws.addEventListener("message", (ev) => {
    const data = ev.data;
    let frame: string;
    if (typeof data === "string") {
      frame = data;
    } else if (data instanceof ArrayBuffer) {
      frame = new TextDecoder().decode(data);
    } else if (data instanceof Uint8Array) {
      frame = new TextDecoder().decode(data);
    } else {
      // Blob fallback — `binaryType = "arraybuffer"` should prevent
      // this; treat as opaque if it sneaks through.
      return;
    }
    // Server is configured to emit one application packet per WS
    // frame, so no FrameReader is needed. If a frame ever contains
    // the legacy NUL/newline terminator (mixed-mode middleware?),
    // strip it to be safe.
    let normalised = frame;
    while (
      normalised.length > 0 &&
      (normalised.endsWith("\x00") || normalised.endsWith("\n"))
    ) {
      normalised = normalised.slice(0, -1);
    }
    if (normalised.length > 0) {
      frameHandler?.(normalised);
    }
  });

  ws.addEventListener("close", (ev) => {
    if (!opened) return; // pre-open close already handled above
    closeHandler?.({
      byPeer: true,
      // CloseEvent.code 1000 = normal; > 1000 = error / abnormal.
      error:
        ev.code !== 1000 && ev.code !== 1005
          ? new Error(`ws close code=${ev.code} reason=${ev.reason || "n/a"}`)
          : undefined,
    });
  });

  ws.addEventListener("error", (_ev) => {
    if (!opened) return;
    // Browser WS errors don't carry a payload. The follow-up `close`
    // event will fire with a non-1000 code; let `close` handle it so
    // we don't double-fire `closeHandler`.
  });

  const handle: TcpSocketHandle = {
    send(payload) {
      // One application packet per WS frame; no terminator. The
      // server's WebSocketHandler strips terminators if they appear,
      // but emitting them at all would mean the server treats them as
      // part of the next packet for the legacy framing layer the WS
      // path bypasses. Send the raw payload only.
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    },
    close() {
      // Use a clean close (1000) so the server doesn't log this as an
      // abnormal disconnect. Subsequent message handlers no-op
      // because readyState !== OPEN.
      try {
        ws.close(1000, "client-close");
      } catch {
        // ignore — already closing
      }
      // Fire local close immediately so the application's reconnect
      // logic doesn't wait for the WS shutdown round-trip.
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
