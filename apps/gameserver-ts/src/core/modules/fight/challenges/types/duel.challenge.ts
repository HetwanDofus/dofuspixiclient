import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import type { CastContext } from "@modules/fight/effects/fight.buff.types";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(45)
export class DuelChallenge extends FightChallenge {
  readonly challengeId = 45;
  readonly challengeName = "Duel";

  private firstAttackerId: number | null = null;

  onFighterAttacked(
    _f: Fight,
    caster: Fighter,
    _target: Fighter,
    _ctx: CastContext
  ): void {
    if (!this.alive) {
      return;
    }
    if (this.firstAttackerId === null) {
      this.firstAttackerId = caster.id;
    } else if (this.firstAttackerId !== caster.id) {
      this.fail(_f, caster);
    }
  }
}
