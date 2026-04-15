import { getCompressedMap, getMap } from "./map-store.ts";
import { getPathfinding } from "./pathfinding.ts";

export async function loadMapBundle(mapId: number) {
  const [map, compressed, pf] = await Promise.all([
    getMap(mapId),
    getCompressedMap(mapId),
    getPathfinding(mapId),
  ]);
  return { map, compressed, pf };
}
