import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { FightObjectKind as FOK } from "@modules/fight/fight.types";
import { ObjectRegistry } from "@modules/fight/map/fight.object";

export class FightMap {
  readonly width: number;
  readonly height: number;
  readonly teamCells: [number[], number[]];
  readonly objects: ObjectRegistry;
  private occupiedById = new Map<number, number>();
  private walkableSet: Set<number> | null = null;

  constructor(
    width: number,
    height: number,
    team0Cells: number[],
    team1Cells: number[]
  ) {
    this.width = width;
    this.height = height;
    this.teamCells = [team0Cells, team1Cells];
    this.objects = new ObjectRegistry();
  }

  setWalkableCells(cellIds: number[]): void {
    this.walkableSet = new Set(cellIds);
  }

  isWalkable(cell: number): boolean {
    return this.walkableSet ? this.walkableSet.has(cell) : true;
  }

  fireArrivalTriggers(fight: Fight, victim: Fighter, cell: number): void {
    for (const obj of this.objects.atCell(cell)) {
      if (!obj.onArrival) {
        continue;
      }
      if (obj.onArrival(fight, victim)) {
        this.objects.remove(obj.id);
      }
    }
  }

  fireTurnStartTriggers(fight: Fight, owner: Fighter): void {
    this.objects.each((o) => {
      if (o.kind !== FOK.Glyph || !o.onTurnStart) {
        return;
      }
      o.onTurnStart(fight, owner);
    });
  }

  occupy(cell: number, id: number): boolean {
    const existing = this.occupiedById.get(cell);
    if (existing !== undefined && existing !== id) {
      return false;
    }
    this.occupiedById.set(cell, id);
    return true;
  }

  free(cell: number, id: number): void {
    if (this.occupiedById.get(cell) === id) {
      this.occupiedById.delete(cell);
    }
  }

  occupantOf(cell: number): number | undefined {
    return this.occupiedById.get(cell);
  }

  isFree(cell: number): boolean {
    return !this.occupiedById.has(cell);
  }
}

const HASH_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";

export function parsePlacementCells(encoded: string): number[] {
  const trimmed = encoded.trim();
  if (trimmed.length === 0 || trimmed.length % 2 !== 0) {
    return [];
  }
  const out: number[] = [];
  for (let i = 0; i < trimmed.length; i += 2) {
    const hi = HASH_CHARS.indexOf(trimmed.charAt(i));
    const lo = HASH_CHARS.indexOf(trimmed.charAt(i + 1));
    if (hi === -1 || lo === -1) {
      return [];
    }
    out.push((hi << 6) | lo);
  }
  return out;
}
