import { describe, expect, it } from "bun:test";

import { createActor } from "xstate";

import { loginMachine } from "./login.machine";

function startActor() {
  const actor = createActor(loginMachine);
  actor.start();
  return actor;
}

const CHARACTERS = [
  { id: 1, name: "Alice", level: 10, class: 1 },
  { id: 2, name: "Bob", level: 50, class: 2 },
];

describe("loginMachine", () => {
  describe("happy path", () => {
    it("runs idle → authenticating → characterSelect → loadingCharacter → inGame", () => {
      const actor = startActor();
      expect(actor.getSnapshot().value).toBe("idle");

      actor.send({ type: "START_LOGIN", username: "u", password: "p" });
      expect(actor.getSnapshot().value).toBe("authenticating");

      actor.send({ type: "AUTH_SUCCESS", characters: CHARACTERS });
      const afterAuth = actor.getSnapshot();
      expect(afterAuth.value).toBe("characterSelect");
      expect(afterAuth.context.accountCharacters).toHaveLength(2);
      expect(afterAuth.context.failureReason).toBeNull();

      actor.send({ type: "SELECT_CHARACTER", characterId: 2 });
      const afterSelect = actor.getSnapshot();
      expect(afterSelect.value).toBe("loadingCharacter");
      expect(afterSelect.context.selectedCharacterId).toBe(2);

      actor.send({ type: "CHARACTER_LOADED" });
      expect(actor.getSnapshot().value).toBe("inGame");
    });
  });

  describe("auth failure", () => {
    it("transitions to failed and records the reason", () => {
      const actor = startActor();
      actor.send({ type: "START_LOGIN", username: "u", password: "bad" });
      actor.send({ type: "AUTH_FAILURE", reason: "invalid password" });

      const snap = actor.getSnapshot();
      expect(snap.value).toBe("failed");
      expect(snap.context.failureReason).toBe("invalid password");
    });

    it("allows retry from failed via START_LOGIN", () => {
      const actor = startActor();
      actor.send({ type: "START_LOGIN", username: "u", password: "p" });
      actor.send({ type: "AUTH_FAILURE", reason: "x" });
      actor.send({ type: "START_LOGIN", username: "u", password: "p" });
      expect(actor.getSnapshot().value).toBe("authenticating");
    });
  });

  describe("LOGOUT", () => {
    it("resets context from any post-auth state", () => {
      const states = ["characterSelect", "loadingCharacter", "inGame"] as const;

      for (const reachState of states) {
        const actor = startActor();
        actor.send({ type: "START_LOGIN", username: "u", password: "p" });
        actor.send({ type: "AUTH_SUCCESS", characters: CHARACTERS });

        if (reachState !== "characterSelect") {
          actor.send({ type: "SELECT_CHARACTER", characterId: 1 });
        }

        if (reachState === "inGame") {
          actor.send({ type: "CHARACTER_LOADED" });
        }

        expect(actor.getSnapshot().value).toBe(reachState);

        actor.send({ type: "LOGOUT" });
        const snap = actor.getSnapshot();
        expect(snap.value).toBe("idle");
        expect(snap.context.accountCharacters).toEqual([]);
        expect(snap.context.selectedCharacterId).toBeNull();
        expect(snap.context.failureReason).toBeNull();
      }
    });

    it("resets from failed state", () => {
      const actor = startActor();
      actor.send({ type: "START_LOGIN", username: "u", password: "p" });
      actor.send({ type: "AUTH_FAILURE", reason: "x" });
      actor.send({ type: "LOGOUT" });
      expect(actor.getSnapshot().value).toBe("idle");
      expect(actor.getSnapshot().context.failureReason).toBeNull();
    });
  });

  describe("invalid events", () => {
    it("ignores AUTH_SUCCESS from idle (no transition)", () => {
      const actor = startActor();
      actor.send({ type: "AUTH_SUCCESS", characters: CHARACTERS });
      const snap = actor.getSnapshot();
      expect(snap.value).toBe("idle");
      expect(snap.context.accountCharacters).toEqual([]);
    });

    it("ignores SELECT_CHARACTER from authenticating", () => {
      const actor = startActor();
      actor.send({ type: "START_LOGIN", username: "u", password: "p" });
      actor.send({ type: "SELECT_CHARACTER", characterId: 1 });
      expect(actor.getSnapshot().value).toBe("authenticating");
      expect(actor.getSnapshot().context.selectedCharacterId).toBeNull();
    });
  });
});
