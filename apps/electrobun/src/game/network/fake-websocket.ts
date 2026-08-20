// Test double for the global WebSocket. Lives outside the spec files because
// both the Connection unit tests and the GameClient wiring tests need to drive
// a socket from the *server* side — opening it, and closing it with a chosen
// code — which no real socket lets us do deterministically.

type CloseLike = { code: number; reason: string };

export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  /** Every socket built since the last install(), oldest first. */
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  binaryType = "blob";
  onopen: (() => void) | null = null;
  onclose: ((e: CloseLike) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  readonly sent: Uint8Array[] = [];

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: Uint8Array): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    this.fireClose(code, reason);
  }

  // ── Server-side controls ──────────────────────────────────────────────────

  /** The handshake completes. */
  accept(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  /** The far end hangs up with `code`. */
  hangUp(code: number, reason = ""): void {
    this.fireClose(code, reason);
  }

  private fireClose(code: number, reason: string): void {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }

    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  static latest(): FakeWebSocket {
    // Not `.at(-1)` — the app's tsconfig lib predates it.
    const last = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

    if (!last) {
      throw new Error("no socket was opened");
    }

    return last;
  }
}

/**
 * Swaps the global WebSocket for the fake and returns the restore function.
 * Connection reads `WebSocket.OPEN` off the global, so the swap has to cover
 * the constructor *and* the statics.
 */
export function installFakeWebSocket(): () => void {
  const real = globalThis.WebSocket;

  FakeWebSocket.instances = [];
  (globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket;

  return () => {
    (globalThis as { WebSocket: unknown }).WebSocket = real;
    FakeWebSocket.instances = [];
  };
}
