import type { Fight } from "@modules/fight/core/fight.entity";
import type { CastContext } from "@modules/fight/effects/fight.buff.types";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(21)
export class KeepMovingChallenge extends FightChallenge {
  readonly challengeId = 21;
  readonly challengeName = "Keep Moving";

  private readonly mpRemovalEffectIds = new Set([77, 127]);

  onCastApplied(f: Fight, ctx: CastContext): void {
    if (!this.alive) {
      return;
    }
    if (ctx.caster.team?.side !== 0) {
      return;
    }
    if (!ctx.target || ctx.target.team?.side === 0) {
      return;
    }
    const hasMpRemoval = ctx.spell.effects.some((eff) =>
      this.mpRemovalEffectIds.has(eff.id)
    );
    if (hasMpRemoval) {
      this.fail(f, ctx.caster);
    }
  }
}
