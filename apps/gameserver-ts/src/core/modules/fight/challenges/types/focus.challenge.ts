import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import type { CastContext } from "@modules/fight/effects/fight.buff.types";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(31)
export class FocusChallenge extends FightChallenge {
  readonly challengeId = 31;
  readonly challengeName = "Focus";
  private attackedTargetId: number | null = null;

  onFighterAttacked(
    f: Fight,
    caster: Fighter,
    target: Fighter,
    _ctx: CastContext
  ): void {
    if (!this.alive) {
      return;
    }
    if (caster.team?.side !== 0 || target.team?.side !== 1) {
      return;
    }
    if (this.attackedTargetId === null) {
      this.attackedTargetId = target.id;
    } else if (this.attackedTargetId !== target.id) {
      this.fail(f, caster);
    }
  }
}
