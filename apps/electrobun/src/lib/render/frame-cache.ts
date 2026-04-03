/**
 * LRU frame cache for per-frame Vello rendering with render budget.
 *
 * Renders individual frames on demand and caches the results.
 * A per-tick render budget prevents FPS dips when many cache misses
 * occur simultaneously (e.g., animation switches for many characters).
 * Frames that exceed the budget show the previous/placeholder texture
 * until the next tick when budget is replenished.
 */
import { ExternalSource, Texture, type Renderer } from "pixi.js";
import type { VelloRenderer } from "vello-wasm";
import type { VelloFrameResult } from "./vello-loader";

export interface CachedFrame {
  texture: Texture;
  textureId: number; // Vello WASM texture ID (for cleanup)
  width: number;
  height: number;
  lastUsedTick: number;
}

export class FrameCache {
  private cache = new Map<string, CachedFrame>();
  private currentTick = 0;
  private maxEntries: number;
  private maxAge: number; // ticks
  private renderBudget: number; // max renders per tick
  private rendersThisTick = 0;
  private vello: VelloRenderer;
  private pixiRenderer: Renderer;

  constructor(
    vello: VelloRenderer,
    pixiRenderer: Renderer,
    options?: { maxEntries?: number; maxAgeTicks?: number; renderBudget?: number },
  ) {
    this.vello = vello;
    this.pixiRenderer = pixiRenderer;
    this.maxEntries = options?.maxEntries ?? 6000; // 300 chars × ~20 frames visible
    this.maxAge = options?.maxAgeTicks ?? 300; // 5 seconds at 60fps
    this.renderBudget = options?.renderBudget ?? 12; // max Vello renders per tick
  }

  /**
   * Build cache key from frame parameters.
   */
  private buildKey(
    velloAssetId: number,
    animName: string,
    frameIndex: number,
    resolution: number,
    colors?: [number, number, number] | null,
    accessoryIds?: number[],
  ): string {
    const colorKey = colors ? `${colors[0]},${colors[1]},${colors[2]}` : "nc";
    const accKey = accessoryIds?.length ? accessoryIds.sort().join(",") : "na";
    const resKey = Math.round(resolution * 100);
    return `${velloAssetId}:${animName}:${frameIndex}:${resKey}:${colorKey}:${accKey}`;
  }

  /**
   * Get a cached frame or render it on demand.
   * Returns null if not cached AND render budget is exhausted for this tick.
   * The caller should keep displaying the previous texture in that case.
   */
  getOrRender(
    velloAssetId: number,
    animName: string,
    frameIndex: number,
    resolution: number,
    colors?: [number, number, number] | null,
    accessoryIds?: number[],
  ): CachedFrame | null {
    const key = this.buildKey(velloAssetId, animName, frameIndex, resolution, colors, accessoryIds);

    // Cache hit — free, no budget cost
    const cached = this.cache.get(key);
    if (cached) {
      cached.lastUsedTick = this.currentTick;
      this.hitsThisTick++;
      return cached;
    }

    // Cache miss — check render budget
    if (this.rendersThisTick >= this.renderBudget) {
      this.skippedThisTick++;
      return null; // Over budget — caller keeps old texture, retry next tick
    }

    // Render via Vello (timed)
    const colorsArg = colors
      ? [colors[0], colors[1], colors[2]]
      : undefined;

    const t0 = performance.now();
    const result = this.vello.renderFrame(
      velloAssetId, animName, frameIndex, resolution,
      colorsArg,
      accessoryIds,
    ) as VelloFrameResult | null;
    this.renderMsThisTick += performance.now() - t0;

    if (!result) return null;

    this.rendersThisTick++;

    const { texture: gpuTexture, textureId, width, height } = result;

    const source = new ExternalSource({
      resource: gpuTexture,
      renderer: this.pixiRenderer,
      width,
      height,
      label: `fc:${velloAssetId}:${animName}:${frameIndex}`,
    });
    source.alphaMode = "no-premultiply-alpha";
    source.format = "rgba8unorm";
    source.resolution = resolution;
    source.autoGarbageCollect = false;

    const texture = new Texture({ source });

    const entry: CachedFrame = {
      texture,
      textureId,
      width,
      height,
      lastUsedTick: this.currentTick,
    };

    this.cache.set(key, entry);

    // Evict if over capacity
    if (this.cache.size > this.maxEntries) {
      this.evict();
    }

    return entry;
  }

  /**
   * Advance the tick counter and reset render budget. Call once per frame.
   */
  tick(): void {
    // Snapshot last tick's stats before resetting
    this.lastRenderMs = this.renderMsThisTick;
    this.lastRenders = this.rendersThisTick;
    this.lastHits = this.hitsThisTick;
    this.lastSkipped = this.skippedThisTick;

    this.currentTick++;
    this.rendersThisTick = 0;
    this.renderMsThisTick = 0;
    this.hitsThisTick = 0;
    this.skippedThisTick = 0;
    // Periodic eviction every 60 ticks (~1 second)
    if (this.currentTick % 60 === 0) {
      this.evict();
    }
  }

  /**
   * Evict least-recently-used entries.
   */
  private evict(): void {
    const cutoff = this.currentTick - this.maxAge;
    const toRemove: string[] = [];

    for (const [key, entry] of this.cache) {
      if (entry.lastUsedTick < cutoff) {
        toRemove.push(key);
      }
    }

    // If still over capacity after age eviction, remove oldest entries
    if (this.cache.size - toRemove.length > this.maxEntries) {
      const entries = [...this.cache.entries()]
        .sort((a, b) => a[1].lastUsedTick - b[1].lastUsedTick);

      const excess = this.cache.size - toRemove.length - this.maxEntries;
      for (let i = 0; i < excess && i < entries.length; i++) {
        if (!toRemove.includes(entries[i][0])) {
          toRemove.push(entries[i][0]);
        }
      }
    }

    for (const key of toRemove) {
      const entry = this.cache.get(key);
      if (entry) {
        this.vello.freeTexture(entry.textureId);
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cached frames.
   */
  clear(): void {
    for (const entry of this.cache.values()) {
      this.vello.freeTexture(entry.textureId);
    }
    this.cache.clear();
  }

  /** Total ms spent in Vello renders this tick */
  renderMsThisTick = 0;
  /** Total ms spent in Vello renders last completed tick */
  lastRenderMs = 0;
  /** Renders done last completed tick */
  lastRenders = 0;
  /** Cache hits last completed tick */
  private hitsThisTick = 0;
  lastHits = 0;
  /** Skipped due to budget last completed tick */
  private skippedThisTick = 0;
  lastSkipped = 0;

  /**
   * Get cache statistics.
   */
  get stats() {
    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
      currentTick: this.currentTick,
      rendersThisTick: this.rendersThisTick,
      renderBudget: this.renderBudget,
      lastRenderMs: this.lastRenderMs,
      lastRenders: this.lastRenders,
      lastHits: this.lastHits,
      lastSkipped: this.lastSkipped,
    };
  }
}
