import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import type { CastContext } from "@modules/fight/effects/fight.buff.types";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(5)
export class ScantyChallenge extends FightChallenge {
  readonly challengeId = 5;
  readonly challengeName = "Scanty";

  private lastSpellPerFighter = new Map<Fighter, number>();

  onCastApplied(_f: Fight, ctx: CastContext): void {
    if (!this.alive) {
      return;
    }
    const caster = ctx.caster;
    const spellId = ctx.spell.spellId;
    const lastSpell = this.lastSpellPerFighter.get(caster);

    if (lastSpell === spellId) {
      this.fail(_f, caster);
      return;
    }

    this.lastSpellPerFighter.set(caster, spellId);
  }
}
