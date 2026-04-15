import type {
  GameCreate,
  GameEnd,
  GameJoin,
  GameReady,
  GameTurnFinish,
  GameTurnStart,
} from "@/game/network/protocol";
import { assign, setup } from "xstate";

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
}

export type FightMachineEvent =
  | {
      type: "FIGHT_INIT";
      payload: GameCreate | GameJoin;
      fightId?: number;
      mySpriteId?: string;
    }
  | {
      type: "FIGHT_SPECTATE_INIT";
      payload: GameJoin;
      fightId?: number;
    }
  | { type: "PLACEMENT_READY"; payload: GameReady }
  | { type: "FIGHT_START" }
  | { type: "TURN_START"; payload: GameTurnStart }
  | { type: "TURN_END"; payload: GameTurnFinish }
  | {
      type: "STATS_UPDATE";
      ap?: number;
      mp?: number;
      maxAp?: number;
      maxMp?: number;
    }
  | { type: "TIMELINE_UPDATE"; timeline: string[] }
  | { type: "FIGHT_END"; payload: GameEnd }
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
      if (event.type !== "TURN_START") return {};
      return {
        turnIndex: context.turnIndex + 1,
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
        FIGHT_END: { target: "ended", actions: "applyEnd" },
        LEAVE: { target: "none", actions: "resetContext" },
      },
    },
    spectating: {
      on: {
        TURN_START: { actions: "applyTurnStart" },
        TIMELINE_UPDATE: { actions: "applyTimeline" },
        STATS_UPDATE: { actions: "applyStats" },
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
