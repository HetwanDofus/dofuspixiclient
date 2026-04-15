import { describe, expect, it } from "bun:test";

import { accessoriesEqual, parseLook } from "./look-parser";

describe("parseLook", () => {
  it("returns zeroed defaults for empty / undefined input", () => {
    for (const input of [undefined, ""]) {
      expect(parseLook(input)).toEqual({
        gfxId: 0,
        color1: -1,
        color2: -1,
        color3: -1,
        accessories: [],
      });
    }
  });

  it("parses gfx + 3 colors", () => {
    const look = parseLook("1234|100|200|300");
    expect(look.gfxId).toBe(1234);
    expect(look.color1).toBe(100);
    expect(look.color2).toBe(200);
    expect(look.color3).toBe(300);
    expect(look.accessories).toEqual([]);
  });

  it("leaves missing color slots as -1", () => {
    const look = parseLook("10");
    expect(look.gfxId).toBe(10);
    expect(look.color1).toBe(-1);
    expect(look.color2).toBe(-1);
    expect(look.color3).toBe(-1);
  });

  it("parses accessory list with type_gfx pairs", () => {
    const look = parseLook("10|0|0|0|6_42,16_7,,,");
    expect(look.accessories).toHaveLength(5);
    expect(look.accessories[0]).toEqual({ type: 6, gfxId: 42 });
    expect(look.accessories[1]).toEqual({ type: 16, gfxId: 7 });
    // Empty slots become zeroed entries
    expect(look.accessories[2]).toEqual({ type: 0, gfxId: 0 });
  });

  it("defaults gfxId and accessory numbers to 0 when non-numeric", () => {
    // Note: colors use `parseInt` directly (no ||0 fallback), so non-numeric
    // colors become NaN. This asserts actual behavior, not ideal behavior.
    const look = parseLook("abc|xyz|foo|bar|nope_nan");
    expect(look.gfxId).toBe(0);
    expect(Number.isNaN(look.color1)).toBe(true);
    expect(look.accessories[0]).toEqual({ type: 0, gfxId: 0 });
  });
});

describe("accessoriesEqual", () => {
  it("returns true for identical arrays", () => {
    const a = [
      { type: 6, gfxId: 42 },
      { type: 16, gfxId: 7 },
    ];
    const b = [
      { type: 6, gfxId: 42 },
      { type: 16, gfxId: 7 },
    ];
    expect(accessoriesEqual(a, b)).toBe(true);
  });

  it("returns false for different lengths", () => {
    expect(accessoriesEqual([{ type: 1, gfxId: 1 }], [])).toBe(false);
  });

  it("returns false when any entry differs", () => {
    const a = [{ type: 6, gfxId: 42 }];
    const b = [{ type: 6, gfxId: 43 }];
    expect(accessoriesEqual(a, b)).toBe(false);
  });

  it("returns true for two empty arrays", () => {
    expect(accessoriesEqual([], [])).toBe(true);
  });
});
