import type { Fight } from "@modules/fight/core/fight.entity";
import type { FightState } from "@modules/fight/core/fight.entity.types";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { StateName } from "@modules/fight/fight.types";

export class NullState implements FightState {
  readonly name = StateName.Null;

  enter(_f: unknown): void {}

  leave(_f: unknown): void {}
}

export class InitialiseState implements FightState {
  readonly name = StateName.Initialise;

  constructor(private onReady?: (f: Fight) => void) {}

  enter(f: unknown): void {
    this.onReady?.(f as Fight);
  }

  leave(_f: unknown): void {}
}

export class PlacementState implements FightState {
  readonly name = StateName.Placement;

  enter(f: unknown): void {
    const fight = f as Fight;
    for (const team of fight.teams) {
      const cells = fight.fightMap.teamCells[team.side];
      if (!cells || cells.length === 0) {
        continue;
      }
      let ci = 0;
      for (const fighter of team.fighters()) {
        if (fighter.cell >= 0) {
          continue;
        }
        while (ci < cells.length && !fight.fightMap.isFree(cells[ci] ?? -1)) {
          ci++;
        }
        const startCell = cells[ci];
        if (!startCell || ci >= cells.length) {
          break;
        }
        fighter.cell = startCell;
        fight.fightMap.occupy(startCell, fighter.id);
        ci++;
      }
    }
  }

  leave(_f: unknown): void {}

  move(f: Fight, fighter: Fighter, toCell: number): boolean {
    const team = fighter.team;
    if (!team) {
      return false;
    }
    const allowed = f.fightMap.teamCells[team.side];
    if (!allowed || !allowed.includes(toCell)) {
      return false;
    }
    if (!f.fightMap.isFree(toCell)) {
      return false;
    }
    f.fightMap.free(fighter.cell, fighter.id);
    fighter.cell = toCell;
    f.fightMap.occupy(toCell, fighter.id);
    return true;
  }

  setReady(fighter: Fighter, ready: boolean): void {
    fighter.ready = ready;
  }
}
