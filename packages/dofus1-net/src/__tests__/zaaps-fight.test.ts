import { describe, expect, test } from "bun:test";
import { dispatch } from "../dispatcher";
import "..";
import type { GDM } from "../messages/game/map-data";
import type { GE } from "../messages/game/game-end";
import type { WC } from "../messages/waypoints/create";

describe("Map data + game-end", () => {
  test("GDM parses mapId|dateTime|decryptKey", () => {
    const r = dispatch("GDMx7654|1709000000|theKey");
    expect(r.opcode).toBe("GDM");
    expect(r.payload as GDM).toEqual({
      mapId: "7654",
      dateTime: "1709000000",
      decryptKey: "theKey",
    });
  });

  test("GDK is an empty ack", () => {
    expect(dispatch("GDK").payload).toEqual({});
  });

  test("GE captures raw + pipe-split sections", () => {
    const r = dispatch("GEteam0|fighterRow1|fighterRow2");
    const p = r.payload as GE;
    expect(p.raw).toBe("team0|fighterRow1|fighterRow2");
    expect(p.sections).toEqual(["team0", "fighterRow1", "fighterRow2"]);
  });
});

describe("Waypoints (zaaps)", () => {
  test("WC parses currentMapId + (id;level) rows", () => {
    const r = dispatch("WC100|101;1|102;5|103;3");
    const p = r.payload as WC;
    expect(p.currentMapId).toBe(100);
    expect(p.waypoints).toEqual([
      { id: 101, level: 1 },
      { id: 102, level: 5 },
      { id: 103, level: 3 },
    ]);
  });

  test("WV — empty close signal", () => {
    expect(dispatch("WV").payload).toEqual({});
  });

  test("WU — empty use-error signal", () => {
    expect(dispatch("WU").payload).toEqual({});
  });
});
