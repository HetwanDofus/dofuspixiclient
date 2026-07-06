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

  test("decodes an npc (-4) row canonically (GameIn.as case -4)", () => {
    // Real AraknemuHorizon milicien row (npc_template 334, gfx 1211):
    // sex=[7] c1=[8] c2=[9] c3=[10] acc=[11] extraClip=[12] artwork=[13].
    // Colors are hex; `0` is a REAL colour (flat black) — canonical
    // applyColor skips only undefined/-1.
    const raw = "GM*+256;3;0;-22304;334;-4;1211^100x100;0;0;0;828282;0,0,0,0;;0";
    const row = (dispatch(raw).payload as GM).rows[0] as GMSpriteAdd;
    expect(row.kind).toBe("npc");
    expect(row.gfxId).toBe(1211);
    expect(row.color1).toBe(0);
    expect(row.color2).toBe(0);
    expect(row.color3).toBe(0x828282);
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
});
