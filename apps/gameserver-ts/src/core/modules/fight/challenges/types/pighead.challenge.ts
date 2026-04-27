import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import type { CastContext } from "@modules/fight/effects/fight.buff.types";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(24)
export class PigheadChallenge extends FightChallenge {
  readonly challengeId = 24;
  readonly challengeName = "Pighead";

  onFighterAttacked(
    _f: Fight,
    caster: Fighter,
    _target: Fighter,
    ctx: CastContext
  ): void {
    if (!this.alive) {
      return;
    }
    if (ctx.spell.spellId === 0) {
      this.fail(_f, caster);
    }
  }
}
