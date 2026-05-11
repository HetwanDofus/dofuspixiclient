import type { Container, Renderer, Texture, TextureSource } from "pixi.js";

import type { PickableObject, PickResult } from "@/game/types";

/**
 * CPU-based pixel-perfect picking system.
 *
 * Instead of rendering a GPU picking texture every frame, this system:
 * 1. AABB-checks all pickable sprites against the query point (O(n), microseconds)
 * 2. For candidates, samples pixel alpha from a cached alpha map of the texture
 * 3. Returns the topmost (highest zIndex) non-transparent hit
 *
 * Alpha maps are extracted once per unique TextureSource and cached forever.
 * Total per-pick cost: ~300 AABB comparisons + 0-3 alpha lookups = <0.1ms.
 */
export class PickingSystem {
  private renderer: Renderer;
  private pickableObjects: Map<number, PickableObject> = new Map();

  /** Cached alpha maps keyed by TextureSource.uid. Extracted once, used forever. */
  private alphaMaps: Map<
    number,
    { data: Uint8Array; width: number; height: number }
  > = new Map();

  /** Pending alpha extractions to avoid duplicate work */
  private pendingExtractions: Set<number> = new Set();

  /** Sources that failed extraction — skip them forever (use AABB fallback) */
  private failedSources: Set<number> = new Set();

  constructor(renderer: Renderer, _minPickInterval = 16) {
    this.renderer = renderer;
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
   * Drop the alpha-map cache + failure markers. Call on map transition
   * so stale TextureSource UIDs from the prior map don't accumulate as
   * dead entries in the cache (each entry holds a `Uint8Array(w*h)` —
   * 1-3MB JS heap per character source, dozens per map). The next pick
   * after this re-extracts on demand for the new map's TextureSources.
   *
   * The staging buffers used during extraction are device buffers
   * scoped to each `extractAlphaMapAsync` call and destroyed in their
   * own `.then`/`.catch` continuations — they do not need to be
   * cleaned up here.
   */
  clearAlphaCache(): void {
    this.alphaMaps.clear();
    this.failedSources.clear();
    // pendingExtractions: leave alone — those are in-flight async
    // continuations whose resolution will populate alphaMaps; clearing
    // would cause double-extracts for the same uid if a pick happens
    // while resolution is pending.
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

      const uvX = adjX / texW;
      const uvY = adjY / texH;

      if (this.checkAlpha(sprite.texture, uvX, uvY)) {
        bestResult = { object: obj, x: screenX, y: screenY };
        bestZIndex = z;
      }
    }

    return bestResult;
  }

  /**
   * Check if the pixel at (uvX, uvY) within the texture frame is non-transparent.
   * Uses a cached alpha map extracted once per TextureSource.
   */
  private checkAlpha(texture: Texture, uvX: number, uvY: number): boolean {
    const source = texture.source;
    const sourceUid = source.uid;

    // If extraction previously failed for this source, fall back to AABB
    if (this.failedSources.has(sourceUid)) {
      return true;
    }

    const alphaMap = this.alphaMaps.get(sourceUid);

    if (!alphaMap) {
      // Trigger async extraction (one-time cost per TextureSource).
      this.extractAlphaMapAsync(source);
      // While the readback is in flight (2-3 frames), fall back to
      // AABB. The caller already validated `localPoint` is inside
      // `[0, texW] × [0, texH]`, so accepting the hit here just
      // makes the pick rectangle-precise instead of silhouette-
      // precise during the gap. Returning `false` was the previous
      // behaviour and left chars temporarily un-hoverable every
      // animation swap / zoom-step re-render — the canonical
      // "hover stops working after the sprite moves" symptom.
      return true;
    }

    // Map UV to pixel position within the texture frame.
    // frame.x/y/width/height are in CSS pixels; alpha map is in actual pixels.
    const res = source.resolution || 1;
    const frame = texture.frame;
    const px = Math.floor((frame.x + uvX * frame.width) * res);
    const py = Math.floor((frame.y + uvY * frame.height) * res);

    if (px < 0 || px >= alphaMap.width || py < 0 || py >= alphaMap.height) {
      return false;
    }

    const idx = py * alphaMap.width + px;
    return alphaMap.data[idx] > 10; // Small threshold to handle anti-aliasing
  }

  /**
   * Asynchronously extract and cache the alpha channel from a TextureSource via WebGPU.
   * Uses copyTextureToBuffer + mapAsync to read pixels from the GPU without blocking.
   * Done once per source — subsequent picks use the cached alpha map.
   */
  private extractAlphaMapAsync(source: TextureSource): void {
    const sourceUid = source.uid;

    // Already cached, pending, or failed
    if (
      this.alphaMaps.has(sourceUid) ||
      this.pendingExtractions.has(sourceUid) ||
      this.failedSources.has(sourceUid)
    ) {
      return;
    }
    this.pendingExtractions.add(sourceUid);

    // Pixi's WebGPU internals aren't in the public types. Narrow via unknown
    // rather than `any` — still a boundary cast, but the shape is documented.
    const gpuTexture = (source as unknown as { resource?: GPUTexture })
      .resource;
    const device = (
      this.renderer as unknown as { gpu?: { device?: GPUDevice } }
    ).gpu?.device;

    if (!gpuTexture || !device || typeof gpuTexture.width !== "number") {
      this.failedSources.add(sourceUid);
      this.pendingExtractions.delete(sourceUid);
      return;
    }

    try {
      const w = gpuTexture.width;
      const h = gpuTexture.height;
      const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
      const bufferSize = bytesPerRow * h;

      const stagingBuffer = device.createBuffer({
        size: bufferSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });

      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture: gpuTexture },
        { buffer: stagingBuffer, bytesPerRow, rowsPerImage: h },
        { width: w, height: h }
      );
      device.queue.submit([encoder.finish()]);

      stagingBuffer
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          const mapped = new Uint8Array(stagingBuffer.getMappedRange());
          const alphaData = new Uint8Array(w * h);

          for (let row = 0; row < h; row++) {
            const rowOffset = row * bytesPerRow;

            for (let col = 0; col < w; col++) {
              alphaData[row * w + col] = mapped[rowOffset + col * 4 + 3];
            }
          }

          stagingBuffer.unmap();
          stagingBuffer.destroy();
          this.alphaMaps.set(sourceUid, {
            data: alphaData,
            width: w,
            height: h,
          });
          this.pendingExtractions.delete(sourceUid);
        })
        .catch(() => {
          stagingBuffer.destroy();
          this.pendingExtractions.delete(sourceUid);
        });
    } catch {
      // GPU texture was destroyed (e.g., zoom changed) — skip, will retry with new texture
      this.pendingExtractions.delete(sourceUid);
    }
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
    this.alphaMaps.clear();
    this.pendingExtractions.clear();
    this.failedSources.clear();
  }
}
