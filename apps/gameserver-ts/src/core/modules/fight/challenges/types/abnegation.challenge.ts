import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import type { CastContext } from "@modules/fight/effects/fight.buff.types";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(43)
export class AbnegationChallenge extends FightChallenge {
  readonly challengeId = 43;
  readonly challengeName = "Self Sacrifice";

  onFighterAttacked(
    f: Fight,
    caster: Fighter,
    target: Fighter,
    _ctx: CastContext
  ): void {
    if (!this.alive) {
      return;
    }
    if (caster.team?.side === 0 && caster.id === target.id) {
      this.fail(f, caster);
    }
  }
}
