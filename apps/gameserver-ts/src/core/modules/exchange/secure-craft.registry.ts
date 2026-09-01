import type { Serializable } from "@shared/handoff/handoff.coordinator";
import { Injectable, Logger } from "@nestjs/common";
import { HandoffPart } from "@shared/handoff/handoff-part.decorator";

/** One party to a co-operative craft. */
export interface SecureCraftSide {
  sessionId: string;
  characterId: string;
  name: string;
}

/**
 * A craft done for somebody else.
 *
 * Like a trade and unlike a bench, this belongs to *two* sockets, so it
 * cannot live in `ExchangeRegistryService` — that one holds the occupancy
 * lock, one entry per socket, and each side's `ExchangeSession.tradeId`
 * points here instead.
 *
 * Nothing in it has moved. The customer's ingredients are still in the
 * customer's bag and the payment is still theirs; both are proposals until
 * the artisan presses "Créer", and that is what makes a restored session
 * safe by construction — there is no half-finished write to reconcile.
 *
 * `jobLevel` and `maxSlots` are frozen at the moment the two agreed, for the
 * same reason a solo bench freezes them: 1.29 does not widen the grid under
 * an artisan who levels mid-session.
 */
export interface SecureCraftState {
  craftId: string;
  mapId: number;
  skillId: number;
  jobId: number;
  jobLevel: number;
  maxSlots: number;
  artisan: SecureCraftSide;
  customer: SecureCraftSide;
  /** The customer's ingredients: `items.id` → units laid on the bench. */
  slots: Record<string, number>;
  /** What the customer offers for the work: `items.id` → units. */
  payItems: Record<string, number>;
  /** A `bigint` in string form, so this survives `JSON.stringify`. */
  payKamas: string;
  /** False until the invited side says yes. */
  accepted: boolean;
  crafted: number;
}

interface SerializedSecureCrafts {
  crafts: SecureCraftState[];
}

@Injectable()
@HandoffPart()
export class SecureCraftRegistryService
  implements Serializable<SerializedSecureCrafts>
{
  readonly name = "exchange.secure-crafts";

  private readonly logger = new Logger(SecureCraftRegistryService.name);
  private readonly byId = new Map<string, SecureCraftState>();

  get(craftId: string): SecureCraftState | undefined {
    return this.byId.get(craftId);
  }

  open(state: SecureCraftState): void {
    this.byId.set(state.craftId, state);
  }

  close(craftId: string): void {
    this.byId.delete(craftId);
  }

  serialize(): SerializedSecureCrafts {
    return { crafts: [...this.byId.values()] };
  }

  restore(data: SerializedSecureCrafts): void {
    this.byId.clear();

    for (const craft of data.crafts ?? []) {
      this.byId.set(craft.craftId, craft);
    }

    if (this.byId.size > 0) {
      this.logger.log(`restored ${this.byId.size} co-operative craft(s)`);
    }
  }
}
