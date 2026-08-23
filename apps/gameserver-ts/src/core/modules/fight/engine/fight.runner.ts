import type { ActiveState } from "@modules/fight/core/fight.active-state";
import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import type {
  FrameSink,
  TurnFinishPayload,
  TurnListFrame,
  TurnMiddlePayload,
  TurnObserver,
  TurnStartPayload,
  ZoneRemovePayload,
} from "@modules/fight/engine/fight.runner.types";
import { Turn } from "@modules/fight/core/fight.turn";
import { FighterKind } from "@modules/fight/fight.types";

export type {
  FrameSink,
  TurnFinishPayload,
  TurnListFrame,
  TurnMiddleEntry,
  TurnMiddlePayload,
  TurnObserver,
  TurnStartPayload,
} from "@modules/fight/engine/fight.runner.types";

export class Runner {
  private fight: Fight;
  private active: ActiveState;
  private sink: FrameSink;
  private turnDurationMs: number;
  private observer: TurnObserver | null = null;
  private turn: Turn | null = null;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    fight: Fight,
    active: ActiveState,
    sink: FrameSink,
    turnDurationMs = 30_000
  ) {
    this.fight = fight;
    this.active = active;
    this.sink = sink;
    this.turnDurationMs = turnDurationMs;
  }

  setObserver(o: TurnObserver): void {
    this.observer = o;
  }

  start(): void {
    this.sink.broadcast(this.fight, "GTL", this.encodeTurnList());
    this.advanceTurn();
  }

  stop(): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    if (this.turnTimer !== null) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  notifyReady(_fighterId: number): void {
    // Ready ack recorded — currently a no-op; future: gate turn start on all acks
  }

  requestEnd(fighterId: number): void {
    if (this.stopped) {
      return;
    }
    if (!this.turn || this.turn.fighter.id !== fighterId) {
      return;
    }
    this.endTurn(this.turn);
  }

  notifyDeath(fighterId: number): void {
    this.active.turnList.remove(fighterId);
    if (this.turn && this.turn.fighter.id === fighterId) {
      this.requestEnd(fighterId);
    }
  }

  private advanceTurn(): void {
    if (this.stopped) {
      return;
    }
    const endCheck = this.fight.checkFightEnd();
    if (endCheck.ended) {
      this.sink.broadcast(this.fight, "GE", null);
      this.stop();
      return;
    }
    const { next: fighter, rounded } = this.active.turnList.advance();
    if (!fighter) {
      this.sink.broadcast(this.fight, "GE", null);
      return;
    }

    // Deployed objects age by the round, not by the turn. Ticking them
    // at every turn end burned a 3-round glyph in well under one round
    // of a four-fighter fight, which read in play as "glyphs vanish
    // immediately".
    if (rounded) {
      this.expireObjects();
    }

    this.refreshFighter(fighter);

    const turn = new Turn(
      fighter,
      this.active.turnList.round + 1,
      this.turnDurationMs
    );
    this.turn = turn;

    if (this.turnTimer !== null) {
      clearTimeout(this.turnTimer);
    }
    this.turnTimer = setTimeout(() => {
      if (this.stopped) {
        return;
      }
      this.requestEnd(fighter.id);
    }, this.turnDurationMs);

    this.fight.modules.fireTurnStart(this.fight, fighter);

    this.fight.fightMap.fireTurnStartTriggers(this.fight, fighter);

    const expiredBuffs = fighter.buffs.tickDown();
    for (const b of expiredBuffs) {
      b.onRemove?.(this.fight, fighter);
    }
    fighter.states.tickDown();

    // After expired buffs + states tickdown, check for fight end
    const postBuffEnd = this.fight.checkFightEnd();
    if (postBuffEnd.ended) {
      this.sink.broadcast(this.fight, "GE", null);
      this.stop();
      return;
    }

    this.sink.broadcast(this.fight, "GTS", {
      spriteId: String(fighter.id),
      timeMs: this.turnDurationMs,
      tableTurnNum: this.active.turnList.round + 1,
    } satisfies TurnStartPayload);

    this.sink.broadcast(this.fight, "GTM", this.encodeTurnMiddle());

    if (this.observer && fighter.kind !== FighterKind.Player) {
      try {
        this.observer.onTurnStart(this.fight, fighter);
      } catch {
        this.requestEnd(fighter.id);
      }
    }
  }

  private endTurn(turn: Turn): void {
    turn.end();
    if (this.turnTimer !== null) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }

    this.fight.modules.fireTurnEnd(this.fight, turn.fighter);

    this.sink.broadcast(this.fight, "GTF", {
      spriteId: String(turn.fighter.id),
    } satisfies TurnFinishPayload);

    this.advanceTurn();
  }

  /**
   * Age deployed objects one round and tell the clients about the ones
   * that died.
   *
   * The expired list used to be discarded, so an expired glyph stayed
   * drawn on the battlefield for the rest of the fight — a zone the
   * player could see and reason about that no longer did anything.
   */
  private expireObjects(): void {
    for (const expired of this.fight.fightMap.objects.tickDown()) {
      this.sink.broadcast(this.fight, "GDZ", {
        cellId: expired.cell,
      } satisfies ZoneRemovePayload);
    }
  }

  private refreshFighter(f: Fighter): void {
    f.resetAp(6);
    f.resetMp(3);
    this.fight.spellUsage.resetTurn(f.id);
  }

  private encodeTurnList(): TurnListFrame {
    return {
      spriteIds: this.active.turnList.fighters().map((f) => String(f.id)),
    };
  }

  private encodeTurnMiddle(): TurnMiddlePayload {
    return {
      entries: this.fight.fighters().map((f) => ({
        spriteId: String(f.id),
        cell: f.cell,
        // Clamp lp at 0 — Fighter.setLp doesn't clamp negative values
        // (it just sets dead=true), so a freshly-killed fighter would
        // serialize as lp=-50 here. Client treats -50 as the new HP
        // and the bar collapses below empty.
        lp: Math.max(0, f.lp),
        lpMax: f.lpMax,
        ap: f.ap,
        mp: f.mp,
        isDead: f.dead,
      })),
    };
  }
}
