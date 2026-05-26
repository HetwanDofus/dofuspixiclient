import { describe, expect, test } from "bun:test";
import { dispatch } from "../dispatcher";
import "..";
import type { GDA } from "../messages/game/adjacent-maps-data";
import type { GE } from "../messages/game/game-end";
import type { WC } from "../messages/waypoints/create";

describe("Map data + game-end", () => {
  test("GDA parses current segment; absent neighbours are null", () => {
    const r = dispatch("GDA|7654;1709000000;theKey|;;|;;|;;");
    expect(r.opcode).toBe("GDA");
    const segs = (r.payload as GDA).segments();
    expect(segs.current).toEqual({
      mapId: "7654",
      dateTime: "1709000000",
      decryptKey: "theKey",
    });
    expect(segs.left).toBeNull();
    expect(segs.right).toBeNull();
    expect(segs.bottom).toBeNull();
  });

  test("GDA with all four maps present", () => {
    const r = dispatch(
      "GDA|100;d0;k0|101;d1;k1|102;d2;k2|103;d3;k3"
    );
    const segs = (r.payload as GDA).segments();
    expect(segs.current.mapId).toBe("100");
    expect(segs.left).toEqual({ mapId: "101", dateTime: "d1", decryptKey: "k1" });
    expect(segs.right).toEqual({ mapId: "102", dateTime: "d2", decryptKey: "k2" });
    expect(segs.bottom).toEqual({ mapId: "103", dateTime: "d3", decryptKey: "k3" });
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
