import type { Fight } from "@modules/fight/core/fight.entity";
import type { FightState } from "@modules/fight/core/fight.entity.types";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { clampFightDirection, getDirection, getNeighbors } from "@dofus/grid";
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
        // `ci >= cells.length` first: `cells[ci]` is `undefined` past the
        // end, and cell id 0 is falsy — testing the value first would treat
        // a legitimate cell 0 as "no more room".
        const startCell = ci < cells.length ? cells[ci] : undefined;
        if (startCell === undefined) {
          // The map's placement block is smaller than the group. 615 maps
          // ship fewer than 8 team-1 cells while `maps.mob_size_max` goes to
          // 8, so this is reached in ordinary play. Breaking here left the
          // remaining fighters at `cell = -1`: still alive, still shipped in
          // the join frame, but drawn off-grid — the fight could not be won
          // and the on-screen count no longer matched the group.
          const overflow = this.findOverflowCell(fight, cells);
          if (overflow === undefined) {
            break;
          }
          fighter.cell = overflow;
          fight.fightMap.occupy(overflow, fighter.id);
          continue;
        }
        fighter.cell = startCell;
        fight.fightMap.occupy(startCell, fighter.id);
        ci++;
      }
    }
    // Face every fighter toward the centroid of the enemy team's
    // placement cells. Mirrors the canonical 1.29 client which orients
    // sprites along the natural blue↔red axis on placement entry — without
    // this, monsters keep direction 0 (SE) and players keep their stale
    // roleplay direction, both of which look wrong against an opponent
    // sitting on the opposite side of the map.
    this.orientFightersTowardEnemy(fight);
  }

  leave(_f: unknown): void {}

  /**
   * A free, walkable cell adjacent to the team's own placement block, for a
   * fighter that did not fit in it.
   *
   * Breadth-first from the block so overflow lands against it rather than
   * anywhere on the map, and never on a cell the other team is entitled to —
   * a monster standing in the blue block would let the player start the fight
   * already in contact. The search is bounded: two rings out is plenty for
   * the two-or-three-fighter shortfall these maps produce, and a bound is
   * what keeps a pathological map from walking every cell.
   */
  private findOverflowCell(
    fight: Fight,
    teamCells: number[]
  ): number | undefined {
    const reserved = new Set<number>([
      ...fight.fightMap.teamCells[0],
      ...fight.fightMap.teamCells[1],
    ]);

    let frontier = [...teamCells];
    const seen = new Set<number>(frontier);

    for (let ring = 0; ring < 2; ring++) {
      const next: number[] = [];

      for (const cell of frontier) {
        for (const neighbor of getNeighbors(
          cell,
          fight.fightMap.width,
          fight.fightMap.height
        )) {
          if (seen.has(neighbor)) {
            continue;
          }
          seen.add(neighbor);
          next.push(neighbor);

          if (
            !reserved.has(neighbor) &&
            fight.fightMap.isWalkable(neighbor) &&
            fight.fightMap.isFree(neighbor)
          ) {
            return neighbor;
          }
        }
      }

      frontier = next;
    }

    return undefined;
  }

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
    // Re-orient on every placement move so the fighter keeps facing the
    // enemy when they slide along their team's cells.
    fighter.direction = this.directionTowardEnemy(f, fighter);
    return true;
  }

  private orientFightersTowardEnemy(fight: Fight): void {
    for (const team of fight.teams) {
      for (const fighter of team.fighters()) {
        if (fighter.cell < 0) {
          continue;
        }
        fighter.direction = this.directionTowardEnemy(fight, fighter);
      }
    }
  }

  private directionTowardEnemy(fight: Fight, fighter: Fighter): number {
    const enemySide = fighter.team?.side === 0 ? 1 : 0;
    const enemyCells = fight.fightMap.teamCells[enemySide] ?? [];
    if (enemyCells.length === 0 || fighter.cell < 0) {
      return fighter.direction;
    }
    // Use the median cell as a stable centroid proxy — avoids needing
    // x/y per-cell data on the server (the grid package's getDirection
    // takes only mapWidth + cell ids).
    const target =
      enemyCells[Math.floor(enemyCells.length / 2)] ?? enemyCells[0];
    if (target === undefined) {
      return fighter.direction;
    }
    // Clamp to fight directions {1,3,5,7} — the client renderer
    // clamps anyway, so storing 8-way here desyncs the equality check
    // in the cast handler and silently suppresses re-emits.
    return clampFightDirection(
      getDirection(fighter.cell, target, fight.fightMap.width)
    );
  }

  setReady(fighter: Fighter, ready: boolean): void {
    fighter.ready = ready;
  }
}
