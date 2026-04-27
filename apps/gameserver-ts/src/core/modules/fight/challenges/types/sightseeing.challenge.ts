import type { Fight } from "@modules/fight/core/fight.entity";
import type { CastContext } from "@modules/fight/effects/fight.buff.types";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(23)
export class SightseeingChallenge extends FightChallenge {
  readonly challengeId = 23;
  readonly challengeName = "Sightseeing";

  private readonly rangeRemovalEffectIds = new Set([116]);

  onCastApplied(f: Fight, ctx: CastContext): void {
    if (!this.alive) {
      return;
    }
    if (ctx.caster.team?.side !== 0) {
      return;
    }
    const hasRangeRemoval = ctx.spell.effects.some((eff) =>
      this.rangeRemovalEffectIds.has(eff.id)
    );
    if (hasRangeRemoval) {
      this.fail(f, ctx.caster);
    }
  }
}
