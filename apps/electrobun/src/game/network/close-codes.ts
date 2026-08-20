// WebSocket close codes the gateway uses to tell us why a session went away.
// The 4000-4999 range is reserved for application use.
//
// Mirrored server-side in
// apps/gameserver-ts/src/gateway/close-codes.ts — the two apps are separate
// deployables with no shared runtime package, so the values are duplicated on
// purpose. Change one, change the other.

/**
 * The core process backing our session died. Character selection, map and
 * presence went with it, so there is nothing to resume: reconnecting the socket
 * would succeed and change nothing. Back to the login screen (QA-046).
 */
export const WS_CLOSE_CORE_GONE = 4001;

/**
 * Another window authenticated on the same account and took the session over.
 * One session per account: this one lost the race.
 */
export const WS_CLOSE_ACCOUNT_TAKEN_OVER = 4002;

/** The server ended the session and gave no reason we recognise. */
export const WS_CLOSE_SESSION_ENDED = 4000;

/** Normal closure — we asked for it, or the server shut down cleanly. */
export const WS_CLOSE_NORMAL = 1000;

const TERMINAL = new Set<number>([
  WS_CLOSE_SESSION_ENDED,
  WS_CLOSE_CORE_GONE,
  WS_CLOSE_ACCOUNT_TAKEN_OVER,
]);

/**
 * True when the server deliberately ended the session. Reconnecting after one
 * of these would succeed at the socket level and change nothing — the state
 * behind the session is gone, or belongs to somebody else now.
 */
export function isTerminalClose(code: number): boolean {
  return TERMINAL.has(code);
}
