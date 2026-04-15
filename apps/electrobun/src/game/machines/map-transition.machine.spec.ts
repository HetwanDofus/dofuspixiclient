import { describe, expect, it } from "bun:test";

import { createActor } from "xstate";

import { mapTransitionMachine } from "./map-transition.machine";

function startActor() {
  const actor = createActor(mapTransitionMachine);
  actor.start();
  return actor;
}

describe("mapTransitionMachine", () => {
  describe("happy path", () => {
    it("runs idle → loadingMap → loadingActors → ready", () => {
      const actor = startActor();
      expect(actor.getSnapshot().value).toBe("idle");

      actor.send({ type: "BEGIN_TRANSITION", mapId: 100 });
      const loading = actor.getSnapshot();
      expect(loading.value).toBe("loadingMap");
      expect(loading.context.pendingMapId).toBe(100);
      expect(loading.context.generation).toBe(1);

      const gen = actor.getSnapshot().context.generation;
      actor.send({ type: "MAP_DATA_READY", mapId: 100, generation: gen });
      expect(actor.getSnapshot().value).toBe("loadingActors");

      actor.send({ type: "MAP_ACTORS_READY", mapId: 100, generation: gen });
      const ready = actor.getSnapshot();
      expect(ready.value).toBe("ready");
      expect(ready.context.currentMapId).toBe(100);
      expect(ready.context.pendingMapId).toBeNull();
    });

    it("carries transition direction into context", () => {
      const actor = startActor();
      actor.send({ type: "BEGIN_TRANSITION", mapId: 5, direction: "east" });
      expect(actor.getSnapshot().context.direction).toBe("east");
    });
  });

  describe("stale response guards", () => {
    it("ignores MAP_DATA_READY with outdated generation", () => {
      const actor = startActor();
      actor.send({ type: "BEGIN_TRANSITION", mapId: 10 });
      const gen1 = actor.getSnapshot().context.generation;

      // Re-trigger transition — generation bumps
      actor.send({ type: "BEGIN_TRANSITION", mapId: 20 });
      const gen2 = actor.getSnapshot().context.generation;
      expect(gen2).toBe(gen1 + 1);

      // Stale MAP_DATA_READY for gen1 is silently ignored
      actor.send({ type: "MAP_DATA_READY", mapId: 10, generation: gen1 });
      expect(actor.getSnapshot().value).toBe("loadingMap");

      // Current-gen response advances
      actor.send({ type: "MAP_DATA_READY", mapId: 20, generation: gen2 });
      expect(actor.getSnapshot().value).toBe("loadingActors");
    });

    it("ignores stale MAP_ACTORS_READY", () => {
      const actor = startActor();
      actor.send({ type: "BEGIN_TRANSITION", mapId: 1 });
      const gen1 = actor.getSnapshot().context.generation;
      actor.send({ type: "MAP_DATA_READY", mapId: 1, generation: gen1 });

      // Mid-flight teleport
      actor.send({ type: "BEGIN_TRANSITION", mapId: 2 });

      // Old actors arriving for gen1 — ignored
      actor.send({ type: "MAP_ACTORS_READY", mapId: 1, generation: gen1 });
      expect(actor.getSnapshot().value).toBe("loadingMap"); // from the gen2 transition
    });
  });

  describe("mid-flight transitions", () => {
    it("BEGIN_TRANSITION re-enters loadingMap from loadingActors", () => {
      const actor = startActor();
      actor.send({ type: "BEGIN_TRANSITION", mapId: 1 });
      const gen1 = actor.getSnapshot().context.generation;
      actor.send({ type: "MAP_DATA_READY", mapId: 1, generation: gen1 });
      expect(actor.getSnapshot().value).toBe("loadingActors");

      actor.send({ type: "BEGIN_TRANSITION", mapId: 2 });
      const snap = actor.getSnapshot();
      expect(snap.value).toBe("loadingMap");
      expect(snap.context.pendingMapId).toBe(2);
      expect(snap.context.generation).toBe(gen1 + 1);
    });
  });

  describe("failure + reset", () => {
    it("TRANSITION_FAILED from loadingMap → failed", () => {
      const actor = startActor();
      actor.send({ type: "BEGIN_TRANSITION", mapId: 1 });
      actor.send({ type: "TRANSITION_FAILED", reason: "timeout" });
      expect(actor.getSnapshot().value).toBe("failed");
    });

    it("RESET from any state returns to idle with cleared context", () => {
      const states: Array<{
        reach: "loadingMap" | "loadingActors" | "ready" | "failed";
        drive: (actor: ReturnType<typeof startActor>) => void;
      }> = [
        {
          reach: "loadingMap",
          drive: (a) => a.send({ type: "BEGIN_TRANSITION", mapId: 1 }),
        },
        {
          reach: "loadingActors",
          drive: (a) => {
            a.send({ type: "BEGIN_TRANSITION", mapId: 1 });
            const g = a.getSnapshot().context.generation;
            a.send({ type: "MAP_DATA_READY", mapId: 1, generation: g });
          },
        },
        {
          reach: "ready",
          drive: (a) => {
            a.send({ type: "BEGIN_TRANSITION", mapId: 1 });
            const g = a.getSnapshot().context.generation;
            a.send({ type: "MAP_DATA_READY", mapId: 1, generation: g });
            a.send({ type: "MAP_ACTORS_READY", mapId: 1, generation: g });
          },
        },
        {
          reach: "failed",
          drive: (a) => {
            a.send({ type: "BEGIN_TRANSITION", mapId: 1 });
            a.send({ type: "TRANSITION_FAILED", reason: "x" });
          },
        },
      ];

      for (const { reach, drive } of states) {
        const actor = startActor();
        drive(actor);
        expect(actor.getSnapshot().value).toBe(reach);

        actor.send({ type: "RESET" });
        const snap = actor.getSnapshot();
        expect(snap.value).toBe("idle");
        expect(snap.context.currentMapId).toBeNull();
        expect(snap.context.pendingMapId).toBeNull();
        expect(snap.context.generation).toBe(0);
        expect(snap.context.direction).toBeNull();
      }
    });

    it("can retry from failed via BEGIN_TRANSITION", () => {
      const actor = startActor();
      actor.send({ type: "BEGIN_TRANSITION", mapId: 1 });
      actor.send({ type: "TRANSITION_FAILED", reason: "x" });
      actor.send({ type: "BEGIN_TRANSITION", mapId: 2 });
      expect(actor.getSnapshot().value).toBe("loadingMap");
    });
  });
});
