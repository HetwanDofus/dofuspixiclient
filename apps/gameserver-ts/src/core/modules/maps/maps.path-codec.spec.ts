import { describe, expect, test } from "bun:test";

import {
  decodeCell,
  decodePath,
  decodePathDecimal,
  decodePathParams,
  MalformedPathError,
} from "@modules/maps/maps.path-codec";

describe("decodePath (hash encoding)", () => {
  test("decodes an empty path to zero steps", () => {
    expect(decodePath("")).toEqual([]);
  });

  test("rejects payload whose length is not a multiple of 3", () => {
    expect(() => decodePath("ab")).toThrow(MalformedPathError);
  });

  test("decodeCell inverts the 12-bit (hi, lo) encoding", () => {
    expect(decodeCell("bb")).toBe(65);
    expect(decodeCell("aa")).toBe(0);
  });

  test("decodes a single step: direction 3 + cell 319", () => {
    const steps = decodePath("de_");

    expect(steps).toEqual([{ direction: 3, cell: 319 }]);
  });

  test("decodes multiple steps", () => {
    const steps = decodePath(`aaa${"bab"}${"ha_"}`);

    expect(steps).toEqual([
      { direction: 0, cell: 0 },
      { direction: 1, cell: 1 },
      { direction: 7, cell: 63 },
    ]);
  });

  test("rejects directions above 7", () => {
    expect(() => decodePath("iaa")).toThrow(MalformedPathError);
  });
});

describe("decodePathDecimal (cell-list encoding)", () => {
  test("derives direction 0 (E) from +1 deltas on a width-10 map", () => {
    const steps = decodePathDecimal("319,320,321", 10);

    expect(steps).toEqual([
      { direction: 0, cell: 320 },
      { direction: 0, cell: 321 },
    ]);
  });

  test("derives direction 2 (S) from +stride delta on a width-10 map", () => {
    // stride = 2*10 - 1 = 19. Going from cell 0 to cell 19 = SOUTH.
    const steps = decodePathDecimal("0,19", 10);

    expect(steps).toEqual([{ direction: 2, cell: 19 }]);
  });

  test("rejects non-adjacent jumps", () => {
    expect(() => decodePathDecimal("0,50", 10)).toThrow(/not adjacent/);
  });

  test("returns empty for lone start cell", () => {
    expect(decodePathDecimal("42", 10)).toEqual([]);
  });

  test("rejects non-numeric cells", () => {
    expect(() => decodePathDecimal("10,abc", 10)).toThrow(/non-numeric/);
  });
});

describe("decodePathParams dispatch", () => {
  test("picks the decimal decoder on comma-separated input", () => {
    const steps = decodePathParams("319,320", 10);

    expect(steps).toEqual([{ direction: 0, cell: 320 }]);
  });

  test("picks the hash decoder on alphabet-only input", () => {
    const steps = decodePathParams("de_", 10);

    expect(steps).toEqual([{ direction: 3, cell: 319 }]);
  });
});
