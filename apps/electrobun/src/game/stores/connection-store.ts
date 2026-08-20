import { ExternalStore } from "./game-store";

/**
 * What the player is allowed to believe about the link to the server.
 *
 * `lost` is terminal for a session: the server state behind it is gone, so no
 * amount of socket-level reconnecting brings it back. It exists because the UI
 * used to have no way to say "still connected, but nothing works" — the badge
 * stayed green while every order the player issued fell into a void (QA-046).
 */
export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "lost";

/** Why the link died. Drives the wording of the connection-lost dialog. */
export type LostCause =
  /** The gateway hung up: the core backing the session restarted. */
  | "core_restarted"
  /** Another window signed in on this account and took the session over. */
  | "taken_over"
  /** The socket dropped and every reconnect attempt failed. */
  | "unreachable";

export interface ConnectionUiState {
  status: ConnectionStatus;
  /** Set only while `status === "lost"`. */
  cause: LostCause | null;
}

const initialState: ConnectionUiState = {
  status: "connecting",
  cause: null,
};

export const connectionStore = new ExternalStore<ConnectionUiState>(
  initialState
);

export function markConnected(): void {
  connectionStore.setState({ status: "connected", cause: null });
}

export function markReconnecting(): void {
  // A `lost` session never walks back to `reconnecting`: the socket may well
  // come back up, but the session behind it will not.
  if (connectionStore.getSnapshot().status === "lost") {
    return;
  }

  connectionStore.setState({ status: "reconnecting", cause: null });
}

export function markLost(cause: LostCause): void {
  connectionStore.setState({ status: "lost", cause });
}

/** Test seam — the store is a module singleton shared by the whole app. */
export function resetConnectionStore(): void {
  connectionStore.replaceState(initialState);
}
