import { describe, expect, test } from "bun:test";

import { dispatch } from "../dispatcher";
import "..";
import type { GM, GMSpriteAdd, GMSpriteRemove } from "../messages/game/movement";

// GM wire body offset is 3 — `GM<flag><rows>`. The dispatcher trims
// `bodyOffset` so what the parser sees is `<rows>` (`flag` is the
// post-opcode marker). Test strings here include a `+` placeholder
// for the flag character before the first row.

describe("GM — sprite stream", () => {
  test("parses an empty body to zero rows", () => {
    const r = dispatch("GM+");
    expect(r.opcode).toBe("GM");
    const p = r.payload as GM;
    expect(p.rows).toHaveLength(0);
  });

  test("decodes a player add row (canonical AraknemuHorizon roleplay)", () => {
    // Canonical layout per `PlayerSprite.toString()`:
    //   <cell>;<dir>;0;<id>;<name>;<race>;<gfx>^<size>;<gender>;
    //   ;<c1>;<c2>;<c3>;<accessories>;;;;;;<restrictions>;
    // Colors are lowercase hex.
    const raw =
      "GM*+200;3;0;42;Pippin;0;1234^100x100;0;;ff;80;40;6_123,16_456;;;;;;0;";
    const r = dispatch(raw);
    const p = r.payload as GM;
    expect(p.rows).toHaveLength(1);
    const row = p.rows[0] as GMSpriteAdd;
    expect(row.op).toBe("add");
    expect(row.kind).toBe("player");
    expect(row.spriteId).toBe("42");
    expect(row.name).toBe("Pippin");
    expect(row.cell).toBe(200);
    expect(row.direction).toBe(3);
    expect(row.gfxId).toBe(1234);
    expect(row.scaleX).toBe(100);
    expect(row.scaleY).toBe(100);
    expect(row.color1).toBe(0xff);
    expect(row.color2).toBe(0x80);
    expect(row.color3).toBe(0x40);
    expect(row.accessories).toBe("6_123,16_456");
    expect(row.restrictions).toBe(0);
  });

  test("decodes roleplay player restrictions at tail [18], base-36 (GameIn.as:481, CharactersManager.as:150)", () => {
    // `1s` base-36 = 64 = 0x40 — the "cannot switch into creatures
    // mode" bit (Character.as:175-178).
    const raw =
      "GM*+200;3;0;42;Pippin;0;1234^100x100;0;;ff;80;40;6_123,16_456;;;;;;1s;";
    const row = (dispatch(raw).payload as GM).rows[0] as GMSpriteAdd;
    expect(row.restrictions).toBe(0x40);

    // Fight rows (25+ fields) never carry restrictions → 0.
    const fight =
      "GM*+200;3;0;42;Pippin;0;1234^100x100;0;12;lvl;ff;80;40;6_123;300;6;3;0;0;0;0;0;0;0;1;;0;0;300";
    const fightRow = (dispatch(fight).payload as GM).rows[0] as GMSpriteAdd;
    expect(fightRow.restrictions).toBe(0);
  });

  test("decodes a creature (-1) row with the creature field layout", () => {
    const raw = "GM*+50;1;10;c7;;-1;100;3;-1;-1;-1;";
    const r = dispatch(raw);
    const p = r.payload as GM;
    expect(p.rows).toHaveLength(1);
    const row = p.rows[0] as GMSpriteAdd;
    expect(row.kind).toBe("creature");
    expect(row.spriteId).toBe("c7");
    expect(row.gfxId).toBe(100);
    expect(row.color1).toBe(-1);
    expect(row.color2).toBe(-1);
    expect(row.color3).toBe(-1);
  });

  test("decodes a monster (-2) row", () => {
    const raw = "GM*+75;5;20;m12;Bouftou;-2;100;1;255;255;255;";
    const r = dispatch(raw);
    const p = r.payload as GM;
    const row = p.rows[0] as GMSpriteAdd;
    expect(row.kind).toBe("monster");
    expect(row.gfxId).toBe(100);
    expect(row.bonusValue).toBe(20);
  });

  test("decodes a remove row", () => {
    const r = dispatch("GM*-42");
    const p = r.payload as GM;
    expect(p.rows).toHaveLength(1);
    const row = p.rows[0] as GMSpriteRemove;
    expect(row.op).toBe("remove");
    expect(row.spriteId).toBe("42");
  });

  test("decodes a mixed multi-row frame", () => {
    const raw = "GM*+10;1;0;42;Bob;5;5;0;-1;-1;-1;|-99|~10;2;0;42;Bob;5;5;0;-1;-1;-1;";
    const p = dispatch(raw).payload as GM;
    expect(p.rows).toHaveLength(3);
    expect(p.rows[0]?.op).toBe("add");
    expect(p.rows[1]?.op).toBe("remove");
    expect(p.rows[2]?.op).toBe("replace");
  });

  test("decodes an npc (-4) row — authored palette always (wc3 parity)", () => {
    // Real AraknemuHorizon milicien row (npc_template 334, gfx 1211):
    // sex=[7] c1=[8] c2=[9] c3=[10] acc=[11] extraClip=[12] artwork=[13].
    // Wire colors are deliberately IGNORED for NPCs (wc3 parity — see
    // movement.ts npc branch; canonical GameIn.as:284-287 deviates).
    const raw = "GM*+256;3;0;-22304;334;-4;1211^100x100;0;0;0;828282;0,0,0,0;;0";
    const row = (dispatch(raw).payload as GM).rows[0] as GMSpriteAdd;
    expect(row.kind).toBe("npc");
    expect(row.gfxId).toBe(1211);
    expect(row.color1).toBe(-1);
    expect(row.color2).toBe(-1);
    expect(row.color3).toBe(-1);
    expect(row.accessories).toBe("0,0,0,0");
    // extraClip + customArtwork stay in `rest` for the npc handler.
    expect(row.rest).toBe(";0");
  });

  test("decodes an offlineCharacter (-5) row canonically (GameIn.as case -5)", () => {
    // c1=[7] c2=[8] c3=[9] acc=[10] guild=[11] emblem=[12] type=[13] charId=[14]
    const raw =
      "GM*+88;1;0;o5;Merchant;-5;10^100x100;ff0000;-1;40;16_9;MyGuild;e1;1;123";
    const row = (dispatch(raw).payload as GM).rows[0] as GMSpriteAdd;
    expect(row.kind).toBe("offlineCharacter");
    expect(row.color1).toBe(0xff0000);
    expect(row.color2).toBe(-1);
    expect(row.color3).toBe(0x40);
    expect(row.accessories).toBe("16_9");
    expect(row.rest).toBe("MyGuild;e1;1;123");
  });

  test("strips `*` flags and `^scale` from gfx", () => {
    const raw = "GM*+10;1;0;42;Bob;5;*5678^80x90*;0;-1;-1;-1;";
    const row = (dispatch(raw).payload as GM).rows[0] as GMSpriteAdd;
    expect(row.gfxId).toBe(5678);
    expect(row.scaleX).toBe(80);
    expect(row.scaleY).toBe(90);
    expect(row.defaultRig).toBe(false); // leading `*`
    expect(row.noFlip).toBe(true); // trailing `*`
  });

  test("`^scale` uses canonical Number() pass-through (GameIn.as:152-166)", () => {
    // No clamp — large uniform values pass through untouched.
    const high = "GM*+10;1;0;42;Bob;5;5678^2000;0;-1;-1;-1;";
    const rowHigh = (dispatch(high).payload as GM).rows[0] as GMSpriteAdd;
    expect(rowHigh.scaleX).toBe(2000);
    expect(rowHigh.scaleY).toBe(2000);

    // Fractional uniform scale (AS2 Number(), not parseInt).
    const frac = "GM*+10;1;0;42;Bob;5;5678^87.5;0;-1;-1;-1;";
    const rowFrac = (dispatch(frac).payload as GM).rows[0] as GMSpriteAdd;
    expect(rowFrac.scaleX).toBe(87.5);
    expect(rowFrac.scaleY).toBe(87.5);

    // Per-axis passes each value through unclamped. (An axis value of
    // literal `0` before the `x` is untestable in the two-axis form:
    // `Number("0x…")` parses as a HEX literal in AS2 and JS alike, so
    // canonical treats `^0x5000` as the UNIFORM form.)
    const mixed = "GM*+10;1;0;42;Bob;5;5678^50x5000;0;-1;-1;-1;";
    const rowMixed = (dispatch(mixed).payload as GM).rows[0] as GMSpriteAdd;
    expect(rowMixed.scaleX).toBe(50);
    expect(rowMixed.scaleY).toBe(5000);

    // Uniform zero passes through (canonical `_xscale = 0` → invisible).
    const zero = "GM*+10;1;0;42;Bob;5;5678^0;0;-1;-1;-1;";
    const rowZero = (dispatch(zero).payload as GM).rows[0] as GMSpriteAdd;
    expect(rowZero.scaleX).toBe(0);
    expect(rowZero.scaleY).toBe(0);

    // Garbage → NaN → the 100 default (never-applied scale).
    const junk = "GM*+10;1;0;42;Bob;5;5678^abc;0;-1;-1;-1;";
    const rowJunk = (dispatch(junk).payload as GM).rows[0] as GMSpriteAdd;
    expect(rowJunk.scaleX).toBe(100);
    expect(rowJunk.scaleY).toBe(100);

    // NaN axis in the two-axis form → that axis defaults to 100.
    const nanAxis = "GM*+10;1;0;42;Bob;5;5678^140xabc;0;-1;-1;-1;";
    const rowNan = (dispatch(nanAxis).payload as GM).rows[0] as GMSpriteAdd;
    expect(rowNan.scaleX).toBe(140);
    expect(rowNan.scaleY).toBe(100);

    // Plain in-range value passes through.
    const ok = "GM*+10;1;0;42;Bob;5;5678^140;0;-1;-1;-1;";
    const rowOk = (dispatch(ok).payload as GM).rows[0] as GMSpriteAdd;
    expect(rowOk.scaleX).toBe(140);
    expect(rowOk.scaleY).toBe(140);
  });
});
