import { ExternalStore } from "./game-store";

export type PanelName =
  | "stats"
  | "spells"
  | "inventory"
  | "quests"
  | "friends"
  | "guild"
  | "mount"
  | "conquest"
  | null;

export interface HudState {
  activePanel: PanelName;
  isWorldMapOpen: boolean;
  minimapMapId: number | null;
  connected: boolean;
  loggedIn: boolean;
  debugEnabled: boolean;
  stressTestActive: boolean;
}

const initialState: HudState = {
  activePanel: null,
  isWorldMapOpen: false,
  minimapMapId: null,
  connected: false,
  loggedIn: false,
  debugEnabled: false,
  stressTestActive: false,
};

export const hudStore = new ExternalStore<HudState>(initialState);

/** Toggle a panel — close if already open, otherwise open it (closing any other) */
export function togglePanel(panel: NonNullable<PanelName>): void {
  const current = hudStore.getSnapshot().activePanel;
  hudStore.setState({
    activePanel: current === panel ? null : panel,
    isWorldMapOpen: false,
  });
}

export function toggleWorldMap(): void {
  const current = hudStore.getSnapshot().isWorldMapOpen;
  hudStore.setState({
    isWorldMapOpen: !current,
    activePanel: null,
  });
}

export function closeAllPanels(): void {
  hudStore.setState({
    activePanel: null,
    isWorldMapOpen: false,
  });
}
