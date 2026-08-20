// WebSocket close codes the gateway uses to tell a client *why* its session
// went away. The 4000-4999 range is reserved for application use.
//
// Mirrored client-side in
// apps/electrobun/src/game/network/close-codes.ts — the two apps are separate
// deployables with no shared runtime package, so the values are duplicated on
// purpose. Change one, change the other.

/**
 * The core process backing this session died. Everything it held — character
 * selection, map, presence — went with it, so the session cannot be resumed:
 * the client must go back to the login screen. Emitted on an unorchestrated
 * core restart, never on a handoff (QA-046).
 */
export const WS_CLOSE_CORE_GONE = 4001;

/**
 * Another window authenticated on the same account and took the session over.
 * One session per account is enforced by the core; this is how the client that
 * loses the race finds out.
 */
export const WS_CLOSE_ACCOUNT_TAKEN_OVER = 4002;

/** The core ended the session and gave no reason we recognise. */
export const WS_CLOSE_SESSION_ENDED = 4000;

const BY_REASON: Record<string, number> = {
  core_gone: WS_CLOSE_CORE_GONE,
  account_taken_over: WS_CLOSE_ACCOUNT_TAKEN_OVER,
};

/**
 * Translates a core-supplied motive into a wire close code. The core says
 * *why*; the gateway owns *how it looks on the socket*, so every code the
 * client can see is defined in this one file.
 */
export function closeCodeForCoreReason(reason: string): number {
  return BY_REASON[reason] ?? WS_CLOSE_SESSION_ENDED;
}
