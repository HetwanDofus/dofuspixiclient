import { type DecodedCell, decodeCells } from "@modules/maps/maps.cells-codec";
import { MapsRepository } from "@modules/maps/maps.repository";
import { Injectable, Logger } from "@nestjs/common";

export interface CachedMap {
  id: number;
  width: number;
  height: number;
  cells: DecodedCell[];
}

// Maps are immutable once loaded — keep decoded cells pinned for the lifetime
// of the process. A ~50-byte DecodedCell per cell × a few hundred live maps
// is comfortably under 10 MB.

@Injectable()
export class MapCacheService {
  private readonly logger = new Logger(MapCacheService.name);
  private readonly cache = new Map<number, CachedMap>();

  constructor(private readonly maps: MapsRepository) {}

  async load(mapId: number): Promise<CachedMap | undefined> {
    const hit = this.cache.get(mapId);

    if (hit) {
      return hit;
    }

    const row = await this.maps.findById(mapId);

    if (!row) {
      return undefined;
    }

    const entry: CachedMap = {
      id: row.id,
      width: row.width,
      height: row.height,
      cells: decodeCells(row.cells),
    };

    this.cache.set(mapId, entry);
    this.logger.log(`cached map=${mapId} cells=${entry.cells.length}`);

    return entry;
  }
}
