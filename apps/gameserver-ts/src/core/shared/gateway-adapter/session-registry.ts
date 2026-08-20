// Core-side view of sessions. Holds no WS reference (gateway owns that), just
// the identity + per-session state services need. Rehydrated from snapshot
// during handoff.

import type { Serializable } from "@shared/handoff/handoff.coordinator";
import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { HandoffPart } from "@shared/handoff/handoff-part.decorator";

export type Session = {
  sessionId: string;
  accountId: string;
  characterId: string;
  remoteAddr: string;
  openedAt: number;
};

export type SerializedSession = Session;

@Injectable()
@HandoffPart()
export class SessionRegistry implements Serializable<SerializedSession[]> {
  readonly name = "sessions";
  private readonly logger = new Logger(SessionRegistry.name);
  private readonly sessions = new Map<string, Session>();
  // accountId → sessionIds. Kept alongside the primary map so "is this account
  // already connected?" is answerable at all: without it there is nowhere to
  // look, which is why nothing ever stopped one account from opening two
  // windows. Never holds an empty accountId — sessions start unauthenticated
  // and only join the index once attachAccount runs.
  private readonly byAccount = new Map<string, Set<string>>();

  constructor(private readonly events: EventEmitter2) {}

  open(input: Omit<Session, "openedAt">) {
    const session: Session = { ...input, openedAt: Date.now() };
    this.sessions.set(session.sessionId, session);
    this.index(session);
    this.events.emit("session.opened", session);
  }

  close(sessionId: string, reason: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    this.sessions.delete(sessionId);
    this.deindex(session);
    this.events.emit("session.closed", { session, reason });
  }

  /** Live sessions on `accountId`, minus `exceptSessionId` when given. */
  sessionsForAccount(
    accountId: string,
    exceptSessionId?: string
  ): Session[] {
    const ids = this.byAccount.get(accountId);

    if (!accountId || !ids) {
      return [];
    }

    const out: Session[] = [];

    for (const id of ids) {
      if (id === exceptSessionId) {
        continue;
      }

      const session = this.sessions.get(id);

      if (session) {
        out.push(session);
      }
    }

    return out;
  }

  private index(session: Session): void {
    if (!session.accountId) {
      return;
    }

    let ids = this.byAccount.get(session.accountId);

    if (!ids) {
      ids = new Set();
      this.byAccount.set(session.accountId, ids);
    }

    ids.add(session.sessionId);
  }

  private deindex(session: Session): void {
    const ids = this.byAccount.get(session.accountId);

    if (!ids) {
      return;
    }

    ids.delete(session.sessionId);

    if (ids.size === 0) {
      this.byAccount.delete(session.accountId);
    }
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  attachAccount(sessionId: string, accountId: string): Session | undefined {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return undefined;
    }

    // A session is anonymous until it authenticates, so this is where it
    // actually joins the account index.
    this.deindex(session);
    session.accountId = accountId;
    this.index(session);

    this.events.emit("session.authenticated", session);

    return session;
  }

  waitForAuth(sessionId: string, timeoutMs = 5000): Promise<Session | undefined> {
    const session = this.sessions.get(sessionId);
    if (session?.accountId) {
      return Promise.resolve(session);
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.events.removeListener("session.authenticated", handler);
        resolve(undefined);
      }, timeoutMs);

      const handler = (s: Session) => {
        if (s.sessionId === sessionId) {
          clearTimeout(timer);
          this.events.removeListener("session.authenticated", handler);
          resolve(s);
        }
      };

      this.events.on("session.authenticated", handler);
    });
  }

  attachCharacter(sessionId: string, characterId: string): Session | undefined {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return undefined;
    }

    session.characterId = characterId;

    return session;
  }

  serialize(): SerializedSession[] {
    return Array.from(this.sessions.values());
  }

  restore(records: SerializedSession[]): void {
    this.sessions.clear();
    // Rebuild the account index too — a handoff that restored the sessions but
    // not the index would silently stop detecting double connections.
    this.byAccount.clear();
    for (const r of records) {
      this.sessions.set(r.sessionId, r);
      this.index(r);
    }
    this.logger.log(`restored ${records.length} sessions`);
  }
}
