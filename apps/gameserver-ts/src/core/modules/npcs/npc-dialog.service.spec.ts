import { describe, expect, it } from "bun:test";

import { classify } from "@modules/npcs/npc-dialog.service";

/**
 * The rows are real ones from StarLoco's `npc_reponses_actions`, so a change
 * in the classification rule shows up here against actual dialog data rather
 * than against invented shapes.
 */
describe("classify", () => {
  it("follows a navigate action that names a question", () => {
    // Kana Petch, answer 2013 -> "Demander à devenir pêcheur".
    expect(classify([{ type: 1, args: "2394" }])).toEqual({
      kind: "branch",
      nextQuestion: 2394,
    });
  });

  it("ends on the literal DV, which is 4046 of the 4904 navigate rows", () => {
    // Unkouy Nak, answer 191 -> "Demander son chemin".
    expect(classify([{ type: 1, args: "DV" }])).toEqual({ kind: "end" });
  });

  it("ends when the answer has no action row at all", () => {
    expect(classify([])).toEqual({ kind: "end" });
  });

  it("ends on a navigate row that points nowhere", () => {
    // `-1` and empty both occur; neither names a question to go to.
    expect(classify([{ type: 1, args: "-1" }])).toEqual({ kind: "end" });
    expect(classify([{ type: 1, args: "" }])).toEqual({ kind: "end" });
  });

  it("blocks an effect action", () => {
    // Kana Petch, answer 2037 -> "Donner les Appats".
    expect(classify([{ type: 988, args: "1171" }])).toEqual({
      kind: "blocked",
    });
  });

  it("blocks an answer that navigates AND does something else", () => {
    // The case the strict rule exists for: following the branch would run
    // the conversation on while silently skipping the quest start.
    expect(
      classify([
        { type: 1, args: "2394" },
        { type: 40, args: "26" },
      ])
    ).toEqual({ kind: "blocked" });
  });
});
