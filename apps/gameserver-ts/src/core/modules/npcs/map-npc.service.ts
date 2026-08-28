import { ItemTemplateCacheService } from "@modules/inventory/item-template.cache";
import { NpcsRepository } from "@modules/npcs/npcs.repository";
import { Injectable, Logger } from "@nestjs/common";

export interface LiveNpcAccessory {
  /** Item category — the `type` half of the 1.29 `type_gfxId` look tuple. */
  itemType: number;
  gfxId: number;
  /** 0 = weapon, 1 = hat, 2 = cape, 3 = pet, 4 = shield. */
  ordinal: number;
}

export interface LiveNpc {
  /** Sprite id on the wire. Negative, see `spriteIdFor`. */
  id: number;
  templateId: number;
  mapId: number;
  cellId: number;
  direction: number;
  name: string;
  gfx: number;
  sex: number;
  color1: number;
  color2: number;
  color3: number;
  scaleX: number;
  scaleY: number;
  accessories: LiveNpcAccessory[];
  /**
   * Overrides `gfx` for the dialog portrait only, never for the map sprite —
   * canonical `NpcDialog.setNpcCharacteristics` picks it when it is > 0.
   */
  customArtwork: number;
  /** Root of this NPC's dialog tree, 0 when it has nothing to say. */
  initialQuestion: number;
  /** Patrol route; only replayed when `isMovable`. See `NpcWanderService`. */
  path: string;
  isMovable: boolean;
}

/**
 * Sprite ids live in one flat namespace on the client, which keys actors by a
 * single number. Players take the positive half (their character id), monster
 * groups count down from -1 (`MapMonsterService`), and monster *fighters*
 * count down from -1_000_000 (`FightStartService`). NPCs are pushed below all
 * of them so no allocator can ever walk into another's range.
 *
 * The id is derived from `scripted_npcs.id` rather than handed out by a
 * counter, so an NPC keeps the same sprite id across map re-entries and core
 * restarts — the client can then treat a repeated ADD as an idempotent update.
 */
const NPC_SPRITE_ID_BASE = -100_000_000;

function spriteIdFor(placementId: number): number {
  return NPC_SPRITE_ID_BASE - placementId;
}

/**
 * Map-scoped NPC placement lookup.
 *
 * Deliberately much thinner than `MapMonsterService`: NPCs are static world
 * furniture. There is nothing to roll, nothing to respawn and nothing to
 * consume — the same rows produce the same sprites forever — so this is a
 * cache in front of one query, not a spawner.
 */
@Injectable()
export class MapNpcService {
  private readonly logger = new Logger(MapNpcService.name);
  private readonly maps = new Map<number, LiveNpc[]>();

  constructor(
    private readonly npcs: NpcsRepository,
    private readonly itemTemplates: ItemTemplateCacheService
  ) {}

  async onMap(mapId: number): Promise<LiveNpc[]> {
    const cached = this.maps.get(mapId);
    if (cached) {
      return cached;
    }

    const rows = await this.npcs.onMap(mapId);
    const live: LiveNpc[] = [];

    for (const row of rows) {
      live.push({
        id: spriteIdFor(Number(row.placementId)),
        templateId: row.templateId,
        mapId,
        cellId: row.cellId ?? 0,
        direction: row.direction ?? 3,
        name: row.name ?? "",
        gfx: row.gfx ?? 0,
        sex: row.sex ?? 0,
        color1: row.color1 ?? -1,
        color2: row.color2 ?? -1,
        color3: row.color3 ?? -1,
        scaleX: row.scaleX || 100,
        scaleY: row.scaleY || 100,
        accessories: await this.resolveAccessories(row.accessories ?? ""),
        customArtwork: row.customArtwork ?? 0,
        initialQuestion: row.initialQuestion ?? 0,
        path: row.path ?? "",
        isMovable: row.isMovable ?? false,
      });
    }

    this.maps.set(mapId, live);

    if (live.length > 0) {
      this.logger.log(`resolved ${live.length} NPCs on map=${mapId}`);
    }

    return live;
  }

  /**
   * The NPC a sprite id names, but only if it is standing on `mapId`. The map
   * argument is not a convenience: it is the check that stops a client from
   * opening a dialog with an NPC it cannot see. Returns undefined when the map
   * has not been resolved yet, which is the honest answer — a player can only
   * click an NPC on a map they have entered, and entering resolves it.
   */
  onMapById(mapId: number, spriteId: number): LiveNpc | undefined {
    return this.maps.get(mapId)?.find((npc) => npc.id === spriteId);
  }

  /** Every map resolved so far. The wander tick walks these, not the world. */
  loadedMapIds(): number[] {
    return [...this.maps.keys()];
  }

  clearMap(mapId: number): void {
    this.maps.delete(mapId);
  }

  /**
   * `npc_templates.accessories` is the raw 1.29 string: comma-separated item
   * ids **in hexadecimal**, the slot being the position in the list. Canonical
   * `CharactersManager.setSpriteAccessories`
   * (`assets/sources/client-code/dofus/managers/CharactersManager.as:526-568`)
   * reads it with `parseInt(value, 16)` and then resolves the item's `type`
   * and `gfx` from the items bundle. We resolve them from `item_templates`,
   * which carries the same two fields and is already cached for the player
   * look path (`AccessoriesService`).
   *
   * A `0` entry is an empty slot, and the ordinal still has to advance past
   * it or the hat would slide into the weapon slot.
   */
  private async resolveAccessories(raw: string): Promise<LiveNpcAccessory[]> {
    if (raw.trim() === "") {
      return [];
    }

    const out: LiveNpcAccessory[] = [];
    const slots = raw.split(",");

    for (let ordinal = 0; ordinal < slots.length; ordinal++) {
      const token = slots[ordinal]?.trim() ?? "";
      if (token === "" || token === "0") {
        continue;
      }

      const itemId = Number.parseInt(token, 16);
      if (!Number.isFinite(itemId) || itemId <= 0) {
        continue;
      }

      const template = await this.itemTemplates.load(itemId);
      if (!template || template.gfxId <= 0) {
        continue;
      }

      out.push({ itemType: template.type, gfxId: template.gfxId, ordinal });
    }

    return out;
  }
}
