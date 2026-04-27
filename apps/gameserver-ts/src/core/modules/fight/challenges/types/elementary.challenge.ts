import type { Fight } from "@modules/fight/core/fight.entity";
import type { CastContext } from "@modules/fight/effects/fight.buff.types";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { effectIdToElement } from "@modules/fight/effects/fight.element-map";
import { Element } from "@modules/fight/fight.types";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(20)
export class ElementaryChallenge extends FightChallenge {
  readonly challengeId = 20;
  readonly challengeName = "Elementary";
  private usedElement: Element | null = null;

  onCastApplied(f: Fight, ctx: CastContext): void {
    if (!this.alive) {
      return;
    }
    if (ctx.caster.team?.side !== 0) {
      return;
    }
    const firstEffect = ctx.spell.effects[0];
    if (!firstEffect) {
      return;
    }
    const element = effectIdToElement(firstEffect.id);
    if (element === null) {
      return;
    }
    if (this.usedElement === null) {
      this.usedElement = element;
    } else if (this.usedElement !== element) {
      this.fail(f, ctx.caster);
    }
  }
}
