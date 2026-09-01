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
    // Following this would open the bank and silently skip the quest.
    // A greyed answer is the lesser wrong.
    expect(
      classify([
        { type: -1, args: "" },
        { type: 40, args: "26" },
      ])
    ).toEqual({ kind: "blocked" });
  });

  it("teaches a job, and carries both branches of the outcome", () => {
    // `(280, 6, '2,898,335,1489')` — "Apprendre le métier de Bûcheron".
    expect(classify([{ type: 6, args: "2,898,335,1489" }])).toEqual({
      kind: "learn-job",
      jobId: 2,
      onSuccess: 335,
      onFailure: 1489,
    });
  });

  it("a job answer wins over the navigate row it travels with", () => {
    // `(2008, …)` carries both, and the twelve rows that do disagree about
    // which of the two question ids the navigate points at — so neither is
    // trusted and the pair in `args` decides.
    expect(
      classify([
        { type: 1, args: "2387" },
        { type: 6, args: "16,7544,335,336" },
      ])
    ).toEqual({
      kind: "learn-job",
      jobId: 16,
      onSuccess: 335,
      onFailure: 336,
    });
  });

  it("an empty type-0 row is a placeholder, not an unimplemented effect", () => {
    // `(1129, 0, '')` sits beside the Pêcheur's own job action; treating it
    // as an effect would grey the only way to learn the job.
    expect(
      classify([
        { type: 6, args: "36,7365,1487,1488" },
        { type: 0, args: "" },
      ])
    ).toEqual({
      kind: "learn-job",
      jobId: 36,
      onSuccess: 1487,
      onFailure: 1488,
    });
  });

  it("but a type-0 row with arguments is a teleport, and stays blocked", () => {
    expect(classify([{ type: 0, args: "1669,384" }])).toEqual({
      kind: "blocked",
    });
  });

  it("a job action with an unusable job id is refused rather than guessed", () => {
    expect(classify([{ type: 6, args: "" }])).toEqual({ kind: "blocked" });
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
