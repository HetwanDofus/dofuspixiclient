import type { ExchangeSession } from "@modules/exchange/exchange.types";
import type { Serializable } from "@shared/handoff/handoff.coordinator";
import { Injectable, Logger } from "@nestjs/common";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";
import { HandoffPart } from "@shared/handoff/handoff-part.decorator";

interface SerializedExchanges {
  sessions: ExchangeSession[];
}

/**
 * Who is currently in an exchange.
 *
 * One session at a time per socket: the client enforces the same rule
 * from the other side and answers a second request with `EREO`
 * (`ALREADY_EXCHANGE`), so "already exchanging" is a protocol state, not
 * merely a server precaution.
 *
 * **This part is handoff-serialised, and that is the point.**
 * `FightRegistryService` and `NpcDialogSessionService` are not, so a core
 * restart leaves their windows open on the client with no server state
 * behind them — replying does nothing and nothing says why (QA-113). The
 * state here is plain JSON, so preserving it costs two methods, and
 * anything that cannot be restored is closed explicitly rather than left
 * to rot.
 */
@Injectable()
@HandoffPart()
export class ExchangeRegistryService
  implements Serializable<SerializedExchanges>
{
  readonly name = "exchange.sessions";

  private readonly logger = new Logger(ExchangeRegistryService.name);
  private readonly bySession = new Map<string, ExchangeSession>();

  constructor(private readonly sessions: SessionRegistry) {}

  get(sessionId: string): ExchangeSession | undefined {
    return this.bySession.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.bySession.has(sessionId);
  }

  open(session: ExchangeSession): void {
    this.bySession.set(session.sessionId, session);
  }

  close(sessionId: string): ExchangeSession | undefined {
    const session = this.bySession.get(sessionId);

    if (session) {
      this.bySession.delete(sessionId);
    }

    return session;
  }

  /** Every open session, for the restart sweep. */
  all(): ExchangeSession[] {
    return [...this.bySession.values()];
  }

  serialize(): SerializedExchanges {
    return { sessions: this.all() };
  }

  restore(state: SerializedExchanges): void {
    this.bySession.clear();

    for (const session of state.sessions ?? []) {
      this.bySession.set(session.sessionId, session);
    }

    this.logger.log(`restored ${this.bySession.size} open exchange(s)`);
  }

  /**
   * Drop the sessions whose socket did not come back, keep the rest.
   *
   * Keeping them is the point of serialising this part at all: an
   * exchange is plain data and its container is re-read from the
   * database on every move, so a preserved session simply carries on
   * where a fight or an NPC dialogue would have left a dead window open
   * (QA-113). It is the *unmatched* ones that have to go, or the
   * occupancy lock would refuse a player an exchange they are no longer
   * in.
   *
   * Runs after every part's `restore`, so `SessionRegistry` is already
   * repopulated by the time this asks it anything.
   */
  onResume(): void {
    let dropped = 0;

    for (const session of this.all()) {
      if (!this.sessions.get(session.sessionId)) {
        this.bySession.delete(session.sessionId);
        dropped += 1;
      }
    }

    this.logger.log(
      `${this.bySession.size} exchange(s) survived the restart, ` +
        `${dropped} dropped with their socket`
    );
  }
}
