import { Container, Sprite, Texture, type Renderer, type TextureSource } from 'pixi.js';
import type { PickableObject, PickResult } from '@/types';

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
  private alphaMaps: Map<number, { data: Uint8Array; width: number; height: number }> = new Map();

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

  markDirty(): void {
    // No-op: CPU picking doesn't cache scene state
  }

  /**
   * Pick the topmost sprite at screen coordinates (x, y).
   * Pure CPU — no GPU work. Safe to call every frame.
   */
  pick(screenX: number, screenY: number, _worldContainer: Container, _forceUpdate = false): PickResult | null {
    let bestResult: PickResult | null = null;
    let bestZIndex = -Infinity;

    for (const [, obj] of this.pickableObjects) {
      const sprite = obj.sprite;
      const container = obj.parentContainer;
      if (!sprite.visible || !sprite.texture || !sprite.parent) continue;

      const localPoint = sprite.toLocal({ x: screenX, y: screenY });

      const texW = sprite.texture.frame.width;
      const texH = sprite.texture.frame.height;

      if (localPoint.x < 0 || localPoint.x >= texW || localPoint.y < 0 || localPoint.y >= texH) continue;

      const z = (container?.zIndex ?? sprite.parent?.zIndex) || 0;
      if (z < bestZIndex) continue;

      const uvX = localPoint.x / texW;
      const uvY = localPoint.y / texH;

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
    if (this.failedSources.has(sourceUid)) return true;

    let alphaMap = this.alphaMaps.get(sourceUid);
    if (!alphaMap) {
      // Trigger async extraction (one-time cost per TextureSource)
      this.extractAlphaMapAsync(source);
      // No alpha data yet — reject to avoid false positives
      return false;
    }

    // Map UV to pixel position within the texture frame.
    // frame.x/y/width/height are in CSS pixels; alpha map is in actual pixels.
    const res = source.resolution || 1;
    const frame = texture.frame;
    const px = Math.floor((frame.x + uvX * frame.width) * res);
    const py = Math.floor((frame.y + uvY * frame.height) * res);

    if (px < 0 || px >= alphaMap.width || py < 0 || py >= alphaMap.height) return false;

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
    if (this.alphaMaps.has(sourceUid) || this.pendingExtractions.has(sourceUid) || this.failedSources.has(sourceUid)) return;
    this.pendingExtractions.add(sourceUid);

    // Get the underlying GPUTexture from the source's resource
    const gpuTexture = (source as any).resource as GPUTexture | undefined;
    // Get the WebGPU device from the Pixi renderer
    const device = (this.renderer as any).gpu?.device as GPUDevice | undefined;

    if (!gpuTexture || !device || typeof gpuTexture.width !== 'number') {
      this.failedSources.add(sourceUid);
      this.pendingExtractions.delete(sourceUid);
      return;
    }

    try {
      const w = gpuTexture.width;
      const h = gpuTexture.height;
      const bytesPerRow = Math.ceil(w * 4 / 256) * 256;
      const bufferSize = bytesPerRow * h;

      const stagingBuffer = device.createBuffer({
        size: bufferSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });

      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture: gpuTexture },
        { buffer: stagingBuffer, bytesPerRow, rowsPerImage: h },
        { width: w, height: h },
      );
      device.queue.submit([encoder.finish()]);

      stagingBuffer.mapAsync(GPUMapMode.READ).then(() => {
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
        this.alphaMaps.set(sourceUid, { data: alphaData, width: w, height: h });
        this.pendingExtractions.delete(sourceUid);
      }).catch(() => {
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
