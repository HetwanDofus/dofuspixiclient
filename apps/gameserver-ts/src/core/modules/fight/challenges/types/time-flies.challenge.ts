import type { Fight } from "@modules/fight/core/fight.entity";
import type { CastContext } from "@modules/fight/effects/fight.buff.types";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(22)
export class TimeFliesChallenge extends FightChallenge {
  readonly challengeId = 22;
  readonly challengeName = "Time Flies";

  private readonly apRemovalEffectIds = new Set([84, 101]);

  onCastApplied(f: Fight, ctx: CastContext): void {
    if (!this.alive) {
      return;
    }
    if (ctx.caster.team?.side !== 0) {
      return;
    }
    const hasApRemoval = ctx.spell.effects.some((eff) =>
      this.apRemovalEffectIds.has(eff.id)
    );
    if (hasApRemoval) {
      this.fail(f, ctx.caster);
    }
  }
}
