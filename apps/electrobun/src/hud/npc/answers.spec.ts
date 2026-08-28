import { describe, expect, it } from "bun:test";

import type { NpcDialogAnswer } from "@/game/stores/npc-dialog-store";
import { visibleAnswers } from "@/hud/npc/answers";

const ANSWERS: NpcDialogAnswer[] = [
  { id: 2013, label: "Demander à devenir pêcheur", disabled: false },
  { id: 2037, label: "Donner les Appats", disabled: true },
];

describe("visibleAnswers", () => {
  it("shows the real answers on the opening question", () => {
    expect(visibleAnswers(ANSWERS, true)).toEqual(ANSWERS);
  });

  it("shows the real answers on a follow-up question", () => {
    expect(visibleAnswers(ANSWERS, false)).toEqual(ANSWERS);
  });

  it("gives a follow-up with nothing to answer a way out", () => {
    const synthesised = visibleAnswers([], false);

    expect(synthesised).toHaveLength(1);
    expect(synthesised[0]?.id).toBe(-1);
    expect(synthesised[0]?.disabled).toBe(false);
    expect(synthesised[0]?.label).toBe("Terminer la discussion.");
  });

  it("leaves a one-line NPC with no button, as 1.29 does", () => {
    // `_bFirstQuestion` gates the synthesised entry: the opening line of an
    // NPC that says one thing and stops is dismissed with the window's cross,
    // not with a button that would make it look like a conversation.
    expect(visibleAnswers([], true)).toEqual([]);
  });
});
