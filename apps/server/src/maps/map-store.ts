import { db } from "../db/database.ts";

interface CachedMap {
  id: number;
  width: number;
  height: number;
  x: number;
  y: number;
  superarea: number;
  background: number;
  places: string;
  cells: unknown[];
  cellsGzip: Buffer;
  walkableIds: number[];
}

const cache = new Map<number, CachedMap>();
const MAX_CACHE_SIZE = 500;

async function loadFromDb(mapId: number): Promise<CachedMap | null> {
  const row = await db
    .selectFrom("maps")
    .select([
      "id",
      "width",
      "height",
      "x",
      "y",
      "superarea",
      "background",
      "places",
      "cells",
      "cells_gzip",
      "walkable_ids",
    ])
    .where("id", "=", mapId)
    .executeTakeFirst();

  if (!row) return null;

  const cells =
    typeof row.cells === "string" ? JSON.parse(row.cells) : row.cells;

  const entry: CachedMap = {
    id: row.id,
    width: row.width,
    height: row.height,
    x: row.x,
    y: row.y,
    superarea: row.superarea,
    background: row.background ?? 0,
    places: row.places ?? "",
    cells: cells as unknown[],
    cellsGzip: row.cells_gzip,
    walkableIds: row.walkable_ids,
  };

  // LRU eviction
  if (cache.size >= MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value!;
    cache.delete(firstKey);
  }

  cache.set(mapId, entry);
  return entry;
}

export async function getMap(mapId: number): Promise<CachedMap | null> {
  const cached = cache.get(mapId);
  if (cached) {
    // Move to end for LRU
    cache.delete(mapId);
    cache.set(mapId, cached);
    return cached;
  }
  return loadFromDb(mapId);
}

export async function getCompressedMap(mapId: number): Promise<Buffer | null> {
  const map = await getMap(mapId);
  return map?.cellsGzip ?? null;
}

export async function getWalkableIds(mapId: number): Promise<number[] | null> {
  const map = await getMap(mapId);
  return map?.walkableIds ?? null;
}

export async function mapExists(mapId: number): Promise<boolean> {
  const map = await getMap(mapId);
  return map !== null;
}

/**
 * Get adjacent maps (up/down/left/right) for a given map.
 * Returns maps at x±1 / y±1 in the same superarea.
 */
export async function getAdjacentMaps(
  mapId: number
): Promise<
  Array<{
    id: number;
    dx: number;
    dy: number;
    width: number;
    height: number;
    background: number;
    cellsGzip: Buffer;
  }>
> {
  const currentMap = await getMap(mapId);
  if (!currentMap) return [];

  const directions = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  const results: Array<{
    id: number;
    dx: number;
    dy: number;
    width: number;
    height: number;
    background: number;
    cellsGzip: Buffer;
  }> = [];

  for (const dir of directions) {
    const row = await db
      .selectFrom("maps")
      .select(["id", "width", "height", "background", "cells_gzip"])
      .where("x", "=", currentMap.x + dir.dx)
      .where("y", "=", currentMap.y + dir.dy)
      .where("superarea", "=", currentMap.superarea)
      .executeTakeFirst();

    if (row) {
      results.push({
        id: row.id,
        dx: dir.dx,
        dy: dir.dy,
        width: row.width,
        height: row.height,
        background: row.background ?? 0,
        cellsGzip: row.cells_gzip,
      });
    }
  }

  return results;
}
