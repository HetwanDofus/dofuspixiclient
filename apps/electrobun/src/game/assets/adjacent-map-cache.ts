import type { MapData } from "@/game/datacenter/map";
import type { AtlasLoader } from "@/game/render/atlas-loader";

export interface AdjacentMapEntry {
  mapId: number;
  dx: number;
  dy: number;
  mapData: MapData;
}

/**
 * Caches decoded MapData for adjacent maps and prefetches their tile textures
 * in the background so transitions are near-instant.
 *
 * Now that the server ships per-map cells inline in GameMapData, the cache
 * is hydrated by callers that already hold a decoded MapData (for example
 * an upstream prefetch handler reacting to neighbor updates). HTTP fetches
 * have been removed from this layer.
 */
export class AdjacentMapCache {
  private cache = new Map<number, AdjacentMapEntry>();
  private prefetchAbort: AbortController | null = null;

  constructor(private readonly atlasLoader: AtlasLoader) {}

  /**
   * Register pre-decoded adjacent maps and prefetch their tile textures.
   */
  loadAdjacentMaps(
    maps: Array<{ mapId: number; dx: number; dy: number; mapData: MapData }>
  ): void {
    this.prefetchAbort?.abort();
    this.prefetchAbort = new AbortController();

    this.cache.clear();
    for (const { mapId, dx, dy, mapData } of maps) {
      this.cache.set(mapId, { mapId, dx, dy, mapData });
    }

    this.prefetchAllTiles();
  }

  get(mapId: number): AdjacentMapEntry | null {
    return this.cache.get(mapId) ?? null;
  }

  getDirection(mapId: number): { dx: number; dy: number } | null {
    const entry = this.cache.get(mapId);
    if (!entry) return null;
    return { dx: entry.dx, dy: entry.dy };
  }

  clear(): void {
    this.prefetchAbort?.abort();
    this.prefetchAbort = null;
    this.cache.clear();
  }

  destroy(): void {
    this.clear();
  }

  private prefetchAllTiles(): void {
    const signal = this.prefetchAbort?.signal;
    for (const entry of this.cache.values()) {
      if (signal?.aborted) break;
      this.prefetchMapTiles(entry.mapData, signal);
    }
  }

  private async prefetchMapTiles(
    mapData: MapData,
    signal: AbortSignal | undefined
  ): Promise<void> {
    const uniqueTileKeys = new Set<string>();

    if (mapData.backgroundNum && mapData.backgroundNum > 0) {
      uniqueTileKeys.add(`ground_${mapData.backgroundNum}`);
    }
    for (const cell of mapData.cells) {
      if (cell.ground > 0) uniqueTileKeys.add(`ground_${cell.ground}`);
      if (cell.layer1 > 0) uniqueTileKeys.add(`objects_${cell.layer1}`);
      if (cell.layer2 > 0) uniqueTileKeys.add(`objects_${cell.layer2}`);
    }

    if (signal?.aborted || uniqueTileKeys.size === 0) return;

    try {
      await this.atlasLoader.prefetchTiles([...uniqueTileKeys], 1);
    } catch {
      // best-effort
    }
  }
}
