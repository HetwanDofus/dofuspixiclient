import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import type { CastContext } from "@modules/fight/effects/fight.buff.types";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(17)
export class UntouchableChallenge extends FightChallenge {
  readonly challengeId = 17;
  readonly challengeName = "Untouchable";

  onFighterAttacked(
    _f: Fight,
    _caster: Fighter,
    target: Fighter,
    _ctx: CastContext
  ): void {
    if (!this.alive) {
      return;
    }
    if (target.team?.side === 0 && !target.isInvocation?.()) {
      this.fail(_f, target);
    }
  }
}
