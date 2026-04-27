import type { MessageHandler } from "@/game/network/message-handler";
import {
  applySpellCooldown,
  applySpellList,
} from "@/game/stores/spells-store";

/**
 * Wires spell-related server proto messages into spellsStore:
 * - SpellList on world entry (full snapshot, hydrated with area shape
 *   + LoS + cast-limit flags from the extended proto schema).
 * - SpellCooldown after a cast whose spell has `cooldown > 0` —
 *   decrements implicitly on TURN_START for the local player via the
 *   fightActor subscription wired in game-client.
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
  }
}
