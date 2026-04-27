import type { Fight } from "@modules/fight/core/fight.entity";
import type { Runner } from "@modules/fight/engine/fight.runner";
import { Injectable } from "@nestjs/common";

@Injectable()
export class FightRegistryService {
  private byId = new Map<number, Fight>();
  private bySession = new Map<string, number>();
  private runners = new Map<number, Runner>();

  add(fight: Fight): void {
    this.byId.set(fight.id, fight);
    for (const fighter of fight.fighters()) {
      if (fighter.sessionId) {
        this.bySession.set(fighter.sessionId, fight.id);
      }
    }
  }

  registerSession(sessionId: string, fightId: number): void {
    this.bySession.set(sessionId, fightId);
  }

  unregisterSession(sessionId: string): void {
    this.bySession.delete(sessionId);
  }

  getBySession(sessionId: string): Fight | undefined {
    const fightId = this.bySession.get(sessionId);
    if (fightId === undefined) {
      return undefined;
    }
    return this.byId.get(fightId);
  }

  getById(fightId: number): Fight | undefined {
    return this.byId.get(fightId);
  }

  isInFight(sessionId: string): boolean {
    return this.bySession.has(sessionId);
  }

  addRunner(fightId: number, runner: Runner): void {
    this.runners.set(fightId, runner);
  }

  getRunner(fightId: number): Runner | undefined {
    return this.runners.get(fightId);
  }

  remove(fightId: number): void {
    const fight = this.byId.get(fightId);
    if (fight) {
      for (const fighter of fight.fighters()) {
        if (fighter.sessionId) {
          this.bySession.delete(fighter.sessionId);
        }
      }
    }
    const runner = this.runners.get(fightId);
    if (runner) {
      runner.stop();
      this.runners.delete(fightId);
    }
    this.byId.delete(fightId);
  }
}
