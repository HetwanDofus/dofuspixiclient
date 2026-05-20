import { assign, setup } from "xstate";

import type { CharacterEntry } from "@dofus/dofus1-net";

/**
 * UI-facing server row — joins per-account fields from `Ax` with
 * per-server live status from `AH`. GameSession computes this join
 * before pushing into `loginActor` so the React screens never have
 * to think about which wire frame is current.
 */
export interface ServerEntry {
  id: number;
  /** From AH — 0=offline, 1=online, 2=saving, 3=full, etc. */
  status: number;
  /** From AH — 0..3 completion bar (0=empty, 3=full). */
  completion: number;
  /** From AH — true when new characters are allowed. */
  canCreate: boolean;
  /** From Ax — how many characters this account has on the server. */
  charactersWatched: number;
}

export type CharacterListEntry = CharacterEntry;

export interface LoginContext {
  username: string;
  servers: ServerEntry[];
  selectedServerId: number | null;
  characters: CharacterListEntry[];
  selectedCharacterId: string | null;
  failureReason: string | null;
}

export type LoginMachineEvent =
  | { type: "START_LOGIN"; username: string }
  | { type: "AUTH_SUCCESS" }
  | { type: "AUTH_FAILURE"; reason: string }
  | { type: "SERVERS_RECEIVED"; servers: ServerEntry[] }
  | { type: "SELECT_SERVER"; serverId: number }
  | { type: "SERVER_SELECTED" }
  | { type: "CHARACTERS_RECEIVED"; characters: CharacterListEntry[] }
  | { type: "SELECT_CHARACTER"; characterId: string }
  | { type: "CHARACTER_LOADED" }
  | { type: "LOGOUT" };

/**
 *   idle ──START_LOGIN──> authenticating ──AUTH_SUCCESS──> waitingServers
 *                              │ AUTH_FAILURE
 *                              ▼
 *                           failed
 *
 *   waitingServers ──SERVERS_RECEIVED──> serverSelect
 *                            SELECT_SERVER
 *                            ▼
 *                         selectingServer ──SERVER_SELECTED──> waitingCharacters
 *                                                                  │ CHARACTERS_RECEIVED
 *                                                                  ▼
 *                                                              characterSelect
 *                                                                  │ SELECT_CHARACTER
 *                                                                  ▼
 *                                                              loadingCharacter
 *                                                                  │ CHARACTER_LOADED
 *                                                                  ▼
 *                                                                 inGame
 */
export const loginMachine = setup({
  types: {
    context: {} as LoginContext,
    events: {} as LoginMachineEvent,
  },
  actions: {
    storeUsername: assign(({ event }) =>
      event.type === "START_LOGIN" ? { username: event.username } : {}
    ),
    storeServers: assign(({ event }) =>
      event.type === "SERVERS_RECEIVED" ? { servers: event.servers } : {}
    ),
    selectServer: assign(({ event }) =>
      event.type === "SELECT_SERVER" ? { selectedServerId: event.serverId } : {}
    ),
    storeCharacters: assign(({ event }) =>
      event.type === "CHARACTERS_RECEIVED"
        ? { characters: event.characters }
        : {}
    ),
    selectCharacter: assign(({ event }) =>
      event.type === "SELECT_CHARACTER"
        ? { selectedCharacterId: event.characterId }
        : {}
    ),
    storeFailure: assign(({ event }) =>
      event.type === "AUTH_FAILURE" ? { failureReason: event.reason } : {}
    ),
    reset: assign(() => ({
      username: "",
      servers: [],
      selectedServerId: null,
      characters: [],
      selectedCharacterId: null,
      failureReason: null,
    })),
  },
}).createMachine({
  id: "login",
  initial: "idle",
  context: {
    username: "",
    servers: [],
    selectedServerId: null,
    characters: [],
    selectedCharacterId: null,
    failureReason: null,
  },
  states: {
    idle: {
      on: {
        START_LOGIN: { target: "authenticating", actions: "storeUsername" },
      },
    },
    authenticating: {
      on: {
        AUTH_SUCCESS: { target: "waitingServers" },
        AUTH_FAILURE: { target: "failed", actions: "storeFailure" },
      },
    },
    waitingServers: {
      on: {
        SERVERS_RECEIVED: { target: "serverSelect", actions: "storeServers" },
        LOGOUT: { target: "idle", actions: "reset" },
      },
    },
    serverSelect: {
      on: {
        SELECT_SERVER: {
          target: "selectingServer",
          actions: "selectServer",
        },
        LOGOUT: { target: "idle", actions: "reset" },
      },
    },
    selectingServer: {
      on: {
        SERVER_SELECTED: { target: "waitingCharacters" },
        AUTH_FAILURE: { target: "serverSelect", actions: "storeFailure" },
        LOGOUT: { target: "idle", actions: "reset" },
      },
    },
    waitingCharacters: {
      on: {
        CHARACTERS_RECEIVED: {
          target: "characterSelect",
          actions: "storeCharacters",
        },
        LOGOUT: { target: "idle", actions: "reset" },
      },
    },
    characterSelect: {
      on: {
        SELECT_CHARACTER: {
          target: "loadingCharacter",
          actions: "selectCharacter",
        },
        LOGOUT: { target: "idle", actions: "reset" },
      },
    },
    loadingCharacter: {
      on: {
        CHARACTER_LOADED: { target: "inGame" },
        LOGOUT: { target: "idle", actions: "reset" },
      },
    },
    inGame: {
      on: {
        LOGOUT: { target: "idle", actions: "reset" },
      },
    },
    failed: {
      on: {
        START_LOGIN: { target: "authenticating", actions: "storeUsername" },
        LOGOUT: { target: "idle", actions: "reset" },
      },
    },
  },
});

export type LoginMachine = typeof loginMachine;
