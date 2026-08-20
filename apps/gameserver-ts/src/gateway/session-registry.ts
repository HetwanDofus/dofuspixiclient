import {
  type ClientMessage,
  ClientMessageSchema,
} from "@dofus/proto/client_messages_pb";
import { type EncodedFrame, FrameReader } from "@dofus/uds-transport";

export type Role = "auth" | "game";

type WireSink = {
  sendBinary: (bytes: EncodedFrame) => void;
  // Hangs up on the client. The gateway needs this to be able to *tell* a
  // client its session is finished: silence is indistinguishable from a quiet
  // server, and the client happily keeps showing "Connected" (QA-046).
  close: (code: number, reason: string) => void;
};

export type Session = {
  sessionId: string;
  role: Role;
  accountId: string;
  characterId: string;
  remoteAddr: string;
  reader: FrameReader<ClientMessage>;
  sink: WireSink;
};

export function newSession(input: Omit<Session, "reader">): Session {
  return { ...input, reader: new FrameReader(ClientMessageSchema) };
}

export class SessionRegistry {
  private readonly bySession = new Map<string, Session>();

  add(session: Session): void {
    this.bySession.set(session.sessionId, session);
  }

  remove(sessionId: string): void {
    this.bySession.delete(sessionId);
  }

  get(sessionId: string): Session | undefined {
    return this.bySession.get(sessionId);
  }

  sendBytes(sessionIds: readonly string[], bytes: EncodedFrame): number {
    // EncodedFrame has a 4-byte length prefix for UDS stream framing.
    // WebSocket messages are already framed — strip the prefix.
    const body = bytes.subarray(4);
    let delivered = 0;
    for (const id of sessionIds) {
      const s = this.bySession.get(id);
      if (!s) {
        continue;
      }
      s.sink.sendBinary(body);
      delivered += 1;
    }
    return delivered;
  }

  // Hangs up on one session. Returns false when it is already gone, which is
  // the normal race rather than an error: the core can order a close for a
  // client that hung up on its own a moment earlier.
  closeOne(sessionId: string, code: number, reason: string): boolean {
    const session = this.bySession.get(sessionId);

    if (!session) {
      return false;
    }

    session.sink.close(code, reason);

    return true;
  }

  // Hangs up on every session bound to `role` and returns the ids that went
  // away. The sessions remove themselves from the registry through the normal
  // socket-close path, so this iterates a snapshot rather than the live map.
  closeRole(role: Role, code: number, reason: string): string[] {
    const doomed: Session[] = [];
    for (const s of this.bySession.values()) {
      if (s.role === role) {
        doomed.push(s);
      }
    }

    for (const s of doomed) {
      s.sink.close(code, reason);
    }

    return doomed.map((s) => s.sessionId);
  }

  size(): number {
    return this.bySession.size;
  }

  sizeByRole(role: Role): number {
    let n = 0;
    for (const s of this.bySession.values()) {
      if (s.role === role) {
        n += 1;
      }
    }
    return n;
  }
}
