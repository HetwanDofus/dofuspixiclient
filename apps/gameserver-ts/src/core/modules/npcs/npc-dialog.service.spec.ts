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

  it("follows the banker's answer: an implemented effect plus its navigate", () => {
    // The dump's answer 259, verbatim: a navigate to DV and the lone
    // `type = -1` row named "Consulter son coffre personnel". Under the
    // old "navigation and nothing else" rule this came out `blocked`,
    // which is exactly what greyed the bank out in game.
    expect(
      classify([
        { type: 1, args: "DV" },
        { type: -1, args: "" },
      ])
    ).toEqual({ kind: "open-bank" });
  });

  it("order of the two rows does not matter", () => {
    expect(
      classify([
        { type: -1, args: "" },
        { type: 1, args: "DV" },
      ])
    ).toEqual({ kind: "open-bank" });
  });

  it("an implemented effect alongside an unimplemented one stays blocked", () => {
    // Following this would open the bank and silently skip the other
    // effect. A greyed answer is the lesser wrong.
    expect(
      classify([
        { type: -1, args: "" },
        { type: 6, args: "11,1066,335,336" },
      ])
    ).toEqual({ kind: "blocked" });
  });

  it("two navigate rows are still refused", () => {
    expect(
      classify([
        { type: 1, args: "410" },
        { type: 1, args: "411" },
      ])
    ).toEqual({ kind: "blocked" });
  });
});
