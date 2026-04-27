import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import type { CastContext } from "@modules/fight/effects/fight.buff.types";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { distance } from "@modules/fight/map/fight.area";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(47)
export class ContaminationChallenge extends FightChallenge {
  readonly challengeId = 47;
  readonly challengeName = "Contamination";

  private damagedThisTurn = new Set<Fighter>();

  onTurnStart(_f: Fight, _fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    this.damagedThisTurn.clear();
  }

  onFighterAttacked(
    _f: Fight,
    _caster: Fighter,
    target: Fighter,
    _ctx: CastContext
  ): void {
    if (!this.alive) {
      return;
    }
    this.damagedThisTurn.add(target);
  }

  onTurnEnd(_f: Fight, fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    const allies = _f
      .fighters()
      .filter(
        (ftr) =>
          ftr.team?.side === fighter.team?.side && ftr !== fighter && ftr.lp > 0
      );
    const isAdjacentToDamagedAlly = allies.some(
      (ally) =>
        this.damagedThisTurn.has(ally) &&
        distance(_f.fightMap, fighter.cell, ally.cell) === 1
    );
    if (isAdjacentToDamagedAlly) {
      this.fail(_f, fighter);
    }
  }
}
