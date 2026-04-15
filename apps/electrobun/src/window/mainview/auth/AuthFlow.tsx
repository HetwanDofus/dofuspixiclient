import { useSelector } from "@xstate/react";
import { useEffect, useMemo } from "react";

import type { GameClient } from "@/game/game-client";
import { loginActor } from "@/game/machines/actors";

import { CharacterSelectScreen } from "./CharacterSelectScreen";
import { LoginScreen } from "./LoginScreen";
import { ServerSelectScreen } from "./ServerSelectScreen";

interface Props {
  client: GameClient;
  onEnterGame: () => void;
}

/**
 * Orchestrates the pre-game flow against a GameClient owned by the parent
 * (App). Subscribes to loginActor and drives automatic follow-ups after
 * auth / server-select / character-select. The GameClient is NOT torn down
 * when this component unmounts — the in-game renderer keeps using the same
 * authenticated WebSocket session.
 */
export function AuthFlow({ client, onEnterGame }: Props) {
  const state = useSelector(loginActor, (s) => s.value);
  const context = useSelector(loginActor, (s) => s.context);

  // Auto-request servers once authenticated.
  useEffect(() => {
    if (state === "waitingServers") {
      client.requestServers();
    }
  }, [state, client]);

  // Auto-request characters once a server is selected.
  useEffect(() => {
    if (state === "waitingCharacters") {
      client.requestCharacters();
    }
  }, [state, client]);

  // Hand off to in-game renderer when fully loaded.
  useEffect(() => {
    if (state === "inGame") {
      onEnterGame();
    }
  }, [state, onEnterGame]);

  const busy = useMemo(
    () =>
      state === "authenticating" ||
      state === "waitingServers" ||
      state === "selectingServer" ||
      state === "waitingCharacters" ||
      state === "loadingCharacter",
    [state]
  );

  if (state === "idle" || state === "authenticating" || state === "failed") {
    return (
      <LoginScreen
        client={client}
        failureReason={context.failureReason}
        busy={busy}
      />
    );
  }

  if (
    state === "waitingServers" ||
    state === "serverSelect" ||
    state === "selectingServer"
  ) {
    return (
      <ServerSelectScreen
        client={client}
        servers={context.servers}
        busy={busy}
      />
    );
  }

  if (
    state === "waitingCharacters" ||
    state === "characterSelect" ||
    state === "loadingCharacter"
  ) {
    return (
      <CharacterSelectScreen
        client={client}
        characters={context.characters}
        busy={busy}
      />
    );
  }

  return null;
}
