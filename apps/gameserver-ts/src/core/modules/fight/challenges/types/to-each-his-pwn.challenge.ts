import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import type { CastContext } from "@modules/fight/effects/fight.buff.types";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(46)
export class ToEachHisPwnChallenge extends FightChallenge {
  readonly challengeId = 46;
  readonly challengeName = "To Each His Pwn";

  private monsterToPlayer = new Map<Fighter, Fighter>();

  onFighterAttacked(
    _f: Fight,
    caster: Fighter,
    target: Fighter,
    _ctx: CastContext
  ): void {
    if (!this.alive) {
      return;
    }

    if (!caster.player) {
      return;
    }

    const previousAttacker = this.monsterToPlayer.get(target);

    if (previousAttacker !== undefined && previousAttacker !== caster) {
      this.fail(_f, caster);
    } else {
      this.monsterToPlayer.set(target, caster);
    }
  }
}
