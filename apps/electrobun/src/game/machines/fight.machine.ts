import { assign, setup } from "xstate";

/**
 * Wire-decoupled fight events. The network handlers in
 * `@/game/net/handlers/game/*` translate dofus1-net frames into these
 * primitive shapes; the machine never imports a network type, so the
 * wire format can evolve without touching the state graph.
 */
export interface FightInitInput {
  /** Server-supplied game type (1 = solo roleplay / spectate join). */
  gameType?: number;
}
export interface FightTurnStartInput {
  /** Canonical sprite id of the fighter whose turn just started. */
  spriteId: string;
  /** `tableTurnNum` — 1-based round number (a full cycle of fighters). */
  tableTurnNum: number;
}
export interface FightTurnFinishInput {
  spriteId: string;
}
export interface FightEndInput {
  winnerTeam: number;
}

/**
 * Per-fighter snapshot projected from the various gameAction /
 * gameMovement / gameTurnMiddle frames. Held here (not in a separate
 * store) so the HUD has a single source of truth for the whole
 * roster — the turn timeline, damage overlays, fighter info panels,
 * and the reachable-cells preview all read from this map.
 */
export interface FighterSnapshot {
  spriteId: string;
  name: string;
  level: number;
  team: 0 | 1;
  cell: number;
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  mp: number;
  maxMp: number;
  gfxId: number;
  dead: boolean;
  /**
   * RGB color zones from the SpriteMovementEntry (-1 = default for the
   * gfx). Carried through so the StringCourse turn-change banner can
   * tint the fighter's portrait per zone — same as canonical 1.29's
   * `stringCourseColor(mc, zone)` callback in
   * `dofus.graphics.gapi.ui.StringCourse`.
   */
  color1: number;
  color2: number;
  color3: number;
  summonedBy?: string;
}

export interface FightContext {
  fightId: number | null;
  mySpriteId: string | null;
  ap: number;
  mp: number;
  maxAp: number;
  maxMp: number;
  turnIndex: number;
  timeline: string[];
  currentTurnSpriteId: string | null;
  isSpectator: boolean;
  winnerTeam: number | null;
  fighters: Map<string, FighterSnapshot>;
}

export type FightMachineEvent =
  | {
      type: "FIGHT_INIT";
      payload?: FightInitInput;
      fightId?: number;
      mySpriteId?: string;
    }
  | {
      type: "FIGHT_SPECTATE_INIT";
      payload?: FightInitInput;
      fightId?: number;
    }
  | { type: "PLACEMENT_READY" }
  | { type: "FIGHT_START" }
  | { type: "TURN_START"; payload: FightTurnStartInput }
  | { type: "TURN_END"; payload: FightTurnFinishInput }
  | {
      type: "STATS_UPDATE";
      ap?: number;
      mp?: number;
      maxAp?: number;
      maxMp?: number;
    }
  | { type: "TIMELINE_UPDATE"; timeline: string[] }
  | {
      type: "FIGHTER_UPSERT";
      fighter: FighterSnapshot;
    }
  | {
      type: "FIGHTER_UPDATE";
      spriteId: string;
      patch: Partial<
        Pick<
          FighterSnapshot,
          "hp" | "maxHp" | "ap" | "maxAp" | "mp" | "maxMp" | "cell" | "dead"
        >
      >;
    }
  | { type: "FIGHTER_REMOVE"; spriteId: string }
  | { type: "FIGHT_END"; payload: FightEndInput }
  | { type: "LEAVE" };

const initialContext: FightContext = {
  fightId: null,
  mySpriteId: null,
  ap: 0,
  mp: 0,
  maxAp: 0,
  maxMp: 0,
  turnIndex: 0,
  timeline: [],
  currentTurnSpriteId: null,
  isSpectator: false,
  winnerTeam: null,
  fighters: new Map(),
};

/**
 * Fight lifecycle over the new protobuf protocol:
 *
 *   none ──FIGHT_INIT──> placement ──FIGHT_START──> fighting ──FIGHT_END──> ended
 *    │                                                  │
 *    │ FIGHT_SPECTATE_INIT                              │
 *    ▼                                                  │
 *   spectating <────────────────────────────────────────┘
 *
 * Sprite ids are now strings (proto field). myTurn is determined by
 * string equality of current-turn sprite id vs our own.
 */
export const fightMachine = setup({
  types: {
    context: {} as FightContext,
    events: {} as FightMachineEvent,
  },
  guards: {
    isMyTurn: ({ context, event }) =>
      event.type === "TURN_START" &&
      context.mySpriteId !== null &&
      event.payload.spriteId === context.mySpriteId,
  },
  actions: {
    applyInit: assign(({ event }) => {
      if (event.type !== "FIGHT_INIT" && event.type !== "FIGHT_SPECTATE_INIT") {
        return {};
      }
      return {
        fightId: event.fightId ?? null,
        mySpriteId:
          event.type === "FIGHT_INIT" ? (event.mySpriteId ?? null) : null,
        isSpectator: event.type === "FIGHT_SPECTATE_INIT",
        winnerTeam: null,
      };
    }),
    applyTurnStart: assign(({ context, event }) => {
      if (event.type !== "TURN_START") {
        return {};
      }
      // Dofus 1.29 semantics: "Tour N" = round N (a full cycle of
      // every fighter acting). Server ships that value as
      // GameTurnStart.tableTurnNum; use it verbatim instead of
      // incrementing per-fighter or we'd display "Tour 8" after one
      // round of 8 fighters.
      const round = event.payload.tableTurnNum;
      return {
        turnIndex: round > 0 ? round - 1 : context.turnIndex,
        currentTurnSpriteId: event.payload.spriteId,
      };
    }),
    applyStats: assign(({ context, event }) => {
      if (event.type !== "STATS_UPDATE") return {};
      return {
        ap: event.ap ?? context.ap,
        mp: event.mp ?? context.mp,
        maxAp: event.maxAp ?? context.maxAp,
        maxMp: event.maxMp ?? context.maxMp,
      };
    }),
    upsertFighter: assign(({ context, event }) => {
      if (event.type !== "FIGHTER_UPSERT") return {};
      const next = new Map(context.fighters);
      const existing = next.get(event.fighter.spriteId);
      // Preserve maxAp / maxMp once we've seen a positive baseline —
      // gameTurnMiddle doesn't ship apMax/mpMax (only lpMax), so we
      // anchor on the first non-zero reading and carry it forward.
      const merged: FighterSnapshot = existing
        ? {
            ...existing,
            ...event.fighter,
            maxAp:
              existing.maxAp > 0 ? existing.maxAp : event.fighter.maxAp,
            maxMp:
              existing.maxMp > 0 ? existing.maxMp : event.fighter.maxMp,
          }
        : event.fighter;
      next.set(merged.spriteId, merged);
      // When the upsert is for the local fighter, mirror their
      // ap/mp/maxAp/maxMp into the top-level context so the AP/MP
      // gauges + the hover-path MP guard (`fight.mp > 0` in
      // hover-preview.ts) work — without this top-level mirror those
      // counters stay at 0 because no separate STATS_UPDATE event ever
      // fires from the protocol.
      if (
        context.mySpriteId !== null &&
        merged.spriteId === context.mySpriteId
      ) {
        return {
          fighters: next,
          ap: merged.ap > 0 ? merged.ap : context.ap,
          mp: merged.mp > 0 ? merged.mp : context.mp,
          maxAp: merged.maxAp > 0 ? merged.maxAp : context.maxAp,
          maxMp: merged.maxMp > 0 ? merged.maxMp : context.maxMp,
        };
      }
      return { fighters: next };
    }),
    updateFighter: assign(({ context, event }) => {
      if (event.type !== "FIGHTER_UPDATE") return {};
      const existing = context.fighters.get(event.spriteId);
      if (!existing) return {};
      const next = new Map(context.fighters);
      const patched: FighterSnapshot = { ...existing, ...event.patch };
      // Same baseline-anchor logic for maxAp/maxMp — if the patch
      // only carries `ap` but the fighter's maxAp is still zero
      // (hasn't been seen in gameTurnMiddle yet), adopt it.
      if (patched.maxAp === 0 && patched.ap > 0) {
        patched.maxAp = patched.ap;
      }
      if (patched.maxMp === 0 && patched.mp > 0) {
        patched.maxMp = patched.mp;
      }
      next.set(event.spriteId, patched);
      // Mirror to top-level ctx when this fighter is us — see the
      // matching block in `upsertFighter` above. GTM is the canonical
      // every-turn ap/mp refresh, so without this the gauges + the
      // MP-bound path preview never update past 0.
      if (
        context.mySpriteId !== null &&
        event.spriteId === context.mySpriteId
      ) {
        return {
          fighters: next,
          ap: patched.ap,
          mp: patched.mp,
          maxAp: patched.maxAp > 0 ? patched.maxAp : context.maxAp,
          maxMp: patched.maxMp > 0 ? patched.maxMp : context.maxMp,
        };
      }
      return { fighters: next };
    }),
    removeFighter: assign(({ context, event }) => {
      if (event.type !== "FIGHTER_REMOVE") return {};
      if (!context.fighters.has(event.spriteId)) return {};
      const next = new Map(context.fighters);
      next.delete(event.spriteId);
      return { fighters: next };
    }),
    applyTimeline: assign(({ event }) =>
      event.type === "TIMELINE_UPDATE" ? { timeline: event.timeline } : {}
    ),
    applyEnd: assign(({ event }) =>
      event.type === "FIGHT_END"
        ? { winnerTeam: event.payload.winnerTeam }
        : {}
    ),
    resetContext: assign(() => ({ ...initialContext })),
  },
}).createMachine({
  id: "fight",
  initial: "none",
  context: initialContext,
  states: {
    none: {
      on: {
        FIGHT_INIT: { target: "placement", actions: "applyInit" },
        FIGHT_SPECTATE_INIT: { target: "spectating", actions: "applyInit" },
      },
    },
    placement: {
      on: {
        FIGHT_START: { target: "fighting" },
        TIMELINE_UPDATE: { actions: "applyTimeline" },
        PLACEMENT_READY: {},
        FIGHTER_UPSERT: { actions: "upsertFighter" },
        FIGHTER_UPDATE: { actions: "updateFighter" },
        FIGHTER_REMOVE: { actions: "removeFighter" },
        LEAVE: { target: "none", actions: "resetContext" },
      },
    },
    fighting: {
      initial: "waitingForTurn",
      states: {
        waitingForTurn: {
          on: {
            TURN_START: [
              {
                guard: "isMyTurn",
                target: "myTurn",
                actions: "applyTurnStart",
              },
              { target: "opponentTurn", actions: "applyTurnStart" },
            ],
          },
        },
        myTurn: {
          on: { TURN_END: { target: "waitingForTurn" } },
        },
        opponentTurn: {
          on: { TURN_END: { target: "waitingForTurn" } },
        },
      },
      on: {
        STATS_UPDATE: { actions: "applyStats" },
        TIMELINE_UPDATE: { actions: "applyTimeline" },
        FIGHTER_UPSERT: { actions: "upsertFighter" },
        FIGHTER_UPDATE: { actions: "updateFighter" },
        FIGHTER_REMOVE: { actions: "removeFighter" },
        FIGHT_END: { target: "ended", actions: "applyEnd" },
        LEAVE: { target: "none", actions: "resetContext" },
      },
    },
    spectating: {
      on: {
        TURN_START: { actions: "applyTurnStart" },
        TIMELINE_UPDATE: { actions: "applyTimeline" },
        STATS_UPDATE: { actions: "applyStats" },
        FIGHTER_UPSERT: { actions: "upsertFighter" },
        FIGHTER_UPDATE: { actions: "updateFighter" },
        FIGHTER_REMOVE: { actions: "removeFighter" },
        FIGHT_END: { target: "ended", actions: "applyEnd" },
        LEAVE: { target: "none", actions: "resetContext" },
      },
    },
    ended: {
      on: { LEAVE: { target: "none", actions: "resetContext" } },
    },
  },
});

export type FightMachine = typeof fightMachine;
