import { DISPLAY_WIDTH, DISPLAY_HEIGHT, CELL_WIDTH, CELL_HEIGHT, DEFAULT_WIDTH, DEFAULT_HEIGHT } from '@/constants/battlefield';
import type { CellData } from './cell';

export interface MapData {
  id: number;
  width: number;
  height: number;
  backgroundNum?: number;
  cells: CellData[];
}

export interface MapScale {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface MapBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function computeMapScale(mapWidth: number, mapHeight: number): MapScale {
  if (mapHeight === DEFAULT_HEIGHT && mapWidth === DEFAULT_WIDTH) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }

  let scale = 1;
  let actualWidth: number;
  let actualHeight: number;

  if (mapHeight > DEFAULT_HEIGHT && mapWidth > DEFAULT_WIDTH) {
    const totalWidth = (mapWidth - 1) * CELL_WIDTH;
    const totalHeight = (mapHeight - 1) * CELL_HEIGHT;

    scale = mapHeight > mapWidth
      ? DISPLAY_WIDTH / totalWidth
      : DISPLAY_HEIGHT / totalHeight;

    actualWidth = Math.floor(totalWidth * scale);
    actualHeight = Math.floor(totalHeight * scale);
  } else {
    scale = 1;
    actualWidth = (mapWidth - 1) * CELL_WIDTH;
    actualHeight = (mapHeight - 1) * CELL_HEIGHT;
  }

  if (actualWidth === DISPLAY_WIDTH && actualHeight === DISPLAY_HEIGHT) {
    return { scale, offsetX: 0, offsetY: 0 };
  }

  const offsetX = (DISPLAY_WIDTH - actualWidth) / 2;
  const offsetY = (DISPLAY_HEIGHT - actualHeight) / 2;

  return {
    scale,
    offsetX: Math.trunc(offsetX),
    offsetY: Math.trunc(offsetY),
  };
}

export async function loadMapData(mapId: number): Promise<MapData> {
  const response = await fetch(`/assets/maps/${mapId}.json`);
  return response.json();
}
