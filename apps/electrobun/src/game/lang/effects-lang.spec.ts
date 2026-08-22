import { describe, expect, it } from "bun:test";

import { decodeEffectPattern } from "./effects-lang";

/**
 * The pattern language is Ankama's; these cases are the four shapes that
 * actually occur across the 407 entries of `effects.json` (fr-1254), with
 * the values a real spell level supplies.
 */
describe("decodeEffectPattern", () => {
  const DAMAGE = "Dommages : #1{~1~2 à }#2 (terre)";

  it("renders a range when both bounds are present", () => {
    // Ronce level 6 — 1d8+10 earth damage.
    expect(decodeEffectPattern(DAMAGE, [11, 18, null, null])).toBe(
      "Dommages : 11 à 18 (terre)"
    );
  });

  it("collapses to a single number when the upper bound is absent", () => {
    // Its critical effect is a fixed 22, so the `à` block drops out and
    // `#2` renders empty rather than repeating the value.
    expect(decodeEffectPattern(DAMAGE, [22, null, null, null])).toBe(
      "Dommages : 22 (terre)"
    );
  });

  it("keeps a single-tilde block only when its value is present", () => {
    const xp = "Gain d'XP : équivalent du niveau 1 à #1{~2 (+#2%)}";
    expect(decodeEffectPattern(xp, [50, 10, null, null])).toBe(
      "Gain d'XP : équivalent du niveau 1 à 50 (+10%)"
    );
    expect(decodeEffectPattern(xp, [50, null, null, null])).toBe(
      "Gain d'XP : équivalent du niveau 1 à 50"
    );
  });

  it("handles a pattern with two independent ranges", () => {
    const finalDamage =
      "Domm. finaux infligés +#1{~1~3 à }#3%, reçus +#2{~2~4 à }#4%";
    expect(decodeEffectPattern(finalDamage, [10, 5, 20, 15])).toBe(
      "Domm. finaux infligés +10 à 20%, reçus +5 à 15%"
    );
  });

  it("leaves a value slot empty rather than printing null", () => {
    expect(decodeEffectPattern("Vole #1 PM", [null, null, null, null])).toBe(
      "Vole  PM"
    );
  });
});
