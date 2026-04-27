import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import type { CastContext } from "@modules/fight/effects/fight.buff.types";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(6)
export class VersatileChallenge extends FightChallenge {
  readonly challengeId = 6;
  readonly challengeName = "Versatile";

  private spellsPerTurnPerFighter = new Map<Fighter, Set<number>>();

  onTurnStart(_f: Fight, fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    this.spellsPerTurnPerFighter.set(fighter, new Set());
  }

  onCastApplied(_f: Fight, ctx: CastContext): void {
    if (!this.alive) {
      return;
    }
    const caster = ctx.caster;
    const spellId = ctx.spell.spellId;
    const spellsThisTurn =
      this.spellsPerTurnPerFighter.get(caster) || new Set();

    if (spellsThisTurn.has(spellId)) {
      this.fail(_f, caster);
      return;
    }

    spellsThisTurn.add(spellId);
    this.spellsPerTurnPerFighter.set(caster, spellsThisTurn);
  }
}
