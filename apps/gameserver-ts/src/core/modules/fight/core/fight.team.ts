import type { Fighter } from "@modules/fight/core/fight.fighter";
import type { TeamSide } from "@modules/fight/fight.types";

export type { TeamOptions } from "@modules/fight/core/fight.team.types";

export class FightTeam {
  readonly side: TeamSide;
  leaderId: number;
  startCells: number[] = [];
  private roster: Fighter[] = [];

  constructor(side: TeamSide, leaderId: number) {
    this.side = side;
    this.leaderId = leaderId;
  }

  add(f: Fighter): void {
    f.team = this;
    this.roster.push(f);
  }

  remove(fighterId: number): void {
    const idx = this.roster.findIndex((f) => f.id === fighterId);
    if (idx !== -1) {
      this.roster.splice(idx, 1);
    }
  }

  fighters(): Fighter[] {
    return [...this.roster];
  }
}
