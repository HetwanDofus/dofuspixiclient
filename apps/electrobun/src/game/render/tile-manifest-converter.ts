import type { FrameInfo, TileBehavior, TileManifest, TileType } from "@/game/types";

import type { CachedTileData } from "./atlas-cache";

/**
 * Convert cached tile data into the leaner TileManifest the renderer consumes.
 *
 * Canvas size + registration point come from `renderMeta` (queried from Vello
 * once at asset load — authoritative and jitter-free because every frame of
 * a given animation renders into the SAME-sized texture). The Extras section
 * provides behavior, fps, and the frame count only.
 *
 * Pivot wiring: sprite-factory reads `-(tile.offsetX + frame.ox)`. We pack the
 * Vello anchor into `tile.offsetX/Y = -anchor`, leaving `frame.ox/oy = 0`, so
 * `pivot = anchor` at 1x. PIXI scales pivot by sprite.scale, which matches
 * Vello's linear anchor scaling with resolution.
 *
 * Behavior is read from the manifest (embedded by the compiler from
 * tile-classifications.json). Fallback heuristic if missing:
 *   - 1 frame → static
 *   - ground + multi-frame → slope (each frame maps to a groundSlope 1..N)
 *   - objects + multi-frame → random (safe default, avoids animation flicker)
 */
export function convertToTileManifest(
  data: CachedTileData,
  type: TileType
): TileManifest {
  const { manifest, atlas, renderMeta } = data;

  let behavior: TileBehavior = "static";

  if (manifest.behavior) {
    behavior = manifest.behavior;
  } else if (atlas.frames.length > 1) {
    behavior = type === "ground" ? "slope" : "random";
  }

  // Every frame renders at the same size (Vello's uniform canvas), so all
  // per-frame entries carry the same geometry. We still emit one per
  // animation frame so frameCount-dependent code paths stay correct.
  const frames: FrameInfo[] = atlas.frames.map((_f, index) => ({
    frame: index,
    x: 0,
    y: 0,
    w: renderMeta.width,
    h: renderMeta.height,
    ox: 0,
    oy: 0,
  }));

  const parsedId = parseInt(manifest.spriteId, 10);
  return {
    // gfx.cell spriteIds are strings ("s1", "i7") — render code only uses `id`
    // for logging, so fall back to 0 when non-numeric rather than NaN.
    id: Number.isFinite(parsedId) ? parsedId : 0,
    type,
    behavior,
    fps: manifest.fps_hint ?? atlas.fps ?? null,
    autoplay: manifest.autoplay ?? true,
    loop: manifest.loop ?? true,
    frameCount: atlas.frames.length,
    width: renderMeta.width,
    height: renderMeta.height,
    // Negated anchor → sprite.pivot = anchor → Flash (0,0) maps to world pos.
    offsetX: -renderMeta.anchorX,
    offsetY: -renderMeta.anchorY,
    frames,
    baseFrame: undefined,
    baseZOrder: atlas.baseZOrder,
    pages: atlas.pages,
  };
}
