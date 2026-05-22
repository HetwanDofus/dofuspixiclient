/**
 * Shared composition atlas for `PlayerStripRendererV2`.
 *
 * One GPU RenderTexture (4096 × 4096), partitioned into a fixed grid
 * of 256-px sub-rect slots. Each active bot owns one slot. The bot's
 * `compositionStage` (a detached Container holding its band meshes +
 * accessory sprites) is parented to `globalCompositionRoot` and
 * positioned so its SWF (0, 0) lands at `slot.origin + offset`.
 *
 * The renderer composes the entire `globalCompositionRoot` in ONE
 * `pixiRenderer.render({ target: renderTexture, clear: true })` call
 * per tick. Pixi's batched draw paths (mesh + sprite) coalesce work
 * across bots that share the same body atlas / accessory texture, so
 * the per-pass cost is bounded by class + accessory variety —
 * **independent of bot count**.
 *
 * In the main pass, every bot's `compositeSprite` samples a
 * sub-rect of this atlas's `TextureSource`. Pixi's sprite batcher
 * sees all 200 sprites share one source and fuses them into ~1 draw
 * call. That collapses the 10.7 ms "200 unique-texture draws" cliff
 * to ~1-2 ms.
 *
 * See `RENDER_SHARED_ATLAS_PLAN.md` for full design rationale.
 */

import { Container, Rectangle, RenderTexture } from "pixi.js";

/**
 * Atlas dimensions. 4096 × 4096 RGBA8 = 64 MB GPU. Below the
 * minimum `maxTextureDimension2D` guarantee (8192) of every WebGPU
 * adapter we care about.
 */
const ATLAS_W = 4096;
const ATLAS_H = 4096;

/**
 * Per-slot dims in atlas pixels. Pick 256 because:
 *  - Bot composite atlases today sit at 100-200 px on a side at
 *    resolution = 3 (the default). 256 fits the median with room.
 *  - 16 × 16 grid yields 256 slots — covers 200-bot stress with
 *    headroom. Real-game scale (16-50 bots) uses < 50.
 *  - Bots whose tight bbox exceeds 256 are downscaled via the same
 *    `rtSizeFor` logic that capped at `RT_MAX_DIM` previously.
 *    Quality impact at default zoom: imperceptible.
 *
 * If we ever need more slots (500-bot HARD_CAP with mounted slots),
 * add a second atlas page; `acquire()` returns null on exhaustion
 * and the caller gracefully skips that slot's render.
 */
export const COMPOSITION_SLOT_SIZE = 256;

const COLS = Math.floor(ATLAS_W / COMPOSITION_SLOT_SIZE);
const ROWS = Math.floor(ATLAS_H / COMPOSITION_SLOT_SIZE);
const SLOT_COUNT = COLS * ROWS;

/**
 * A reserved sub-rect of the shared atlas. Frozen — slot dims are
 * fixed; bots adapt to slot, not the other way around.
 */
export interface CompositionSlot {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * LIFO freelist of slot indices. LIFO (vs FIFO) so a slot freed by
 * a recently-detached bot is the first one re-allocated — keeping
 * the same atlas region "hot" in GPU cache. With max 256 slots and
 * bot detach/attach being O(seconds), the allocator never becomes
 * a bottleneck.
 */
class CompositionSlotAllocator {
  private free: number[];
  /** Maps `index` → frozen `CompositionSlot` for cheap re-use. The
   *  rects are immutable, so we cache them once at construction. */
  private rects: CompositionSlot[];

  constructor() {
    this.rects = new Array(SLOT_COUNT);
    for (let i = 0; i < SLOT_COUNT; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      this.rects[i] = Object.freeze({
        index: i,
        x: col * COMPOSITION_SLOT_SIZE,
        y: row * COMPOSITION_SLOT_SIZE,
        w: COMPOSITION_SLOT_SIZE,
        h: COMPOSITION_SLOT_SIZE,
      });
    }
    // Initialise freelist so low indices pop first (column-major
    // packing). Stress test then occupies the top-left first; the
    // bottom-right stays cold and never touches GPU cache when
    // under-allocated.
    this.free = new Array(SLOT_COUNT);
    for (let i = 0; i < SLOT_COUNT; i++) {
      this.free[i] = SLOT_COUNT - 1 - i;
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

  /** Total slots currently held. */
  used(): number {
    return SLOT_COUNT - this.free.length;
  }

  capacity(): number {
    return SLOT_COUNT;
  }
}

/**
 * Owns the shared `RenderTexture` plus the detached
 * `globalCompositionRoot` Container that parents every active bot's
 * `compositionStage`. The renderer (`PlayerStripRendererV2`) drives
 * a single `composeAll()` call per tick that renders the root into
 * the atlas.
 */
export class SharedCompositionAtlas {
  readonly renderTexture: RenderTexture;
  /** Detached Container. Never added to the visible scene graph;
   *  its only render destination is `renderTexture` via the
   *  renderer's composeAll() pass. Children are individual bots'
   *  `compositionStage`s, each positioned at its slot origin. */
  readonly globalCompositionRoot: Container;
  readonly slotSize: number = COMPOSITION_SLOT_SIZE;
  private allocator: CompositionSlotAllocator;

  constructor() {
    this.renderTexture = RenderTexture.create({
      width: ATLAS_W,
      height: ATLAS_H,
    });
    this.renderTexture.label = "composition-atlas";
    const source = this.renderTexture.source;
    if (source && typeof source === "object") {
      // Label the underlying source too — Pixi's managed-texture
      // hash keys by source label in some paths, so the stress
      // monitor's `byLabel` breakdown can attribute the bytes.
      (source as { label?: string }).label = "composition-atlas";
    }
    this.globalCompositionRoot = new Container();
    // No sort needed at root level — bots live in non-overlapping
    // slots, so z-order between bots inside the atlas pass is
    // irrelevant. Within each bot's compositionStage, `sortableChildren`
    // handles band+accessory z-order (set at the bot's createSlot).
    this.allocator = new CompositionSlotAllocator();
  }

  /**
   * Acquire a slot AND parent `stage` to `globalCompositionRoot`.
   * Single atomic operation so callers can't accidentally leak slot
   * indices without parenting (or vice versa).
   *
   * Returns null on exhaustion; caller must handle by skipping the
   * bot's render. First-version safety net — multi-page atlas
   * (deferred) eliminates the failure case.
   */
  acquire(stage: Container): CompositionSlot | null {
    const slot = this.allocator.acquire();
    if (!slot) return null;
    this.globalCompositionRoot.addChild(stage);
    return slot;
  }

  /**
   * Release the slot and unparent `stage`. The previous occupant's
   * pixels stay in the atlas until the next `composeAll()` clears
   * the whole RT — invisible because the slot isn't sampled by any
   * composite sprite during that window.
   */
  release(stage: Container, slot: CompositionSlot): void {
    if (stage.parent === this.globalCompositionRoot) {
      this.globalCompositionRoot.removeChild(stage);
    }
    this.allocator.release(slot);
  }

  /** Sub-rect frame for sampling this slot in the main pass. Cheap —
   *  the slot's coords are immutable, so callers can stash this
   *  Rectangle for the slot's lifetime. */
  frameRect(slot: CompositionSlot): Rectangle {
    return new Rectangle(slot.x, slot.y, slot.w, slot.h);
  }

  getStats(): { slotsUsed: number; slotsCapacity: number } {
    return {
      slotsUsed: this.allocator.used(),
      slotsCapacity: this.allocator.capacity(),
    };
  }

  /** Releases the GPU atlas + the detached root. Caller must have
   *  already detached every bot via `release()`. */
  destroy(): void {
    try {
      this.renderTexture.destroy(true);
    } catch {}
    try {
      // `children: false` because children are owned by their
      // respective SlotStateV2s, which clean themselves up via
      // their own retireSlotState path.
      this.globalCompositionRoot.destroy({ children: false });
    } catch {}
  }
}
