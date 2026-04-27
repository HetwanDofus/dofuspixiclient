import { useSyncExternalStore } from "react";

import { ExternalStore } from "@/game/stores/game-store";

export interface TacticalModeState {
  tactical: boolean;
}

export const tacticalModeStore = new ExternalStore<TacticalModeState>({
  tactical: false,
});

export function setTacticalMode(value: boolean): void {
  tacticalModeStore.setState({ tactical: value });
}

export function toggleTacticalMode(): void {
  setTacticalMode(!tacticalModeStore.getSnapshot().tactical);
}

export function useTacticalMode() {
  const state = useSyncExternalStore(
    tacticalModeStore.subscribe,
    tacticalModeStore.getSnapshot
  );
  return { tactical: state.tactical, toggleTactical: toggleTacticalMode };
}
