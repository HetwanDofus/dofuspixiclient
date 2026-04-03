/**
 * Per-frame atlas cache — shared slots across characters.
 *
 * Slots keyed by visual state: (assetId, animName, frameIndex, colors, accessories).
 * Characters with the same look share cached frames.
 * After warmup (~1s): 0 renders, 60fps.
 */
import { ExternalSource, Rectangle, Texture, type Renderer } from "pixi.js";
import type { VelloRenderer } from "vello-wasm";

interface FrameSlot {
  index: number;
  pixelX: number;
  pixelY: number;
  pixiTexture: Texture;
  lastUsedTick: number;
}

export class FrameAtlas {
  private vello: VelloRenderer;
  private pixiRenderer: Renderer;
  readonly resolution: number;

  private readonly slotW: number;
  private readonly slotH: number;
  private readonly cols: number;
  private readonly maxSlots: number;
  private readonly atlasW: number;
  private readonly atlasH: number;

  private atlasTextureId = -1;
  private atlasSource: ExternalSource | null = null;
  private frameCache = new Map<string, FrameSlot>();
  private freeList: number[] = [];
  private nextSlot = 0;
  private currentTick = 0;

  rendersThisTick = 0;
  queueMsThisTick = 0;
  flushMsThisTick = 0;
  lastRenders = 0;
  lastQueueMs = 0;
  lastFlushMs = 0;
  hitsThisTick = 0;
  lastHits = 0;

  constructor(vello: VelloRenderer, pixiRenderer: Renderer, resolution: number, maxTextureSize = 8192) {
    this.vello = vello;
    this.pixiRenderer = pixiRenderer;
    this.resolution = resolution;
    const rawSlot = Math.ceil(256 * resolution);
    this.slotW = Math.max(512, 1 << Math.ceil(Math.log2(rawSlot)));
    this.slotH = this.slotW;
    this.atlasW = Math.min(maxTextureSize, 16384);
    this.atlasH = Math.min(maxTextureSize, 8192);
    this.cols = Math.floor(this.atlasW / this.slotW);
    this.maxSlots = this.cols * Math.floor(this.atlasH / this.slotH);
  }

  init(): boolean {
    console.log(`[FrameAtlas] ${this.atlasW}x${this.atlasH} atlas, slot=${this.slotW}, ${this.maxSlots} slots, res=${this.resolution}`);
    let result: { texture: GPUTexture; textureId: number } | null;
    try {
      result = this.vello.createAtlas(this.atlasW, this.atlasH) as typeof result;
    } catch (e) {
      console.error("[FrameAtlas] createAtlas threw:", e);
      return false;
    }
    if (!result) return false;
    this.atlasTextureId = result.textureId;

    this.atlasSource = new ExternalSource({
      resource: result.texture,
      renderer: this.pixiRenderer,
      width: this.atlasW,
      height: this.atlasH,
      label: "frame-atlas",
    });
    this.atlasSource.alphaMode = "no-premultiply-alpha";
    this.atlasSource.format = "rgba8unorm";
    this.atlasSource.resolution = this.resolution;
    this.atlasSource.autoGarbageCollect = false;
    return true;
  }

  getFrame(
    velloAssetId: number,
    animName: string,
    frameIndex: number,
    colors?: [number, number, number] | null,
    accInfo?: number[],
  ): Texture | null {
    if (!this.atlasSource) return null;

    const colorKey = colors ? `${colors[0]},${colors[1]},${colors[2]}` : "nc";
    const accKey = accInfo?.length ? accInfo.join(",") : "na";
    const frameKey = `${velloAssetId}:${animName}:${frameIndex}:${colorKey}:${accKey}`;

    const existing = this.frameCache.get(frameKey);
    if (existing) {
      existing.lastUsedTick = this.currentTick;
      this.hitsThisTick++;
      return existing.pixiTexture;
    }

    let slotIndex: number;
    if (this.freeList.length > 0) {
      slotIndex = this.freeList.pop()!;
    } else if (this.nextSlot < this.maxSlots) {
      slotIndex = this.nextSlot++;
    } else {
      slotIndex = this.evictLRU();
      if (slotIndex < 0) return null;
    }

    const col = slotIndex % this.cols;
    const row = Math.floor(slotIndex / this.cols);
    const px = col * this.slotW;
    const py = row * this.slotH;

    const t0 = performance.now();
    const colorsArg = colors ? [colors[0], colors[1], colors[2]] : undefined;
    let dims: { width: number; height: number } | null;
    try {
      dims = this.vello.queueFrame(
        velloAssetId, animName, frameIndex, this.resolution,
        colorsArg, accInfo, px, py,
      ) as typeof dims;
    } catch (e) {
      console.error("[FrameAtlas] queueFrame failed:", e);
      this.freeList.push(slotIndex);
      return null;
    }
    this.queueMsThisTick += performance.now() - t0;

    if (!dims) {
      this.freeList.push(slotIndex);
      return null;
    }
    this.rendersThisTick++;

    const fw = dims.width / this.resolution;
    const fh = dims.height / this.resolution;
    const pixiTexture = new Texture({
      source: this.atlasSource,
      frame: new Rectangle(px / this.resolution, py / this.resolution, fw, fh),
    });

    this.frameCache.set(frameKey, {
      index: slotIndex, pixelX: px, pixelY: py, pixiTexture, lastUsedTick: this.currentTick,
    });
    return pixiTexture;
  }

  flush(): void {
    const t0 = performance.now();
    try { this.vello.flushFrames(this.atlasTextureId); } catch {}
    this.flushMsThisTick = performance.now() - t0;
  }

  private evictLRU(): number {
    let oldestKey: string | null = null;
    let oldestTick = Infinity;
    for (const [key, slot] of this.frameCache) {
      if (slot.lastUsedTick >= this.currentTick) continue;
      if (slot.lastUsedTick < oldestTick) {
        oldestTick = slot.lastUsedTick;
        oldestKey = key;
      }
    }
    if (!oldestKey) return -1;
    const slot = this.frameCache.get(oldestKey)!;
    this.frameCache.delete(oldestKey);
    return slot.index;
  }

  tick(): void {
    this.currentTick++;
    this.lastRenders = this.rendersThisTick;
    this.lastQueueMs = this.queueMsThisTick;
    this.lastFlushMs = this.flushMsThisTick;
    this.lastHits = this.hitsThisTick;
    this.rendersThisTick = 0;
    this.queueMsThisTick = 0;
    this.flushMsThisTick = 0;
    this.hitsThisTick = 0;
  }

  getResolution(): number { return this.resolution; }

  get stats() {
    return {
      slots: this.frameCache.size,
      maxSlots: this.maxSlots,
      lastRenders: this.lastRenders,
      lastQueueMs: this.lastQueueMs,
      lastFlushMs: this.lastFlushMs,
      lastHits: this.lastHits,
    };
  }

  clear(): void {
    this.frameCache.clear();
    this.freeList.length = 0;
    this.nextSlot = 0;
  }
}
