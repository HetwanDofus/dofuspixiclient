/**
 * SharedInputAtlas — input-side super atlas for per-variant body bakes.
 *
 * Purpose: collapse the ~500 per-variant `combinedTexture`s that
 * post-Path-2 routing produces into a handful of shared 8192² pages,
 * so `BodyBandBatch` keys (which are `(combinedTexture.source.uid,
 * bandIndex)`) collapse from ~500 batches × 1 instanced draw each
 * down to ~5–10 batches per band × 5 bands ≈ 25 draws/frame.
 *
 * Math: at 250 bots compose render was ~2.6 ms/f with ~510 batches
 * (≈ 5 µs per instanced draw). With ~25 draws it drops below 0.2 ms/f.
 *
 * Lifecycle:
 *  - `wrapSingleVariantAtlas` (character-cache.ts) calls
 *    `allocSlot(w, h)` to reserve a sub-rect on some 8192² page, then
 *    `blitBitmap` to upload the variant's image data into that rect.
 *    The variant's `ClassAtlasPage.combinedTexture` is then the
 *    super page's shared `RenderTexture` (NOT a per-variant texture),
 *    and `bands[].atlasX/Y` are pre-offset to super-page coords so
 *    `computeBandFrameUV` works unchanged.
 *  - On `scheduleRetireClassAtlas`, the slot is freed back to the
 *    page's `RectAllocator` (the page TEXTURE is never destroyed — it's
 *    shared, and tearing it down mid-frame raced composition sampling
 *    and flashed missing-texture magenta). Freed rects are recycled
 *    after a short grace window, so page (VRAM) growth under spawn /
 *    despawn / zoom churn is bounded to the live working set instead of
 *    leaking monotonically.
 *
 * Page size: 8192² × RGBA = 256 MB GPU per page. Capped at 16 pages
 * (= 4 GB upper bound). At ~4 MP avg per variant we fit ~16 variants
 * per page → 16 pages × 16 ≈ 256 distinct variants before the cap
 * trips. Beyond that, `allocSlot` returns null and `wrapSingleVariantAtlas`
 * falls back to the legacy per-variant `Texture` path so the bot
 * still renders, just without batch merging for that variant.
 */

import { Container, RenderTexture, Sprite, Texture, type Renderer } from "pixi.js";
import { getPixiRenderer, getVelloGpu } from "@/game/render/vello-loader";

/**
 * Page edge length in pixels. 8192 matches what the class-atlas bake
 * path already requests as the post-zoom upper bound, so any single
 * variant we'd produce fits trivially. Bump to 16384 if profiling
 * shows we'd benefit; WebGPU's `maxTextureDimension2d` is typically
 * 16384 on desktop but 8192 on some mobile/iGPU configs.
 */
const PAGE_DIM = 8192;

/** Soft cap on page count. Past this `allocSlot` returns null and the
 *  caller falls back. 16 pages × 256 MB = 4 GB worst case. */
const MAX_PAGES = 16;

/**
 * A freed rect isn't reusable until this many `tick()`s (≈ frames)
 * after it was freed. A composition `BodyBandBatch` keyed on a slot's
 * sub-rect may still sample it for a frame or two after the cache
 * evicts the variant (the batch release lags the refcount drop). The
 * grace window lets that settle before a new variant's blit overwrites
 * the pixels — otherwise the lingering batch would briefly show the new
 * variant's content.
 */
const FREE_GRACE_TICKS = 4;

/** A reserved sub-rect on a super-atlas page. */
export interface InputAtlasSlot {
  /** Unique per-allocation id. Used by `freeSlot` to reject double /
   *  stale frees (the cache's refcount accounting has several release
   *  paths; freeing the same rect twice would hand it out to two
   *  variants → overlapping blits → garbage). Frees of an id that's no
   *  longer live are no-ops. */
  readonly id: number;
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Public reference handed to consumers. Carries the texture (shared
 *  across many variants) plus the slot offset so callers can pre-bake
 *  band coords into super-page coords. */
export interface InputAtlasAllocation {
  readonly slot: InputAtlasSlot;
  readonly texture: Texture;
  readonly pageWidth: number;
  readonly pageHeight: number;
}

interface FreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Guillotine free-rect allocator with edge-coalescing and a grace
 * queue. Unlike the append-only skyline it replaces, it supports
 * per-rect `free` + reuse, so a page's freed slots get recycled instead
 * of leaking — which bounds page (VRAM) growth under churn to the live
 * working set.
 *
 * `alloc` uses best-short-side-fit then a single guillotine cut (the
 * two remainders tile the chosen free rect with the placed rect and
 * never overlap). `free` queues the rect; `releasePending` moves
 * grace-expired rects into the live list and coalesces edge-adjacent
 * free rects so large variants still find room after fragmentation.
 */
class RectAllocator {
  // NB: named `freeList`, not `free` — a field sharing the `free`
  // method's name would overwrite the method on the instance.
  private freeList: FreeRect[];
  private pending: { rect: FreeRect; tick: number }[] = [];

  constructor(width: number, height: number) {
    this.freeList = [{ x: 0, y: 0, w: width, h: height }];
  }

  alloc(w: number, h: number): { x: number; y: number } | null {
    let bestIdx = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.freeList.length; i++) {
      const f = this.freeList[i];
      if (f.w >= w && f.h >= h) {
        const score = Math.min(f.w - w, f.h - h);
        if (score < bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
    }
    if (bestIdx < 0) return null;
    const node = this.freeList[bestIdx];
    const x = node.x;
    const y = node.y;
    // Remove the chosen node; re-insert the two guillotine remainders.
    // Right remainder spans the node's full height; bottom remainder is
    // only `w` wide — together with the placed w×h they tile `node` and
    // never overlap.
    this.freeList.splice(bestIdx, 1);
    const rightW = node.w - w;
    const bottomH = node.h - h;
    if (rightW > 0) this.freeList.push({ x: x + w, y, w: rightW, h: node.h });
    if (bottomH > 0) this.freeList.push({ x, y: y + h, w, h: bottomH });
    return { x, y };
  }

  /** Queue a rect for reuse once `FREE_GRACE_TICKS` have elapsed. */
  free(x: number, y: number, w: number, h: number, tick: number): void {
    this.pending.push({ rect: { x, y, w, h }, tick });
  }

  /** Promote grace-expired pending rects into the live free list and
   *  coalesce. Returns true if anything was released. */
  releasePending(currentTick: number, graceTicks: number): boolean {
    if (this.pending.length === 0) return false;
    let released = false;
    const stillPending: { rect: FreeRect; tick: number }[] = [];
    for (const p of this.pending) {
      if (currentTick - p.tick >= graceTicks) {
        this.freeList.push(p.rect);
        released = true;
      } else {
        stillPending.push(p);
      }
    }
    this.pending = stillPending;
    if (released) this.coalesce();
    return released;
  }

  /** Merge free rects sharing a full edge. O(n²) but n (free rects per
   *  page) is small; repeats until stable so the list stays compact. */
  private coalesce(): void {
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < this.freeList.length && !merged; i++) {
        for (let j = i + 1; j < this.freeList.length && !merged; j++) {
          const a = this.freeList[i];
          const b = this.freeList[j];
          if (a.x === b.x && a.w === b.w) {
            // Vertically stacked, same column.
            if (a.y + a.h === b.y) {
              a.h += b.h;
              this.freeList.splice(j, 1);
              merged = true;
            } else if (b.y + b.h === a.y) {
              b.h += a.h;
              this.freeList.splice(i, 1);
              merged = true;
            }
          } else if (a.y === b.y && a.h === b.h) {
            // Side by side, same row.
            if (a.x + a.w === b.x) {
              a.w += b.w;
              this.freeList.splice(j, 1);
              merged = true;
            } else if (b.x + b.w === a.x) {
              b.w += a.w;
              this.freeList.splice(i, 1);
              merged = true;
            }
          }
        }
      }
    }
  }

  freeRectCount(): number {
    return this.freeList.length;
  }

  pendingCount(): number {
    return this.pending.length;
  }
}

class InputAtlasPage {
  readonly index: number;
  readonly renderTexture: RenderTexture;
  readonly texture: Texture;
  readonly allocator: RectAllocator;
  liveSlots = 0;
  /** GPUTexture handle for direct `copyExternalImageToTexture` blits.
   *  Pixi v8 WebGPU lazily creates it on first use, so we materialize
   *  it with a one-shot empty render in `ensureGpuTexture` before the
   *  first blit. Cached here for subsequent landings. */
  private cachedGpuTexture: GPUTexture | null = null;
  private materializeAttempted = false;

  constructor(index: number) {
    this.index = index;
    this.renderTexture = RenderTexture.create({
      width: PAGE_DIM,
      height: PAGE_DIM,
    });
    this.renderTexture.label = `shared-input-atlas-p${index}`;
    const src = this.renderTexture.source;
    if (src && typeof src === "object") {
      (src as { label?: string }).label = `shared-input-atlas-p${index}`;
    }
    // Reuse the page's RenderTexture as the sampling Texture so all
    // variants on this page share one `texture.source.uid`. The
    // BodyBandBatch key (in composition-atlas) collapses on that uid.
    this.texture = this.renderTexture;
    this.allocator = new RectAllocator(PAGE_DIM, PAGE_DIM);
  }

  /** Reach into Pixi v8's WebGPU source to extract the underlying
   *  GPUTexture. First call forces materialization via an empty
   *  render-pass so Pixi allocates the GPU resource. Returns null on
   *  non-WebGPU backends or if Pixi's internals shift in a future
   *  version (caller falls back to Pixi sprite-into-RT blit). */
  ensureGpuTexture(renderer: Renderer): GPUTexture | null {
    if (this.cachedGpuTexture) return this.cachedGpuTexture;
    if (!this.materializeAttempted) {
      this.materializeAttempted = true;
      try {
        const empty = new Container();
        renderer.render({
          container: empty,
          target: this.renderTexture,
          clear: true,
        });
        empty.destroy();
      } catch {
        // ignore — we'll just return null and the caller falls back
      }
    }
    const src = this.renderTexture.source as unknown as {
      gpuTexture?: GPUTexture;
      _gpuTexture?: GPUTexture;
    };
    const tex = src.gpuTexture ?? src._gpuTexture ?? null;
    if (tex) this.cachedGpuTexture = tex;
    return tex;
  }
}

export class SharedInputAtlas {
  private readonly pages: InputAtlasPage[] = [];
  /** Monotonic tick counter (≈ frames) driving the free-grace window. */
  private tickCount = 0;
  /** Monotonic allocation id source. */
  private nextSlotId = 1;
  /** Live slots by id → rect. Guards `freeSlot` against double / stale
   *  frees (only a live id frees) and powers the DIAG overlap check. */
  private readonly liveSlots = new Map<
    number,
    { pageIndex: number; x: number; y: number; w: number; h: number }
  >();
  /** Slots the cache has freed (`freeSlot`) but not yet returned to the
   *  allocator — held until `reclaimDeferredSlots` confirms (from a
   *  ground-truth per-frame liveness recompute) that no live bot still
   *  references them. id → rect. */
  private readonly deferredFree = new Map<
    number,
    { pageIndex: number; x: number; y: number; w: number; h: number }
  >();
  /** Set to a function that returns the active Pixi renderer; defers
   *  the lookup so we don't reach into Pixi during the singleton's
   *  construction (which can happen before `getPixiRenderer` is
   *  primed). */
  private renderer: Renderer | null = null;

  private getRenderer(): Renderer | null {
    if (!this.renderer) {
      this.renderer = getPixiRenderer();
    }
    return this.renderer;
  }

  /**
   * Reserve a `w × h` sub-rect on some page. Tries to recycle space on
   * existing pages first; opens a new page only when none has room.
   * Returns null if no page has room AND we've hit `MAX_PAGES`.
   */
  allocSlot(w: number, h: number): InputAtlasAllocation | null {
    if (w <= 0 || h <= 0) return null;
    // A variant larger than a single page can't fit. Caller should
    // fall back to the legacy per-variant Texture path.
    if (w > PAGE_DIM || h > PAGE_DIM) return null;

    for (const page of this.pages) {
      const placed = page.allocator.alloc(w, h);
      if (placed) {
        return this.makeAllocation(page, placed.x, placed.y, w, h);
      }
    }

    if (this.pages.length >= MAX_PAGES) return null;

    const page = new InputAtlasPage(this.pages.length);
    this.pages.push(page);
    const placed = page.allocator.alloc(w, h);
    if (!placed) {
      // A page that can't fit a same-page-sized rect is malformed —
      // shouldn't happen, but bail safely.
      return null;
    }
    return this.makeAllocation(page, placed.x, placed.y, w, h);
  }

  private makeAllocation(
    page: InputAtlasPage,
    x: number,
    y: number,
    w: number,
    h: number,
  ): InputAtlasAllocation {
    page.liveSlots += 1;
    const id = this.nextSlotId++;
    // DIAG (temp): does the freshly-allocated rect overlap any LIVE
    // slot? If so the allocator handed out occupied space → garbage.
    for (const [lid, lr] of this.liveSlots) {
      if (
        lr.pageIndex === page.index &&
        x < lr.x + lr.w &&
        lr.x < x + w &&
        y < lr.y + lr.h &&
        lr.y < y + h
      ) {
        // eslint-disable-next-line no-console
        console.error(
          `[ATLAS OVERLAP] new slot ${id} (${x},${y} ${w}x${h}) overlaps live slot ${lid} (${lr.x},${lr.y} ${lr.w}x${lr.h}) on page ${page.index}`,
        );
        break;
      }
    }
    this.liveSlots.set(id, { pageIndex: page.index, x, y, w, h });
    return {
      slot: { id, pageIndex: page.index, x, y, w, h },
      texture: page.texture,
      pageWidth: PAGE_DIM,
      pageHeight: PAGE_DIM,
    };
  }

  /**
   * Upload `bitmap` into the slot's GPU sub-rect.
   *
   * Fast path: direct `device.queue.copyExternalImageToTexture` into
   * the page's GPUTexture sub-rect. No shader, no command-buffer
   * ceremony, no temp Pixi resources — just one queued GPU copy.
   * Sub-millisecond per land (~10× faster than the sprite-into-RT
   * fallback).
   *
   * Slow path: when we can't extract the GPUTexture (non-WebGPU
   * backend, or Pixi internals changed), fall back to wrapping the
   * bitmap as a temp Pixi Texture and rendering a Sprite into the
   * page RT with `clear:false`. ~2-3 ms per blit.
   *
   * Either way, `bitmap.close()` runs at the end — `copyExternalImage
   * ToTexture` captures the source synchronously per spec, and Pixi's
   * upload path consumes it before the call returns.
   */
  blitBitmap(allocation: InputAtlasAllocation, bitmap: ImageBitmap): void {
    const renderer = this.getRenderer();
    const page = this.pages[allocation.slot.pageIndex];
    if (!page || !renderer) {
      try {
        bitmap.close();
      } catch {}
      return;
    }
    const gpu = getVelloGpu();
    const gpuTex = gpu ? page.ensureGpuTexture(renderer) : null;
    if (gpu && gpuTex) {
      try {
        gpu.device.queue.copyExternalImageToTexture(
          { source: bitmap, flipY: false },
          {
            texture: gpuTex,
            mipLevel: 0,
            origin: {
              x: allocation.slot.x,
              y: allocation.slot.y,
              z: 0,
            },
          },
          {
            width: allocation.slot.w,
            height: allocation.slot.h,
            depthOrArrayLayers: 1,
          },
        );
        try {
          bitmap.close();
        } catch {}
        return;
      } catch (err) {
        // Fall through to the Pixi-render blit. Log once-ish so we
        // notice if direct copy is mis-wired without spamming.
        // eslint-disable-next-line no-console
        console.warn(
          "[SharedInputAtlas] direct GPU copy failed, falling back to Pixi blit:",
          err,
        );
      }
    }
    // Fallback: Pixi sprite-into-RT blit
    const tempTex = Texture.from(bitmap);
    const sprite = new Sprite(tempTex);
    sprite.position.set(allocation.slot.x, allocation.slot.y);
    try {
      renderer.render({
        container: sprite,
        target: page.renderTexture,
        clear: false,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[SharedInputAtlas] blit render failed:", err);
    }
    try {
      sprite.destroy();
    } catch {}
    try {
      tempTex.destroy(true);
    } catch {}
    try {
      bitmap.close();
    } catch {}
  }

  /**
   * Free a slot back to its page's allocator. The rect enters a grace
   * queue (see `FREE_GRACE_TICKS`) and becomes reusable a few ticks
   * later — never immediately, so a composition batch still sampling
   * the slot for a frame can't get overwritten under it. The page
   * texture is NEVER destroyed.
   */
  freeSlot(slot: InputAtlasSlot): void {
    // Idempotent guard: only a live id is freed once. The cache's
    // refcount accounting has several release paths; this rejects
    // double / stale frees that would otherwise corrupt the allocator.
    if (!this.liveSlots.delete(slot.id)) return;
    const page = this.pages[slot.pageIndex];
    if (!page) return;
    if (page.liveSlots > 0) page.liveSlots -= 1;
    this.deferredFree.set(slot.id, {
      pageIndex: slot.pageIndex,
      x: slot.x,
      y: slot.y,
      w: slot.w,
      h: slot.h,
    });
  }

  /**
   * Recycle deferred-free slots that NO live bot references. `liveIds`
   * is the authoritative set of input-slot ids currently sampled by live
   * strip bots (recomputed each frame from `states` — no accounting to
   * drift). A deferred slot absent from it has no live band-instance, so
   * its rect is safe to return to the allocator (after the flush grace).
   * Called once per frame from `PlayerStripRendererV2.composeAll`.
   */
  reclaimDeferredSlots(liveIds: Set<number>): number {
    if (this.deferredFree.size === 0) return 0;
    let recycled = 0;
    for (const [id, rect] of this.deferredFree) {
      if (liveIds.has(id)) continue;
      this.deferredFree.delete(id);
      const page = this.pages[rect.pageIndex];
      if (page) {
        page.allocator.free(rect.x, rect.y, rect.w, rect.h, this.tickCount);
        recycled += 1;
      }
    }
    return recycled;
  }

  deferredCount(): number {
    return this.deferredFree.size;
  }

  /**
   * Advance the grace clock and promote grace-expired freed rects into
   * the reusable free list (covers the 1-frame GPU flush lag between a
   * bot releasing its instances and the slot being recycled). Called
   * once per frame from the character cache tick. NEVER destroys a page
   * texture — only recycles slots within live pages.
   */
  tick(): void {
    this.tickCount += 1;
    for (const page of this.pages) {
      page.allocator.releasePending(this.tickCount, FREE_GRACE_TICKS);
    }
  }

  stats(): {
    pages: number;
    liveSlots: number[];
    freeRects: number[];
    pending: number[];
  } {
    return {
      pages: this.pages.length,
      liveSlots: this.pages.map((p) => p.liveSlots),
      freeRects: this.pages.map((p) => p.allocator.freeRectCount()),
      pending: this.pages.map((p) => p.allocator.pendingCount()),
    };
  }
}

let instance: SharedInputAtlas | null = null;

export function getSharedInputAtlas(): SharedInputAtlas {
  if (!instance) instance = new SharedInputAtlas();
  return instance;
}
