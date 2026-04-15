import type { FrameInfo, TileBehavior, TileManifest } from "@/game/types";

import type { CachedTileData } from "./atlas-cache";

/**
 * Convert spritesheet format into the leaner TileManifest the renderer consumes.
 *
 * Behavior is read from the manifest (embedded by the spritesheet compiler
 * from tile-classifications.json). Falls back to a safe heuristic if missing:
 *   - 1 frame → static
 *   - ground + multi-frame → slope (each frame maps to a groundSlope 1..N)
 *   - objects + multi-frame → random (safe default, avoids animation flicker)
 */
export function convertToTileManifest(
  data: CachedTileData,
  type: "ground" | "objects"
): TileManifest {
  const { manifest, atlas } = data;

  let behavior: TileBehavior = "static";

  if (manifest.behavior) {
    behavior = manifest.behavior;
  } else if (atlas.frames.length > 1) {
    behavior = type === "ground" ? "slope" : "random";
  }

  const firstFrame = atlas.frames[0];
  const spriteWidth = firstFrame?.width ?? atlas.width;
  const spriteHeight = firstFrame?.height ?? atlas.height;

  const frames: FrameInfo[] = atlas.frames.map((f, index) => ({
    frame: index,
    x: f.x,
    y: f.y,
    w: f.width,
    h: f.height,
    ox: f.offsetX,
    oy: f.offsetY,
    ...(f.page != null && f.page > 0 ? { page: f.page } : {}),
  }));

  let baseFrame: FrameInfo | undefined;

  if (atlas.baseFrame) {
    const bf = atlas.baseFrame;
    baseFrame = {
      frame: -1,
      x: bf.x,
      y: bf.y,
      w: bf.width,
      h: bf.height,
      ox: bf.offsetX,
      oy: bf.offsetY,
    };
  }

  return {
    id: parseInt(manifest.spriteId, 10),
    type,
    behavior,
    fps: manifest.fps_hint ?? atlas.fps ?? null,
    autoplay: manifest.autoplay ?? true,
    loop: manifest.loop ?? true,
    frameCount: atlas.frames.length,
    width: spriteWidth,
    height: spriteHeight,
    offsetX: atlas.offsetX ?? 0,
    offsetY: atlas.offsetY ?? 0,
    frames,
    baseFrame,
    baseZOrder: atlas.baseZOrder,
    pages: atlas.pages,
  };
}
