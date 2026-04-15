import {
  CELL_HEIGHT,
  CELL_WIDTH,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
} from "@/game/constants/battlefield";

import type { CellData } from "./cell";

export interface MapData {
  id: number;
  width: number;
  height: number;
  backgroundNum?: number;
  cells: CellData[];
  triggerCellIds?: number[];
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

    scale =
      mapHeight > mapWidth
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

// loadMapData was removed: the server now ships the typed cells inline in
// the GameMapData proto frame. See map.handler.ts (mapDataFromPayload).
// Any caller that wants a MapData should receive it from the network layer.

