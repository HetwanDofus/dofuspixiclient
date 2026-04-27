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

  constructor(private readonly events: EventEmitter2) {}

  open(input: Omit<Session, "openedAt">) {
    const session: Session = { ...input, openedAt: Date.now() };
    this.sessions.set(session.sessionId, session);
    this.events.emit("session.opened", session);
  }

  close(sessionId: string, reason: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    this.sessions.delete(sessionId);
    this.events.emit("session.closed", { session, reason });
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  attachAccount(sessionId: string, accountId: string): Session | undefined {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return undefined;
    }

    session.accountId = accountId;
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
    for (const r of records) {
      this.sessions.set(r.sessionId, r);
    }
    this.logger.log(`restored ${records.length} sessions`);
  }
}
