import { describe, expect, test } from "bun:test";

import { wireColorsToZones } from "./color-zone";

// Mirrors wc3's `color_zone.rs` tests (canonical
// `GlobalSpriteHandler.getColorIndex`, GlobalSpriteHandler.as:75-309).
describe("wireColorsToZones", () => {
  test("group A (Feca/Osa-f 10/11) — head→3, body→1, bottom→2", () => {
    // zones[perm[slot]-1] = wire[slot]
    expect(wireColorsToZones(10, [0xaa, 0xbb, 0xcc])).toEqual([
      0xbb, 0xcc, 0xaa,
    ]);
    expect(wireColorsToZones(11, [0xaa, 0xbb, 0xcc])).toEqual([
      0xbb, 0xcc, 0xaa,
    ]);
    expect(wireColorsToZones(9224, [0xaa, 0xbb, 0xcc])).toEqual([
      0xbb, 0xcc, 0xaa,
    ]);
  });

  test("group B (Iop 80) — head→2, body→3, bottom→1", () => {
    expect(wireColorsToZones(80, [0xaa, 0xbb, 0xcc])).toEqual([
      0xcc, 0xaa, 0xbb,
    ]);
  });

  test("group C (Cra 90/91) is identity", () => {
    expect(wireColorsToZones(90, [0xaa, 0xbb, 0xcc])).toEqual([
      0xaa, 0xbb, 0xcc,
    ]);
    expect(wireColorsToZones(91, [0xaa, 0xbb, 0xcc])).toEqual([
      0xaa, 0xbb, 0xcc,
    ]);
  });

  test("group D (Pandawa 120) — head→1, body→3, bottom→2", () => {
    expect(wireColorsToZones(120, [0xaa, 0xbb, 0xcc])).toEqual([
      0xaa, 0xcc, 0xbb,
    ]);
  });

  test("9235 hits group D first (canonical AS2 first-match-wins)", () => {
    expect(wireColorsToZones(9235, [0xaa, 0xbb, 0xcc])).toEqual([
      0xaa, 0xcc, 0xbb,
    ]);
  });

  test("unknown gfx falls back to identity (wc3 deviation, keeps wire-coloured monsters tinted)", () => {
    expect(wireColorsToZones(99999, [0xaa, 0xbb, 0xcc])).toEqual([
      0xaa, 0xbb, 0xcc,
    ]);
    expect(wireColorsToZones(1211, [0, 0, 0x828282])).toEqual([
      0, 0, 0x828282,
    ]);
  });

  test("-1 unset sentinel travels through the permutation", () => {
    // Tesst: gfx 11, wire (0, 0xfa952f, 0x406f96) → dress(z1)=0xfa952f,
    // boots(z2)=0x406f96, hair(z3)=black.
    expect(wireColorsToZones(11, [0, 0xfa952f, 0x406f96])).toEqual([
      0xfa952f, 0x406f96, 0,
    ]);
    expect(wireColorsToZones(11, [-1, -1, -1])).toEqual([-1, -1, -1]);
  });
});
