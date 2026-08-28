import { describe, expect, it } from "bun:test";

import type { DialogLangData } from "@/game/lang/dialog-lang";
import { buildAnswers } from "@/game/network/handlers/npc-dialog.handler";

// Snori Nairb's opening question, verbatim from the dump: answer 6023 has
// bundle text and a `type 1 / args DV` action, answer 23016 has neither — it
// is a dangling id.
const LANG: DialogLangData = {
  questions: new Map(),
  responses: new Map([
    [6023, "Demander comment redevenir Neutre."],
    [2037, "Donner les Appats"],
    [9999, "   "],
  ]),
  continueLabel: "Terminer la discussion.",
};

describe("buildAnswers", () => {
  it("keeps the server's order, which is the dump's display order", () => {
    expect(buildAnswers(LANG, [2037, 6023], []).map((a) => a.id)).toEqual([
      2037, 6023,
    ]);
  });

  it("greys an answer the server flagged unavailable but still lists it", () => {
    // The player must be able to see that the branch exists.
    const [answer] = buildAnswers(LANG, [2037], [2037]);
    expect(answer?.disabled).toBe(true);
    expect(answer?.label).toBe("Donner les Appats");
  });

  it("drops an answer with no bundle text rather than greying it", () => {
    // 23016 is unreadable: greying it would offer a choice nobody can make.
    expect(buildAnswers(LANG, [6023, 23016], [])).toHaveLength(1);
  });

  it("treats whitespace-only text as no text", () => {
    expect(buildAnswers(LANG, [9999], [])).toEqual([]);
  });
});
