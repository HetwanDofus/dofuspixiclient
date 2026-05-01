import type { LiveMonsterGroup } from "@modules/monsters/map-monster.service";
import { create } from "@bufbuild/protobuf";
import { CharacterColorsSchema, SpriteType } from "@dofus/proto/common_pb";
import {
  MonsterGroupMemberSchema,
  type SpriteMovementEntry,
  SpriteMovementEntry_Operation,
  SpriteMovementEntrySchema,
} from "@dofus/proto/game_pb";

const DEFAULT_COLOR = -1;
const DEFAULT_SCALE = 100;

/**
 * Build the world-map ADD entry for a `LiveMonsterGroup`. Shared between
 * `enter-game` (initial spawn fan-out) and `fight-end` (re-add of
 * still-living groups to the survivor's view after a fight finishes).
 *
 * Mirrors `dofus.datacenter.MonsterGroup` on the canonical client: the
 * leader's gfx + colours drive the in-world sprite, and the per-member
 * roster is shipped through `monsters` so the hover panel can render the
 * full composition without an extra round-trip.
 */
export function monsterGroupToSpriteEntry(
  group: LiveMonsterGroup
): SpriteMovementEntry {
  const leader = group.members[0];
  return create(SpriteMovementEntrySchema, {
    operation: SpriteMovementEntry_Operation.ADD,
    spriteType: SpriteType.MONSTER_GROUP,
    spriteId: String(group.id),
    cellId: group.cellId,
    direction: group.direction,
    gfxId: leader?.gfx ?? 0,
    scaleX: DEFAULT_SCALE,
    scaleY: DEFAULT_SCALE,
    colors: create(CharacterColorsSchema, {
      color1: leader?.color1 ?? DEFAULT_COLOR,
      color2: leader?.color2 ?? DEFAULT_COLOR,
      color3: leader?.color3 ?? DEFAULT_COLOR,
    }),
    monsters: group.members.map((m) =>
      create(MonsterGroupMemberSchema, {
        templateId: m.templateId,
        level: m.level,
        gfxId: m.gfx,
        color1: m.color1,
        color2: m.color2,
        color3: m.color3,
        name: m.name,
      })
    ),
    monsterGroupBonus: group.bonusValue,
  });
}
