import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import type { CastContext } from "@modules/fight/effects/fight.buff.types";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(34)
export class UnpredictableChallenge extends FightChallenge {
  readonly challengeId = 34;
  readonly challengeName = "Unpredictable";

  private targetPerFighter = new Map<Fighter, Fighter | null>();

  onTurnStart(_f: Fight, fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    const enemies = _f
      .fighters()
      .filter((ftr) => ftr.team?.side !== fighter.team?.side && ftr.lp > 0);
    if (enemies.length > 0) {
      const target =
        enemies[Math.floor(Math.random() * enemies.length)] ?? null;
      this.targetPerFighter.set(fighter, target);
    }
  }

  onFighterAttacked(
    _f: Fight,
    caster: Fighter,
    target: Fighter,
    _ctx: CastContext
  ): void {
    if (!this.alive) {
      return;
    }
    const expectedTarget = this.targetPerFighter.get(caster);
    if (expectedTarget && target !== expectedTarget) {
      this.fail(_f, caster);
    }
  }
}
