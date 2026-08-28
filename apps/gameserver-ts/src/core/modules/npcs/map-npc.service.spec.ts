import { describe, expect, test } from "bun:test";

import { SpriteType } from "@dofus/proto/common_pb";
import { MapNpcService } from "@modules/npcs/map-npc.service";
import { npcToSpriteEntry } from "@modules/npcs/map-npc.sprite-entry";

/** `npc_templates` join `scripted_npcs`, only the columns the service reads. */
function makeRow(over: Record<string, unknown> = {}) {
  return {
    placementId: 42,
    cellId: 350,
    direction: 1,
    templateId: 537,
    name: "Unkouy Nak",
    gfx: 80,
    sex: 0,
    color1: -1,
    color2: -1,
    color3: -1,
    accessories: "",
    scaleX: 100,
    scaleY: 100,
    extraClip: -1,
    ...over,
  };
}

function makeService(
  row: Record<string, unknown>,
  templates: Record<number, { type: number; gfxId: number }> = {}
): MapNpcService {
  const repo = { onMap: async () => [makeRow(row)] };
  const cache = { load: async (id: number) => templates[id] };
  return new MapNpcService(repo as never, cache as never);
}

describe("MapNpcService", () => {
  test("NPC sprite ids are far below every other allocator", async () => {
    // Players are positive, monster groups count down from -1, monster
    // fighters from -1_000_000. An NPC must not be mistaken for any of them.
    const npcs = await makeService({ placementId: 1 }).onMap(7411);

    expect(npcs[0]?.id).toBeLessThan(-1_000_000);
  });

  test("the same placement keeps the same sprite id across lookups", async () => {
    const first = await makeService({ placementId: 7 }).onMap(7411);
    const second = await makeService({ placementId: 7 }).onMap(7411);

    expect(first[0]?.id).toBe(second[0]?.id as number);
  });

  test("accessories decode from hex, keeping the slot ordinal", async () => {
    // Real row for NPC 537: weapon empty, hat 0x1acf, cape 0x1ae6, pet
    // empty, shield 0x1b9d. The empty slots still have to advance the
    // ordinal or the hat would render in the weapon slot.
    const npcs = await makeService(
      { accessories: "0,1acf,1ae6,0,1b9d" },
      {
        6863: { type: 16, gfxId: 72 },
        6886: { type: 17, gfxId: 59 },
        7069: { type: 82, gfxId: 8 },
      }
    ).onMap(7411);

    expect(npcs[0]?.accessories).toEqual([
      { itemType: 16, gfxId: 72, ordinal: 1 },
      { itemType: 17, gfxId: 59, ordinal: 2 },
      { itemType: 82, gfxId: 8, ordinal: 4 },
    ]);
  });

  test("an accessory whose item template is missing is skipped, not faked", async () => {
    const npcs = await makeService({ accessories: "1acf" }, {}).onMap(7411);

    expect(npcs[0]?.accessories).toEqual([]);
  });

  test("a zero scale reads as life size rather than an invisible sprite", async () => {
    const npcs = await makeService({ scaleX: 0, scaleY: 0 }).onMap(7411);

    expect(npcs[0]?.scaleX).toBe(100);
    expect(npcs[0]?.scaleY).toBe(100);
  });
});

describe("npcToSpriteEntry", () => {
  test("ships the template id in npc_id, not the placement's sprite id", async () => {
    const npcs = await makeService({ placementId: 42, templateId: 537 }).onMap(
      7411
    );
    const entry = npcToSpriteEntry(npcs[0] as never);

    expect(entry.spriteType).toBe(SpriteType.NPC);
    expect(entry.npcId).toBe(537);
    expect(entry.spriteId).toBe(String(npcs[0]?.id));
    expect(entry.name).toBe("Unkouy Nak");
    expect(entry.gfxId).toBe(80);
  });
});
