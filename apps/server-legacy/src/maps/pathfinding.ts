import { DofusPathfinding } from "@dofus/grid";

import { getMap, getWalkableIds } from "./map-store.ts";

export { DofusPathfinding as MapPathfinding };

const MAX_PF_CACHE_SIZE = 200;
const pathfindingCache = new Map<number, DofusPathfinding>();

export async function getPathfinding(
  mapId: number
): Promise<DofusPathfinding | null> {
  const cached = pathfindingCache.get(mapId);
  if (cached) return cached;

  const map = await getMap(mapId);
  const walkableIds = await getWalkableIds(mapId);
  if (!map || !walkableIds) return null;

  const pf = new DofusPathfinding(map.width, map.height, walkableIds);

  // Evict oldest if cache exceeds limit
  if (pathfindingCache.size >= MAX_PF_CACHE_SIZE) {
    const firstKey = pathfindingCache.keys().next().value;
    if (firstKey !== undefined) {
      pathfindingCache.delete(firstKey);
    }
  }

  pathfindingCache.set(mapId, pf);
  return pf;
}
