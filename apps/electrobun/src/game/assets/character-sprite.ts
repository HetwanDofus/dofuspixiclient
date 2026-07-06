import type { Renderer } from "pixi.js";
import type { VelloRenderer } from "vello-wasm";

import type { FrameAtlas } from "@/game/render/frame-atlas";
import {
  lookIndexToMountSlot,
  preloadAccessoryBundles,
  resolveAccessoryBundle,
} from "@/game/assets/accessory-resolver";
import { parseLook } from "@/game/assets/look-parser";
import { VelloAssetRegistry } from "@/game/assets/vello-asset-registry";
import { Direction } from "@/game/fight/types";
import { swfAnimFrameCount } from "@/game/render/vello-loader";

/**
 * Reference to one accessory mounted on a character. Slot mirrors
 * canonical AS2 `applyAccessory(slot, side)`:
 *   1 = hat, 2 = cape, 3 = weapon, 4 = shield, 5 = pet
 *
 * `animType`: 0 = static, 1 = walk, 2 = run — picks which slot-
 * specific direction-fallback table the renderer walks.
 */
export interface AccessoryRef {
  slot: number;
  bundle: string;
  exportName: string;
  animType: 0 | 1 | 2;
}

/**
 * Per-(gfxId, animName, look) animation metadata. Carries the Vello
 * SWF render parameters (bundle/export/fps/frameCount) plus
 * pre-resolved accessories + color zones. Consumed by
 * `PlayerStripRenderer.applyAnimation` to dispatch the strip render.
 */
export interface CharacterAnimation {
  /** Loaded SWF bundle name (e.g. "sprite-10", "chevauchor-3"). */
  bundle: string;
  /** Resolved export name including direction suffix (e.g. "static_R"). */
  exportName: string;
  /** Authored fps for animation cursor advance. */
  fps: number;
  /** Total frames in the timeline (1 for static, N for walk/run/etc.). */
  frameCount: number;
  /** Pre-resolved accessory list for this look + animType combo. */
  accessories: AccessoryRef[];
  /**
   * Three RGB-packed `0xRRGGBB` color zone values per AS2
   * `applyColor` mounts, or null when the look carries no class
   * tinting (mobs / no-class characters). `-1` per zone = unset
   * (canonical applyColor skips only `undefined`/`-1`; `0` is a
   * REAL colour — flat black). Threaded directly into
   * `CharWorldPlacement.colorZones` — eliminates the legacy
   * `setSwfPlayerColors` global state.
   */
  colorZones: [number, number, number] | null;
}

// R = right, L = left, F = front, B = back, S = south-east (default Dofus view).
// Directions 3 (SW), 4 (W), 7 (NE) reuse mirrored suffixes with horizontal flip.
const DIRECTION_SUFFIX: Record<number, string> = {
  [Direction.EAST]: "S",
  [Direction.SOUTH_EAST]: "R",
  [Direction.SOUTH]: "F",
  [Direction.SOUTH_WEST]: "R",
  [Direction.WEST]: "S",
  [Direction.NORTH_WEST]: "L",
  [Direction.NORTH]: "B",
  [Direction.NORTH_EAST]: "L",
};

const DIRECTION_FLIP: Record<number, boolean> = {
  [Direction.EAST]: false,
  [Direction.SOUTH_EAST]: false,
  [Direction.SOUTH]: false,
  [Direction.SOUTH_WEST]: true,
  [Direction.WEST]: true,
  [Direction.NORTH_WEST]: false,
  [Direction.NORTH]: false,
  [Direction.NORTH_EAST]: true,
};

// Fallback chain when an animation+direction variant doesn't exist.
// Monster SWFs only export `L`/`R` variants (no S/F/B), so any miss
// must be able to land on one of those two suffixes — otherwise the
// monster boots without a sprite and only the placeholder rectangle
// shows. The original chain `S → R → F` would still miss when only
// L/R exist (we'd give up after F), so every entry now ends in `L`.
const SUFFIX_FALLBACKS: Record<string, string[]> = {
  S: ["R", "F", "L"],
  R: ["S", "F", "L"],
  L: ["R", "S", "F"],
  F: ["S", "R", "L"],
  B: ["S", "L", "R"],
};

// Monster SWFs use a numeric anim taxonomy (anim0/anim1/anim2/die/hit)
// instead of the player-side static/walk/run/anim0/animH/animF/...
// We don't know per gfxId which side of the taxonomy a sprite uses,
// so the loader probes the player names first and falls back to the
// monster names. Mapping verified against the canonical 1.29 client:
// monster `setAnim("static")` resolves via library aliasing to the
// SWF's first idle clip, which the SVG export records as `anim1` for
// most monsters (anim0 is reserved for the spawn / appear pose).
const MONSTER_ANIM_FALLBACKS: Record<string, string[]> = {
  static: ["anim1", "anim0", "anim2"],
  walk: ["anim2", "anim1"],
  run: ["anim2", "anim1"],
  anim0: ["anim1"],
  anim1: ["anim2", "anim0"],
};

export function getAnimationName(baseAnim: string, direction: number): string {
  const suffix = DIRECTION_SUFFIX[direction] ?? "S";
  return `${baseAnim}${suffix}`;
}

export function getDirectionSuffix(direction: number): string {
  return DIRECTION_SUFFIX[direction] ?? "S";
}

export function isDirectionFlipped(direction: number): boolean {
  return DIRECTION_FLIP[direction] ?? false;
}

/** Per-(gfxId, animName) → 0-based applyEnd frame index. */
type ApplyEndCache = Map<string, number>;

/**
 * Resolves `(gfxId, animName, look)` into the metadata the unified
 * World layer needs to encode a Char placement. Owns SWF bundle
 * loading via `VelloAssetRegistry`, accessory bundle resolution, and
 * the small metadata cache.
 *
 * No GPU textures are owned here — the layer composes pixels every
 * tick via `render_world_pass`, so there is nothing to evict on zoom
 * or look changes. The cache is bounded by the natural cardinality
 * of `(gfxId, animName, look)` triples encountered during play, which
 * is small.
 */
export class CharacterSpriteLoader {
  private cache = new Map<string, CharacterAnimation>();
  private pending = new Map<string, Promise<CharacterAnimation | null>>();
  private currentZoom = 1;
  private vello: VelloRenderer | null = null;
  private pixiRenderer: Renderer | null = null;
  private readonly assets = new VelloAssetRegistry();
  // applyEnd map per gfxId — recovering the AS2 `GAC.applyEnd(this)`
  // call frame would require a Rust-side bytecode detector. Until that
  // lands, we leave the map empty: PlayerRenderer's `getApplyEndFrame`
  // returns `null`, which makes its one-shot completion gracefully
  // fall back to a near-frame-0 launch + last-frame hit.
  private readonly applyEndByGfx = new Map<number, ApplyEndCache | null>();

  setVelloRenderer(vello: VelloRenderer, pixiRenderer: Renderer): void {
    this.vello = vello;
    this.pixiRenderer = pixiRenderer;
  }

  /**
   * Stub kept for the existing `getAtlas()?.tick()` callsite in the
   * PlayerRenderer pre/post-tick hooks. The legacy FrameAtlas was a
   * 16384×8192 GPU strip cache; the World layer composes chars
   * directly so there is no atlas anymore.
   */
  getAtlas(): FrameAtlas | null {
    return null;
  }

  /**
   * No-op shim — recovering the AS2 applyEnd-frame would need a
   * Rust-side `swf_doc.rs` bytecode walker. Until then, returns null
   * so existing call sites compose unchanged.
   */
  async loadApplyEnd(gfxId: number): Promise<ApplyEndCache | null> {
    if (!this.applyEndByGfx.has(gfxId)) {
      this.applyEndByGfx.set(gfxId, null);
    }
    return null;
  }

  getApplyEndFrame(gfxId: number, animName: string): number | null {
    const cache = this.applyEndByGfx.get(gfxId);
    if (!cache) {
      return null;
    }
    return cache.get(animName) ?? null;
  }

  /**
   * Track display zoom for any future zoom-aware behavior. Does NOT
   * invalidate the cache — animation metadata is zoom-independent
   * under the unified renderer (the World layer's RT lives at fixed
   * MAX_DENSITY internally).
   */
  setZoom(zoom: number): void {
    this.currentZoom = zoom;
  }

  /**
   * Preserved for symmetry with the legacy API. The metadata cache
   * is small and maps bundle + accessory state per look — wiping it
   * on map change avoids leaking entries for actors that won't
   * appear on the new map. SWF bundles inside the WASM stay loaded.
   *
   * Also clears the asset registry's gfxId→bundle-name map so its
   * `bundleNames` and `pendingLoads` don't accumulate one entry per
   * unique NPC ever encountered. The WASM-side `loadedSwfBundles`
   * set is the canonical "is this bundle ready" gate and stays
   * intact, so re-encountering the same gfxId on a future map
   * re-runs only the (cheap) `loadSprite` bookkeeping path.
   */
  clearForMapChange(): void {
    this.cache.clear();
    this.pending.clear();
    this.assets.clear();
  }

  async loadAnimation(
    gfxId: number,
    animName: string,
    look?: string
  ): Promise<CharacterAnimation | null> {
    const key = cacheKey(gfxId, animName, look);
    const cached = this.cache.get(key);

    if (cached) {
      return cached;
    }

    const pendingLoad = this.pending.get(key);

    if (pendingLoad) {
      return pendingLoad;
    }

    const promise = this.doLoadAnimation(gfxId, animName, look);
    this.pending.set(key, promise);

    try {
      return await promise;
    } finally {
      this.pending.delete(key);
    }
  }

  /** Try the requested animation+direction, then direction fallbacks. */
  async loadAnimationWithFallback(
    gfxId: number,
    baseAnim: string,
    direction: number,
    look?: string
  ): Promise<{ animation: CharacterAnimation; animName: string } | null> {
    const suffix = getDirectionSuffix(direction);
    const baseProbes = [baseAnim, ...(MONSTER_ANIM_FALLBACKS[baseAnim] ?? [])];

    for (const base of baseProbes) {
      const direct = await this.loadAnimation(gfxId, `${base}${suffix}`, look);
      if (direct) {
        return { animation: direct, animName: `${base}${suffix}` };
      }
      for (const fb of SUFFIX_FALLBACKS[suffix] ?? []) {
        const fbName = `${base}${fb}`;
        const result = await this.loadAnimation(gfxId, fbName, look);
        if (result) {
          return { animation: result, animName: fbName };
        }
      }
    }

    return null;
  }

  getAnimationSync(
    gfxId: number,
    animName: string,
    look?: string
  ): CharacterAnimation | null {
    return this.cache.get(cacheKey(gfxId, animName, look)) ?? null;
  }

  /** True once the gfxId's SWF bundle is loaded into the WASM renderer. */
  hasBundle(gfxId: number): boolean {
    return !!this.assets.getSpriteBundleName(gfxId);
  }

  private async doLoadAnimation(
    gfxId: number,
    animName: string,
    look?: string
  ): Promise<CharacterAnimation | null> {
    if (!this.vello || !this.pixiRenderer) {
      return null;
    }

    const loaded = await this.assets.loadSprite(gfxId);
    const bundleName = this.assets.getSpriteBundleName(gfxId);
    if (!loaded || !bundleName) {
      return null;
    }

    let frameCount = swfAnimFrameCount(bundleName, animName);
    if (frameCount <= 0) {
      return null;
    }
    // Dofus character SWFs export `staticR/L/F/B/S` as a 1-frame wrapper
    // that places a multi-frame inner rig. Without an AVM1 tick on the
    // wrapper our timeline walker plays every frame of the inner rig
    // and the character "breathes" while idle. Clamp static anims to
    // frame 0 so they hold the canonical pose.
    if (animName.startsWith("static")) {
      frameCount = 1;
    }

    // Character anims advance at a CONSTANT host rate, NOT each SWF's own
    // authored frame-rate. In canonical Flash/AS2 a loaded SWF plays at the
    // ROOT movie's frame-rate; the 1.29 client root is `preloader.swf`,
    // authored at 60 fps (see wc3 `tick_anim.rs` HOST_FPS). Character sprite
    // SWFs carry inconsistent header frame-rates (e.g. gfx 1 = 12, gfx 111 =
    // 40, most = 60) that are authoring-tool leftovers — honouring them made
    // some bots animate several× too slow. Tiles/objects DO use their own
    // rate, so that path keeps `swfBundleFrameRate`.
    const HOST_FPS = 60;
    const fps = HOST_FPS;

    const parsed = look ? parseLook(look) : null;
    // Canonical sentinel: -1 (or NaN/undefined) = zone unset → authored
    // fill. 0 is a legitimate flat-black tint (GlobalSpriteHandler.as
    // applyColor skips only undefined/-1).
    const normZone = (c: number) => (Number.isFinite(c) && c >= 0 ? c : -1);
    const colorZones = parsed
      ? ([
          normZone(parsed.color1),
          normZone(parsed.color2),
          normZone(parsed.color3),
        ] as [number, number, number])
      : null;

    // Resolve accessory bundle list. Each entry feeds the World layer's
    // per-placement accessory CSR, so the Rust side can compose the
    // canonical hat / cape / weapon / shield / pet on top of the body
    // every tick. animType drives the per-slot direction-fallback
    // table the renderer walks (cape mirrors differently for run vs
    // walk vs static).
    const accessories: AccessoryRef[] = [];
    if (parsed && parsed.accessories.length > 0) {
      await preloadAccessoryBundles();
      const animType: 0 | 1 | 2 = animName.startsWith("run")
        ? 2
        : animName.startsWith("static")
          ? 0
          : 1;
      for (let i = 0; i < parsed.accessories.length; i++) {
        const acc = parsed.accessories[i];
        if (acc.type <= 0 || acc.gfxId <= 0) continue;
        const slot = lookIndexToMountSlot(i);
        if (slot === null) continue;
        const accBundle = resolveAccessoryBundle(acc.type, acc.gfxId);
        if (!accBundle) {
          console.warn(
            `[character-sprite] accessory look[${i}] type=${acc.type} gfx=${acc.gfxId} → no bundle has symbol "${acc.type}_${acc.gfxId}"`
          );
          continue;
        }
        accessories.push({
          slot,
          bundle: accBundle,
          exportName: `${acc.type}_${acc.gfxId}`,
          animType,
        });
      }
    }

    const animation: CharacterAnimation = {
      bundle: bundleName,
      exportName: animName,
      fps,
      frameCount,
      accessories,
      colorZones,
    };

    const key = cacheKey(gfxId, animName, look);
    this.cache.set(key, animation);
    return animation;
  }

  clear(): void {
    this.cache.clear();
    this.pending.clear();
    this.assets.clear();
  }

  /** Read-only access to the current zoom for any zoom-aware consumer. */
  getZoom(): number {
    return this.currentZoom;
  }

  getStats(): {
    cache: number;
    pending: number;
    applyEnd: number;
    assetBundles: number;
    assetPending: number;
  } {
    const a = this.assets.getStats();
    return {
      cache: this.cache.size,
      pending: this.pending.size,
      applyEnd: this.applyEndByGfx.size,
      assetBundles: a.bundleNames,
      assetPending: a.pendingLoads,
    };
  }
}

function cacheKey(gfxId: number, animName: string, look?: string): string {
  return look ? `${gfxId}:${animName}:${look}` : `${gfxId}:${animName}`;
}

let globalLoader: CharacterSpriteLoader | null = null;

export function getCharacterSpriteLoader(): CharacterSpriteLoader {
  if (!globalLoader) {
    globalLoader = new CharacterSpriteLoader();
  }

  return globalLoader;
}

export function initCharacterSpriteLoader(): CharacterSpriteLoader {
  if (!globalLoader) {
    globalLoader = new CharacterSpriteLoader();
  }

  return globalLoader;
}
