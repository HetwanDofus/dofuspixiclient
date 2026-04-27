import type { FightObject } from "@modules/fight/map/fight.object.types";

export type {
  ArrivalTrigger,
  FightObject,
  TurnStartTrigger,
} from "@modules/fight/map/fight.object.types";

export class ObjectRegistry {
  private items: FightObject[] = [];
  private nextId = 0;

  add(o: FightObject): FightObject {
    this.nextId++;
    o.id = this.nextId;
    this.items.push(o);
    return o;
  }

  remove(id: number): FightObject | undefined {
    const idx = this.items.findIndex((o) => o.id === id);
    if (idx === -1) {
      return undefined;
    }
    return this.items.splice(idx, 1)[0];
  }

  each(fn: (o: FightObject) => void): void {
    const snap = [...this.items];
    for (const o of snap) {
      fn(o);
    }
  }

  atCell(cell: number): FightObject[] {
    return this.items.filter((o) => o.cell === cell);
  }

  inRange(
    cell: number,
    radius: number,
    dist?: (a: number, b: number) => number
  ): FightObject[] {
    return this.items.filter((o) => {
      if (!dist) {
        return o.cell === cell;
      }
      return dist(o.cell, cell) <= radius;
    });
  }

  tickDown(): FightObject[] {
    const expired: FightObject[] = [];
    this.items = this.items.filter((o) => {
      if (o.remaining < 0) {
        return true;
      }
      if (o.remaining === 0) {
        expired.push(o);
        return false;
      }
      o.remaining--;
      return true;
    });
    return expired;
  }

  snapshot(): FightObject[] {
    return [...this.items];
  }
}
