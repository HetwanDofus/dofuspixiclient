import { createLogger } from "@/utils/logger";

const log = createLogger("MapsLang");

const LOCALE = "fr";
const MAPS_BUNDLE_URL = `/assets/langs/${LOCALE}/maps.json`;

/**
 * The published `maps` bundle, which is what 1.29 read for the location
 * caption in the top-left of the play area.
 *
 * `MA.m[mapId] = { x, y, sa }` — world coordinates and the subarea the map
 * belongs to; `MA.sa[subareaId] = { n, a, tt, tc }` — the subarea name, its
 * parent area, and the tactic-mode theme + colors; `MA.a[areaId] = { n }` —
 * the area name. Area names live nowhere else: the server's `subareas` table
 * carries ids only, and there is no `areas` table at all, so this bundle is
 * the source of truth for the caption.
 *
 * Same fetch-once-and-latch shape as `npc-lang.ts` / `classes-lang.ts`: one
 * fetch, cached at module level, an empty latch on failure so the HUD renders
 * without the caption rather than wedging. The bundle is 2.6 MB, hence lazy.
 */
export interface MapsLangEntry {
  x: number;
  y: number;
  subareaId: number;
}

export interface MapsLangSubarea {
  name: string;
  areaId: number;
  /** Tactic-mode theme name, used by `scene/map/handler.ts`. */
  themeName?: string | undefined;
  /** Tactic-mode colors (4 hex strings). */
  themeColors?: string[] | undefined;
}

export interface MapsLangData {
  maps: Map<number, MapsLangEntry>;
  subareas: Map<number, MapsLangSubarea>;
  areaNames: Map<number, string>;
}

/** The named half of the caption — "Incarnam (Pitons rocheux)". */
export interface MapNames {
  areaName: string;
  subareaName: string;
}

type MapsBundle = {
  data?: {
    MA?: {
      m?: Record<string, { x?: number; y?: number; sa?: number }>;
      sa?: Record<
        string,
        { n?: string; a?: number; tt?: string; tc?: string[] }
      >;
      a?: Record<string, { n?: string }>;
    };
  };
};

let cache: MapsLangData | null = null;
let loading: Promise<MapsLangData> | null = null;

function emptyData(): MapsLangData {
  return { maps: new Map(), subareas: new Map(), areaNames: new Map() };
}

export function parseMapsBundle(json: unknown): MapsLangData {
  const out = emptyData();
  const ma = (json as MapsBundle).data?.MA;

  if (!ma) {
    return out;
  }

  for (const [idKey, entry] of Object.entries(ma.m ?? {})) {
    const mapId = Number.parseInt(idKey, 10);

    if (!Number.isFinite(mapId)) {
      continue;
    }

    out.maps.set(mapId, {
      x: entry.x ?? 0,
      y: entry.y ?? 0,
      subareaId: entry.sa ?? 0,
    });
  }

  for (const [idKey, entry] of Object.entries(ma.sa ?? {})) {
    const subareaId = Number.parseInt(idKey, 10);

    if (!Number.isFinite(subareaId)) {
      continue;
    }

    out.subareas.set(subareaId, {
      name: entry.n ?? "",
      areaId: entry.a ?? -1,
      themeName: entry.tt,
      themeColors: entry.tc,
    });
  }

  for (const [idKey, entry] of Object.entries(ma.a ?? {})) {
    const areaId = Number.parseInt(idKey, 10);

    if (!Number.isFinite(areaId) || !entry.n) {
      continue;
    }

    out.areaNames.set(areaId, entry.n);
  }

  return out;
}

export function loadMapsLang(): Promise<MapsLangData> {
  if (cache) {
    return Promise.resolve(cache);
  }

  if (!loading) {
    loading = fetch(MAPS_BUNDLE_URL)
      .then((r) => r.json())
      .then((json) => {
        cache = parseMapsBundle(json);
        return cache;
      })
      .catch((err) => {
        log.error("failed to load the maps bundle:", err);
        // Latch empty: the caption disappears, the map still plays.
        cache = emptyData();
        return cache;
      });
  }

  return loading;
}

/** The parsed bundle if it is already in, null before the fetch resolves. */
export function getMapsLang(): MapsLangData | null {
  return cache;
}

/**
 * Resolve a map to its area / subarea names. Synchronous — call
 * `loadMapsLang()` first.
 *
 * `subareaIdOverride` is the value the server put on the `GameMapData` frame.
 * It wins over the bundle's own `MA.m[mapId].sa` so a custom map the retail
 * bundle never knew about still names its subarea correctly.
 */
export function getMapNames(
  mapId: number,
  subareaIdOverride?: number | null
): MapNames | null {
  if (!cache) {
    return null;
  }

  const subareaId = subareaIdOverride ?? cache.maps.get(mapId)?.subareaId ?? 0;
  const subarea = subareaId > 0 ? cache.subareas.get(subareaId) : undefined;

  if (!subarea?.name) {
    return null;
  }

  const areaName = cache.areaNames.get(subarea.areaId);

  if (!areaName) {
    return null;
  }

  return { areaName, subareaName: subarea.name };
}

/** The map's world coordinates from the bundle, null when it isn't listed. */
export function getMapLangCoords(
  mapId: number
): { x: number; y: number } | null {
  const entry = cache?.maps.get(mapId);
  return entry ? { x: entry.x, y: entry.y } : null;
}
