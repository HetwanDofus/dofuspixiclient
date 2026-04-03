/**
 * Per-frame atlas cache — shared slots across characters.
 *
 * Slots keyed by visual state: (assetId, animName, frameIndex, colors, accessories).
 * Characters with the same look share cached frames.
 * After warmup (~1s): 0 renders, 60fps.
 */
import { ExternalSource, Rectangle, Texture, type Renderer } from "pixi.js";
import type { VelloRenderer } from "vello-wasm";
import { getVelloGpu } from "./vello-loader";

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
    // Slot size fits the largest character frame at this resolution.
    // At 2x: frames are ~130-174px → 256 fits all.
    const rawSlot = Math.ceil(128 * resolution);
    this.slotW = 1 << Math.ceil(Math.log2(rawSlot));
    this.slotH = this.slotW;
    this.atlasW = Math.min(maxTextureSize, 16384);
    this.atlasH = Math.min(maxTextureSize, 8192);
    this.cols = Math.floor(this.atlasW / this.slotW);
    this.maxSlots = this.cols * Math.floor(this.atlasH / this.slotH);
  }

  init(): boolean {
    console.log(`[FrameAtlas] ${this.atlasW}x${this.atlasH} atlas, slot=${this.slotW}, ${this.maxSlots} slots, res=${this.resolution}`);
    (globalThis as any).__frameAtlas = this;
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
    // Invalidate the old Pixi Texture so any sprite still holding it
    // shows transparent instead of the wrong character's content.
    slot.pixiTexture.frame = new Rectangle(0, 0, 0, 0);
    slot.pixiTexture.update();
    this.frameCache.delete(oldestKey);
    return slot.index;
  }

  tick(): void {
    this.currentTick++;
    this.captureAtlas();
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

  /** Debug: capture atlas snapshots every N ticks. Call from console:
   *  window.__frameAtlas.startCapture(10)  — capture every 10 ticks, up to 10 images */
  private _captureInterval = 0;
  private _captureCount = 0;
  private _captureMax = 10;

  /** Debug: render a single frame to a downloadable PNG.
   *  Call: __frameAtlas.debugFrame(assetId, "walkR", 0, [0xff0000,0x00ff00,0x0000ff], [accId,slotId,...]) */
  debugFrame(assetId: number, anim: string, frame: number, colors?: number[], accInfo?: number[]): void {
    const result = this.vello.renderFrame(assetId, anim, frame, this.resolution, colors, accInfo) as
      { texture: GPUTexture; textureId: number; width: number; height: number } | null;
    if (!result) { console.error("renderFrame returned null"); return; }

    console.log(`[debugFrame] asset=${assetId} anim=${anim} frame=${frame} size=${result.width}x${result.height} acc=${accInfo?.length ?? 0}`);

    const gpuDevice = getVelloGpu()?.device;
    if (!gpuDevice) { console.error("No GPU device"); return; }

    const w = result.width, h = result.height;
    const bytesPerRow = Math.ceil(w * 4 / 256) * 256;
    const buf = gpuDevice.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = gpuDevice.createCommandEncoder();
    enc.copyTextureToBuffer(
      { texture: result.texture }, { buffer: buf, bytesPerRow, rowsPerImage: h }, { width: w, height: h },
    );
    gpuDevice.queue.submit([enc.finish()]);

    buf.mapAsync(GPUMapMode.READ).then(() => {
      const data = new Uint8Array(buf.getMappedRange());
      const pixels = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) pixels.set(data.subarray(y * bytesPerRow, y * bytesPerRow + w * 4), y * w * 4);
      buf.unmap(); buf.destroy();

      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), w, h), 0, 0);
      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob!);
        const a = document.createElement("a"); a.href = url;
        a.download = `debug_${assetId}_${anim}_${frame}.png`; a.click();
        URL.revokeObjectURL(url);
        console.log(`[debugFrame] saved ${w}x${h}`);
      });
    });

    this.vello.freeTexture(result.textureId);
  }

  startCapture(everyNTicks = 10, maxImages = 10): void {
    this._captureInterval = everyNTicks;
    this._captureCount = 0;
    this._captureMax = maxImages;
    console.log(`[FrameAtlas] Will capture ${maxImages} snapshots every ${everyNTicks} ticks`);
  }

  private async captureAtlas(): Promise<void> {
    if (!this._captureInterval || this._captureCount >= this._captureMax) return;
    if (this.currentTick % this._captureInterval !== 0) return;

    try {
      const gpuTex = this.atlasSource!.resource as GPUTexture;
      const gpuDevice = getVelloGpu()?.device;
      if (!gpuDevice) { console.error("[FrameAtlas] No GPU device"); this._captureInterval = 0; return; }
      // Only capture top-left 2048x2048 for manageable size
      const capW = Math.min(this.atlasW, 2048);
      const capH = Math.min(this.atlasH, 2048);
      const bytesPerRow = Math.ceil(capW * 4 / 256) * 256; // align to 256

      const buf = gpuDevice.createBuffer({
        size: bytesPerRow * capH,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });

      const enc = gpuDevice.createCommandEncoder();
      enc.copyTextureToBuffer(
        { texture: gpuTex, origin: { x: 0, y: 0, z: 0 } },
        { buffer: buf, bytesPerRow, rowsPerImage: capH },
        { width: capW, height: capH },
      );
      gpuDevice.queue.submit([enc.finish()]);

      await buf.mapAsync(GPUMapMode.READ);
      const data = new Uint8Array(buf.getMappedRange());

      // Copy to tight layout (remove row padding)
      const pixels = new Uint8Array(capW * capH * 4);
      for (let y = 0; y < capH; y++) {
        pixels.set(data.subarray(y * bytesPerRow, y * bytesPerRow + capW * 4), y * capW * 4);
      }
      buf.unmap();
      buf.destroy();

      // Draw to canvas and download
      const canvas = document.createElement("canvas");
      canvas.width = capW;
      canvas.height = capH;
      const ctx = canvas.getContext("2d")!;
      const imgData = new ImageData(new Uint8ClampedArray(pixels.buffer), capW, capH);
      ctx.putImageData(imgData, 0, 0);

      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `atlas_tick${this.currentTick}_${this._captureCount}.png`;
      a.click();
      URL.revokeObjectURL(url);
      this._captureCount++;
      console.log(`[FrameAtlas] Captured ${this._captureCount}/${this._captureMax} (${capW}x${capH})`);
    } catch (e) {
      console.error("[FrameAtlas] Capture failed:", e);
      this._captureInterval = 0;
    }
  }

  clear(): void {
    this.frameCache.clear();
    this.freeList.length = 0;
    this.nextSlot = 0;
  }
}
