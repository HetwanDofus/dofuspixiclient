import type { ClientSession } from "./client-session.ts";

export interface AuthenticatedSession extends ClientSession {
  accountId: number;
}

export interface InWorldSession extends AuthenticatedSession {
  characterId: number;
  characterName: string;
  mapId: number;
  cellId: number;
}

export function requireAuthenticated(session: ClientSession): session is AuthenticatedSession {
  return session.accountId !== null;
}

export function requireInWorld(session: ClientSession): session is InWorldSession {
  return (
    session.accountId !== null &&
    session.characterId !== null &&
    session.characterName !== null &&
    session.mapId !== null &&
    session.cellId !== null
  );
}
