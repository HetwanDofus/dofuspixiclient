import type { LiveNpc } from "@modules/npcs/map-npc.service";
import { create } from "@bufbuild/protobuf";
import {
  AccessorySchema,
  CharacterColorsSchema,
  SpriteType,
} from "@dofus/proto/common_pb";
import {
  type SpriteMovementEntry,
  SpriteMovementEntry_Operation,
  SpriteMovementEntrySchema,
} from "@dofus/proto/game_pb";

/**
 * World-map ADD entry for a placed NPC — the third sibling of
 * `toSpriteEntry` (players) and `monsterGroupToSpriteEntry` (monster groups).
 *
 * The field set mirrors the canonical `-4` branch of the GM packet
 * (`assets/sources/client-code/dofus/aks/extend/GameIn.as:276-292`):
 * gfx, scale, cell, direction, sex, the three colours, accessories, and the
 * template id — which the client needs to look the NPC's action list up in
 * the `npc` lang bundle. `extra_clip` and `custom_artwork` are read by the
 * canonical client too but have no renderer support here yet, so they are
 * left off rather than shipped and ignored.
 */
export function npcToSpriteEntry(
  npc: LiveNpc,
  operation: SpriteMovementEntry_Operation = SpriteMovementEntry_Operation.ADD
): SpriteMovementEntry {
  return create(SpriteMovementEntrySchema, {
    operation,
    spriteType: SpriteType.NPC,
    spriteId: String(npc.id),
    cellId: npc.cellId,
    direction: npc.direction,
    gfxId: npc.gfx,
    scaleX: npc.scaleX,
    scaleY: npc.scaleY,
    colors: create(CharacterColorsSchema, {
      color1: npc.color1,
      color2: npc.color2,
      color3: npc.color3,
    }),
    accessories: npc.accessories.map((a) =>
      create(AccessorySchema, {
        itemId: a.itemType,
        skinId: a.gfxId,
        ordinal: a.ordinal,
      })
    ),
    name: npc.name,
    sex: npc.sex,
    // The *template* id, not the placement: it is what keys the `npc` lang
    // bundle (`N.d[id].a`) the client reads to build the action bubble.
    npcId: npc.templateId,
  });
}
