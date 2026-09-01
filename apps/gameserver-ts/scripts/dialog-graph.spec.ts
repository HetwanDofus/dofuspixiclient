import { describe, expect, test } from "bun:test";

import { filterDialogGraph } from "./dialog-graph";

describe("filterDialogGraph", () => {
  test("removes an answer whose 1.39 destination has no 1.29 text", () => {
    const result = filterDialogGraph({
      questions: [
        {
          id: 2342,
          responseIds: [1948, 2000],
          parameters: [],
          cond: "",
          ifFalse: 0,
        },
        {
          id: 9255,
          responseIds: [9655],
          parameters: [],
          cond: "",
          ifFalse: 0,
        },
      ],
      actions: [
        { responseId: 1948, type: 1, args: "9255" },
        { responseId: 2000, type: 1, args: "DV" },
      ],
      questionTexts: { "2342": "Bonjour" },
      responseTexts: { "1948": "Se renseigner", "2000": "Partir" },
    });

    expect(result.questions).toEqual([
      {
        id: 2342,
        responseIds: [2000],
        parameters: [],
        cond: "",
        ifFalse: 0,
      },
    ]);
    expect(result.rejectedQuestions).toBe(1);
    expect(result.rejectedDeadBranches).toBe(1);
  });

  test("keeps a learning effect and clears only its missing follow-ups", () => {
    const result = filterDialogGraph({
      questions: [
        {
          id: 3596,
          responseIds: [10217],
          parameters: [],
          cond: "",
          ifFalse: 0,
        },
      ],
      actions: [{ responseId: 10217, type: 6, args: "26,0,9255,1489" }],
      questionTexts: { "3596": "Que veux-tu apprendre ?" },
      responseTexts: { "10217": "Apprendre le métier d'Alchimiste" },
    });

    expect(result.actions).toEqual([
      { responseId: 10217, type: 6, args: "26,0,0,0" },
    ]);
  });
});
