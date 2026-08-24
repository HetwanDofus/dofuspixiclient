import { describe, expect, test } from "bun:test";

import { formatCriteria } from "./item-conditions";

describe("formatCriteria", () => {
  test("an empty expression has no clauses", () => {
    expect(formatCriteria("")).toEqual([]);
  });

  test("a single threshold, from a real weapon (CS>4)", () => {
    expect(formatCriteria("CS>4")).toEqual(["Force > 4"]);
  });

  test("a chain of thresholds, from a real weapon (CS>42&CI>6)", () => {
    expect(formatCriteria("CS>42&CI>6")).toEqual([
      "Force > 42",
      "Intelligence > 6",
    ]);
  });

  test("sex renders as Homme/Femme, from real wedding hats", () => {
    expect(formatCriteria("PS=0")).toEqual(["Sexe = Homme"]);
    expect(formatCriteria("PS=1")).toEqual(["Sexe = Femme"]);
  });

  test("level thresholds, from real consumables", () => {
    expect(formatCriteria("PL<16")).toEqual(["Niveau < 16"]);
  });

  test("not-equal renders as ≠", () => {
    expect(formatCriteria("PL!10")).toEqual(["Niveau ≠ 10"]);
  });

  test("a code the server does not enforce falls back to its raw form", () => {
    expect(formatCriteria("PB=86")).toEqual(["PB=86"]);
  });
});
