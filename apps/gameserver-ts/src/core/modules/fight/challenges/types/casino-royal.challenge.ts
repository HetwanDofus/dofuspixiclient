import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import type { CastContext } from "@modules/fight/effects/fight.buff.types";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(14)
export class CasinoRoyalChallenge extends FightChallenge {
  readonly challengeId = 14;
  readonly challengeName = "Casino Royal";

  private castThisTurn = false;

  onTurnStart(_f: Fight, _fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    this.castThisTurn = false;
  }

  onCastApplied(_f: Fight, _ctx: CastContext): void {
    if (!this.alive) {
      return;
    }
    this.castThisTurn = true;
  }

  onTurnEnd(_f: Fight, fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    if (fighter.player && !this.castThisTurn) {
      this.fail(_f, fighter);
    }
    this.castThisTurn = false;
  }
}
