import type { Container, Renderer } from "pixi.js";

import type {
  AlphaMapAccessor,
  PickableObject,
  PickResult,
} from "@/game/types";

/**
 * Stub accessor handed to `PickableObject.alphaTest` callbacks for
 * shape compatibility. Always returns null — current `alphaTest`
 * implementations (e.g. `player-strip-renderer-v2.getSlotAlphaTest`)
 * read their own pre-baked silhouette and ignore this parameter.
 * Kept on the interface so a future caller could re-introduce a
 * working pixel-cache accessor without changing the call shape.
 */
const NO_ALPHA_MAP_ACCESSOR: AlphaMapAccessor = {
  get: () => null,
};

/**
 * CPU-based picking system.
 *
 * Per pick query:
 * 1. AABB-test every registered pickable's sprite against the query
 *    point (O(n), microseconds).
 * 2. For each candidate that passes AABB, if the pickable supplies a
 *    custom `alphaTest`, call it for pixel-perfect silhouette
 *    rejection. Without `alphaTest`, the AABB hit is taken as-is.
 * 3. Return the topmost (highest zIndex) hit.
 *
 * Silhouette extraction strategy: each pickable owns its own
 * pixel-test. Characters return `getSlotAlphaTest` which reads from
 * a pre-baked, in-memory `Uint8Array` silhouette (worker-extracted at
 * class atlas bake time; see `bake-worker.ts:handleBake`). This
 * keeps picking entirely on the CPU at lookup time — no per-pick
 * GPU readback, no per-source `OffscreenCanvas` extraction, no
 * caching of GPU-side alpha textures (the previous
 * `extractAlphaMapAsync` path tried this and failed: Pixi v8's
 * `source.resource` exposes the upload-side `ImageBitmap`, not the
 * GPUTexture, so `copyTextureToBuffer` validation rejected every
 * call and the retry-on-catch loop produced a 60Hz GPU error storm
 * every time the cursor sat on a non-character pickable).
 */
export class PickingSystem {
  private pickableObjects: Map<number, PickableObject> = new Map();

  constructor(_renderer: Renderer, _minPickInterval = 16) {
    // Renderer kept in the constructor signature for API stability —
    // the previous GPU-readback path needed `renderer.gpu.device`,
    // the silhouette-based path does not. Removed the field to avoid
    // suggesting future readback work is supported.
  }

  initializeTexture(_width: number, _height: number): void {
    // No-op: CPU picking doesn't need a render texture
  }

  registerObject(object: PickableObject): void {
    this.pickableObjects.set(object.id, object);
  }

  unregisterObject(id: number): void {
    this.pickableObjects.delete(id);
  }

  clear(): void {
    this.pickableObjects.clear();
  }

  getStats(): {
    pickable: number;
    alphaMaps: number;
    pendingExtractions: number;
    failedSources: number;
  } {
    return {
      pickable: this.pickableObjects.size,
      // alphaMaps / pendingExtractions / failedSources stay in the
      // stats shape (consumers in the debug HUD read them) but the
      // GPU-readback alpha cache no longer exists.
      alphaMaps: 0,
      pendingExtractions: 0,
      failedSources: 0,
    };
  }

  /**
   * Pick the topmost char placement in the unified World layer at
   * `(screenX, screenY)`. Returns the player id whose alpha-bitmap
   * silhouette covers the screen point in reverse-depth order, or
   * null on miss.
   *
   * Currently a stub — full implementation requires a Rust-side
   * `render_char_alpha_bitmap(...)` shipping per-(gfxId, anim, frame,
   * accHash, zoneHash) bitmaps for the cache lookup
   * (`CHARACTER_RENDERER_AUDIT.md` §4.2). Until then, char picking
   * gracefully degrades: hover / click events on chars route through
   * the cell-based picker only. The API surface here is stable so
   * once the Rust function lands, only the implementation needs an
   * update — every consumer call site is in place.
   */
  pickWorldChar(_screenX: number, _screenY: number): number | null {
    return null;
  }

  /**
   * No-op kept for API compatibility. Previously this dropped the
   * GPU-readback alpha cache on map transition. The current
   * silhouette-based picking holds its alpha bytes inside each
   * `VariantInfo` (owned by `CharacterCache` and freed via class
   * atlas eviction), so the picking system itself has nothing to
   * invalidate on map change.
   */
  clearAlphaCache(): void {
    // No state to clear.
  }

  markDirty(): void {
    // No-op: CPU picking doesn't cache scene state
  }

  /**
   * Pick the topmost sprite at screen coordinates (x, y).
   * Pure CPU — no GPU work. Safe to call every frame.
   */
  pick(
    screenX: number,
    screenY: number,
    _worldContainer: Container,
    _forceUpdate = false
  ): PickResult | null {
    let bestResult: PickResult | null = null;
    let bestZIndex = -Infinity;

    for (const [, obj] of this.pickableObjects) {
      const sprite = obj.sprite;
      const container = obj.parentContainer;

      if (!sprite.visible || !sprite.texture || !sprite.parent) {
        continue;
      }

      // `sprite.toLocal` returns coords in the sprite's untransformed
      // local space; per Pixi v8 `updateQuadBounds`, that span is
      // `[-anchor.x*texW, (1-anchor.x)*texW] × [-anchor.y*texH, ...]`,
      // NOT `[0, texW] × [0, texH]`. Shifting by `anchor*texSize`
      // re-aligns the local point with the texture frame's top-left
      // so the bounds check + UV calc both work for SWF-anchored
      // sprites (chars, foreground tiles), not just anchor=(0,0).
      const localPoint = sprite.toLocal({ x: screenX, y: screenY });
      const texW = sprite.texture.frame.width;
      const texH = sprite.texture.frame.height;
      const ax = sprite.anchor.x * texW;
      const ay = sprite.anchor.y * texH;
      const adjX = localPoint.x + ax;
      const adjY = localPoint.y + ay;

      if (adjX < 0 || adjX >= texW || adjY < 0 || adjY >= texH) {
        continue;
      }

      const z = (container?.zIndex ?? sprite.parent?.zIndex) || 0;

      if (z < bestZIndex) {
        continue;
      }

      // Pixel-perfect rejection if the pickable opts in via
      // `alphaTest` (e.g. characters carry a worker-baked silhouette
      // they can sample at `(adjX, adjY)`). Without `alphaTest`, the
      // AABB hit stands — the prior GPU-readback alpha cache
      // (`extractAlphaMapAsync`) never worked for Pixi v8 sources
      // and was deleted to stop the 60Hz GPU-error storm it
      // produced on every hover.
      const hit = obj.alphaTest
        ? obj.alphaTest(adjX, adjY, NO_ALPHA_MAP_ACCESSOR)
        : true;
      if (hit) {
        bestResult = { object: obj, x: screenX, y: screenY };
        bestZIndex = z;
      }
    }

    return bestResult;
  }

  getPickableObjects(): PickableObject[] {
    return Array.from(this.pickableObjects.values());
  }

  getObject(id: number): PickableObject | undefined {
    return this.pickableObjects.get(id);
  }

  getPickingTexture(): null {
    return null;
  }

  getPickingContainer(): null {
    return null;
  }

  destroy(): void {
    this.pickableObjects.clear();
  }
}
