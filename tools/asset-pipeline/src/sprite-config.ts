import { readFile } from "node:fs/promises";

import type { FrameSvgFile } from "@dofus/dofasset-format/pipeline";

/**
 * Authoritative shape of `assets/sprite-config.json`. This is the same schema
 * the legacy `svg-spritesheet` tool consumed; the file was moved into
 * `assets/` so the pipeline has a stable, tool-agnostic home for it.
 *
 *   - `defaults.staticFrameLimit`: for animations whose name starts with
 *     "static", collapse the per-frame SVGs to the first N frames. Dofus
 *     static poses are typically N identical frames; dedup wouldn't shrink
 *     them fully because each re-emits its own root group.
 *   - `accessoryBounds`: per-slot fixed-pixel padding used when the old tool
 *     pre-packed an atlas. The new frame-direct compile lets Vello recompute
 *     tight bounds including accessories at render time, so this is unused
 *     here — kept in the type for config forward-compat.
 *   - `sprites.<id>.staticFrameLimit`: per-sprite override.
 *   - `sprites.<id>.hairToggle`: DOM-layer CSS hair swap metadata; irrelevant
 *     to the binary compiler but preserved so the config stays round-trip.
 */
export interface SpriteConfig {
  defaults?: {
    staticFrameLimit?: number;
  };
  accessoryBounds?: Record<
    string,
    { left: number; top: number; right: number; bottom: number }
  >;
  sprites?: Record<
    string,
    {
      staticFrameLimit?: number;
      hairToggle?: {
        sourceFrame?: number;
        compareFrame?: number;
        cssClass?: string;
        triggerSlot?: number;
      };
    }
  >;
}

export async function loadSpriteConfig(
  path: string
): Promise<SpriteConfig> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as SpriteConfig;
  } catch {
    return {};
  }
}

/**
 * Effective static-frame limit for a sprite — per-sprite override wins,
 * then the global default, else no limit.
 */
export function resolveStaticFrameLimit(
  cfg: SpriteConfig,
  spriteId: string | number
): number | undefined {
  const override = cfg.sprites?.[String(spriteId)]?.staticFrameLimit;
  return override ?? cfg.defaults?.staticFrameLimit;
}

/**
 * Build the `filterFrames` callback `compileSpriteFromFrames` accepts. Applies
 * `staticFrameLimit` to any animation whose name starts with "static" (the
 * engine-level naming convention for static poses).
 */
export function buildFrameFilter(
  cfg: SpriteConfig,
  spriteId: string | number
): ((animName: string, files: FrameSvgFile[]) => FrameSvgFile[]) | undefined {
  const limit = resolveStaticFrameLimit(cfg, spriteId);
  if (!limit || limit <= 0) return undefined;
  return (animName, files) => {
    if (!animName.toLowerCase().startsWith("static")) return files;
    return files.length > limit ? files.slice(0, limit) : files;
  };
}
