/**
 * WorldmapSwfRenderer — runtime SWF-driven minimap + worldmap tiles +
 * hint icons. Replaces the legacy `Assets.load("/assets/maps/world/.../tile_X_Y.webp")`
 * / `Assets.load("/assets/maps/hints/<gfx>.svg")` baked-asset pipeline.
 *
 * Each `superarea` corresponds to a single SWF bundle under
 * `assets/sources/clips/maps/<superarea>.swf` (served at `/swf/maps/<n>.swf`
 * via the vite swfPlugin). The SWF declares one named export per chunk —
 * the linkage id is canonically `"X_Y"` where (X,Y) are the chunk
 * coordinates (see `clips/MiniMap.as:451`, `attachMovie(_loc2_ + "_" +
 * _loc3_, …)`). For example, Amakna's `0.swf` carries exports `-6_-8`
 * through `2_3`.
 *
 * Chunks are rendered into the standalone Vello surface via
 * `renderSwfFrame` and the returned GPUTexture is wrapped as a Pixi
 * `ExternalSource` → `Sprite`. The caller is responsible for sprite
 * placement, scale, and — critically — calling `freeRenderTexture` when
 * the sprite is destroyed (the patched wgpu's `Drop for WebTexture` is a
 * no-op; see `feedback_pixi_wgpu_texture_lifetime`).
 *
 * Hints (`hints.swf` exports symbols named by raw gfxID — `"0"`, `"10"`,
 * `"422"`, …) follow the same runtime-render path.
 */

import { createLogger } from "@/utils/logger";

import {
  loadSwfBundle,
  renderSwfFrame,
  type VelloSwfFrameResult,
  whenVelloReady,
} from "./vello-loader";

const log = createLogger("WorldmapSwf");

const WORLDMAP_SWF_PATH = "/swf/maps";
const WORLDMAP_BUNDLE_PREFIX = "worldmap-";
const HINTS_BUNDLE_NAME = "worldmap-hints";
const HINTS_SWF_URL = "/swf/maps/hints.swf";

/**
 * Superarea → SWF basename mapping. Numeric superareas map to `<n>.swf`
 * (Amakna=0, Astrub=2, Incarnam=3) and named superareas to their literal
 * basename (e.g. `dungeon` → `dungeon.swf`). The dungeon variant has no
 * `X_Y` chunk grid — its content sits on the root timeline — so callers
 * who need dungeon backgrounds should fall back to `renderSwfRoot`
 * rather than `renderChunk`.
 */
export type WorldmapKey = number | string;

function worldmapBundleName(key: WorldmapKey): string {
  return `${WORLDMAP_BUNDLE_PREFIX}${key}`;
}

function worldmapSwfUrl(key: WorldmapKey): string {
  return `${WORLDMAP_SWF_PATH}/${key}.swf`;
}

const loadedWorldmaps = new Map<WorldmapKey, boolean>();
const inflightWorldmapLoads = new Map<WorldmapKey, Promise<boolean>>();

/**
 * Ensure the worldmap SWF bundle is loaded into Vello. Idempotent +
 * dedup'd across concurrent callers. Resolves true on success, false
 * on fetch / decode failure.
 */
export async function loadWorldmapBundle(key: WorldmapKey): Promise<boolean> {
  const cached = loadedWorldmaps.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const existing = inflightWorldmapLoads.get(key);
  if (existing) {
    return existing;
  }
  const promise = (async () => {
    try {
      // React mounts the minimap before the Battlefield bootstrap
      // finishes `initVello()`. Gating here keeps the wait at the
      // single bundle-load boundary rather than smearing it through
      // every consumer.
      await whenVelloReady();
      const ok = await loadSwfBundle(worldmapBundleName(key), worldmapSwfUrl(key));
      loadedWorldmaps.set(key, ok);
      if (!ok) {
        log.warn(`failed to load worldmap SWF for ${key}`);
      }
      return ok;
    } catch (err) {
      log.warn(`worldmap load threw for ${key}: ${String(err)}`);
      loadedWorldmaps.set(key, false);
      return false;
    } finally {
      inflightWorldmapLoads.delete(key);
    }
  })();
  inflightWorldmapLoads.set(key, promise);
  return promise;
}

/**
 * Render one worldmap chunk. The export name follows the canonical
 * `"X_Y"` convention from MiniMap.as. Returns null if the bundle isn't
 * loaded yet OR the chunk isn't declared in the SWF (ocean / out-of-
 * world cells legitimately have no export). The caller wraps the
 * returned `texture` as `ExternalSource` and is responsible for
 * `freeRenderTexture(textureId)` once the sprite is destroyed.
 */
export function renderWorldmapChunk(
  key: WorldmapKey,
  chunkX: number,
  chunkY: number,
  resolution: number,
): VelloSwfFrameResult | null {
  if (!loadedWorldmaps.get(key)) {
    return null;
  }
  const exportName = `${chunkX}_${chunkY}`;
  return renderSwfFrame(worldmapBundleName(key), exportName, 0, resolution);
}

let hintsLoaded = false;
let hintsLoading: Promise<boolean> | null = null;

/**
 * Ensure `hints.swf` is loaded once. Hints export names are bare numeric
 * gfxIDs (the SWF maps each hint's `gfx` field directly to a symbol
 * name — see MiniMap.as:506 `attachMovie(_loc7_.gfx, …)`).
 */
export async function loadHintsBundle(): Promise<boolean> {
  if (hintsLoaded) {
    return true;
  }
  if (!hintsLoading) {
    hintsLoading = (async () => {
      try {
        await whenVelloReady();
        const ok = await loadSwfBundle(HINTS_BUNDLE_NAME, HINTS_SWF_URL);
        hintsLoaded = ok;
        if (!ok) {
          log.warn("failed to load hints.swf");
        }
        return ok;
      } catch (err) {
        log.warn(`hints load threw: ${String(err)}`);
        return false;
      } finally {
        hintsLoading = null;
      }
    })();
  }
  return hintsLoading;
}

/**
 * Render one hint icon by gfxID. Returns null if the bundle isn't
 * loaded yet OR the gfxID has no export (graceful — the caller skips
 * the placement). Texture lifetime is the caller's job.
 */
export function renderHintIcon(
  gfxId: number,
  resolution: number,
): VelloSwfFrameResult | null {
  if (!hintsLoaded) {
    return null;
  }
  return renderSwfFrame(HINTS_BUNDLE_NAME, String(gfxId), 0, resolution);
}
