import type { Fight } from "@modules/fight/core/fight.entity";
import type { CastContext } from "@modules/fight/effects/fight.buff.types";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(18)
export class IncurableChallenge extends FightChallenge {
  readonly challengeId = 18;
  readonly challengeName = "Incurable";

  private readonly healEffectIds = new Set([81, 108, 143]);

  onCastApplied(_f: Fight, ctx: CastContext): void {
    if (!this.alive) {
      return;
    }

    const hasHealEffect = ctx.spell.effects.some((effect) =>
      this.healEffectIds.has(effect.id)
    );

    if (hasHealEffect) {
      this.fail(_f, ctx.caster);
    }
  }
}
