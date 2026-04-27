import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(28)
export class NeitherPiwinChallenge extends FightChallenge {
  readonly challengeId = 28;
  readonly challengeName = "Neither Piwin Nor Submissive";

  onFighterDied(_f: Fight, fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    if (fighter.team?.side === (_f.fighters()[0]?.team?.side ?? null)) {
      return;
    }

    const playerFighters = _f
      .fighters()
      .filter(
        (ftr) =>
          ftr.player &&
          ftr.team?.side === (_f.fighters()[0]?.team?.side ?? null)
      );
    const lastAttacker = playerFighters[playerFighters.length - 1] ?? null;

    if (lastAttacker?.player && lastAttacker.player.sex === 0) {
      this.fail(_f, lastAttacker);
    }
  }
}
