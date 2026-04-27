import type { Fight } from "@modules/fight/core/fight.entity";
import type { CastContext } from "@modules/fight/effects/fight.buff.types";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(9)
export class BarbaricChallenge extends FightChallenge {
  readonly challengeId = 9;
  readonly challengeName = "Barbaric";

  onCastApplied(_f: Fight, ctx: CastContext): void {
    if (!this.alive) {
      return;
    }
    if (ctx.caster.team?.side === 0) {
      this.fail(_f, ctx.caster);
    }
  }
}
