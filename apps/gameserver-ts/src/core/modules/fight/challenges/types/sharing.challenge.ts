import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import type { FighterReward } from "@modules/fight/engine/fight.module-hooks.types";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(44)
export class SharingChallenge extends FightChallenge {
  readonly challengeId = 44;
  readonly challengeName = "Sharing";

  private killersPerTeam = new Set<number>();

  onFighterDied(_f: Fight, _fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    // In a multiplayer context, we'd track who dealt the killing blow
    // For now, track teams that have killed at least one monster
    const playerTeam = _f.fighters().find((ftr) => ftr.team?.side === 0);
    if (playerTeam) {
      this.killersPerTeam.add(playerTeam.id);
    }
  }

  onFightEnd(_f: Fight, _winner: number, _rewards: FighterReward[]): void {
    if (!this.alive) {
      return;
    }
    const playerFighters = _f.fighters().filter((ftr) => ftr.team?.side === 0);
    if (playerFighters.some((ftr) => !this.killersPerTeam.has(ftr.id))) {
      this.fail(_f, null);
    } else {
      this.succeed();
    }
  }
}
