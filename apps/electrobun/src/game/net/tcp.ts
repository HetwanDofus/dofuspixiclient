// Low-level transport helpers. The dofus1-net `Client` already owns
// the socket and dispatches inbound frames, so the work left here is:
//
//   - Frame-level tracing (raw inbound + outbound strings) gated by a
//     single flag, so step-5 debugging can capture an end-to-end log.
//   - A typed close result that distinguishes "we expected this close"
//     (e.g. we just called `client.disconnect()` after AX → pivot)
//     from "the peer dropped us" (error path).
//
// The handshake / pivot orchestration sits in `bootstrap.ts`; the
// per-opcode subscriptions sit in `handlers/`; this file is
// intentionally protocol-agnostic.

export const NET_TRACE_FRAMES = true;

export interface CloseInfo {
  /** True when the peer closed first (we did not call `close()`). */
  byPeer: boolean;
  /** True when bootstrap expected this close (e.g. pivot to gamed). */
  expected: boolean;
  error?: unknown;
}

const MAX_TRACE_LEN = 160;

export function traceTrim(s: string): string {
  if (s.length <= MAX_TRACE_LEN) {
    return s;
  }

  return `${s.slice(0, MAX_TRACE_LEN)}…(+${s.length - MAX_TRACE_LEN})`;
}
