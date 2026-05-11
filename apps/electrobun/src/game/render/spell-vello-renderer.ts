import { ExternalSource, Rectangle, type Renderer, Texture } from "pixi.js";

import { createLogger } from "@/utils/logger";

import {
  freeRenderTexture,
  loadSwfBundle,
  renderSwfSpellStrip,
} from "./vello-loader";

const log = createLogger("SpellVello");

/**
 * Soft cap on the (spellId, animation, resolution) → strip cache. Each
 * cached entry holds one wgpu texture + ExternalSource (a 256×… RGBA8
 * strip ≈ a few MB GPU). 128 entries bounds the working set at ~hundreds
 * of MB worst case — enough for an extended fight + tooltip preview
 * churn without growing into a session-lifetime leak. On eviction we
 * destroy the source AND free the wgpu texture (Drop for WebTexture is
 * a no-op — see feedback_pixi_wgpu_texture_lifetime).
 */
const ANIMATION_CACHE_CAP = 128;

/** Pre-rendered animation slice: one GPU strip, sliced into Pixi Textures. */
export interface SpellAnimation {
  frames: Texture[];
  frameCount: number;
  fps: number;
  offsetX: number;
  offsetY: number;
  /** Per-frame logical width/height (CSS pixels). Uniform across the strip — */
  frameWidth: number;
  frameHeight: number;
  /** Registration point in PIXEL coords within the frame; uniform per strip. */
  anchorPxX: number;
  anchorPxY: number;
}

/**
 * Spell counterpart to the character-sprite loader. Replaces the legacy
 * dofasset bake: each spell's `.swf` is loaded into Vello once, then the
 * AVM1 emulator (`render_avm1::AvmRenderer`) runs across the main timeline
 * to produce the same composite strip texture the asset-pipeline used to
 * pre-bake.
 *
 * Result: one Vello dispatch per spell animation, AS2 side-effects faithfully
 * driving the pixels (gotoAndStop, _alpha fades, _rotation, etc.), no bake
 * step. JS slices the strip into per-frame Pixi Textures so
 * FrameAnimatedSprite can swap cheaply.
 */
interface CachedSpellAnimation {
  animation: SpellAnimation;
  /** ExternalSource shared by every Texture in `animation.frames`. */
  source: ExternalSource;
  /** WASM-side wgpu texture id; freed on eviction. */
  textureId: number;
}

export class SpellVelloRenderer {
  /** spellId → bundle name once loaded (or null = sticky failure). */
  private readonly bundleNames = new Map<number, string | null>();
  private readonly pendingLoads = new Map<number, Promise<boolean>>();
  private readonly missingAssets = new Set<number>();
  /**
   * Cached strip per (spellId, animation, resolution). Map iteration
   * preserves insertion order so we can run a simple LRU: read hits
   * touch (delete + re-set), writes evict the oldest entry past
   * `ANIMATION_CACHE_CAP`. On eviction we destroy the ExternalSource
   * AND free the wgpu texture explicitly.
   */
  private readonly animationCache = new Map<string, CachedSpellAnimation>();

  constructor(private readonly pixiRenderer: Renderer) {}

  /**
   * Compatibility shim — the SWF render path reads its renderer from
   * the shared `vello-loader` singleton, so the explicit hand-off the
   * dofasset pipeline did via `setVelloRenderer` is now a no-op.
   */
  setVelloRenderer(_vello?: unknown): void {
    // intentionally empty
  }

  hasAsset(spellId: number): boolean {
    return this.bundleNames.get(spellId) != null;
  }

  bundleNameFor(spellId: number): string | undefined {
    return this.bundleNames.get(spellId) ?? undefined;
  }

  async loadAsset(spellId: number): Promise<boolean> {
    if (this.missingAssets.has(spellId)) {
      return false;
    }
    const cached = this.bundleNames.get(spellId);
    if (cached !== undefined) {
      return cached !== null;
    }
    const pending = this.pendingLoads.get(spellId);
    if (pending) {
      return pending;
    }
    const promise = this.doLoadAsset(spellId);
    this.pendingLoads.set(spellId, promise);
    try {
      return await promise;
    } finally {
      this.pendingLoads.delete(spellId);
    }
  }

  /**
   * Run the AVM1 emulator across the spell's main timeline and slice
   * the resulting strip into per-frame Pixi Textures. Cached per
   * `(spellId, animation, resolution)` so re-requests return the same
   * Textures sharing one ExternalSource.
   *
   * Note: spell SWFs only have one main timeline. The `animation` arg
   * is kept as a cache discriminator (so the dofasset-era manifest's
   * `anim1`/`anim2`/etc. keys still bucket correctly), but every key
   * resolves to the SAME strip — the SWF doesn't carry the
   * dofasset-era multi-animation split.
   */
  buildAnimation(
    spellId: number,
    animation: string,
    resolution: number
  ): SpellAnimation | null {
    const bundleName = this.bundleNames.get(spellId);
    if (!bundleName) {
      return null;
    }

    const cacheKey = `${spellId}:${animation}:${resolution}`;
    const cached = this.animationCache.get(cacheKey);
    if (cached) {
      // LRU touch — re-insert at the tail so eviction targets cold entries.
      this.animationCache.delete(cacheKey);
      this.animationCache.set(cacheKey, cached);
      return cached.animation;
    }

    const strip = renderSwfSpellStrip(bundleName, resolution);
    if (!strip) {
      log.warn(
        `spell ${spellId} anim=${animation}: AVM1 strip render returned null (resolution=${resolution})`
      );
      return null;
    }

    const stripSource = new ExternalSource({
      resource: strip.texture,
      renderer: this.pixiRenderer,
      width: strip.width,
      height: strip.height,
      label: `swf-spell:${spellId}:${animation}`,
    });
    stripSource.alphaMode = "no-premultiply-alpha";
    stripSource.format = "rgba8unorm";
    stripSource.scaleMode = "linear";
    stripSource.resolution = resolution;
    stripSource.autoGarbageCollect = false;

    const fw = strip.frameWidth / resolution;
    const fh = strip.frameHeight / resolution;
    const frames: Texture[] = [];
    for (let i = 0; i < strip.frameCount; i++) {
      const col = i % strip.gridCols;
      const row = Math.floor(i / strip.gridCols);
      frames.push(
        new Texture({
          source: stripSource,
          frame: new Rectangle(col * fw, row * fh, fw, fh),
        })
      );
    }

    const animation_: SpellAnimation = {
      frames,
      frameCount: strip.frameCount,
      fps: strip.fps,
      offsetX: -strip.anchorX / resolution,
      offsetY: -strip.anchorY / resolution,
      frameWidth: fw,
      frameHeight: fh,
      // Uniform anchor inherited from the strip's union-of-bounds origin.
      anchorPxX: strip.anchorX / resolution,
      anchorPxY: strip.anchorY / resolution,
    };
    // If a prior cast had this same (bundle, level, resolution), the
    // existing cache entry holds an earlier strip — dispose it before
    // overwriting so we don't strand a wgpu texture in
    // `VelloRenderer.textures` (Pixi's Drop for WebTexture is a no-op,
    // see `feedback_pixi_wgpu_texture_lifetime`).
    const previous = this.animationCache.get(cacheKey);
    if (previous) {
      this.disposeCached(previous);
    }
    this.animationCache.set(cacheKey, {
      animation: animation_,
      source: stripSource,
      textureId: strip.textureId,
    });
    while (this.animationCache.size > ANIMATION_CACHE_CAP) {
      const oldestKey = this.animationCache.keys().next().value;
      if (oldestKey === undefined) break;
      const evicted = this.animationCache.get(oldestKey);
      this.animationCache.delete(oldestKey);
      if (evicted) {
        this.disposeCached(evicted);
      }
    }
    return animation_;
  }

  /**
   * Drop every cached strip and free the underlying GPU storage.
   * Called on fight teardown. Live FrameAnimatedSprites still
   * referencing one of these Textures will sample a destroyed source on
   * their next render — they're expected to be torn down before this is
   * invoked. Pixi v8 handles a destroyed source gracefully (renders
   * empty) so a missed teardown is a visual artifact, not a crash.
   */
  clearAnimationCache(): void {
    for (const entry of this.animationCache.values()) {
      this.disposeCached(entry);
    }
    this.animationCache.clear();
  }

  private disposeCached(entry: CachedSpellAnimation): void {
    try {
      entry.source.destroy();
    } catch {
      // already destroyed — fine.
    }
    freeRenderTexture(entry.textureId);
  }

  private async doLoadAsset(spellId: number): Promise<boolean> {
    const bundleName = `spell-${spellId}`;
    const url = `/swf/spells/${spellId}.swf`;
    try {
      const ok = await loadSwfBundle(bundleName, url);
      if (!ok) {
        this.missingAssets.add(spellId);
        this.bundleNames.set(spellId, null);
        return false;
      }
      this.bundleNames.set(spellId, bundleName);
      return true;
    } catch (err) {
      log.warn(`Failed to load spell ${spellId}:`, err);
      this.missingAssets.add(spellId);
      this.bundleNames.set(spellId, null);
      return false;
    }
  }
}
