import { createLogger } from "../utils/logger.ts";

const log = createLogger("Session");

export interface WsHandle {
  send(data: string | Uint8Array | ArrayBuffer): void;
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
  publish(topic: string, data: string | Uint8Array | ArrayBuffer): void;
}

export const SessionState = {
  CONNECTED: "connected",
  AUTHENTICATED: "authenticated",
  IN_WORLD: "in_world",
  IN_COMBAT: "in_combat",
} as const;

export type SessionStateValue =
  (typeof SessionState)[keyof typeof SessionState];

const VALID_TRANSITIONS: Record<SessionStateValue, SessionStateValue[]> = {
  [SessionState.CONNECTED]: [SessionState.AUTHENTICATED],
  [SessionState.AUTHENTICATED]: [SessionState.IN_WORLD, SessionState.CONNECTED],
  [SessionState.IN_WORLD]: [SessionState.IN_COMBAT, SessionState.AUTHENTICATED],
  [SessionState.IN_COMBAT]: [SessionState.IN_WORLD],
};

export interface ClientSession {
  ws: WsHandle;
  sessionId: string;
  state: SessionStateValue;
  accountId: number | null;
  characterId: number | null;
  characterName: string | null;
  mapId: number | null;
  cellId: number | null;
  direction: number;
}

const sessions = new Map<string, ClientSession>();

export function createSession(ws: WsHandle, sessionId: string): ClientSession {
  const session: ClientSession = {
    ws,
    sessionId,
    state: SessionState.CONNECTED,
    accountId: null,
    characterId: null,
    characterName: null,
    mapId: null,
    cellId: null,
    direction: 1,
  };
  sessions.set(sessionId, session);
  return session;
}

export function transitionTo(
  session: ClientSession,
  targetState: SessionStateValue
): boolean {
  const allowed = VALID_TRANSITIONS[session.state];
  if (!allowed?.includes(targetState)) {
    log.warn(
      `Invalid transition: ${session.state} → ${targetState} for ${session.sessionId}`
    );
    return false;
  }
  session.state = targetState;
  return true;
}

export function getSession(sessionId: string): ClientSession | undefined {
  return sessions.get(sessionId);
}

export function removeSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function getSessionByCharacterId(
  characterId: number
): ClientSession | undefined {
  for (const session of sessions.values()) {
    if (session.characterId === characterId) return session;
  }
  return undefined;
}

export function getAllSessions(): IterableIterator<ClientSession> {
  return sessions.values();
}

export function getSessionCount(): number {
  return sessions.size;
}
