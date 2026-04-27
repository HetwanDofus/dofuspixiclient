import type { Serializable } from "@shared/handoff/handoff.coordinator";
import { Injectable, Logger } from "@nestjs/common";
import { HandoffPart } from "@shared/handoff/handoff-part.decorator";

// In-memory per-map index of live players. Handoff-serialized so presence
// survives blue/green restarts without kicking anyone.

/**
 * Visible accessory — category (hat/cape/shield/weapon/pet) + its GFX id.
 * The ordinal is the client-side slot (0 weapon, 1 hat, 2 cape, 3 pet, 4
 * shield); we derive it server-side from the item's `type` field on equip.
 */
export interface PlayerAccessoryPresence {
  itemType: number;
  gfxId: number;
  ordinal: number;
}

export interface PlayerPresenceEntry {
  sessionId: string;
  characterId: string;
  mapId: number;
  cellId: number;
  direction: number;
  name: string;
  level: number;
  sex: number;
  gfx: number;
  color1: number;
  color2: number;
  color3: number;
  accessories: PlayerAccessoryPresence[];
}

@Injectable()
@HandoffPart()
export class PlayerPresenceService
  implements Serializable<PlayerPresenceEntry[]>
{
  readonly name = "player-presence.players";

  private readonly logger = new Logger(PlayerPresenceService.name);
  private readonly byMap = new Map<number, Map<string, PlayerPresenceEntry>>();
  private readonly byCharacter = new Map<string, number>();
  private readonly bySession = new Map<string, string>();

  enter(player: PlayerPresenceEntry): void {
    this.leaveByCharacter(player.characterId);

    let bucket = this.byMap.get(player.mapId);

    if (!bucket) {
      bucket = new Map();
      this.byMap.set(player.mapId, bucket);
    }

    bucket.set(player.characterId, player);
    this.byCharacter.set(player.characterId, player.mapId);
    this.bySession.set(player.sessionId, player.characterId);
  }

  leaveByCharacter(characterId: string): PlayerPresenceEntry | undefined {
    const mapId = this.byCharacter.get(characterId);

    if (mapId === undefined) {
      return undefined;
    }

    const bucket = this.byMap.get(mapId);
    const player = bucket?.get(characterId);

    bucket?.delete(characterId);

    if (bucket?.size === 0) {
      this.byMap.delete(mapId);
    }

    this.byCharacter.delete(characterId);

    if (player) {
      this.bySession.delete(player.sessionId);
    }

    return player;
  }

  leaveBySession(sessionId: string): PlayerPresenceEntry | undefined {
    const characterId = this.bySession.get(sessionId);

    return characterId ? this.leaveByCharacter(characterId) : undefined;
  }

  getByCharacter(characterId: string): PlayerPresenceEntry | undefined {
    const mapId = this.byCharacter.get(characterId);

    return mapId !== undefined
      ? this.byMap.get(mapId)?.get(characterId)
      : undefined;
  }

  updatePosition(
    characterId: string,
    cellId: number,
    direction: number
  ): PlayerPresenceEntry | undefined {
    const player = this.getByCharacter(characterId);

    if (!player) {
      return undefined;
    }

    player.cellId = cellId;
    player.direction = direction;

    return player;
  }

  onMap(mapId: number): PlayerPresenceEntry[] {
    return Array.from(this.byMap.get(mapId)?.values() ?? []);
  }

  sessionsOnMap(mapId: number, exceptCharacterId?: string): string[] {
    const bucket = this.byMap.get(mapId);

    if (!bucket) {
      return [];
    }

    const ids: string[] = [];

    for (const p of bucket.values()) {
      if (p.characterId !== exceptCharacterId) {
        ids.push(p.sessionId);
      }
    }

    return ids;
  }

  serialize(): PlayerPresenceEntry[] {
    const out: PlayerPresenceEntry[] = [];

    for (const bucket of this.byMap.values()) {
      for (const p of bucket.values()) {
        out.push({ ...p });
      }
    }

    return out;
  }

  restore(players: PlayerPresenceEntry[]): void {
    this.byMap.clear();
    this.byCharacter.clear();
    this.bySession.clear();

    for (const p of players) {
      this.enter(p);
    }

    this.logger.log(`restored presence for ${players.length} player(s)`);
  }
}
