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
 *  - On `scheduleRetireClassAtlas`, the slot is freed (not the
 *    texture — that's shared). V1 free is a no-op: pages are
 *    append-only and accept growth up to a cap. The cache-layer LRU
 *    bounds live-variant count; un-freed slots are leaked but never
 *    re-used. Acceptable until a free-rect allocator lands in v2.
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

/** A reserved sub-rect on a super-atlas page. */
export interface InputAtlasSlot {
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

/**
 * Bottom-left-fit skyline packer. Append-only — no `free()`. See
 * module header for the lifecycle rationale.
 *
 * The skyline is an ordered, non-overlapping list of horizontal
 * segments covering `[0, PAGE_DIM)` along x. Each segment's `y` is
 * the lowest free y at that x-range; rect placement raises segments
 * under the placed rect to `(rectY + rectH)` and merges adjacent
 * same-`y` segments.
 */
class SkylinePacker {
  private segments: { x: number; y: number; w: number }[];

  constructor(private readonly width: number, private readonly height: number) {
    this.segments = [{ x: 0, y: 0, w: width }];
  }

  alloc(w: number, h: number): { x: number; y: number } | null {
    if (w > this.width || h > this.height) return null;
    let bestX = -1;
    let bestY = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.segments.length; i++) {
      const start = this.segments[i].x;
      if (start + w > this.width) break;
      const peakY = this.peakY(start, w);
      if (peakY < 0) continue;
      if (peakY + h > this.height) continue;
      if (peakY < bestY) {
        bestY = peakY;
        bestX = start;
      }
    }
    if (bestX < 0) return null;
    this.place(bestX, bestY, w, h);
    return { x: bestX, y: bestY };
  }

  /** Highest `y` across segments covering `[startX, startX + w)`.
   *  Returns -1 if the coverage is broken (shouldn't happen with
   *  our place-preserving update, but guards correctness). */
  private peakY(startX: number, w: number): number {
    const endX = startX + w;
    let maxY = 0;
    let covered = startX;
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      const segEnd = seg.x + seg.w;
      if (segEnd <= covered) continue;
      if (seg.x > covered) return -1;
      if (seg.y > maxY) maxY = seg.y;
      covered = segEnd;
      if (covered >= endX) return maxY;
    }
    return -1;
  }

  private place(x: number, y: number, w: number, h: number): void {
    const newY = y + h;
    const startX = x;
    const endX = x + w;
    const out: { x: number; y: number; w: number }[] = [];
    let inserted = false;
    for (const seg of this.segments) {
      const segEnd = seg.x + seg.w;
      if (segEnd <= startX) {
        out.push(seg);
        continue;
      }
      if (seg.x >= endX) {
        if (!inserted) {
          out.push({ x: startX, y: newY, w });
          inserted = true;
        }
        out.push(seg);
        continue;
      }
      if (seg.x < startX) {
        out.push({ x: seg.x, y: seg.y, w: startX - seg.x });
      }
      if (segEnd > endX) {
        if (!inserted) {
          out.push({ x: startX, y: newY, w });
          inserted = true;
        }
        out.push({ x: endX, y: seg.y, w: segEnd - endX });
      }
    }
    if (!inserted) out.push({ x: startX, y: newY, w });
    // Coalesce adjacent same-y segments
    const merged: typeof out = [];
    for (const s of out) {
      const last = merged[merged.length - 1];
      if (last && last.y === s.y && last.x + last.w === s.x) {
        last.w += s.w;
      } else {
        merged.push(s);
      }
    }
    this.segments = merged;
  }
}

class InputAtlasPage {
  readonly index: number;
  readonly renderTexture: RenderTexture;
  readonly texture: Texture;
  readonly packer: SkylinePacker;
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
    this.packer = new SkylinePacker(PAGE_DIM, PAGE_DIM);
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
   * Reserve a `w × h` sub-rect on some page. Returns null if no page
   * has room AND we've hit `MAX_PAGES`.
   */
  allocSlot(w: number, h: number): InputAtlasAllocation | null {
    if (w <= 0 || h <= 0) return null;
    // A variant larger than a single page can't fit. Caller should
    // fall back to the legacy per-variant Texture path.
    if (w > PAGE_DIM || h > PAGE_DIM) return null;

    for (const page of this.pages) {
      const placed = page.packer.alloc(w, h);
      if (placed) {
        page.liveSlots += 1;
        return {
          slot: {
            pageIndex: page.index,
            x: placed.x,
            y: placed.y,
            w,
            h,
          },
          texture: page.texture,
          pageWidth: PAGE_DIM,
          pageHeight: PAGE_DIM,
        };
      }
    }

    if (this.pages.length >= MAX_PAGES) return null;

    const page = new InputAtlasPage(this.pages.length);
    this.pages.push(page);
    const placed = page.packer.alloc(w, h);
    if (!placed) {
      // A page that can't fit a same-page-sized rect is malformed —
      // shouldn't happen, but bail safely.
      return null;
    }
    page.liveSlots += 1;
    return {
      slot: {
        pageIndex: page.index,
        x: placed.x,
        y: placed.y,
        w,
        h,
      },
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
   * Free a slot. V1: decrements `liveSlots` for diagnostics but does
   * not return the rect to the packer — skyline doesn't support free.
   * See module header.
   */
  freeSlot(slot: InputAtlasSlot): void {
    const page = this.pages[slot.pageIndex];
    if (!page) return;
    if (page.liveSlots > 0) page.liveSlots -= 1;
  }

  stats(): { pages: number; liveSlots: number[] } {
    return {
      pages: this.pages.length,
      liveSlots: this.pages.map((p) => p.liveSlots),
    };
  }
}

let instance: SharedInputAtlas | null = null;

export function getSharedInputAtlas(): SharedInputAtlas {
  if (!instance) instance = new SharedInputAtlas();
  return instance;
}
