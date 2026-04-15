import { beforeEach, describe, expect, it } from "bun:test";

import {
  closeAllPanels,
  hudStore,
  togglePanel,
  toggleWorldMap,
} from "./hud-store";

beforeEach(() => {
  hudStore.replaceState({
    activePanel: null,
    isWorldMapOpen: false,
    minimapMapId: null,
    connected: false,
    loggedIn: false,
    debugEnabled: false,
    stressTestActive: false,
  });
});

describe("togglePanel", () => {
  it("opens a panel when none is active", () => {
    togglePanel("stats");
    expect(hudStore.getSnapshot().activePanel).toBe("stats");
  });

  it("closes the same panel when toggled again", () => {
    togglePanel("stats");
    togglePanel("stats");
    expect(hudStore.getSnapshot().activePanel).toBeNull();
  });

  it("switches to a different panel when one is open", () => {
    togglePanel("stats");
    togglePanel("inventory");
    expect(hudStore.getSnapshot().activePanel).toBe("inventory");
  });

  it("closes the world map when opening a panel", () => {
    hudStore.setState({ isWorldMapOpen: true });
    togglePanel("spells");
    expect(hudStore.getSnapshot().isWorldMapOpen).toBe(false);
    expect(hudStore.getSnapshot().activePanel).toBe("spells");
  });
});

describe("toggleWorldMap", () => {
  it("opens the world map and closes any active panel", () => {
    hudStore.setState({ activePanel: "stats" });
    toggleWorldMap();
    expect(hudStore.getSnapshot().isWorldMapOpen).toBe(true);
    expect(hudStore.getSnapshot().activePanel).toBeNull();
  });

  it("toggles closed when already open", () => {
    toggleWorldMap();
    toggleWorldMap();
    expect(hudStore.getSnapshot().isWorldMapOpen).toBe(false);
  });
});

describe("closeAllPanels", () => {
  it("closes both the active panel and the world map", () => {
    hudStore.setState({ activePanel: "inventory", isWorldMapOpen: true });
    closeAllPanels();
    expect(hudStore.getSnapshot().activePanel).toBeNull();
    expect(hudStore.getSnapshot().isWorldMapOpen).toBe(false);
  });

  it("leaves connection state alone", () => {
    hudStore.setState({ connected: true, loggedIn: true });
    closeAllPanels();
    const snap = hudStore.getSnapshot();
    expect(snap.connected).toBe(true);
    expect(snap.loggedIn).toBe(true);
  });
});
