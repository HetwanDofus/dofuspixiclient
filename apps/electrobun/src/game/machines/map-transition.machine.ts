import { assign, setup } from "xstate";

export interface MapTransitionContext {
  currentMapId: number | null;
  pendingMapId: number | null;
  generation: number;
  direction: "north" | "south" | "east" | "west" | null;
}

export type MapTransitionEvent =
  | {
      type: "BEGIN_TRANSITION";
      mapId: number;
      direction?: MapTransitionContext["direction"];
    }
  | { type: "MAP_DATA_READY"; mapId: number; generation: number }
  | { type: "MAP_ACTORS_READY"; mapId: number; generation: number }
  | { type: "TRANSITION_FAILED"; reason: string }
  | { type: "RESET" };

/**
 * Replaces `mapTransitioning` + `mapGeneration` flags in game-client.ts.
 *
 *   idle ──BEGIN_TRANSITION──> loadingMap ──MAP_DATA_READY──> loadingActors ──MAP_ACTORS_READY──> ready
 *                                 │                              │
 *                                 │ TRANSITION_FAILED            │ RESET
 *                                 ▼                              │
 *                              failed ─────RESET──────────> idle
 *
 * Generation counter in context discriminates stale responses (e.g. MAP_ACTORS
 * arrives for a map that's already been superseded by another teleport).
 */
export const mapTransitionMachine = setup({
  types: {
    context: {} as MapTransitionContext,
    events: {} as MapTransitionEvent,
  },
  guards: {
    isCurrentGeneration: ({ context, event }) =>
      (event.type === "MAP_DATA_READY" || event.type === "MAP_ACTORS_READY") &&
      event.generation === context.generation,
  },
  actions: {
    bumpGeneration: assign(({ context, event }) => {
      if (event.type !== "BEGIN_TRANSITION") {
        return {};
      }

      return {
        pendingMapId: event.mapId,
        direction: event.direction ?? null,
        generation: context.generation + 1,
      };
    }),
    promotePending: assign(({ context }) => ({
      currentMapId: context.pendingMapId,
      pendingMapId: null,
    })),
    reset: assign(() => ({
      currentMapId: null,
      pendingMapId: null,
      generation: 0,
      direction: null,
    })),
  },
}).createMachine({
  id: "mapTransition",
  initial: "idle",
  context: {
    currentMapId: null,
    pendingMapId: null,
    generation: 0,
    direction: null,
  },
  states: {
    idle: {
      on: {
        BEGIN_TRANSITION: { target: "loadingMap", actions: "bumpGeneration" },
      },
    },
    loadingMap: {
      on: {
        MAP_DATA_READY: {
          guard: "isCurrentGeneration",
          target: "loadingActors",
        },
        BEGIN_TRANSITION: {
          target: "loadingMap",
          actions: "bumpGeneration",
          reenter: true,
        },
        TRANSITION_FAILED: { target: "failed" },
        RESET: { target: "idle", actions: "reset" },
      },
    },
    loadingActors: {
      on: {
        MAP_ACTORS_READY: {
          guard: "isCurrentGeneration",
          target: "ready",
          actions: "promotePending",
        },
        BEGIN_TRANSITION: {
          target: "loadingMap",
          actions: "bumpGeneration",
          reenter: true,
        },
        TRANSITION_FAILED: { target: "failed" },
        RESET: { target: "idle", actions: "reset" },
      },
    },
    ready: {
      on: {
        BEGIN_TRANSITION: { target: "loadingMap", actions: "bumpGeneration" },
        RESET: { target: "idle", actions: "reset" },
      },
    },
    failed: {
      on: {
        BEGIN_TRANSITION: { target: "loadingMap", actions: "bumpGeneration" },
        RESET: { target: "idle", actions: "reset" },
      },
    },
  },
});

export type MapTransitionMachine = typeof mapTransitionMachine;
