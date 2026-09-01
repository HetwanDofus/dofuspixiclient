import type { Serializable } from "@shared/handoff/handoff.coordinator";
import { Injectable } from "@nestjs/common";
import { HandoffPart } from "@shared/handoff/handoff-part.decorator";

/**
 * What is on one artisan's bench.
 *
 * Nothing here is in the database, and that is the point — the same reason
 * `TradeRegistryService` holds an offer rather than moving rows. An
 * ingredient laid in a slot is a *proposal*: the player may take it back,
 * close the window or lose the socket, and none of those should have needed
 * an `UPDATE` to undo. Rows move once, at the moment the craft commits.
 *
 * `jobLevel`, `maxSlots` and `certainAt` are **frozen when the window opens**.
 * 1.29 does not apply a level gained mid-session until the bench is closed
 * and reopened, and players rely on it: the whole "stack a pile of two-slot
 * crafts just before 60" trick is that freeze. Recomputing them per craft
 * would quietly delete a piece of the game.
 *
 * Every field survives `JSON.stringify` — this crosses a blue/green handoff,
 * and a bench that came back empty would look like the ingredients had been
 * eaten.
 */
export interface CraftState {
  sessionId: string;
  characterId: string;
  skillId: number;
  jobId: number;
  jobLevel: number;
  maxSlots: number;
  /** `items.id` → how many units of that stack are on the bench. */
  slots: Record<string, number>;
  /** The result of the last successful match, for a repeat run. */
  lastResultItemId: number | null;
  /** Crafts left in the running series; 0 when not looping. */
  remaining: number;
  /** How many the current series has produced, for `Ea`. */
  crafted: number;
}

interface SerializedCrafts {
  benches: CraftState[];
}

@Injectable()
@HandoffPart()
export class CraftRegistryService implements Serializable<SerializedCrafts> {
  readonly name = "exchange.crafts";

  private readonly bySession = new Map<string, CraftState>();

  get(sessionId: string): CraftState | undefined {
    return this.bySession.get(sessionId);
  }

  open(state: CraftState): void {
    this.bySession.set(state.sessionId, state);
  }

  close(sessionId: string): CraftState | undefined {
    const state = this.bySession.get(sessionId);
    this.bySession.delete(sessionId);
    return state;
  }

  serialize(): SerializedCrafts {
    return { benches: [...this.bySession.values()] };
  }

  restore(data: SerializedCrafts): void {
    this.bySession.clear();

    for (const bench of data.benches ?? []) {
      this.bySession.set(bench.sessionId, bench);
    }
  }
}
