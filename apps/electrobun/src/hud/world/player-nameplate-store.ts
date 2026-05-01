import { ExternalStore } from "@/game/stores/game-store";

/**
 * One visible TextOverHead (player / NPC / monster sprite) anchored
 * to its world-projected canvas position. Mirrors canonical Dofus 1.29
 * `dofus.graphics.battlefield.TextOverHead` — single black rounded
 * rect with the sprite name in Verdana Bold 10 white.
 *
 * `anchorX` / `anchorY` are CSS pixels in canvas-relative space — the
 * same coord space DamagePoints uses, since both render inside
 * HudOverlay's canvas-aligned wrapper.
 */
export interface PlayerNameplateEntry {
  id: number;
  name: string;
  anchorX: number;
  anchorY: number;
}

interface PlayerNameplatesState {
  entries: readonly PlayerNameplateEntry[];
}

const initial: PlayerNameplatesState = { entries: [] };

export const playerNameplateStore = new ExternalStore<PlayerNameplatesState>(
  initial
);

/** Show or update a nameplate. Idempotent on `id`. */
export function setPlayerNameplate(entry: PlayerNameplateEntry): void {
  const { entries } = playerNameplateStore.getSnapshot();
  const existing = entries.find((e) => e.id === entry.id);
  if (
    existing &&
    existing.name === entry.name &&
    existing.anchorX === entry.anchorX &&
    existing.anchorY === entry.anchorY
  ) {
    return;
  }
  const without = existing ? entries.filter((e) => e.id !== entry.id) : entries;
  playerNameplateStore.setState({ entries: [...without, entry] });
}

export function hidePlayerNameplate(id: number): void {
  const { entries } = playerNameplateStore.getSnapshot();
  const next = entries.filter((e) => e.id !== id);
  if (next.length !== entries.length) {
    playerNameplateStore.setState({ entries: next });
  }
}

export function clearPlayerNameplates(): void {
  const { entries } = playerNameplateStore.getSnapshot();
  if (entries.length > 0) {
    playerNameplateStore.setState({ entries: [] });
  }
}
