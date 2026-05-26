// Base (non-tactic) tile-placement builder. Walks a `MapData`'s cells
// and emits one `LayeredTilePlacement` per (cell, layer) with a
// non-zero tile id, resolving each tile id to its bundle/export/frame
// via a `TileResolver`.
//
// Extracted from `MapHandler.buildPlacements` so the same cell-walk
// powers both the live map render AND the off-screen neighbour-map
// bakes used by `NeighborBandRenderer`. The tactic-mode extras
// (background override + LOS decor) stay in `MapHandler`, which calls
// `buildBaseMapPlacements` for the base layers then appends its own.

import type { MapData } from "@/game/datacenter/map";
import type { TileResolver } from "@/game/render/tile-resolver";
import type { LayeredTilePlacement } from "@/game/render/tile-sprite-renderer";
import type { TilePrefixOverride } from "@/game/scene/tiles/layer-builder";
import { getCellPosition } from "@/game/datacenter/cell";
import { frameIndexForTile } from "@/game/scene/tiles/sprite-factory";

interface CellPlacementInput {
  cellId: number;
  cellX: number;
  cellY: number;
  rotation: number;
  flip: boolean;
  groundSlope: number;
  isBackground?: boolean;
  /**
   * Explicit frame index override — bypasses `frameIndexForTile`'s
   * slope/random selection (used by tactic decor; unused on the base
   * path).
   */
  staticFrameOverride?: number;
}

/**
 * Resolve a (cellId, layer, tileId) triple to its tile-key string,
 * honouring an optional tactic prefix override map.
 */
export function tileKeyFor(
  cellId: number,
  layer: 0 | 1 | 2,
  id: number,
  prefixOverride: Map<number, TilePrefixOverride> | null
): string {
  const override = prefixOverride?.get(cellId);
  const layerOverride =
    layer === 0
      ? override?.ground
      : layer === 1
        ? override?.layer1
        : override?.layer2;
  if (layerOverride) {
    return `${layerOverride.prefix}_${layerOverride.idOverride ?? id}`;
  }
  return `${layer === 0 ? "ground" : "objects"}_${id}`;
}

/**
 * Resolve one tile placement and push it onto `out`. No-op if the tile
 * key doesn't resolve against any loaded bundle.
 */
export function pushPlacementByKey(
  out: LayeredTilePlacement[],
  tileResolver: TileResolver,
  tileKey: string,
  layer: 0 | 1 | 2,
  cell: CellPlacementInput
): void {
  const resolved = tileResolver.resolve(tileKey);
  if (!resolved) return;
  const hasFrameOverride = cell.staticFrameOverride !== undefined;
  const isAnimated =
    !hasFrameOverride &&
    resolved.kind === "animated" &&
    resolved.frameCount > 1;
  const behavior = resolved.kind === "" ? "static" : resolved.kind;
  const staticFrame = isAnimated
    ? 0
    : hasFrameOverride
      ? Math.max(
          0,
          Math.min(resolved.frameCount - 1, cell.staticFrameOverride!)
        )
      : frameIndexForTile(
          {
            frameCount: resolved.frameCount,
            behavior,
          } as Parameters<typeof frameIndexForTile>[0],
          cell.cellId,
          cell.groundSlope
        );
  out.push({
    tileKey,
    bundle: resolved.bundle,
    exportName: resolved.exportName,
    cellX: cell.cellX,
    cellY: cell.cellY,
    rotation: cell.rotation & 3,
    flip: cell.flip,
    frameCount: resolved.frameCount,
    isAnimated,
    fps: resolved.fps,
    staticFrame,
    layer,
    isBackground: cell.isBackground === true,
  });
}

/**
 * Build the base ground/object placement list for a map (background +
 * layer 0/1/2). The "contain"-fit transform for bigger-than-default
 * maps is applied at the layer-container level by the caller, so
 * positions here are raw logical pixels.
 */
export function buildBaseMapPlacements(
  mapData: MapData,
  tileResolver: TileResolver,
  prefixOverride: Map<number, TilePrefixOverride> | null = null
): LayeredTilePlacement[] {
  const out: LayeredTilePlacement[] = [];

  if (mapData.backgroundNum && mapData.backgroundNum > 0) {
    pushPlacementByKey(
      out,
      tileResolver,
      `ground_${mapData.backgroundNum}`,
      0,
      {
        cellId: 0,
        cellX: 0,
        cellY: 0,
        rotation: 0,
        flip: false,
        groundSlope: 1,
        isBackground: true,
      }
    );
  }

  // Layer 0: ground.
  for (const cell of mapData.cells) {
    if (cell.ground <= 0) continue;
    const basePos = getCellPosition(cell.id, mapData.width, cell.groundLevel);
    const groundSlope = cell.groundSlope ?? 1;
    const tileKey = tileKeyFor(cell.id, 0, cell.ground, prefixOverride);
    let groundRot = cell.layerGroundRot;
    if (groundSlope !== 1) groundRot = 0;
    pushPlacementByKey(out, tileResolver, tileKey, 0, {
      cellId: cell.id,
      cellX: basePos.x,
      cellY: basePos.y,
      rotation: groundRot,
      flip: cell.layerGroundFlip,
      groundSlope,
    });
  }

  // Layer 1: walkable-tile decorations.
  for (const cell of mapData.cells) {
    if (cell.layer1 <= 0) continue;
    const basePos = getCellPosition(cell.id, mapData.width, cell.groundLevel);
    const groundSlope = cell.groundSlope ?? 1;
    const tileKey = tileKeyFor(cell.id, 1, cell.layer1, prefixOverride);
    const objRot = groundSlope === 1 ? cell.layerObject1Rot : 0;
    pushPlacementByKey(out, tileResolver, tileKey, 1, {
      cellId: cell.id,
      cellX: basePos.x,
      cellY: basePos.y,
      rotation: objRot,
      flip: cell.layerObject1Flip,
      groundSlope,
    });
  }

  // Layer 2: foreground objects (buildings, walls, decor).
  for (const cell of mapData.cells) {
    if (cell.layer2 <= 0) continue;
    const basePos = getCellPosition(cell.id, mapData.width, cell.groundLevel);
    const groundSlope = cell.groundSlope ?? 1;
    const tileKey = tileKeyFor(cell.id, 2, cell.layer2, prefixOverride);
    pushPlacementByKey(out, tileResolver, tileKey, 2, {
      cellId: cell.id,
      cellX: basePos.x,
      cellY: basePos.y,
      rotation: 0, // canonical AS never rotates layer 2
      flip: cell.layerObject2Flip,
      groundSlope,
    });
  }

  return out;
}
