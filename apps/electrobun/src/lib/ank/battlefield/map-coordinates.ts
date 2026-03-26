import type { MapCoordinates } from "@/types/worldmap";
import type { TransitionDirection } from "./map-transition";

let coordsPromise: Promise<MapCoordinates> | null = null;
let coords: MapCoordinates | null = null;

function ensureLoaded(): Promise<MapCoordinates> {
  if (coords) return Promise.resolve(coords);
  if (!coordsPromise) {
    coordsPromise = fetch("/assets/data/map-data.json")
      .then((r) => r.json())
      .then((data: { maps: MapCoordinates }) => {
        coords = data.maps;
        return coords;
      });
  }
  return coordsPromise;
}

/**
 * Preload map coordinates so lookups are synchronous.
 * Call once at startup.
 */
export async function preloadMapCoordinates(): Promise<void> {
  await ensureLoaded();
}

/**
 * Compute the transition direction between two maps using their world coordinates.
 * Returns null if either map is unknown or they aren't direct neighbors.
 */
export function getMapTransitionDirection(
  fromMapId: number,
  toMapId: number
): TransitionDirection | null {
  if (!coords) return null;

  const from = coords[fromMapId.toString()];
  const to = coords[toMapId.toString()];
  if (!from || !to) return null;

  // Only allow pan for direct neighbors (delta of exactly 1 on one or both axes)
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return null;

  return { dx, dy };
}
