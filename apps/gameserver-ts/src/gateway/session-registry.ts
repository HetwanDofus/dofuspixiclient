import {
  type ClientMessage,
  ClientMessageSchema,
} from "@dofus/proto/client_messages_pb";
import { type EncodedFrame, FrameReader } from "@dofus/uds-transport";

export type Role = "auth" | "game";

type WireSink = {
  sendBinary: (bytes: EncodedFrame) => void;
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
