import type { PlayerPresenceEntry } from "@modules/player-presence/player-presence.service";
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

const DEFAULT_SCALE = 100;

export function toSpriteEntry(
  player: PlayerPresenceEntry,
  operation: SpriteMovementEntry_Operation
): SpriteMovementEntry {
  return create(SpriteMovementEntrySchema, {
    operation,
    spriteType: SpriteType.CHARACTER,
    spriteId: player.characterId,
    cellId: player.cellId,
    direction: player.direction,
    gfxId: player.gfx,
    scaleX: DEFAULT_SCALE,
    scaleY: DEFAULT_SCALE,
    colors: create(CharacterColorsSchema, {
      color1: player.color1,
      color2: player.color2,
      color3: player.color3,
    }),
    accessories: player.accessories.map((a) =>
      create(AccessorySchema, {
        // `item_id` + `skin_id` map to the Dofus 1.29 look tuple (type, gfx);
        // the client encodes them as `type_gfxId` in the legacy look string.
        itemId: a.itemType,
        skinId: a.gfxId,
        ordinal: a.ordinal,
      })
    ),
    name: player.name,
    level: player.level,
    sex: player.sex,
  });
}
