import { Assets } from 'pixi.js';
import type {
  WorldMapManifest,
  HintManifest,
  HintsData,
  HintsLayering,
  MapCoordinates,
} from '@/types/worldmap';
import { WORLDMAP_CONSTANTS } from '@/types/worldmap';

export interface WorldMapDataSet {
  manifest: WorldMapManifest;
  hintsData: HintsData;
  hintManifest: HintManifest;
  hintsLayering: HintsLayering;
  mapCoordinates: MapCoordinates;
}

const dataCache = new Map<string, WorldMapDataSet>();

export async function loadWorldMapData(superarea: number): Promise<WorldMapDataSet> {
  const worldMapName = superarea === 0 ? 'amakna' : 'incarnam';
  const cacheKey = worldMapName;

  if (dataCache.has(cacheKey)) {
    return dataCache.get(cacheKey)!;
  }

  const [manifest, hintsData, hintManifest, hintsLayering, mapData] = await Promise.all([
    fetch(`/assets/maps/world/${worldMapName}/manifest.json`).then(r => r.json()) as Promise<WorldMapManifest>,
    fetch('/assets/data/hints-data.json').then(r => r.json()) as Promise<HintsData>,
    fetch('/assets/maps/hints/manifest.json').then(r => r.json()) as Promise<HintManifest>,
    fetch('/assets/data/hints-layering.json').then(r => r.json()) as Promise<HintsLayering>,
    fetch('/assets/data/map-data.json').then(r => r.json()) as Promise<{ maps: MapCoordinates }>,
  ]);

  const dataSet: WorldMapDataSet = {
    manifest,
    hintsData,
    hintManifest,
    hintsLayering,
    mapCoordinates: mapData.maps,
  };

  dataCache.set(cacheKey, dataSet);
  return dataSet;
}

export async function loadWorldMapTiles(manifest: WorldMapManifest): Promise<Map<string, import('pixi.js').Texture>> {
  const worldMapName = manifest.worldmap;
  const urls = manifest.tiles.map(t => `/assets/maps/world/${worldMapName}/${t.file}`);

  const textures = await Assets.load(urls);
  const textureMap = new Map<string, import('pixi.js').Texture>();

  for (const tile of manifest.tiles) {
    const url = `/assets/maps/world/${worldMapName}/${tile.file}`;
    if (textures[url]) {
      textureMap.set(tile.file, textures[url]);
    }
  }

  return textureMap;
}

export async function loadHintTextures(
  hints: Array<{ gfxID: number }>,
  hintManifest: HintManifest
): Promise<Map<string, import('pixi.js').Texture>> {
  const uniqueGfxIds = new Set(hints.map(h => h.gfxID.toString()));
  const urls: string[] = [];

  for (const gfxID of uniqueGfxIds) {
    const info = hintManifest.graphics[gfxID];
    if (info) {
      urls.push(`/assets/maps/hints/${info.file}`);
    }
  }

  if (urls.length === 0) {
    return new Map();
  }

  const textures = await Assets.load(urls);
  const textureMap = new Map<string, import('pixi.js').Texture>();

  for (const gfxID of uniqueGfxIds) {
    const info = hintManifest.graphics[gfxID];
    if (info) {
      const url = `/assets/maps/hints/${info.file}`;
      if (textures[url]) {
        textureMap.set(gfxID, textures[url]);
      }
    }
  }

  return textureMap;
}

export function mapCoordToPixel(
  gameMapX: number,
  gameMapY: number,
  chunkXMin: number,
  chunkYMin: number,
  scale = 1
): [number, number] {
  const { DISPLAY_WIDTH, DISPLAY_HEIGHT, CHUNK_SIZE } = WORLDMAP_CONSTANTS;

  const chunkX = gameMapX / CHUNK_SIZE;
  const chunkY = gameMapY / CHUNK_SIZE;

  const offsetX = chunkX - chunkXMin;
  const offsetY = chunkY - chunkYMin;

  const pixelX = Math.round(offsetX * DISPLAY_WIDTH * scale);
  const pixelY = Math.round(offsetY * DISPLAY_HEIGHT * scale);

  const mapCellWidth = DISPLAY_WIDTH / CHUNK_SIZE;
  const mapCellHeight = DISPLAY_HEIGHT / CHUNK_SIZE;

  return [pixelX + mapCellWidth / 2, pixelY + mapCellHeight / 2];
}

export function filterHintsByArea(
  hintsLayering: HintsLayering,
  mapCoordinates: MapCoordinates,
  enabledCategories: Set<number>,
  superarea: number
): Array<{ overlay: { x: number; y: number }; hint: { name: string; categoryID: number; gfxID: number; mapID: number } }> {
  const result: Array<{ overlay: { x: number; y: number }; hint: { name: string; categoryID: number; gfxID: number; mapID: number } }> = [];

  for (const overlay of hintsLayering.hint_overlays) {
    for (const hint of overlay.hints) {
      const mapID = hint.mapID.toString();
      const coord = mapCoordinates[mapID];

      if (coord && coord.sua !== superarea) {
        continue;
      }

      if (!enabledCategories.has(hint.categoryID)) {
        continue;
      }

      result.push({ overlay: { x: overlay.x, y: overlay.y }, hint });
    }
  }

  return result;
}
