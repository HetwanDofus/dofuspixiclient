import type { MessageHandler } from "@/game/network/message-handler";
import {
  applySpellDetails,
  applySpellDetailsLevel,
  clearSpellDetailsPending,
} from "@/game/stores/spell-details-store";
import { applySpellCooldown, applySpellList } from "@/game/stores/spells-store";

/**
 * Wires spell-related server proto messages into spellsStore:
 * - SpellList on world entry (full snapshot, hydrated with area shape
 *   + LoS + cast-limit flags from the extended proto schema).
 * - SpellCooldown after a cast whose spell has `cooldown > 0` —
 *   decrements implicitly on TURN_START for the local player via the
 *   fightActor subscription wired in game-client.
 * - SpellDetails (Sd) — the per-level table the spell book's detail
 *   panel renders, answered on demand.
 * - SpellUpgrade (SU) — the outcome of spending capital sorts on a
 *   spell. The new AP cost / range / effects arrive on the SpellList
 *   the server re-emits right after, and the new point balance on the
 *   As frame after that; this only moves the detail panel's owned-level
 *   marker so the `+` button settles without waiting for either.
 */
export class SpellHandler {
  constructor(private readonly messageHandler: MessageHandler) {
    this.register();
  }

  private register(): void {
    this.messageHandler.on("spellList", (payload) => {
      applySpellList(payload.spells);
    });
    this.messageHandler.on("spellCooldown", (payload) => {
      applySpellCooldown(payload.spellId, payload.remainingTurns);
    });
    this.messageHandler.on("spellDetails", (payload) => {
      applySpellDetails(payload);
    });
    this.messageHandler.on("spellUpgrade", (payload) => {
      // A rejection still clears the pending flag so the `+` button
      // stops spinning; the level in the payload is the unchanged one.
      clearSpellDetailsPending(payload.spellId);
      if (!payload.success) {
        return;
      }
      applySpellDetailsLevel(payload.spellId, payload.newLevel);
    });
  }
}
