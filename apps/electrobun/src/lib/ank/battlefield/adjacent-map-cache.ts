import type { AtlasLoader } from "@/render/atlas-loader";

import { loadMapDataFromServer, type MapData, type ServerMapDataPayload } from "./datacenter/map";

export interface AdjacentMapEntry {
  mapId: number;
  dx: number;
  dy: number;
  mapData: MapData;
}

/**
 * Caches decoded MapData for adjacent maps and prefetches their tile textures
 * in the background so transitions are near-instant.
 */
export class AdjacentMapCache {
  private cache = new Map<number, AdjacentMapEntry>();
  private atlasLoader: AtlasLoader;
  private prefetchAbort: AbortController | null = null;

  constructor(atlasLoader: AtlasLoader) {
    this.atlasLoader = atlasLoader;
  }

  /**
   * Store adjacent maps from a MAP_ADJACENT server message.
   * Decodes the compressed data and kicks off background texture prefetching.
   */
  loadAdjacentMaps(
    maps: Array<{
      mapId: number;
      dx: number;
      dy: number;
      width: number;
      height: number;
      background: number;
      compressed: Uint8Array;
      encoding: "gzip";
    }>
  ): void {
    // Cancel any in-flight prefetch from a previous map
    this.prefetchAbort?.abort();
    this.prefetchAbort = new AbortController();

    this.cache.clear();

    for (const entry of maps) {
      try {
        const mapData = loadMapDataFromServer({
          mapId: entry.mapId,
          width: entry.width,
          height: entry.height,
          background: entry.background,
          compressed: entry.compressed,
          encoding: entry.encoding,
        } as ServerMapDataPayload);

        this.cache.set(entry.mapId, {
          mapId: entry.mapId,
          dx: entry.dx,
          dy: entry.dy,
          mapData,
        });
      } catch (err) {
        console.warn(`[AdjacentMapCache] Failed to decode map ${entry.mapId}:`, err);
      }
    }

    // Background prefetch tile textures for all adjacent maps
    this.prefetchAllTiles();
  }

  /**
   * Get cached adjacent map data by mapId. Returns null if not preloaded.
   */
  get(mapId: number): AdjacentMapEntry | null {
    return this.cache.get(mapId) ?? null;
  }

  /**
   * Get the transition direction for a given target map.
   * Returns {dx, dy} or null if the map wasn't in the adjacent cache.
   */
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
      // Silently ignore — prefetch is best-effort
    }
  }
}
