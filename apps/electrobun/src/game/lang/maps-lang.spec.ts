import { beforeEach, describe, expect, it } from "bun:test";

import {
  getMapLangCoords,
  getMapNames,
  loadMapsLang,
  parseMapsBundle,
} from "./maps-lang";

// A cut-down `maps.json`: one map on subarea 95, one subarea per area, and
// an area name — the exact shape `MA` ships in the published bundle.
const BUNDLE = {
  data: {
    MA: {
      m: {
        "7365": { x: 1, y: -17, sa: 95, ep: 1 },
        "9000": { x: 4, y: 4, sa: 999 },
      },
      sa: {
        "95": { n: "Pitons rocheux", a: 45, tt: "exterieur" },
        "48": { n: "Quartier des Bûcherons", a: 7 },
      },
      a: {
        "45": { n: "Incarnam" },
        "7": { n: "Bonta" },
      },
    },
  },
};

beforeEach(async () => {
  // Prime the module-level latch with the fixture instead of a real fetch.
  globalThis.fetch = (() =>
    Promise.resolve({
      json: () => Promise.resolve(BUNDLE),
    })) as unknown as typeof fetch;
  await loadMapsLang();
});

describe("parseMapsBundle", () => {
  it("indexes maps, subareas and area names", () => {
    const data = parseMapsBundle(BUNDLE);
    expect(data.maps.get(7365)).toEqual({ x: 1, y: -17, subareaId: 95 });
    expect(data.subareas.get(95)?.name).toBe("Pitons rocheux");
    expect(data.subareas.get(95)?.themeName).toBe("exterieur");
    expect(data.areaNames.get(45)).toBe("Incarnam");
  });

  it("latches empty on a bundle with no MA table", () => {
    const data = parseMapsBundle({ data: {} });
    expect(data.maps.size).toBe(0);
    expect(data.subareas.size).toBe(0);
  });
});

describe("getMapNames", () => {
  it("names the area and the subarea of a known map", () => {
    expect(getMapNames(7365)).toEqual({
      areaName: "Incarnam",
      subareaName: "Pitons rocheux",
    });
  });

  it("prefers the server subarea over the bundle's own", () => {
    expect(getMapNames(7365, 48)).toEqual({
      areaName: "Bonta",
      subareaName: "Quartier des Bûcherons",
    });
  });

  it("returns null for an unknown map", () => {
    expect(getMapNames(123456)).toBeNull();
  });

  it("returns null when the subarea has no lang row", () => {
    expect(getMapNames(9000)).toBeNull();
  });
});

describe("getMapLangCoords", () => {
  it("reads the map's world coordinates", () => {
    expect(getMapLangCoords(7365)).toEqual({ x: 1, y: -17 });
  });

  it("returns null for an unknown map", () => {
    expect(getMapLangCoords(123456)).toBeNull();
  });
});
