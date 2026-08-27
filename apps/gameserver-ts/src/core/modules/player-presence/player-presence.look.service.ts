import type { PlayerAccessoryPresence } from "@modules/player-presence/player-presence.service";
import { create } from "@bufbuild/protobuf";
import {
  GameMovementSchema,
  SpriteMovementEntry_Operation,
} from "@dofus/proto/game_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { FightRegistryService } from "@modules/fight/registry/fight.registry";
import { AccessoriesService } from "@modules/inventory/accessories.service";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import { toSpriteEntry } from "@modules/player-presence/player-presence.sprite-entry";
import { Injectable, Logger } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";

function sameAccessories(
  a: PlayerAccessoryPresence[],
  b: PlayerAccessoryPresence[]
): boolean {
  if (a.length !== b.length) {
    return false;
  }

  // Both sides come out of `AccessoriesService.buildPresence` sorted by
  // ordinal, so a positional compare is enough.
  return a.every((left, i) => {
    const right = b[i];

    return (
      right !== undefined &&
      left.ordinal === right.ordinal &&
      left.itemType === right.itemType &&
      left.gfxId === right.gfxId
    );
  });
}

/**
 * Pushes a character's look to everyone who can see it after the worn
 * set changed.
 *
 * `enter-game` is the only other place a look is ever built, which is
 * why equipping a hat used to be invisible to every other client until
 * one of them changed map: the sprite entry peers hold is a snapshot
 * taken when the character walked in, and nothing refreshed it.
 *
 * The frame is the same `GM` the map already speaks, with the `UPDATE`
 * operation — the client re-applies the entry onto the actor it already
 * has instead of adding a second one.
 */
@Injectable()
export class PlayerLookService {
  private readonly logger = new Logger(PlayerLookService.name);

  constructor(
    private readonly presence: PlayerPresenceService,
    private readonly accessories: AccessoriesService,
    private readonly fights: FightRegistryService,
    private readonly frames: GatewayFrameService
  ) {}

  /**
   * Rebuild `characterId`'s visible accessories and, if they moved,
   * broadcast the new look to every session on their map — themselves
   * included, since the local client has no other way of learning what
   * a piece of gear looks like on the sprite.
   *
   * A no-op for gear with no look slot (ring, amulet, belt, boots,
   * dofus): `buildPresence` drops those, so the comparison below finds
   * nothing changed and no frame goes out.
   */
  async refresh(characterId: string): Promise<void> {
    const player = this.presence.getByCharacter(characterId);

    if (!player) {
      return;
    }

    const accessories = await this.accessories.buildPresence(characterId);

    if (sameAccessories(player.accessories, accessories)) {
      return;
    }

    // Presence is updated even when the broadcast is skipped below: it
    // is what `fight.end` and the next map load rebuild sprites from,
    // so it must never hold a stale look.
    player.accessories = accessories;

    // A fighter's sprite is driven by the fight frames, not by the map
    // ones. Replaying a roleplay `GM` at it would drag it back to its
    // roleplay cell mid-combat.
    if (this.fights.isInFight(player.sessionId)) {
      return;
    }

    const sessions = this.presence.sessionsOnMap(player.mapId);

    if (sessions.length === 0) {
      return;
    }

    this.frames.broadcast(
      sessions,
      create(DofusMessageSchema, {
        payload: {
          case: "gameMovement",
          value: create(GameMovementSchema, {
            entries: [
              toSpriteEntry(player, SpriteMovementEntry_Operation.UPDATE),
            ],
          }),
        },
      })
    );

    this.logger.debug(
      `look refreshed: character=${characterId} ` +
        `accessories=${accessories.length} sessions=${sessions.length}`
    );
  }
}
