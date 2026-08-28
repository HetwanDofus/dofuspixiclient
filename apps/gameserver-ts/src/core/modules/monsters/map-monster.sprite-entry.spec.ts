import { describe, expect, test } from "bun:test";

import type { LiveMonsterGroup } from "@modules/monsters/map-monster.service";
import { monsterGroupToSpriteEntry } from "@modules/monsters/map-monster.sprite-entry";

function member(over: Partial<LiveMonsterGroup["members"][number]>) {
  return {
    templateId: 491,
    level: 1,
    name: "Piou Bleu",
    gfx: 1212,
    life: 20,
    ap: 6,
    mp: 3,
    color1: -1,
    color2: -1,
    color3: -1,
    spells: [],
    xp: 0,
    kamasMin: 0,
    kamasMax: 0,
    ...over,
  };
}

describe("monsterGroupToSpriteEntry", () => {
  test("carries every member, with its own gfx and colours", () => {
    // The six pious are one drawing under different palettes, so a member's
    // colour triple is the only thing that distinguishes it on screen.
    const group: LiveMonsterGroup = {
      id: -1,
      mapId: 7365,
      cellId: 100,
      direction: 1,
      bonusValue: 0,
      members: [
        member({
          templateId: 493,
          name: "Piou Jaune",
          gfx: 9202,
          color1: 0xf2c40c,
          color2: 0xbda64d,
        }),
        member({
          templateId: 490,
          name: "Piou Vert",
          gfx: 9205,
          color1: 0x448051,
          color2: 0xf9f9a5,
        }),
        member({ templateId: 491, name: "Piou Bleu", gfx: 1212 }),
      ],
    };

    const entry = monsterGroupToSpriteEntry(group);

    expect(entry.monsters).toHaveLength(3);
    expect(entry.monsters.map((m) => m.gfxId)).toEqual([9202, 9205, 1212]);
    expect(entry.monsters.map((m) => m.color1)).toEqual([
      0xf2c40c, 0x448051, -1,
    ]);
  });

  test("the group's own sprite is the first member's", () => {
    // `buildMembers` sorts by descending level, so member 0 is the highest
    // level — the same monster the hover panel lists first.
    const group: LiveMonsterGroup = {
      id: -1,
      mapId: 7365,
      cellId: 100,
      direction: 1,
      bonusValue: 0,
      members: [
        member({ level: 5, gfx: 9202, color1: 0xf2c40c }),
        member({ level: 1, gfx: 1212 }),
      ],
    };

    const entry = monsterGroupToSpriteEntry(group);

    expect(entry.gfxId).toBe(9202);
    expect(entry.colors?.color1).toBe(0xf2c40c);
  });
});
