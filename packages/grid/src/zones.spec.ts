import { describe, expect, it } from "bun:test";

import { AreaKind } from "./area.ts";
import { decodeZonePair, decodeZones } from "./zones.ts";

describe("decodeZonePair", () => {
  it.each([
    ["Pa", AreaKind.None, 1],
    ["P_", AreaKind.None, 0],
    ["Ca", AreaKind.Circle, 1],
    ["Cb", AreaKind.Circle, 2],
    ["Cc", AreaKind.Circle, 3],
    ["Ce", AreaKind.Circle, 5],
    ["Cg", AreaKind.Circle, 7],
    ["X_", AreaKind.Cross, 0],
    ["Xc", AreaKind.Cross, 3],
    ["Xe", AreaKind.Cross, 5],
    ["+a", AreaKind.PerpCross, 1],
    ["Tb", AreaKind.PerpCross, 2],
    ["Lc", AreaKind.Line, 3],
    ["Dd", AreaKind.DiagonalLine, 4],
    ["Ob", AreaKind.Ring, 2],
    ["Rc", AreaKind.Square, 3],
    ["Qa", AreaKind.Sector, 1],
  ])("decodes %s", (pair, kind, size) => {
    expect(decodeZonePair(pair)).toEqual({ kind, size });
  });

  it("returns None/0 on malformed input", () => {
    expect(decodeZonePair("")).toEqual({ kind: AreaKind.None, size: 0 });
    expect(decodeZonePair("x")).toEqual({ kind: AreaKind.None, size: 0 });
    expect(decodeZonePair("xyz")).toEqual({ kind: AreaKind.None, size: 0 });
    expect(decodeZonePair("Z9")).toEqual({ kind: AreaKind.None, size: 0 });
  });
});

describe("decodeZones", () => {
  it("splits a string into one decoded zone per effect", () => {
    expect(decodeZones("PaPa", 2)).toEqual([
      { kind: AreaKind.None, size: 1 },
      { kind: AreaKind.None, size: 1 },
    ]);
  });

  it("decodes mixed-shape pairs in order", () => {
    expect(decodeZones("CbX_Pa", 3)).toEqual([
      { kind: AreaKind.Circle, size: 2 },
      { kind: AreaKind.Cross, size: 0 },
      { kind: AreaKind.None, size: 1 },
    ]);
  });

  it("pads with None/0 when zones is shorter than effect count", () => {
    expect(decodeZones("Cb", 3)).toEqual([
      { kind: AreaKind.Circle, size: 2 },
      { kind: AreaKind.None, size: 0 },
      { kind: AreaKind.None, size: 0 },
    ]);
  });

  it("returns empty defaults when zones is missing", () => {
    expect(decodeZones("", 2)).toEqual([
      { kind: AreaKind.None, size: 0 },
      { kind: AreaKind.None, size: 0 },
    ]);
  });
});
