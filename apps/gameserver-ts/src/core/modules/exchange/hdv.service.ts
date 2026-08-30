import { parseCategories } from "@modules/exchange/big-store.pricing";
import { BigStoreRepository } from "@modules/exchange/big-store.repository";
import { ItemPresentationCacheService } from "@modules/inventory/item-presentation.cache";
import { Injectable, Logger } from "@nestjs/common";

/** One auction house, with its category list already parsed. */
export interface Hall {
  id: number;
  mapId: number;
  /** `item_types.id` this hall accepts. Its whole specialisation. */
  types: number[];
  /** The names of `types`, positionally, for the category dropdown. */
  typeNames: string[];
  taxPercent: number;
  levelMax: number;
  /** Simultaneous listings per account. */
  maxItems: number;
  sellTimeHours: number;
}

/**
 * Which auction house a player is standing in.
 *
 * Keyed by **map**, because that is how 1.29 keys it: `hdvs.map` is the
 * hall, and the 56 vendor NPCs that advertise actions 5 and 6 are only
 * the way in. A player opens the hall of the map they are on; the NPC is
 * checked separately, and only to prove the click was legitimate.
 *
 * ~59 rows, static for the process's lifetime — loaded once, like
 * `MapNpcService` does for placements.
 */
@Injectable()
export class HdvService {
  private readonly logger = new Logger(HdvService.name);
  private byMap: Map<number, Hall> | null = null;

  constructor(
    private readonly repository: BigStoreRepository,
    private readonly presentation: ItemPresentationCacheService
  ) {}

  async onMap(mapId: number): Promise<Hall | undefined> {
    return (await this.halls()).get(mapId);
  }

  async byId(hdvId: number): Promise<Hall | undefined> {
    for (const hall of (await this.halls()).values()) {
      if (hall.id === hdvId) {
        return hall;
      }
    }

    return undefined;
  }

  private async halls(): Promise<Map<number, Hall>> {
    if (this.byMap) {
      return this.byMap;
    }

    const rows = await this.repository.allHalls();
    const byMap = new Map<number, Hall>();

    for (const row of rows) {
      const types = parseCategories(row.categories);
      const names = await Promise.all(
        types.map(async (id) => (await this.presentation.loadType(id))?.name)
      );

      byMap.set(row.mapId, {
        id: row.id,
        mapId: row.mapId,
        types,
        // A type with no row in `item_types` is named by its id rather
        // than dropped: a hall that lists it still accepts it, and an
        // empty entry in the dropdown would be worse than a number.
        typeNames: names.map((name, i) => name ?? `Type ${types[i]}`),
        taxPercent: row.sellTax,
        levelMax: row.levelMax,
        maxItems: row.accountItems,
        sellTimeHours: row.sellTimeHours,
      });
    }

    this.byMap = byMap;

    if (rows.length === 0) {
      // The table is created by migration 0014 and filled by
      // `just import-content`. Empty means the world import has not been
      // run, and every auction house will refuse to open — worth one
      // line at boot rather than a mystery per click.
      this.logger.warn(
        "no auction houses: run `just import-content game.sql` to fill " +
          "hdv_templates"
      );
    } else {
      this.logger.log(`loaded ${rows.length} auction houses`);
    }

    return byMap;
  }
}
