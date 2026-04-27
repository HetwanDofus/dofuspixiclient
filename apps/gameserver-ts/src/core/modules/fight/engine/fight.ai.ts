import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import type { TurnObserver } from "@modules/fight/engine/fight.runner.types";
import { FighterKind } from "@modules/fight/fight.types";
import { fastDistance } from "@modules/fight/map/fight.area";

export class MonsterAI implements TurnObserver {
  constructor(
    private readonly requestEnd: (fighterId: number) => void,
    private readonly castSpell?: (
      fight: Fight,
      caster: Fighter,
      spellId: number,
      targetCell: number,
      level: number
    ) => Promise<void>,
    private readonly broadcastMovement?: (
      fight: Fight,
      fighter: Fighter,
      pathCells: number[]
    ) => void
  ) {}

  onTurnStart(fight: Fight, fighter: Fighter): void {
    if (fighter.kind === FighterKind.Player) {
      return;
    }

    this.runTurn(fight, fighter).catch(() => {
      this.requestEnd(fighter.id);
    });
  }

  private async runTurn(fight: Fight, fighter: Fighter): Promise<void> {
    await delay(300);

    const target = this.findNearestEnemy(fight, fighter);
    if (!target) {
      this.requestEnd(fighter.id);
      return;
    }

    let cast = await this.tryCast(fight, fighter, target);

    if (!cast && fighter.mp > 0) {
      this.moveToward(fight, fighter, target);
      await delay(200);
      cast = await this.tryCast(fight, fighter, target);
    }

    if (cast && fighter.ap > 0) {
      await delay(300);
      const newTarget = this.findNearestEnemy(fight, fighter);
      if (newTarget) {
        await this.tryCast(fight, fighter, newTarget);
      }
    }

    await delay(200);
    this.requestEnd(fighter.id);
  }

  private findNearestEnemy(fight: Fight, fighter: Fighter): Fighter | null {
    const myTeam = fighter.team?.side;
    let nearest: Fighter | null = null;
    let nearestDist = Number.MAX_SAFE_INTEGER;

    for (const f of fight.fighters()) {
      if (f.dead || f.team?.side === myTeam) {
        continue;
      }
      const d = fastDistance(fight.fightMap, fighter.cell, f.cell);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = f;
      }
    }
    return nearest;
  }

  private async tryCast(
    fight: Fight,
    fighter: Fighter,
    target: Fighter
  ): Promise<boolean> {
    if (!this.castSpell || fighter.monsterSpells.length === 0) {
      return false;
    }

    const sorted = [...fighter.monsterSpells].sort((a, b) => b.level - a.level);

    for (const spell of sorted) {
      try {
        await this.castSpell(
          fight,
          fighter,
          spell.spellId,
          target.cell,
          spell.level
        );
        return true;
      } catch {}
    }
    return false;
  }

  private moveToward(fight: Fight, fighter: Fighter, target: Fighter): void {
    const fmap = fight.fightMap;
    const total = fmap.width * fmap.height * 2;

    // Combat only allows the four isometric-cardinal directions
    // (1=SE, 3=SW, 5=NW, 7=NE) — the "full-cell" moves. The half-step
    // directions (0=E / 2=S / 4=W / 6=N, offsets ±1 and ±stride) are
    // roleplay-only; stepping into them produces cells that aren't
    // valid fighter positions, and the client's path decoder then
    // animates a bogus direction. Same constraint `findFightPath`
    // enforces on the player side (packages/grid/src/pathfinding.ts
    // line 116 `if (orthogonalOnly && (dir & 1) === 0) continue`).
    const deltas = [
      fmap.width, // SE
      -fmap.width, // NW
      fmap.width - 1, // SW
      -(fmap.width - 1), // NE
    ];

    let remaining = fighter.mp;
    let currentCell = fighter.cell;
    const pathCells: number[] = [];

    while (remaining > 0) {
      const targetDist = fastDistance(fmap, currentCell, target.cell);
      if (targetDist <= 1) {
        break;
      }

      let bestCell = -1;
      let bestDist = targetDist;

      for (const d of deltas) {
        const next = currentCell + d;
        if (next < 0 || next >= total) {
          continue;
        }
        if (!fmap.isFree(next) || !fmap.isWalkable(next)) {
          continue;
        }
        const nd = fastDistance(fmap, next, target.cell);
        if (nd < bestDist) {
          bestDist = nd;
          bestCell = next;
        }
      }

      if (bestCell === -1) {
        break;
      }

      fmap.free(currentCell, fighter.id);
      currentCell = bestCell;
      fmap.occupy(currentCell, fighter.id);
      pathCells.push(currentCell);
      remaining--;
    }

    if (currentCell !== fighter.cell) {
      fighter.cell = currentCell;
      fighter.spendMp(fighter.mp - remaining);
      this.broadcastMovement?.(fight, fighter, pathCells);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
