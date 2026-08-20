// One session per account. The single place in the project that ends somebody
// else's session, so that a future session-resume feature has exactly one path
// to change.

import { Injectable, Logger } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

/** Motive handed to the gateway, which maps it onto a WebSocket close code. */
export const EVICT_ACCOUNT_TAKEN_OVER = "account_taken_over";

@Injectable()
export class SessionEvictionService {
  private readonly logger = new Logger(SessionEvictionService.name);

  constructor(
    private readonly sessions: SessionRegistry,
    private readonly frames: GatewayFrameService
  ) {}

  /**
   * Ends every other live session on `accountId`, keeping `keepSessionId` — the
   * one that just authenticated.
   *
   * Callers must only reach here **after** validating the credentials or the
   * ticket. Evicting on a failed attempt would let anyone disconnect a player
   * by guessing their username.
   *
   * Returns how many sessions were ended.
   */
  evictAccount(
    accountId: string,
    keepSessionId: string,
    reason: string = EVICT_ACCOUNT_TAKEN_OVER
  ): number {
    const doomed = this.sessions.sessionsForAccount(accountId, keepSessionId);

    for (const session of doomed) {
      // Gateway first: the socket dies without waiting on us, and the
      // `sessionClose` it echoes back lands on a session we have already
      // dropped — a no-op rather than a loop.
      this.frames.closeSession(session.sessionId, reason);
      // Then locally, which emits `session.closed` — so leaving the world goes
      // through the same saga as an ordinary disconnect.
      this.sessions.close(session.sessionId, reason);

      this.logger.log(
        `evicted session=${session.sessionId} account=${accountId} reason=${reason}`
      );
    }

    return doomed.length;
  }
}
