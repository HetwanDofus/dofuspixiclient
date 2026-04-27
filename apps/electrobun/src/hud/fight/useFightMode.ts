import { useSyncExternalStore } from "react";

import { fightStore } from "@/game/stores/fight-store";

/**
 * Read-only projection of fightStore for React consumers.
 *
 * `isFighting` is the union of placement + combat + spectate (anything
 * that requires the fight HUD). `isMyTurn` is true only inside the
 * `fighting.myTurn` substate.
 */
export function useFightMode() {
  const state = useSyncExternalStore(
    fightStore.subscribe,
    fightStore.getSnapshot
  );

  const isFighting =
    state.mode === "placement" ||
    state.mode === "fighting" ||
    state.mode === "spectating";

  return {
    ...state,
    isFighting,
    isPlacement: state.mode === "placement",
    isCombat: state.mode === "fighting",
    isEnded: state.mode === "ended",
    isSpectator: state.mode === "spectating",
  };
}
