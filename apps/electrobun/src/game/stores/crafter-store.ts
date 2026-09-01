import type { CrafterSummary } from "@/game/network/protocol";

import { ExternalStore } from "./game-store";

export interface CrafterState {
  open: boolean;
  /** The job currently being browsed; 0 before one is picked. */
  jobId: number;
  crafters: CrafterSummary[];
}

const closed: CrafterState = { open: false, jobId: 0, crafters: [] };

/**
 * The craftsmen's book — exchange type 14.
 *
 * A directory, not a container: it holds no items and moves nothing. It
 * opens empty and fills on the `EJ` that answers the reader's choice of job,
 * which is why nothing arrives with the `EC`.
 */
export const crafterStore = new ExternalStore<CrafterState>(closed);

export function openCrafterList(): void {
  crafterStore.replaceState({ ...closed, open: true });
}

export function closeCrafterList(): void {
  if (crafterStore.getSnapshot().open) {
    crafterStore.replaceState(closed);
  }
}

/** `EJ` — who is offering that job right now. */
export function setCrafters(jobId: number, crafters: CrafterSummary[]): void {
  crafterStore.setState({ jobId, crafters });
}
