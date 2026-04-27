import type { Fighter } from "@modules/fight/core/fight.fighter";

export function initiativeOf(f: Fighter): number {
  if (f.player) {
    return f.player.level * 2;
  }
  return 0;
}

export class TurnList {
  private entries: Fighter[];
  private currentIdx = -1;
  private roundNum = 0;

  constructor(fighters: Fighter[]) {
    this.entries = [...fighters].sort((a, b) => {
      const ia = initiativeOf(a);
      const ib = initiativeOf(b);
      if (ia !== ib) {
        return ib - ia;
      }
      return a.id - b.id;
    });
  }

  get round(): number {
    return this.roundNum;
  }

  fighters(): Fighter[] {
    return [...this.entries];
  }

  current(): Fighter | null {
    if (this.currentIdx < 0 || this.currentIdx >= this.entries.length) {
      return null;
    }
    return this.entries[this.currentIdx] ?? null;
  }

  advance(): { next: Fighter | null; rounded: boolean } {
    if (this.entries.length === 0) {
      return { next: null, rounded: false };
    }
    const start = this.currentIdx;
    let rounded = false;
    for (let attempt = 0; attempt <= this.entries.length; attempt++) {
      this.currentIdx = (this.currentIdx + 1) % this.entries.length;
      if (this.currentIdx === 0 && start >= 0) {
        this.roundNum++;
        rounded = true;
      }
      const f = this.entries[this.currentIdx];
      if (!f) {
        return { next: null, rounded };
      }
      if (!f.dead) {
        return { next: f, rounded };
      }
      if (this.currentIdx === start) {
        return { next: null, rounded };
      }
    }
    return { next: null, rounded: false };
  }

  remove(fighterId: number): void {
    const idx = this.entries.findIndex((f) => f.id === fighterId);
    if (idx === -1) {
      return;
    }
    this.entries.splice(idx, 1);
    if (idx < this.currentIdx) {
      this.currentIdx--;
    }
  }
}

export class Turn {
  readonly fighter: Fighter;
  readonly number: number;
  readonly startedAt: number;
  readonly durationMs: number;
  ended = false;

  constructor(fighter: Fighter, number: number, durationMs: number) {
    this.fighter = fighter;
    this.number = number;
    this.startedAt = Date.now();
    this.durationMs = durationMs;
  }

  end(): void {
    this.ended = true;
  }
}
