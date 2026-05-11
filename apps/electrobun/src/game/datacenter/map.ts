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
  /**
   * Dofus subarea id (0-261). Drives tactic-mode theme/color lookup via
   * `lang.MA.sa[subareaId]` (tt = theme name, tc = 4 hex colors). 0 when
   * the server doesn't have it on record.
   */
  subareaId?: number;
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

/**
 * Fit a map's cell grid into the `DISPLAY_WIDTH × DISPLAY_HEIGHT` viewport.
 *
 * Standard "contain" fit: if either dimension would overflow, scale down
 * uniformly so both fit; if both fit at scale=1, no scaling. The result
 * is centered in the viewport.
 *
 * Why the rewrite (2026-05-06): the previous implementation only
 * triggered scaling when BOTH `mapHeight > DEFAULT_HEIGHT` AND
 * `mapWidth > DEFAULT_WIDTH`. A map with only one over-sized dimension
 * (e.g. a 15-wide × 22-tall world map) fell into the unscaled branch,
 * `actualHeight = (22-1)*27 = 567 > DISPLAY_HEIGHT=432`, and every
 * cell whose `cellY` exceeded 432 rendered OUTSIDE the tile-pass
 * texture's vertical bounds — producing the "bottom 20% of map is
 * black" symptom the user hit on real maps. The dual-overflow branch
 * also picked the wrong scale ratio (DISPLAY_WIDTH/totalWidth when the
 * map was tall, DISPLAY_HEIGHT/totalHeight when wide — inverted), so
 * even maps that exceeded both dimensions were partially clipped.
 *
 * The new formulation handles all four cases uniformly:
 *   - both fit              → scale=1, content centered if smaller
 *   - only width overflows  → scale = DISPLAY_WIDTH / totalWidth
 *   - only height overflows → scale = DISPLAY_HEIGHT / totalHeight
 *   - both overflow         → scale = min of the two (whichever is tighter)
 */
export function computeMapScale(mapWidth: number, mapHeight: number): MapScale {
  const totalWidth = (mapWidth - 1) * CELL_WIDTH;
  const totalHeight = (mapHeight - 1) * CELL_HEIGHT;

  // Uniform "contain" scale — never magnify (cap at 1) so undersized
  // maps just sit centered with margins on all sides.
  const scaleW = totalWidth > DISPLAY_WIDTH ? DISPLAY_WIDTH / totalWidth : 1;
  const scaleH =
    totalHeight > DISPLAY_HEIGHT ? DISPLAY_HEIGHT / totalHeight : 1;
  const scale = Math.min(scaleW, scaleH);

  const actualWidth = totalWidth * scale;
  const actualHeight = totalHeight * scale;

  // Default-sized 15×17 maps land exactly on the viewport (742 × 432) →
  // fast path zero offset. The general formula below also produces 0
  // for that case but skipping the trunc() call avoids any chance of
  // an off-by-half-pixel artifact at the seams.
  if (
    mapHeight === DEFAULT_HEIGHT &&
    mapWidth === DEFAULT_WIDTH &&
    actualWidth === DISPLAY_WIDTH &&
    actualHeight === DISPLAY_HEIGHT
  ) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }

  return {
    scale,
    offsetX: Math.trunc((DISPLAY_WIDTH - actualWidth) / 2),
    offsetY: Math.trunc((DISPLAY_HEIGHT - actualHeight) / 2),
  };
}

// loadMapData was removed: the server now ships the typed cells inline in
// the GameMapData proto frame. See map.handler.ts (mapDataFromPayload).
// Any caller that wants a MapData should receive it from the network layer.

