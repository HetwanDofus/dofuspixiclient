import type { FightStateId } from "@modules/fight/fight.types";

export class FightStateBitmap {
  private active = new Map<FightStateId, number>();

  set(id: FightStateId, rounds: number): void {
    this.active.set(id, rounds);
  }

  clear(id: FightStateId): void {
    this.active.delete(id);
  }

  has(id: FightStateId): boolean {
    return this.active.has(id);
  }

  snapshot(): Map<FightStateId, number> {
    return new Map(this.active);
  }

  tickDown(): FightStateId[] {
    const expired: FightStateId[] = [];
    for (const [id, rounds] of this.active) {
      if (rounds < 0) {
        continue;
      }
      if (rounds === 0) {
        this.active.delete(id);
        expired.push(id);
        continue;
      }
      this.active.set(id, rounds - 1);
    }
    return expired;
  }

  clearAll(): void {
    this.active.clear();
  }
}
