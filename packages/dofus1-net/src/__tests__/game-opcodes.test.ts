import { describe, expect, test } from "bun:test";
import { dispatch } from "../dispatcher";
import { buildOutboundFrame } from "../wire";
import "..";
import { GA, GAOut } from "../messages/game/action";
import type { GJ } from "../messages/game/join";
import type { GP } from "../messages/game/position-start";
import type { GR } from "../messages/game/ready";
import type { GTM } from "../messages/game/turn-middle";
import type { GTS } from "../messages/game/turn-start";
import type { GTR } from "../messages/game/turn-ready";
import type { GTF } from "../messages/game/turn-finish";
import type { GTL } from "../messages/game/turn-list";
import type { GAS } from "../messages/game/actions-start";
import type { GAF } from "../messages/game/actions-finish";

describe("Game flow opcodes", () => {
  test("GS — empty payload", () => {
    const r = dispatch("GS");
    expect(r.opcode).toBe("GS");
    expect(r.payload).toEqual({});
  });

  test("GTS — turn start with passive flag", () => {
    const r = dispatch("GTS42|30000|5|1");
    expect(r.opcode).toBe("GTS");
    expect(r.payload as GTS).toEqual({
      spriteId: "42",
      durationMs: 30000,
      tableTurn: 5,
      passive: true,
    });
  });

  test("GTS — passive omitted defaults to false", () => {
    expect((dispatch("GTS42|30000|5").payload as GTS).passive).toBe(false);
  });

  test("GTF — turn finish", () => {
    expect((dispatch("GTF123").payload as GTF).spriteId).toBe("123");
  });

  test("GTL — turn list (bodyOffset=4 skips opcode + 1 padding char)", () => {
    const r = dispatch("GTLx1|2|3|4");
    expect((r.payload as GTL).spriteIds).toEqual(["1", "2", "3", "4"]);
  });

  test("GTM — turn middle (canonical AraknemuHorizon format)", () => {
    // Canonical layout per AraknemuHorizon `TurnMiddle.java`:
    //   alive: <id>;0;<hp>;<ap>;<mp>;<cell>;<unused>;<hpMax>
    //   dead:  <id>;1
    const r = dispatch("GTMx101;0;200;7;3;55;;250|102;1");
    const p = r.payload as GTM;
    expect(p.updates).toHaveLength(2);
    expect({
      spriteId: p.updates[0]?.spriteId,
      dead: p.updates[0]?.dead,
      hp: p.updates[0]?.hp,
      ap: p.updates[0]?.ap,
      mp: p.updates[0]?.mp,
      cell: p.updates[0]?.cell,
      hpMax: p.updates[0]?.hpMax,
    }).toEqual({
      spriteId: "101",
      dead: false,
      hp: 200,
      ap: 7,
      mp: 3,
      cell: 55,
      hpMax: 250,
    });
    expect(p.updates[1]?.dead).toBe(true);
  });

  test("GTR — turn ready ack", () => {
    expect((dispatch("GTR999").payload as GTR).spriteId).toBe("999");
  });

  test("GP — position start", () => {
    expect(dispatch("GPaXbY|cZdW|0").payload as GP).toEqual({
      team1Cells: "aXbY",
      team2Cells: "cZdW",
      playerTeam: 0,
    });
  });

  test("GR — ready flag concatenated with spriteId (no separator)", () => {
    expect(dispatch("GR1abc").payload as GR).toEqual({
      ready: true,
      spriteId: "abc",
    });
    expect(dispatch("GR0xyz").payload as GR).toEqual({
      ready: false,
      spriteId: "xyz",
    });
  });

  test("GJ — game join with flags", () => {
    const r = dispatch("GJx2|1|0|1|45000|3");
    expect(r.payload as GJ).toEqual({
      state: 2,
      cancelEnabled: true,
      showChallengeMenu: false,
      isSpectator: true,
      durationMs: 45000,
      fightType: 3,
    });
  });

  test("GAS / GAF — action batch markers", () => {
    expect(dispatch("GAS55").payload as GAS).toEqual({ spriteId: "55" });
    expect(dispatch("GAF7|55").payload as GAF).toEqual({
      actionId: 7,
      spriteId: "55",
    });
  });

  test("GA — inbound action frame parses 4 leading fields", () => {
    const p = dispatch("GA42;300;101;5;30;A").payload as GA;
    expect(p.actionId).toBe(42);
    expect(p.actionType).toBe(300);
    expect(p.sourceSpriteId).toBe("101");
    expect(p.args).toEqual(["5", "30", "A"]);
  });

  test("GA — outbound serialize pads actionType to 3 digits", () => {
    const req = new GAOut();
    req.actionType = 9;
    req.args = ["sprite1"];
    expect(buildOutboundFrame(req)).toBe("GA009sprite1");
    req.actionType = 906;
    expect(buildOutboundFrame(req)).toBe("GA906sprite1");
  });
});
