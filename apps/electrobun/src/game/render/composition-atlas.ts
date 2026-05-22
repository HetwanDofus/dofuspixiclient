/**
 * Shared composition atlas — multi-page edition for
 * `PlayerStripRendererV2`.
 *
 * Multiple 4096 × 4096 GPU `RenderTexture` pages, each partitioned
 * into a 16 × 16 grid of 256-px sub-rect slots (256 slots / page).
 * New pages are created lazily when the existing pages are full —
 * bot count grows without an arbitrary cap. Memory grows linearly:
 * each page = 64 MB GPU RGBA8.
 *
 * Per-page structure:
 *   - `renderTexture`     — the 4096² atlas surface
 *   - `globalRoot`        — detached Container parenting that page's
 *                           BodyBandBatch meshes + accessory sprites
 *   - `allocator`         — LIFO slot freelist
 *   - `batches`           — `(body-atlas, band-index)` → BodyBandBatch
 *
 * Per-bot ownership is page-stable: once a bot is assigned a slot
 * on page N, its bands + accessories live in page N's root for the
 * bot's lifetime. Bots never migrate between pages.
 *
 * Rendering: `renderAll(pixiRenderer)` flushes every page's batches
 * then dispatches one `pixiRenderer.render(...)` per NON-EMPTY page.
 * The empty-page short-circuit means a project with only 50 active
 * bots still pays only 1 render pass even if more pages were
 * allocated previously.
 *
 * Bots' composite sprites in the main scene sample the SOURCE of
 * their slot's page — `getPageSource(pageIndex)`. Pixi's sprite
 * batcher fuses all sprites pointing at the same source, so within
 * each page bots still batch into ~1 main-pass draw.
 *
 * See `RENDER_INSTANCED_BANDS_PLAN.md` for the broader rendering
 * architecture rationale.
 */

import { Container, Rectangle, RenderTexture, type TextureSource } from "pixi.js";

import {
  BodyBandBatch,
} from "@/game/render/body-band-batch";
import type {
  BodyAtlas,
  BodyAtlasBand,
} from "@/game/render/character-cache";
import { createLogger } from "@/utils/logger";

const log = createLogger("SharedCompositionAtlas");

/**
 * Per-page dimensions. 4096 × 4096 RGBA8 = 64 MB GPU. Below the
 * minimum `maxTextureDimension2D` guarantee (8192) of every WebGPU
 * adapter we care about.
 */
const PAGE_W = 4096;
const PAGE_H = 4096;

/**
 * Per-slot dims in atlas pixels. Pick 256 because:
 *  - Bot composite atlases today sit at 100-200 px on a side at
 *    resolution = 3 (the default). 256 fits the median with room.
 *  - 16 × 16 grid yields 256 slots per page.
 *  - Bots whose tight bbox exceeds 256 are downscaled via the same
 *    `rtSizeFor` logic that capped at `RT_MAX_DIM` previously.
 *    Quality impact at default zoom: imperceptible.
 */
export const COMPOSITION_SLOT_SIZE = 256;

const COLS = Math.floor(PAGE_W / COMPOSITION_SLOT_SIZE);
const ROWS = Math.floor(PAGE_H / COMPOSITION_SLOT_SIZE);
const SLOTS_PER_PAGE = COLS * ROWS;

/**
 * Soft cap on pages — fire a warning when we cross it. The renderer
 * still allocates more pages on demand; this is just a "you've spent
 * 1 GB of GPU memory on composition atlases" heads-up. Adjust if
 * you ship for hardware that comfortably handles more.
 */
const PAGE_SOFT_WARN = 16; // 16 pages × 64 MB = 1024 MB GPU

/**
 * A reserved sub-rect of a specific page. Frozen — slot dims are
 * fixed; bots adapt to slot, not the other way around.
 *
 * `pageIndex` identifies which page's `globalRoot` / `renderTexture`
 * the slot's content lives on. Callers MUST keep the slot together
 * with its `pageIndex` for the slot's lifetime so all per-page work
 * (batch lookup, accessory parenting, composite sprite source) lands
 * on the right page.
 */
export interface CompositionSlot {
  readonly pageIndex: number;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * LIFO freelist of slot indices for a single page. LIFO so a slot
 * freed by a recently-detached bot is the first one re-allocated —
 * keeps the page's used region clustered (top-left) when usage is
 * below capacity.
 */
class CompositionSlotAllocator {
  private free: number[];
  /** Maps `index` → frozen `CompositionSlot` for cheap re-use. The
   *  rects are immutable, so we cache them once at construction. */
  private rects: CompositionSlot[];

  constructor(pageIndex: number) {
    this.rects = new Array(SLOTS_PER_PAGE);
    for (let i = 0; i < SLOTS_PER_PAGE; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      this.rects[i] = Object.freeze({
        pageIndex,
        index: i,
        x: col * COMPOSITION_SLOT_SIZE,
        y: row * COMPOSITION_SLOT_SIZE,
        w: COMPOSITION_SLOT_SIZE,
        h: COMPOSITION_SLOT_SIZE,
      });
    }
    // Initialise freelist so low indices pop first (column-major
    // packing). New page then occupies the top-left first; bottom-
    // right stays cold and never touches GPU cache when under-
    // allocated. Helps the GPU's compress-on-write caches.
    this.free = new Array(SLOTS_PER_PAGE);
    for (let i = 0; i < SLOTS_PER_PAGE; i++) {
      this.free[i] = SLOTS_PER_PAGE - 1 - i;
    }
  }

  acquire(): CompositionSlot | null {
    const idx = this.free.pop();
    if (idx === undefined) return null;
    return this.rects[idx];
  }

  release(slot: CompositionSlot): void {
    this.free.push(slot.index);
  }

  used(): number {
    return SLOTS_PER_PAGE - this.free.length;
  }

  capacity(): number {
    return SLOTS_PER_PAGE;
  }
}

/**
 * One 4096² atlas page. Self-contained: its own GPU surface,
 * detached root container, slot allocator, and batch registry.
 */
class AtlasPage {
  readonly pageIndex: number;
  readonly renderTexture: RenderTexture;
  readonly globalRoot: Container;
  readonly allocator: CompositionSlotAllocator;
  /** `${atlasSource.uid}|${bandIndex}` → BodyBandBatch live on
   *  this page. Created lazily on `getOrCreateBatch`; destroyed
   *  when the last instance releases. */
  readonly batches: Map<string, BodyBandBatch> = new Map();

  constructor(pageIndex: number) {
    this.pageIndex = pageIndex;
    this.renderTexture = RenderTexture.create({
      width: PAGE_W,
      height: PAGE_H,
    });
    this.renderTexture.label = `composition-atlas-p${pageIndex}`;
    const source = this.renderTexture.source;
    if (source && typeof source === "object") {
      (source as { label?: string }).label =
        `composition-atlas-p${pageIndex}`;
    }
    this.globalRoot = new Container();
    this.globalRoot.sortableChildren = true;
    this.allocator = new CompositionSlotAllocator(pageIndex);
  }

  destroy(): void {
    for (const batch of this.batches.values()) {
      try {
        batch.destroy();
      } catch {}
    }
    this.batches.clear();
    try {
      this.renderTexture.destroy(true);
    } catch {}
    try {
      this.globalRoot.destroy({ children: false });
    } catch {}
  }
}

/**
 * Owns the array of `AtlasPage`s plus the cross-page slot allocator
 * + batch lookup. The renderer drives `renderAll(pixiRenderer)`
 * once per tick — that flushes every page's batches and dispatches
 * one render pass per non-empty page.
 */
export class SharedCompositionAtlas {
  readonly slotSize: number = COMPOSITION_SLOT_SIZE;
  private pages: AtlasPage[] = [];
  private softWarnFired = false;

  constructor() {
    // Start with one page. New pages are allocated lazily on
    // `acquireSlot` when existing pages are full.
    this.pages.push(new AtlasPage(0));
  }

  /**
   * Acquire a slot for a new bot. Tries each existing page in
   * order; if all pages are full, creates a new page.
   *
   * Returns null only if `RenderTexture.create` fails (out of GPU
   * memory or similar). Caller MUST handle null by skipping the
   * bot's render.
   */
  acquireSlot(): CompositionSlot | null {
    for (const page of this.pages) {
      const slot = page.allocator.acquire();
      if (slot) return slot;
    }
    // All existing pages full — allocate a new one.
    let newPage: AtlasPage;
    try {
      newPage = new AtlasPage(this.pages.length);
    } catch (e) {
      log.error(
        `acquireSlot: failed to create page ${this.pages.length}`,
        e,
      );
      return null;
    }
    this.pages.push(newPage);
    if (!this.softWarnFired && this.pages.length >= PAGE_SOFT_WARN) {
      log.warn(
        `composition atlas grew to ${this.pages.length} pages ` +
          `(${this.pages.length * 64} MB GPU). Check if your scene ` +
          `really needs this many concurrent bots.`,
      );
      this.softWarnFired = true;
    }
    return newPage.allocator.acquire();
  }

  /** Release the slot back to its page's pool. */
  releaseSlot(slot: CompositionSlot): void {
    const page = this.pages[slot.pageIndex];
    if (!page) {
      log.warn(`releaseSlot: invalid pageIndex ${slot.pageIndex}`);
      return;
    }
    page.allocator.release(slot);
  }

  /**
   * Look up or create the `BodyBandBatch` for this slot's page +
   * `(atlas, band)` tuple. Each page has its own batch registry —
   * a batch on page 0 and one on page 1 with the same (atlas, band)
   * are DIFFERENT objects, because the bots they serve live on
   * different render targets.
   */
  getOrCreateBatch(
    slot: CompositionSlot,
    atlas: BodyAtlas,
    band: BodyAtlasBand,
  ): BodyBandBatch {
    const page = this.pages[slot.pageIndex];
    const sourceUid =
      (atlas.combinedTexture.source as { uid: number }).uid;
    const key = `${sourceUid}|${band.bandIndex}`;
    let batch = page.batches.get(key);
    if (batch) return batch;
    batch = new BodyBandBatch(atlas, band);
    batch.mesh.zIndex = band.bandIndex * 2;
    batch.mesh.label =
      `band-batch|p${slot.pageIndex}|src${sourceUid}|b${band.bandIndex}`;
    page.globalRoot.addChild(batch.mesh);
    page.batches.set(key, batch);
    return batch;
  }

  /**
   * Drop a batch if it has no active instances. Called by the
   * renderer when the last bot using a `(page, atlas, band)` combo
   * releases its instance slot.
   *
   * The `pageIndex` argument is required because the renderer
   * caches `bandInstance.batch` references — when releasing them at
   * detach time, the renderer knows which page each batch lives on
   * (the bot's `compositionSlot.pageIndex`).
   */
  releaseBatchIfEmpty(
    pageIndex: number,
    atlas: BodyAtlas,
    band: BodyAtlasBand,
  ): void {
    const page = this.pages[pageIndex];
    if (!page) return;
    const sourceUid =
      (atlas.combinedTexture.source as { uid: number }).uid;
    const key = `${sourceUid}|${band.bandIndex}`;
    const batch = page.batches.get(key);
    if (!batch || !batch.isEmpty()) return;
    page.batches.delete(key);
    try {
      if (batch.mesh.parent === page.globalRoot) {
        page.globalRoot.removeChild(batch.mesh);
      }
      batch.destroy();
    } catch {}
  }

  /**
   * Get the `globalRoot` for a slot's page. Callers parent
   * per-bot accessory `Sprite`s here so they participate in that
   * page's compose pass.
   */
  rootForSlot(slot: CompositionSlot): Container {
    return this.pages[slot.pageIndex].globalRoot;
  }

  /**
   * Get the `TextureSource` for a slot's page. Composite sprites
   * use this as their texture's source so they sample the right
   * page's render target.
   */
  sourceForSlot(slot: CompositionSlot): TextureSource {
    return this.pages[slot.pageIndex].renderTexture.source;
  }

  /**
   * Render every non-empty page into its own RT. Flushes per-page
   * batch instance buffers first. ONE render call per used page;
   * pages with zero active bots are skipped entirely.
   */
  renderAll(pixiRenderer: import("pixi.js").Renderer): void {
    for (const page of this.pages) {
      if (page.allocator.used() === 0) continue;
      // Flush only this page's batches before its render.
      for (const batch of page.batches.values()) batch.flush();
      try {
        pixiRenderer.render({
          container: page.globalRoot,
          target: page.renderTexture,
          clear: true,
        });
      } catch (e) {
        log.warn(`renderAll page ${page.pageIndex} failed`, e);
      }
    }
  }

  /** Sub-rect frame for sampling this slot in the main pass. */
  frameRect(slot: CompositionSlot): Rectangle {
    return new Rectangle(slot.x, slot.y, slot.w, slot.h);
  }

  getStats(): {
    slotsUsed: number;
    slotsCapacity: number;
    batchCount: number;
    pageCount: number;
  } {
    let slotsUsed = 0;
    let batchCount = 0;
    for (const page of this.pages) {
      slotsUsed += page.allocator.used();
      batchCount += page.batches.size;
    }
    return {
      slotsUsed,
      slotsCapacity: this.pages.length * SLOTS_PER_PAGE,
      batchCount,
      pageCount: this.pages.length,
    };
  }

  /** Drops every page's GPU + Pixi state. */
  destroy(): void {
    for (const page of this.pages) {
      try {
        page.destroy();
      } catch {}
    }
    this.pages = [];
  }
}
