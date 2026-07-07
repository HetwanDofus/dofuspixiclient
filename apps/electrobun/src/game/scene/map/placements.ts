// Base (non-tactic) tile-placement builder. Walks a `MapData`'s cells
// and emits one `LayeredTilePlacement` per (cell, layer) with a
// non-zero tile id, resolving each tile id to its bundle/export via a
// `TileResolver` and its BEHAVIOR via the single decision point below.
//
// ROUTING (wc3 render_tiles/resolve.rs model — one decision point, no
// TS-side classification):
//  1. explicit tactic frame override → forced static (canonical
//     `gotoAndStop(counter % 3 + 1)` decor round-robin);
//  2. ground layer with `groundSlope != 1` → forced static at
//     `slope - 1` (canonical external `tile.gotoAndStop(slope)`,
//     assets/sources/client-code/ank/battlefield/MapHandler.as:224-227;
//     wc3 render_tiles/resolve.rs:69-77);
//  3. otherwise the wasm classifier (`swfTileBehavior` — byte-equal
//     port of wc3's `tile_behavior::resolve_full`) decides, and its
//     result rides the placement VERBATIM;
//  4. classifier refusal (bundle missing / renderer halted) is an
//     ERROR path: console.error + forced static frame 0 — never a
//     second classifier.
//
// Extracted from `MapHandler.buildPlacements` so one cell-walk owns
// the base layers. The tactic-mode extras (background override + LOS
// decor) stay in `MapHandler`, which calls `buildBaseMapPlacements`
// for the base layers then appends its own.

import type { MapData } from "@/game/datacenter/map";
import type { TileResolver } from "@/game/render/tile-resolver";
import type { TileBehaviorPlan } from "@/game/render/tile-routing";
import type { LayeredTilePlacement } from "@/game/render/tile-sprite-renderer";
import type { TilePrefixOverride } from "@/game/scene/tiles/layer-builder";
import { getCellPosition } from "@/game/datacenter/cell";
import { swfTileBehavior } from "@/game/render/vello-loader";

interface CellPlacementInput {
  cellId: number;
  cellX: number;
  cellY: number;
  rotation: number;
  flip: boolean;
  groundSlope: number;
  isBackground?: boolean;
  /**
   * Explicit frame index override — a canonical pre-engine playhead
   * force (tactic decor's `gotoAndStop(counter % 3 + 1)`); unused on
   * the base path.
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
 * key doesn't resolve against any loaded bundle. THE single behavior
 * decision point — see the module doc.
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

  const maxFrame = Math.max(0, resolved.frameCount - 1);
  let plan: TileBehaviorPlan;
  if (cell.staticFrameOverride !== undefined) {
    plan = {
      source: "forced",
      reason: "override",
      frame: Math.max(0, Math.min(maxFrame, cell.staticFrameOverride)),
    };
  } else if (layer === 0 && cell.groundSlope !== 1 && !cell.isBackground) {
    // Canonical slope force: the engine externally calls
    // `tile.gotoAndStop(cell.groundSlope)` AFTER attach
    // (MapHandler.as:224-227) — it wins over whatever the sprite's own
    // script would have done (wc3 render_tiles/resolve.rs:69-77;
    // ground layer only, like wc3's `TileLayer::Ground` guard).
    plan = {
      source: "forced",
      reason: "slope",
      frame: Math.min(maxFrame, Math.max(0, cell.groundSlope - 1)),
    };
  } else {
    const behavior = swfTileBehavior(
      resolved.bundle,
      resolved.exportName,
      cell.cellId
    );
    if (behavior) {
      plan = { source: "engine", behavior };
    } else {
      // ERROR path — classification parity with wc3 is NOT in effect
      // for this tile; render it frozen at frame 0 rather than invent
      // a second classifier.
      // eslint-disable-next-line no-console
      console.error(
        `[placements] tile classifier refused ${resolved.bundle}/${resolved.exportName} cell=${cell.cellId} — forcing static frame 0`
      );
      plan = { source: "forced", reason: "engine-refused", frame: 0 };
    }
  }

  out.push({
    tileKey,
    bundle: resolved.bundle,
    exportName: resolved.exportName,
    cellId: cell.cellId,
    cellX: cell.cellX,
    cellY: cell.cellY,
    rotation: cell.rotation & 3,
    flip: cell.flip,
    fps: resolved.fps,
    plan,
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
