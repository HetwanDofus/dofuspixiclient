/**
 * Path B PlayerStripRendererV2 — band-mesh + accessory-sprite model.
 *
 * Same public surface as `PlayerStripRenderer` (V1) but the per-bot
 * container holds:
 *   - N `BodyBandMesh`es, one per Z-ordered slice of the body.
 *   - M accessory `Sprite`s, one per equipped slot.
 *
 * Body bands are baked once per `(class, anim, dir, flipped, band)`
 * and shared across every bot of the same class via `CharacterCache`.
 * Per-bot tint comes from a shader uniform — bots don't allocate
 * their own body strips. Accessory strips are similarly shared per
 * `(accBundle, accExport, slot, animType, dir, side)`. Mount affines
 * are CPU tables shared per `(bundle, anim, dir, flipped)`.
 *
 * Live battlefield still uses V1 by default; the cut-over is a
 * one-line swap in `battlefield-scene.ts` when validation lands.
 * Step 10 stress test targets V2 directly.
 *
 * Public API mirrors V1 so callers can swap implementations.
 */

import {
  Container,
  Matrix,
  Sprite,
  Texture,
  Ticker,
  type Renderer as PixiRenderer,
} from "pixi.js";

import type { CharacterAnimation } from "@/game/assets/character-sprite";
import type { ActivePlayer } from "@/game/scene/player/types";
import {
  type AtlasBand,
  type BodyBandBatch,
  computeBandFrameUV,
} from "@/game/render/body-band-batch";
import {
  type AccessoryStrip,
  type CharacterCacheStats,
  type ClassAtlas,
  getCharacterCache,
  MAX_SLOT,
  type MountTransforms,
  type VariantInfo,
} from "@/game/render/character-cache";
import {
  type CompositionSlot,
  SharedCompositionAtlas,
} from "@/game/render/composition-atlas";
import { recordProbe } from "@/game/render/render-probes";
import { createLogger } from "@/utils/logger";

const log = createLogger("PlayerStripRendererV2");

export type DirSuffix = "R" | "L" | "F" | "B" | "S";

export type PlayerStripSlot =
  | "main"
  | "mount-back"
  | "mount-rider"
  | "mount-front";

const SLOT_Z_INDEX: Record<PlayerStripSlot, number> = {
  "mount-back": -2,
  "mount-rider": -1,
  main: 0,
  "mount-front": 1,
};

interface AccessoryHook {
  /** Direct child of `atlas.globalCompositionRoot`. Position +
   *  scale are written each frame as
   *  `(slot translate × bot scale × mount affine)` so the world
   *  pixel position matches the legacy compositionStage-parented
   *  path. zIndex = `slotZ.get(mountSlot)` (odd values between
   *  even band zIndices). */
  sprite: Sprite;
  strip: AccessoryStrip | null;
  slot: number;
}

/**
 * Per-band batched-mesh slot reservation. Each bot owns one slot
 * per band in the corresponding `BodyBandBatch`. Frame changes,
 * zone updates, and slot-transform writes go through these.
 */
interface BandInstance {
  bandIndex: number;
  batch: BodyBandBatch;
  /** Index into the batch's instance buffer. */
  instanceIdx: number;
  /** Band sub-rect inside the atlas (atlasX, atlasY) — cached so
   *  `setBandsFrame` can compute UV without re-deriving from the
   *  atlas every tick. */
  atlasX: number;
  atlasY: number;
}

interface PendingAnim {
  /** The anim key this staging is for. Stale-skip predicate matches against it. */
  key: string;
  animation: CharacterAnimation;
  animName: string;
  dir: DirSuffix;
  flipped: boolean;
  /**
   * The class atlas covering EVERY animation variant of the class.
   * Filled in by the body-acquire callback; `undefined` while
   * pending, `null` on bake failure. Phase 2 progressive commit:
   * body commits as soon as the atlas lands; accessories follow
   * as their strips land.
   */
  atlas?: ClassAtlas | null;
  /** Variant inside the class atlas that matches this anim's
   *  `(exportName, applyBFix, hatEquipped)` tuple. Filled in at
   *  commit time once the atlas is present. */
  variant?: VariantInfo | null;
  atlasArrived: boolean;
  /** Equipped slot → resolved AccessoryStrip (or null on bake failure). */
  accStrips: Map<number, AccessoryStrip | null>;
  /** Equipped slot ids — also serves as the expected accStrips key set. */
  accSlots: number[];
  /** Original accessory ref order so we can rebuild AccessoryHook order. */
  accessoryRefs: CharacterAnimation["accessories"];
  /** Sorted slot-depth list copied off the band info — drives Z order. */
  slotZ: Map<number, number>;
  mounts: MountTransforms | null;
  /**
   * Phase 2: tracks whether the body half of the commit has run. Once
   * true, the bot is visible (with whatever accessories had already
   * landed); subsequent `tryCommit` calls install remaining accessory
   * strips into their existing hooks without re-laying-out the bands
   * or the per-bot RT. Cleared when `pendingAnim` is nulled.
   */
  bodyCommitted: boolean;
  /**
   * Caller-side readiness signal. Resolves `true` once every band +
   * accessory strip is in the cache and the bot is rendering the new
   * anim. Resolves `false` when superseded by a later
   * `applyAnimation` call (movement / AI should bail and re-issue
   * against the latest anim instead of acting on a stale strip).
   *
   * Phase 2 note: the bot becomes VISIBLE as soon as the body atlas
   * commits; the Promise still waits for every accessory so awaiters
   * that gate an action on "fully-loaded look" get the same contract
   * as before.
   */
  resolve: (committed: boolean) => void;
  readyPromise: Promise<boolean>;
}

interface SlotStateV2 {
  /** Per-slot Pixi container under `player.container`.
   *  Holds `hitSprite` (picking shim) + `compositeSprite` (the
   *  visible composite sampled from the atlas). Band meshes and
   *  accessory sprites now live under
   *  `SharedCompositionAtlas.globalCompositionRoot`, not here. */
  root: Container;
  /**
   * Invisible (`renderable=false`) Sprite that tracks the band-0
   * strip's texture + anchor. Used by the picking layer for AABB +
   * alpha-test hovers — V2's actual visible content is the composite
   * sprite, which the picker doesn't sample; the atlas alpha pattern
   * is the right source for hit-test.
   */
  hitSprite: Sprite;
  /** Currently-live class atlas (refcounted; null until the first commit). */
  atlas: ClassAtlas | null;
  /** Currently-live variant inside `atlas`. */
  variant: VariantInfo | null;
  /**
   * Phase 5: band-instance slots in batched meshes. One entry per
   * band of `st.atlas`. Each entry holds the `BodyBandBatch` we're
   * registered with + the instance row index inside that batch.
   * Frame changes write UV into the batch row; anim swaps release
   * old batches' slots and allocate in new batches.
   */
  bandInstances: Map<number, BandInstance>;
  /** Per-bot zone colours (packed `0xRRGGBB`, or 0 for inactive).
   *  Stored so we can re-write to bandInstances when batches change
   *  (e.g., after an atlas swap). */
  zone1: number;
  zone2: number;
  zone3: number;
  /** Equipped accessory sprites keyed by mount-slot id. Each
   *  sprite is a direct child of `atlas.globalCompositionRoot`. */
  accessories: Map<number, AccessoryHook>;
  /** CPU mount-transform table for the active anim. */
  mounts: MountTransforms | null;
  /** Mount-slot id → zIndex for the accessory sprite. Bands at even
   *  zIndices (`bandIndex × 2`); accessories at odd. */
  slotZ: Map<number, number>;
  /** Anim key currently INSTALLED (the visible bands). */
  currentAnimKey: string;
  /** Anim key most recently REQUESTED. Stale-skip predicate compares. */
  requestedAnimKey: string;
  /**
   * Path B staging buffer for the next anim. Filled in by the
   * acquire callbacks; commit fires atomically once every entry is
   * present so the visible body never half-swaps. `null` while no
   * change is pending — the live bands keep rendering as-is.
   */
  pendingAnim: PendingAnim | null;
  /** Last applyAnimation args — kept for resolution-change replay. */
  lastAnimation: CharacterAnimation | null;
  lastAnimName: string;
  lastDir: DirSuffix;
  lastFlipped: boolean;
  player: ActivePlayer | null;
  /**
   * Visible composite sprite. Its texture samples the bot's slot
   * sub-rect of the shared atlas; the atlas is filled by the global
   * composeAll pass that renders every band batch + accessory
   * sprite into the slot via per-instance / per-sprite transforms.
   */
  compositeSprite: Sprite;
  /** Atlas slot this bot occupies. Null if acquisition failed
   *  (slot exhaustion) — the bot will not render until a slot
   *  frees up. */
  compositionSlot: CompositionSlot | null;
  /** Bot's current slot-fit scale (so accessory matrices can read
   *  it without recomputing from bounds). Set in
   *  `applyCompositionTransform`. */
  botScale: number;
  /** SWF origin offset inside the slot, in atlas pixels. Used to
   *  compose accessory transforms against the slot. */
  swfOriginInSlotX: number;
  swfOriginInSlotY: number;
  /** Last frame index baked into the band-instance buffers. -1 =
   *  needs a fresh setBandsFrame on next swap. */
  lastCompositionFrame: number;
}

function makeAnimKey(
  animation: CharacterAnimation,
  animName: string,
  dir: DirSuffix,
  flipped: boolean,
): string {
  // `look` is intentionally NOT in the key — body bake is per-class
  // shared across all looks; per-bot colour comes from the shader
  // uniform group. This is the whole point of Path B.
  return `${animation.bundle}|${animName}|${dir}|${flipped ? "f" : "u"}`;
}

/**
 * Tiny safety margin (atlas-pixel scale) applied around the
 * computed bot bounding box. Defends against AA fringe + sub-pixel
 * rounding when accessories are positioned right at the bbox edge.
 * Functional padding (room for accessories) is NOT done with this —
 * see `computeBotBounds` which derives extents from the actual
 * accessory strips + mount transforms across every frame.
 */
const RT_SAFETY_PAD = 2;

/**
 * Ticker priority for `composeAll`. Pixi v8 `UPDATE_PRIORITY` values:
 *   INTERACTION = 50, HIGH = 25, NORMAL = 0, LOW = -25, UTILITY = -50.
 * Per-actor `swapFrame` callbacks run at NORMAL (0). Pixi's
 * `Application.start()` schedules `app.render()` at LOW (-25). We
 * want `composeAll` to land BETWEEN those two so the shared atlas
 * is freshly composed before the main pass samples it. -10 picks a
 * value strictly inside that band with margin on both sides.
 */
const COMPOSE_ALL_PRIORITY = -10;

export class PlayerStripRendererV2 {
  private states = new Map<number, Map<PlayerStripSlot, SlotStateV2>>();
  private resolution: number;
  private cache = getCharacterCache();
  private pixiRenderer: PixiRenderer;
  /** Shared composition atlas. One GPU RenderTexture partitioned
   *  into fixed-size slots, one per active bot. Replaces the old
   *  per-bot RenderTexture pool. See `composition-atlas.ts` and
   *  `RENDER_SHARED_ATLAS_PLAN.md`. */
  private atlas: SharedCompositionAtlas;
  /** Set to `true` whenever any bot's frame index advances. Drives
   *  `composeAll`'s early-out — when nothing changed since the last
   *  compose, the atlas state from the previous tick is still
   *  valid for the main pass. */
  private compositionDirty = false;
  private composeTickerInstalled = false;
  private composeTickerCallback: (() => void) | null = null;

  constructor(pixiRenderer: PixiRenderer, resolution = 3) {
    this.pixiRenderer = pixiRenderer;
    this.resolution = Math.max(1, resolution);
    this.atlas = new SharedCompositionAtlas();
    // Register globally so the stress-test snapshot can read atlas
    // pressure without threading a reference through the scene tree.
    activeStripRenderer = this;
  }

  /**
   * Install the global compose tick. Runs once per main frame at
   * priority -10 — AFTER per-actor swapFrame callbacks (NORMAL=0)
   * and BEFORE Pixi's auto-render (LOW=-25). The atlas is composed
   * with the freshest frame state before the main pass samples it.
   */
  private ensureComposeTickerInstalled(): void {
    if (this.composeTickerInstalled) return;
    this.composeTickerInstalled = true;
    this.composeTickerCallback = () => this.composeAll();
    Ticker.shared.add(
      this.composeTickerCallback,
      null,
      COMPOSE_ALL_PRIORITY,
    );
  }

  /**
   * Render every bot's compositionStage into the shared atlas in ONE
   * `pixiRenderer.render()` call. Cost is bounded by class + accessory
   * variety (≈ 60-100 batched draws), NOT by bot count — Pixi's
   * mesh + sprite batchers fuse same-texture children across bots.
   *
   * `clear: true` wipes the whole atlas before re-rendering. Pixi v8
   * doesn't expose scissor-clear; the whole-atlas clear is a single
   * `clearColorAttachment` on the render pass, cheap. Re-rendering
   * every bot (rather than just dirty ones) is what avoids stale
   * pixels in slots whose contents changed shape since last compose.
   *
   * Called via Ticker.shared at priority -10 (see
   * `ensureComposeTickerInstalled`). Public so headless harnesses
   * (tests, screenshot tools) can drive composition manually.
   */
  composeAll(): void {
    if (!this.compositionDirty) return;
    if (this.atlas.getStats().slotsUsed === 0) {
      this.compositionDirty = false;
      return;
    }
    // Phase 5 + multi-page atlas: each page flushes its own batches
    // and renders into its own RT. Skip empty pages internally.
    const t0 = performance.now();
    this.atlas.renderAll(this.pixiRenderer);
    recordProbe("composeBot", performance.now() - t0);
    this.compositionDirty = false;
  }

  /**
   * Compute the tight bounding box of the bot's body + every equipped
   * accessory across EVERY anim frame, in compositionStage local
   * coords (SWF (0,0) at local origin). Output bounds are in
   * atlas-pixel scale (matches the atlas + mount-matrix output).
   *
   * Why we need this: a fixed pad like `frameWidth + 16` cuts long
   * weapons / trailing capes / fancy hats off at the RT edge. The
   * user-visible symptom is "accessories cropped." Computing extents
   * from the actual accessory strips + per-frame mount transforms
   * gives us the EXACT size the RT must be — no cropping, no
   * over-allocation.
   *
   * The bounds extend across every frame of the bot's anim because
   * one RT is shared across the whole cycle (we re-composite per
   * frame, but the RT dimensions stay constant). If frame 3 has the
   * weapon swung wide and the RT was sized for frame 0's neutral
   * pose, frame 3's swing gets clipped.
   */
  private computeBotBounds(st: SlotStateV2, variant: VariantInfo): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } {
    // Body extent. Band meshes draw their atlas cell with the cell's
    // SWF (0,0) at compositionStage's local origin. So body pixels
    // span (-anchorX, -anchorY) to (frameWidth-anchorX,
    // frameHeight-anchorY) in compositionStage local coords.
    let minX = -variant.anchorX;
    let minY = -variant.anchorY;
    let maxX = variant.frameWidth - variant.anchorX;
    let maxY = variant.frameHeight - variant.anchorY;

    // Accessory extents — only consider frames where the body's
    // display list actually places the mount (via presence bitmap).
    // For every present (frame, slot), transform the accessory's 4
    // strip corners by the mount matrix and union into bounds.
    const mounts = st.mounts;
    if (mounts) {
      const twipScale = this.resolution / 20;
      const maxSlot = mounts.maxSlot;
      for (const [slotId, acc] of st.accessories) {
        if (!acc.strip) continue;
        const strip = acc.strip;
        // Strip corners in sprite-local pixel coords, anchored at
        // SWF (0,0) of the accessory.
        const cornersX = [
          -strip.anchorX,
          strip.frameWidth - strip.anchorX,
          strip.frameWidth - strip.anchorX,
          -strip.anchorX,
        ];
        const cornersY = [
          -strip.anchorY,
          -strip.anchorY,
          strip.frameHeight - strip.anchorY,
          strip.frameHeight - strip.anchorY,
        ];
        for (let frame = 0; frame < mounts.frameCount; frame++) {
          if (!this.cache.isMountPresent(mounts, frame, slotId)) continue;
          const off = (frame * maxSlot + slotId) * 6;
          const a = mounts.data[off];
          const b = mounts.data[off + 1];
          const c = mounts.data[off + 2];
          const d = mounts.data[off + 3];
          const tx = mounts.data[off + 4] * twipScale;
          const ty = mounts.data[off + 5] * twipScale;
          for (let k = 0; k < 4; k++) {
            const x = cornersX[k];
            const y = cornersY[k];
            const wx = a * x + c * y + tx;
            const wy = b * x + d * y + ty;
            if (wx < minX) minX = wx;
            if (wy < minY) minY = wy;
            if (wx > maxX) maxX = wx;
            if (wy > maxY) maxY = wy;
          }
        }
      }
    }

    // Tiny defensive expansion for AA fringe + sub-pixel rounding.
    return {
      minX: minX - RT_SAFETY_PAD,
      minY: minY - RT_SAFETY_PAD,
      maxX: maxX + RT_SAFETY_PAD,
      maxY: maxY + RT_SAFETY_PAD,
    };
  }

  /**
   * Compute the scale factor needed to fit a bot's tight bbox inside
   * a fixed atlas slot. Returns a uniform scale ≤ 1; if the bbox
   * already fits, scale = 1 (no downsample). If the bbox exceeds the
   * slot dim, scale shrinks uniformly so both axes fit — visible-
   * pixel ratio at default camera zoom remains close to 1×.
   */
  private slotScaleFor(bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }): number {
    const naturalW = Math.max(1, bounds.maxX - bounds.minX);
    const naturalH = Math.max(1, bounds.maxY - bounds.minY);
    return Math.min(1, this.atlas.slotSize / Math.max(naturalW, naturalH));
  }

  setResolution(res: number): void {
    this.resolution = Math.max(1, res);
  }

  getStats(): {
    players: number;
    slots: number;
    cache: CharacterCacheStats;
    atlas: {
      slotsUsed: number;
      slotsCapacity: number;
      batchCount: number;
      pageCount: number;
    };
  } {
    let slots = 0;
    for (const m of this.states.values()) slots += m.size;
    return {
      players: this.states.size,
      slots,
      cache: this.cache.getStats(),
      atlas: this.atlas.getStats(),
    };
  }

  /**
   * True once the slot's first applyAnimation has fully committed —
   * every band + accessory landed and the bot's container is visible.
   * Path B promises commit atomically, so this stays true through
   * subsequent anim swaps (the live anim keeps rendering while a new
   * one stages). Callers gating an action (movement, AI, click) on
   * readiness should `await stripRenderer.applyAnimation(...)`
   * instead — the Promise resolves exactly when the requested anim
   * is on screen.
   */
  isSlotReady(playerId: number, slot: PlayerStripSlot = "main"): boolean {
    const st = this.states.get(playerId)?.get(slot);
    if (!st) return false;
    return st.currentAnimKey !== "" && st.currentAnimKey !== "<retired>";
  }

  /** Stable view of (page atlas dims) for UV math — passed to
   *  `computeBandFrameUV` along with the active variant. Uses the
   *  variant's `pageIndex` because multi-page class atlases scale
   *  each page independently. */
  private atlasDimsForVariant(
    atlas: ClassAtlas,
    variant: VariantInfo,
  ): { atlasWidth: number; atlasHeight: number } {
    const page = atlas.pages[variant.pageIndex];
    return { atlasWidth: page.atlasWidth, atlasHeight: page.atlasHeight };
  }

  /** Picking layer adapter — returns the slot's hit-test Sprite. */
  getSlotSprite(
    playerId: number,
    slot: PlayerStripSlot = "main",
  ): Sprite | null {
    const st = this.states.get(playerId)?.get(slot);
    if (!st) return null;
    // Honor the V1 contract: only return a sprite once a strip has
    // actually landed. Callers (picking) treat null as "not yet
    // pickable" and gracefully fall through to ground-clicks.
    if (!st.atlas || !st.hitSprite.texture) return null;
    return st.hitSprite;
  }

  getSlotContainer(
    playerId: number,
    slot: PlayerStripSlot = "main",
  ): Container | null {
    return this.states.get(playerId)?.get(slot)?.root ?? null;
  }

  attach(player: ActivePlayer): void {
    if (this.states.has(player.id)) return;
    const slots = new Map<PlayerStripSlot, SlotStateV2>();
    slots.set("main", this.createSlot(player, "main"));
    this.states.set(player.id, slots);
  }

  ensureSlot(player: ActivePlayer, slot: PlayerStripSlot): void {
    const slots = this.states.get(player.id);
    if (!slots) {
      log.warn(`ensureSlot: player ${player.id} not attached`);
      return;
    }
    if (!slots.has(slot)) slots.set(slot, this.createSlot(player, slot));
  }

  removeSlot(player: ActivePlayer, slot: PlayerStripSlot): void {
    const slots = this.states.get(player.id);
    if (!slots) return;
    const st = slots.get(slot);
    if (!st) return;
    this.retireSlotState(st);
    slots.delete(slot);
  }

  setSlotVisible(
    player: ActivePlayer,
    slot: PlayerStripSlot,
    visible: boolean,
  ): void {
    const st = this.states.get(player.id)?.get(slot);
    if (st) st.root.visible = visible;
  }

  /**
   * Request the bands + accessory strips for an animation. Cache hits
   * install synchronously; misses go through the bake queue and
   * land asynchronously over the next few frames.
   */
  /**
   * Request an anim. Returns a Promise that resolves `true` once
   * every band + accessory strip is in the cache and the bot is
   * rendering the new anim (commit). Resolves `false` if a later
   * `applyAnimation` call supersedes this one — the caller should
   * bail out of any action it was about to queue.
   *
   * **Path B "never frozen" contract**: callers (movement loop, AI,
   * click handlers) MUST `await` this Promise before triggering any
   * action that depends on the requested anim being on-screen. While
   * waiting:
   *  - new bots stay hidden (no partial render),
   *  - bots with a live anim keep rendering it (the live anim's
   *    frame cycle still ticks via `swapFrame`).
   * Once the Promise resolves true, the strip is hot and the next
   * action can fire.
   */
  /**
   * Fire-and-forget background atlas warm-up. Called once per class
   * (gfxId) from the sprite controller after the first bot of that
   * class spawns. Routes through the SAME bake queue as live
   * acquires, so the adaptive budget throttles them on busy frames.
   *
   * No bot state is touched. The atlas lands in the cache with
   * refcount=0 (we immediately release after acquire). LRU-eligible
   * but available for the first actual hit, which is the whole win:
   * the bot's first `walkR` request becomes a cache HIT instead of
   * a JS-blocking Vello compute on a mid-frame rAF.
   */
  prewarmAtlas(
    animation: CharacterAnimation,
    _animName: string,
    _flipped: boolean,
  ): void {
    // Class-atlas migration: one acquire covers every animation
    // variant of the class (walk/static/run × R/L/F/B/S × bFix ×
    // hat). The pre-warm bakes the whole class in a single Rust
    // call. LOW priority keeps it behind any live bot's HIGH bake.
    this.cache.acquireClassAtlas(
      animation.bundle,
      this.resolution,
      (atlas) => {
        if (atlas) this.cache.releaseClassAtlas(atlas);
      },
      () => true,
      "low",
    );
  }

  applyAnimation(
    player: ActivePlayer,
    slot: PlayerStripSlot,
    animation: CharacterAnimation,
    animName: string,
    dir: DirSuffix,
    flipped: boolean,
  ): Promise<boolean> {
    const st = this.states.get(player.id)?.get(slot);
    if (!st) {
      log.warn(`applyAnimation: player ${player.id} slot ${slot} not attached`);
      return Promise.resolve(false);
    }
    const key = makeAnimKey(animation, animName, dir, flipped);
    // No-op if the LIVE anim already matches and nothing is pending.
    // Resolve true immediately — the caller can act right away.
    if (key === st.currentAnimKey && st.pendingAnim === null) {
      this.applyFlipToSlot(st, flipped);
      this.updateZones(st, animation);
      st.player = player;
      return Promise.resolve(true);
    }
    // If a stage is already pending for the SAME key, just refresh
    // the flip/zones — the in-flight acquires will still resolve.
    // Hand the caller the SAME promise so multiple awaits on the
    // same intended action all resolve together.
    if (st.pendingAnim && st.pendingAnim.key === key) {
      this.applyFlipToSlot(st, flipped);
      this.updateZones(st, animation);
      st.player = player;
      return st.pendingAnim.readyPromise;
    }
    st.requestedAnimKey = key;
    this.applyFlipToSlot(st, flipped);
    this.updateZones(st, animation);
    st.player = player;

    // Look up band layout for this body export (used to derive the
    // accessory Z order between bands).
    const info = this.cache.getBodyBandInfo(animation.bundle, animation.exportName);
    if (!info) {
      log.warn(
        `applyAnimation: band info missing for ${animation.bundle}/${animation.exportName}`,
      );
      return Promise.resolve(false);
    }

    // Discard any previous staging — its strips weren't installed,
    // so release their refs immediately + signal the old promise's
    // awaiters that they were superseded.
    if (st.pendingAnim) {
      this.discardPending(st.pendingAnim);
    }

    const pendingMounts = this.cache.getMounts({
      bundle: animation.bundle,
      exportName: animation.exportName,
      start: 0,
      count: animation.frameCount,
      applyBFix: flipped,
    });

    // Slot Z order map for the new anim. The slots list is sorted
    // by depth; slot i ends up at zIndex `2*i + 1` (bands at even,
    // accessories at odd, bottom-up).
    const slotZ = new Map<number, number>();
    info.slots.forEach((entry, i) => {
      slotZ.set(entry.slot, 2 * i + 1);
    });

    const accessoryRefs = animation.accessories;
    let resolve: (committed: boolean) => void = () => undefined;
    const readyPromise = new Promise<boolean>((res) => {
      resolve = res;
    });
    const pending: PendingAnim = {
      key,
      animation,
      animName,
      dir,
      flipped,
      atlasArrived: false,
      accStrips: new Map(),
      accSlots: accessoryRefs.map((a) => a.slot),
      accessoryRefs,
      slotZ,
      mounts: pendingMounts,
      bodyCommitted: false,
      resolve,
      readyPromise,
    };
    st.pendingAnim = pending;
    st.lastAnimation = animation;
    st.lastAnimName = animName;
    st.lastDir = dir;
    st.lastFlipped = flipped;

    this.stageBodyAtlas(st, pending);
    this.stageAccessories(st, pending);
    // Cache may resolve everything synchronously (full cache hit) —
    // attempt commit now so a hot path doesn't wait a frame.
    this.tryCommit(st);
    return pending.readyPromise;
  }

  /** Per-tick frame swap — drives bands + accessories to the bot's
   *  current frame and re-composites the per-bot RT WHEN the frame
   *  actually changed. Pixi anchor / transforms of the visible
   *  composite sprite are unchanged across frames, so the main
   *  scene's per-bot cost reduces to one batched sprite draw.
   *
   *  Composition cost: ~bands+accessories sub-draws per anim-frame
   *  change × N bots × anim fps. At 12 fps anim × 200 bots × ~5
   *  sub-draws = ~12 000 RT sub-draws/sec — bounded by the bot count
   *  and anim fps, NOT by the main render fps. */
  swapFrame(player: ActivePlayer): void {
    const slots = this.states.get(player.id);
    if (!slots) return;
    const idx = player.frameIndex;
    for (const st of slots.values()) {
      const variant = st.variant;
      if (!variant) continue;
      const fc = variant.frameCount;
      if (fc === 0) continue;
      const frame = idx % fc;
      if (frame === st.lastCompositionFrame) {
        // No frame change → atlas contents still valid. The shared
        // composition atlas only needs re-rendering when at least
        // one bot's frame advanced (see `composeAll`).
        continue;
      }
      this.setBandsFrame(st, frame);
      this.setAccessoriesFrame(st, frame);
      // Mark global compose dirty; the actual render happens once
      // per tick in `composeAll()` (Ticker.shared at priority -10).
      // We do NOT call composeBot here — the per-bot RT pass is
      // gone, replaced by the single global pass that batches all
      // bots into one render call.
      st.lastCompositionFrame = frame;
      this.compositionDirty = true;
    }
  }

  updateFlip(player: ActivePlayer, flipped: boolean): void {
    const slots = this.states.get(player.id);
    if (!slots) return;
    for (const st of slots.values()) {
      this.applyFlipToSlot(st, flipped);
    }
  }

  /** Re-render every live slot at a new resolution. */
  setResolutionAndRerender(res: number): void {
    const clamped = Math.max(1, res);
    if (clamped === this.resolution) return;
    this.resolution = clamped;
    for (const slots of this.states.values()) {
      for (const [slotKey, st] of slots) {
        st.currentAnimKey = "";
        this.applyFlipToSlot(st, st.lastFlipped);
        if (st.lastAnimation && st.player) {
          this.applyAnimation(
            st.player,
            slotKey,
            st.lastAnimation,
            st.lastAnimName,
            st.lastDir,
            st.lastFlipped,
          );
        }
      }
    }
  }

  detach(player: ActivePlayer): void {
    const slots = this.states.get(player.id);
    if (!slots) return;
    for (const st of slots.values()) this.retireSlotState(st);
    this.states.delete(player.id);
  }

  destroy(): void {
    for (const slots of this.states.values()) {
      for (const st of slots.values()) this.retireSlotState(st);
    }
    this.states.clear();
    if (this.composeTickerCallback) {
      Ticker.shared.remove(this.composeTickerCallback);
      this.composeTickerCallback = null;
      this.composeTickerInstalled = false;
    }
    try {
      this.atlas.destroy();
    } catch (e) {
      log.warn("atlas destroy threw", e);
    }
    if (activeStripRenderer === this) activeStripRenderer = null;
  }

  private createSlot(
    player: ActivePlayer,
    slot: PlayerStripSlot,
  ): SlotStateV2 {
    this.ensureComposeTickerInstalled();
    const root = new Container();
    root.scale.set(1 / this.resolution);
    root.sortableChildren = true;
    root.zIndex = SLOT_Z_INDEX[slot];
    player.container.addChild(root);

    // Picking shim: invisible Sprite that adopts the band-0 strip's
    // texture so the picking system's AABB + alpha-test path works
    // identically to V1. `renderable=false` keeps it from drawing
    // while still participating in the transform tree.
    const hitSprite = new Sprite();
    hitSprite.renderable = false;
    hitSprite.anchor.set(0, 0);
    root.addChild(hitSprite);

    // Phase 5: no per-bot compositionStage. Bands live in shared
    // `BodyBandBatch` meshes registered in the atlas; accessory
    // sprites attach directly to `atlas.globalCompositionRoot` on
    // first commit. We just need the atlas slot for the composite
    // sprite to sample.
    const compositionSlot = this.atlas.acquireSlot();
    if (!compositionSlot) {
      log.warn(
        `createSlot: atlas exhausted (${this.atlas.getStats().slotsCapacity} slots), ` +
          `player ${player.id} slot '${slot}' will not render until a slot frees up`,
      );
    }

    // Composite sprite samples this bot's slot sub-rect of its
    // page's atlas. Pixi's sprite batcher fuses bots whose slot
    // lives on the SAME page (same `TextureSource`) into a batched
    // draw; cross-page bots emit ~1 main-pass draw per page.
    const compositeSprite = new Sprite();
    compositeSprite.anchor.set(0, 0);
    compositeSprite.visible = false;
    if (compositionSlot) {
      compositeSprite.texture = new Texture({
        source: this.atlas.sourceForSlot(compositionSlot),
        frame: this.atlas.frameRect(compositionSlot),
      });
    }
    root.addChild(compositeSprite);

    // Path B "never frozen" contract: a bot stays HIDDEN until its
    // first applyAnimation commits — every band + accessory has
    // landed. After the first commit, the container stays visible
    // and subsequent anim swaps keep showing the live anim until the
    // next anim is fully ready (atomic swap, never partial).
    root.visible = false;

    return {
      root,
      hitSprite,
      atlas: null,
      variant: null,
      bandInstances: new Map(),
      zone1: 0,
      zone2: 0,
      zone3: 0,
      accessories: new Map(),
      mounts: null,
      slotZ: new Map(),
      currentAnimKey: "",
      requestedAnimKey: "",
      pendingAnim: null,
      lastAnimation: null,
      lastAnimName: "",
      lastDir: "F",
      lastFlipped: false,
      player,
      compositeSprite,
      compositionSlot,
      botScale: 1,
      swfOriginInSlotX: 0,
      swfOriginInSlotY: 0,
      lastCompositionFrame: -1,
    };
  }

  private updateZones(st: SlotStateV2, animation: CharacterAnimation): void {
    const cz = animation.colorZones;
    // Phase 5: zones are per-instance attributes, written into every
    // band batch this bot occupies. Store the values on `st` so
    // `commitBody` can re-apply them after an atlas swap moves the
    // bot to different batches.
    if (cz) {
      st.zone1 = cz[0];
      st.zone2 = cz[1];
      st.zone3 = cz[2];
    } else {
      st.zone1 = 0;
      st.zone2 = 0;
      st.zone3 = 0;
    }
    for (const bi of st.bandInstances.values()) {
      bi.batch.setZones(bi.instanceIdx, st.zone1, st.zone2, st.zone3);
    }
    if (st.bandInstances.size > 0) this.compositionDirty = true;
  }

  private applyFlipToSlot(st: SlotStateV2, flipped: boolean): void {
    const s = 1 / this.resolution;
    st.root.scale.set(flipped ? -s : s, s);
  }

  /** Kick off a body-atlas acquire for `pending`. The cache dispatches
   *  between two paths:
   *   - Common anims (static/walk/run): one shared class atlas per
   *     bundle, covering every direction × bFix × hat variant.
   *   - Rare anims (die/cast/hit/anim*): a per-variant atlas baked
   *     on demand via the legacy `renderSwfBodyAtlas` path, wrapped
   *     as a 1-page, 1-variant `ClassAtlas` so the renderer code
   *     path is unchanged. */
  private stageBodyAtlas(st: SlotStateV2, pending: PendingAnim): void {
    const hatEquipped = pending.accessoryRefs.some((a) => a.slot === 1);
    this.cache.acquireVariantAtlas(
      pending.animation.bundle,
      pending.animation.exportName,
      pending.flipped,
      hatEquipped,
      pending.animation.frameCount,
      this.resolution,
      (atlas) => this.onAtlasLanded(st, pending, atlas),
      () => st.pendingAnim === pending,
      "high",
    );
  }

  /** Kick off accessory acquires for `pending`. Same staging contract
   *  as `stageBodyAtlas` — no live state mutated until commit.
   *
   *  Each accessory's `side` argument is the body's CANONICAL authored
   *  `applyAccessory(this, slot, side)` argument — extracted by
   *  `swfBodyBandInfo` per slot. Falls back to the bot's facing `dir`
   *  only if the body's mount declaration omitted the side string
   *  (legacy assets). Using the bot's `dir` unconditionally is what
   *  used to break capes' walking variants (`WR`/`WL`). */
  private stageAccessories(st: SlotStateV2, pending: PendingAnim): void {
    const info = this.cache.getBodyBandInfo(
      pending.animation.bundle,
      pending.animation.exportName,
    );
    const sideForSlot = (slotId: number): string => {
      if (info) {
        const entry = info.slots.find((s) => s.slot === slotId);
        if (entry && entry.side) return entry.side;
      }
      return pending.dir;
    };
    for (const accDef of pending.accessoryRefs) {
      const slotId = accDef.slot;
      this.cache.acquireAccessory(
        {
          bundle: accDef.bundle,
          exportName: accDef.exportName,
          slot: slotId,
          animType: accDef.animType,
          dir: pending.dir,
          side: sideForSlot(slotId),
          resolution: this.resolution,
        },
        (strip) => this.onAccessoryLanded(st, pending, slotId, strip),
        () => st.pendingAnim === pending,
      );
    }
  }

  private onAtlasLanded(
    st: SlotStateV2,
    pending: PendingAnim,
    atlas: ClassAtlas | null,
  ): void {
    // Pending was discarded (another applyAnimation superseded it)
    // — release the atlas here so we don't leak the ref.
    if (st.pendingAnim !== pending) {
      if (atlas) this.cache.releaseClassAtlas(atlas);
      return;
    }
    pending.atlas = atlas;
    if (atlas) {
      const hatEquipped = pending.accessoryRefs.some((a) => a.slot === 1);
      pending.variant = this.cache.getVariant(
        atlas,
        pending.animation.exportName,
        pending.flipped,
        hatEquipped,
      );
      // Missing variant = the bundle has no bakeable form of this
      // export (e.g. unusual anim, frame-count too high to fit grid).
      // Quiet skip — `commitBody` keeps the bot on its previously
      // committed variant so it stays visible.
    }
    pending.atlasArrived = true;
    this.tryCommit(st);
  }

  private onAccessoryLanded(
    st: SlotStateV2,
    pending: PendingAnim,
    slotId: number,
    strip: AccessoryStrip | null,
  ): void {
    if (st.pendingAnim !== pending) {
      if (strip) this.cache.releaseAccessory(strip);
      return;
    }
    pending.accStrips.set(slotId, strip);
    this.tryCommit(st);
  }

  /** Phase 2 progressive commit:
   *   - As soon as the body atlas lands, `commitBody` runs. Bands are
   *     swapped, accessory hooks are created (one per equipped slot;
   *     hooks whose strip hasn't landed yet stay invisible), the RT
   *     is allocated, and the bot becomes visible.
   *   - Each subsequent accessory landing installs its strip into the
   *     existing hook (`installLandedAccessory`) without re-laying out
   *     anything.
   *   - The `readyPromise` resolves only when EVERY accessory has
   *     reported in, preserving the "full look ready" contract for
   *     callers that `await applyAnimation(...)`.
   *
   * Why this matters: the previous design waited for body AND every
   * accessory before flipping `root.visible = true`. On cold cache at
   * 200-bot stress, that meant every bot was invisible for the entire
   * bake window (~1.6 s with 5 ms bakes × 2-3 bakes/frame). Splitting
   * the commit means the bot appears within ~1 frame of the body bake
   * landing; accessories pop in within ~5-200 ms each as their strips
   * land. See `RENDER_BAKE_PLAN.md` Phase 2 for the rationale.
   */
  private tryCommit(st: SlotStateV2): void {
    const pending = st.pendingAnim;
    if (!pending) return;
    if (!pending.atlasArrived) return;

    // Body half — runs exactly once per pending. After this the bot
    // is visible; any accessories that already landed are installed.
    //
    // CRITICAL: resolve the readyPromise with `true` HERE, on body
    // commit, NOT on full-accessory completion. The promise gates
    // `player.animReady` (renderer.ts:140-155): bots whose promise
    // never resolves true freeze mid-anim because `tickFrame` skips
    // unready players. Late accessories install progressively via
    // `installLandedAccessories` and recompute bounds in place;
    // their absence is a cosmetic glitch, not a state hang.
    //
    // We keep `st.pendingAnim` alive after the resolve so that
    // subsequent accessory-landed callbacks (`onAccessoryLanded`)
    // still find their pending and install themselves. The pending
    // is cleared only when ALL accessories have reported in (the
    // gate below), so stale-skipped bakes don't leak — see
    // CharacterCache + bake-queue contract for guaranteed null
    // callbacks on stale-skip.
    if (!pending.bodyCommitted) {
      const committed = this.commitBody(st, pending);
      if (committed) {
        pending.bodyCommitted = true;
        pending.resolve(true);
      } else {
        // commitBody refused to install a null atlas (stale-skipped
        // or failed bake). Discard the pending so the bot's next
        // applyAnimation gets a fresh slate; resolve(false) so the
        // caller knows this request didn't land. The bot keeps its
        // previous atlas visible — no "moves without animation"
        // state.
        pending.resolve(false);
        st.pendingAnim = null;
        return;
      }
    } else {
      // Late-arriving accessory: plug each newly-landed strip into
      // its existing hook + re-bound for the new extents.
      this.installLandedAccessories(st, pending);
    }

    // Final-cleanup gate: every accessory has reported in (either as
    // a real strip or null on failure / stale-skip). We've already
    // resolved the promise above on body commit; this just frees
    // `pendingAnim` so the next applyAnimation doesn't see a stale
    // pending.
    if (pending.accStrips.size >= pending.accSlots.length) {
      st.pendingAnim = null;
    }
  }

  /** Phase 5 body commit — runs once per pending. Idempotent on
   *  st.atlas (releases old), bandInstances (releases old batches,
   *  allocates new), accessories (hook reuse / destroy), st.mounts /
   *  st.slotZ / st.currentAnimKey. Accessories whose strips already
   *  landed get their textures wired up here; the rest stay hidden
   *  until `installLandedAccessories` fills them in. */
  /**
   * Returns `true` when the commit installed a new atlas; `false`
   * when the pending was abandoned because its bake came back null
   * (stale-skipped or failed). Caller MUST NOT mark
   * `pending.bodyCommitted=true` on a `false` return — the pending
   * needs to be discarded so the next applyAnimation gets a fresh
   * one. Without this, the renderer would replace `st.atlas` with
   * null, release the bot's band instances, and leave the bot
   * visible-but-uncomposited — the "actor moves without animation"
   * symptom we saw at 500-bot stress.
   */
  private commitBody(st: SlotStateV2, pending: PendingAnim): boolean {
    const nextAtlas = pending.atlas ?? null;
    const nextVariant = pending.variant ?? null;
    const oldAtlas = st.atlas;
    const oldVariant = st.variant;

    if (!nextAtlas || !nextVariant) {
      // Stale-skipped or failed bake, or the class atlas didn't
      // include this anim variant. Don't touch st.atlas — the bot
      // keeps its previous variant rendered. If the class atlas
      // landed but lacked the variant, release the +1 ref the
      // pending acquire took so we don't leak the class atlas.
      if (nextAtlas) {
        this.cache.releaseClassAtlas(nextAtlas);
        pending.atlas = null;
        pending.variant = null;
      }
      return false;
    }

    // 1. Release every band-instance slot we previously held. After
    //    this the bot is invisible in the atlas; will become visible
    //    again once new band instances are allocated + setUV'd below.
    //
    //    Class-atlas optimisation: when the next class atlas is the
    //    SAME object as the current one, batches' shader resources
    //    don't change (same combinedTexture.source.uid) and we could
    //    in principle reuse the existing instance allocations for
    //    bands shared between variants. Cheaper just to release +
    //    re-allocate uniformly: the batch's free-list reuses the
    //    same instance row index, so the GPU buffer is rewritten in
    //    place. Batches stay alive between variants (the
    //    releaseBatchIfEmpty pass below only tears down genuinely
    //    empty batches).
    const releasedBands: { combinedTexture: Texture; band: AtlasBand }[] = [];
    if (oldAtlas && oldVariant) {
      const oldPage = oldAtlas.pages[oldVariant.pageIndex];
      for (const bi of st.bandInstances.values()) {
        bi.batch.release(bi.instanceIdx);
        const oldBand = oldVariant.bands.find(
          (b) => b.bandIndex === bi.bandIndex,
        );
        if (oldBand && oldPage) {
          releasedBands.push({
            combinedTexture: oldPage.combinedTexture,
            band: oldBand,
          });
        }
      }
    }
    st.bandInstances.clear();

    // 2. Release the old class atlas's refcount. The pending side
    //    holds its own +1 (taken at acquire time); transferring
    //    ownership means: drop the OLD ref the bot held, the
    //    pending's ref becomes the bot's ref. When `oldAtlas ===
    //    nextAtlas` (variant-only swap on the same class), we still
    //    must release — the acquire added a second ref to the same
    //    atlas, and skipping the release here would leak +1 per
    //    same-class anim transition.
    if (oldAtlas) {
      this.cache.releaseClassAtlas(oldAtlas);
    }

    // 3. Allocate new band-instance slots. Batches are keyed by
    //    `(page.combinedTexture.source.uid, bandIndex)` — so variants
    //    on the same class atlas page reuse the same batch object
    //    (batch consolidation across all bots of the same class).
    //    A class swap OR a page swap fans out into fresh batches.
    const nextPage = nextAtlas.pages[nextVariant.pageIndex];
    if (!nextPage) {
      log.warn(
        `commitBody: class atlas '${nextAtlas.key}' missing page ${nextVariant.pageIndex}`,
      );
      return false;
    }
    if (st.compositionSlot) {
      for (const bandInfo of nextVariant.bands) {
        const batch = this.atlas.getOrCreateBatch(
          st.compositionSlot,
          nextPage.combinedTexture,
          bandInfo,
        );
        const instanceIdx = batch.allocate();
        const atlasDims = this.atlasDimsForVariant(nextAtlas, nextVariant);
        const uv = computeBandFrameUV(atlasDims, nextVariant, bandInfo, 0);
        batch.setUV(instanceIdx, uv.u0, uv.v0, uv.u1, uv.v1);
        batch.setZones(instanceIdx, st.zone1, st.zone2, st.zone3);
        st.bandInstances.set(bandInfo.bandIndex, {
          bandIndex: bandInfo.bandIndex,
          batch,
          instanceIdx,
          atlasX: bandInfo.atlasX,
          atlasY: bandInfo.atlasY,
        });
      }
    }
    // Picking shim: hit-test reads from the variant's page. AABB
    // uses the active variant's frame dims + anchor.
    st.hitSprite.texture = nextPage.combinedTexture;
    const fw = nextVariant.frameWidth || 1;
    const fh = nextVariant.frameHeight || 1;
    st.hitSprite.anchor.set(nextVariant.anchorX / fw, nextVariant.anchorY / fh);
    st.atlas = nextAtlas;
    st.variant = nextVariant;

    // 4. Try to dispose empty batches from the OLD atlas's batches
    //    on this bot's page. After releasing our instances, batches
    //    whose last instance was ours can be torn down. On
    //    variant-only changes the batch ALSO contains our new
    //    allocations so it won't be empty — releaseBatchIfEmpty is
    //    a no-op for non-empty batches.
    const pageIndex = st.compositionSlot?.pageIndex;
    if (pageIndex !== undefined) {
      for (const { combinedTexture, band } of releasedBands) {
        this.atlas.releaseBatchIfEmpty(pageIndex, combinedTexture, band);
      }
    }

    // 5. Release old accessory sprites + tear down those no longer
    //    worn; reuse the Sprite for slots that survive the swap.
    //    Accessories whose strips haven't landed yet get hooks with
    //    `strip=null` and `sprite.visible=false` — they'll get filled
    //    in by `installLandedAccessories` on subsequent `tryCommit`
    //    calls as their bakes finish.
    const newAccessories = new Map<number, AccessoryHook>();
    const keepSlots = new Set(pending.accSlots);
    for (const [slotId, oldHook] of st.accessories) {
      if (keepSlots.has(slotId)) continue;
      if (oldHook.strip) this.cache.releaseAccessory(oldHook.strip);
      try {
        oldHook.sprite.parent?.removeChild(oldHook.sprite);
        oldHook.sprite.destroy();
      } catch {}
    }
    for (const accDef of pending.accessoryRefs) {
      const slotId = accDef.slot;
      const strip = pending.accStrips.get(slotId) ?? null;
      let hook = st.accessories.get(slotId);
      if (hook) {
        // Reuse the existing sprite, release its old strip ref.
        if (hook.strip) this.cache.releaseAccessory(hook.strip);
      } else {
        const sprite = new Sprite();
        sprite.anchor.set(0, 0);
        // Multi-page atlas: accessory sprites live in the bot's
        // page's globalRoot, not a single shared root. Bots are
        // page-stable (same compositionSlot.pageIndex for their
        // lifetime), so every accessory of this bot lands on the
        // same page. zIndex (set below) drives the band/accessory
        // interleave; the page's sortableChildren re-sorts each
        // tick.
        if (st.compositionSlot) {
          this.atlas.rootForSlot(st.compositionSlot).addChild(sprite);
        }
        hook = { sprite, strip: null, slot: slotId };
      }
      hook.sprite.zIndex = pending.slotZ.get(slotId) ?? 1;
      // Phase 2: only the slots whose strip already landed get textured
      // here. The rest stay hidden — `installLandedAccessories` plugs
      // them in later as their bake-queue entries resolve. The
      // accStrips Map only has entries for SLOTS THAT REPORTED, so a
      // `null` value (bake failure) is distinguishable from
      // "still in flight" (missing key).
      if (pending.accStrips.has(slotId)) {
        if (strip) {
          hook.strip = strip;
          hook.sprite.texture = strip.frames[0] ?? strip.texture;
          hook.sprite.anchor.set(
            strip.anchorX / strip.frameWidth,
            strip.anchorY / strip.frameHeight,
          );
          hook.sprite.visible = true;
          pending.accStrips.set(slotId, null);
        } else {
          hook.strip = null;
          hook.sprite.visible = false;
        }
      } else {
        hook.strip = null;
        hook.sprite.visible = false;
      }
      newAccessories.set(slotId, hook);
    }
    st.accessories = newAccessories;

    // Body atlas ownership transferred → null pending.atlas so a
    // subsequent supersede doesn't double-release st.atlas.
    pending.atlas = null;

    // 6. Promote mount-transform table + Z order + current key.
    st.mounts = pending.mounts;
    st.slotZ = pending.slotZ;
    st.currentAnimKey = pending.key;

    // 7. Position the bot's band instances inside its atlas slot,
    //    drive bands + accessories to frame 0, and mark the global
    //    compose pass dirty.
    if (st.compositionSlot) {
      const bounds = this.computeBotBounds(st, nextVariant);
      this.applyCompositionTransform(st, bounds);
      // Drive band UVs + accessory positions to frame 0 BEFORE the
      // first composition so the atlas shows frame 0 without gaps.
      this.setBandsFrame(st, 0);
      this.setAccessoriesFrame(st, 0);
      st.lastCompositionFrame = 0;
      this.compositionDirty = true;
      st.compositeSprite.visible = true;
    } else {
      st.compositeSprite.visible = false;
    }

    // 8. Body-commit reveals the bot's container.
    st.root.visible = true;
    return true;
  }

  /** Phase 2 accessory half — installs every accStrips entry whose
   *  hook still has `strip=null`. Idempotent: hooks whose strip is
   *  already set (from `commitBody` or a prior install pass) are
   *  skipped. Re-runs `setAccessoriesFrame` + `composeBot` so the
   *  newly-installed sprite appears in the next composite. */
  private installLandedAccessories(
    st: SlotStateV2,
    pending: PendingAnim,
  ): void {
    let installed = 0;
    for (const [slotId, strip] of pending.accStrips) {
      const hook = st.accessories.get(slotId);
      if (!hook) continue;
      if (hook.strip) continue; // already installed
      if (strip === null) {
        // Two cases land here: (a) bake genuinely failed (the
        // `onAccessoryLanded` callback got a null) — hook stays
        // hidden; (b) entry was already nulled by a prior install
        // pass (we transferred ownership and tagged it as null) —
        // skip silently. Both are no-ops.
        continue;
      }
      hook.strip = strip;
      hook.sprite.texture = strip.frames[0] ?? strip.texture;
      hook.sprite.anchor.set(
        strip.anchorX / strip.frameWidth,
        strip.anchorY / strip.frameHeight,
      );
      hook.sprite.visible = true;
      // Ownership transferred from pending → hook. See `commitBody`
      // for the rationale on nulling instead of deleting.
      pending.accStrips.set(slotId, null);
      installed += 1;
    }
    if (installed > 0 && st.atlas && st.variant) {
      if (st.compositionSlot) {
        const bounds = this.computeBotBounds(st, st.variant);
        this.applyCompositionTransform(st, bounds);
      }
      const fc = st.variant.frameCount;
      if (fc > 0) {
        const frame =
          st.lastCompositionFrame >= 0 ? st.lastCompositionFrame : 0;
        this.setAccessoriesFrame(st, frame);
        this.compositionDirty = true;
      }
    }
  }

  /**
   * Apply the bot's slot-fit transform to (a) each band-instance's
   * `aTransform` attribute in its batch — this is how the batched
   * shader knows where in the atlas each instance should land —
   * and (b) the composite sprite's anchor/scale so the bot's
   * world-space origin stays at SWF (0,0).
   *
   * Each band instance gets `(slot.x + swfOffsetX, slot.y +
   * swfOffsetY, frameWidth × scale, frameHeight × scale)`. The
   * shader uses this to position the unit-quad in atlas pixels.
   *
   * The composite sprite's anchor + scale match the legacy path so
   * `root.scale = 1/resolution` lands the visible composite at
   * screen pixels.
   */
  private applyCompositionTransform(
    st: SlotStateV2,
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    const slot = st.compositionSlot;
    if (!slot || !st.variant) return;
    const variant = st.variant;
    const scale = this.slotScaleFor(bounds);
    const swfOriginInSlotX = -bounds.minX * scale;
    const swfOriginInSlotY = -bounds.minY * scale;
    st.botScale = scale;
    st.swfOriginInSlotX = swfOriginInSlotX;
    st.swfOriginInSlotY = swfOriginInSlotY;

    // Each band instance positions itself at the slot origin + SWF
    // offset, with the bot's frame dimensions × slot-fit scale. The
    // shader vertex stage scales the unit quad by aTransform.zw.
    //
    // CRITICAL: band cell content's local origin (in SWF space) is
    // `(-anchorX, -anchorY)`, NOT `(0, 0)`. The unit quad's (0,0)
    // corner must therefore land at `(slot.x + swfOriginInSlotX
    // + bounds.minX × scale, ...)`. Because `swfOriginInSlotX =
    // -bounds.minX × scale`, the two cancel and the quad's (0,0)
    // is at `(slot.x, slot.y)` only if `bounds.min == -atlas.anchor`.
    // To keep it correct, anchor at the BAND CELL's origin: the
    // unit-quad's (0,0) corner = (-anchorX, -anchorY) in SWF space.
    // Our `aTransform.xy` therefore needs to factor anchorX/Y in.
    //
    // Simpler: position the quad so SWF (-anchorX, -anchorY) lands
    // at (slot.x, slot.y) — i.e. instance origin = slot - anchor*scale
    // + swfOriginInSlot. But since `swfOriginInSlot = -bounds.min ×
    // scale` and bounds.min already accounts for anchor, this works
    // out by setting `aTransform.xy = (slot.x + swfOriginInSlotX +
    // -atlas.anchorX × scale, slot.y + swfOriginInSlotY + -atlas.anchorY × scale)`
    // mathematically — let's derive: in legacy code, the
    // compositionStage at (slot.x + swfOriginInSlotX, ...) wraps the
    // band mesh whose pivot is (anchorX, anchorY). With pivot, a
    // local (0,0) on the mesh sample point maps to (-anchorX,
    // -anchorY) in pre-pivot coords. So compositionStage local
    // origin (after pivot) corresponds to SWF (0, 0). Thus the
    // composite-stage origin IS the SWF (0, 0) point in atlas pixels.
    // For the batched version, our unit quad's (0,0) corner should
    // map to the cell's SWF (-anchorX, -anchorY) point in atlas
    // pixels. World position = slot.x + swfOriginInSlotX +
    // (-anchorX) × scale.
    const atlasAnchorPxX = variant.anchorX * scale;
    const atlasAnchorPxY = variant.anchorY * scale;
    const instanceOriginX = slot.x + swfOriginInSlotX - atlasAnchorPxX;
    const instanceOriginY = slot.y + swfOriginInSlotY - atlasAnchorPxY;
    const scaledFrameW = variant.frameWidth * scale;
    const scaledFrameH = variant.frameHeight * scale;
    for (const bi of st.bandInstances.values()) {
      bi.batch.setTransform(
        bi.instanceIdx,
        instanceOriginX,
        instanceOriginY,
        scaledFrameW,
        scaledFrameH,
      );
    }

    st.compositeSprite.anchor.set(
      swfOriginInSlotX / slot.w,
      swfOriginInSlotY / slot.h,
    );
    st.compositeSprite.scale.set(1 / scale);
  }

  /** Drive every band-instance's UV to the cell for `frameIndex`. */
  private setBandsFrame(st: SlotStateV2, frameIndex: number): void {
    if (!st.atlas || !st.variant) return;
    const atlasDims = this.atlasDimsForVariant(st.atlas, st.variant);
    for (const bi of st.bandInstances.values()) {
      const band = {
        bandIndex: bi.bandIndex,
        atlasX: bi.atlasX,
        atlasY: bi.atlasY,
      };
      const uv = computeBandFrameUV(atlasDims, st.variant, band, frameIndex);
      bi.batch.setUV(bi.instanceIdx, uv.u0, uv.v0, uv.u1, uv.v1);
    }
  }

  /** Drive accessory sprites of `st` to `frameIndex`. Updates the
   *  sprite's texture (sub-frame cycle) AND its local affine via the
   *  active mount table — UNLESS the body's display list has no
   *  mount placement for this slot on this frame, in which case the
   *  sprite goes `renderable=false`.
   *
   *  Presence comes from the Rust extractor's per-(frame, slot)
   *  bitmap — canonical truth, no heuristics. Without this gate,
   *  capes/weapons/shields would render at SWF (0,0) on frames whose
   *  body anim doesn't include their mount (the "ghost weapon" bug).
   *
   *  Defensive: if `st.mounts` failed to load (e.g. stale wasm), we
   *  still set `renderable=true` and identity-skip so a previously-
   *  hidden sprite from a prior tick doesn't stay hidden. The sprite
   *  will render at its tryCommit-time default position — visibly
   *  wrong but at least visible, which is what surfaces the "wasm
   *  needs rebuild" failure mode. */
  private setAccessoriesFrame(st: SlotStateV2, frameIndex: number): void {
    if (!st.mounts) {
      for (const acc of st.accessories.values()) {
        if (acc.strip) acc.sprite.renderable = true;
      }
      return;
    }
    const frameInMount = frameIndex % st.mounts.frameCount;
    const tmp = mountScratch;
    for (const acc of st.accessories.values()) {
      if (!acc.strip) continue;
      if (!this.cache.isMountPresent(st.mounts, frameInMount, acc.slot)) {
        acc.sprite.renderable = false;
        continue;
      }
      acc.sprite.renderable = true;
      this.cache.readMountMatrix(st.mounts, frameInMount, acc.slot, tmp);
      const subIdx = frameIndex % acc.strip.frameCount;
      acc.sprite.texture = acc.strip.frames[subIdx];
      this.applyMountToAccessory(st, acc, tmp);
    }
  }

  /** Discard a staging in flight — release any strips that already
   *  landed and prevent any still-pending acquires from doing work.
   *  Resolves the staging's promise with `false` so awaiters know
   *  they were superseded and can decide whether to retry against
   *  the latest anim.
   *
   *  Phase 2: ownership semantics. After `commitBody` runs, the body
   *  atlas's ref AND every installed accessory strip's ref have been
   *  TRANSFERRED to `st.atlas` / `st.accessories[*].strip`. We clear
   *  those entries on transfer (`pending.atlas = null`, accStrips
   *  value set to null) so a subsequent discard doesn't re-release
   *  what `st` now owns. The check below skips nulls accordingly.
   *  Untransferred entries (bake landed but `commitBody` hadn't run
   *  yet because atlas hadn't, or accessory landed mid-stage with
   *  superseded pending) still hold the only ref and must be
   *  released here. */
  private discardPending(pending: PendingAnim): void {
    if (pending.atlas) {
      this.cache.releaseClassAtlas(pending.atlas);
      pending.atlas = null;
      pending.variant = null;
    }
    for (const strip of pending.accStrips.values()) {
      if (strip) this.cache.releaseAccessory(strip);
    }
    pending.accStrips.clear();
    pending.resolve(false);
  }

  private applyMountToAccessory(
    st: SlotStateV2,
    acc: AccessoryHook,
    m: { a: number; b: number; c: number; d: number; tx: number; ty: number },
  ): void {
    // Mount affine is in TWIP space; translation needs scaling by
    // `resolution / 20` to land in pixel space. Phase 5: accessory
    // sprites are direct children of `atlas.globalCompositionRoot`
    // (no per-bot compositionStage anymore), so the sprite's local
    // matrix must include the bot's slot translate + slot-fit scale
    // on top of the mount affine.
    //
    // World position composition (row-vector convention, applied
    // left-to-right):
    //   p_world = p_local × mount × scale_S × translate_T
    // where:
    //   mount     = (a, b, c, d, tx × twipScale, ty × twipScale)
    //   scale_S   = botScale
    //   translate = (slot.x + swfOriginInSlotX, slot.y + swfOriginInSlotY)
    //
    // Pixi v8 `matrix.prepend(other)`: `this = this × other`. So:
    //   M = mount             (set components)
    //   M.prepend(combinedST) → M = mount × combinedST = mount × S × T
    //
    // combinedST is just `(a=s, b=0, c=0, d=s, tx, ty)` — no need for
    // a separate Matrix object.
    const twipScale = this.resolution / 20;
    const slot = st.compositionSlot;
    if (!slot) {
      // No atlas slot → bot can't render anyway; skip.
      acc.sprite.renderable = false;
      return;
    }
    const M = pixelMatrixScratch;
    M.a = m.a;
    M.b = m.b;
    M.c = m.c;
    M.d = m.d;
    M.tx = m.tx * twipScale;
    M.ty = m.ty * twipScale;
    // Inline `M.prepend(combinedST)`. Pixi prepend formula:
    //   tx1 = this.tx, a1 = this.a, c1 = this.c
    //   this.a = a1*other.a + this.b*other.c
    //   this.b = a1*other.b + this.b*other.d
    //   this.c = c1*other.a + this.d*other.c
    //   this.d = c1*other.b + this.d*other.d
    //   this.tx = tx1*other.a + this.ty*other.c + other.tx
    //   this.ty = tx1*other.b + this.ty*other.d + other.ty
    // With combinedST = (s, 0, 0, s, T.tx, T.ty):
    //   a → a*s + b*0 = a*s
    //   b → a*0 + b*s = b*s
    //   c → c*s + d*0 = c*s
    //   d → c*0 + d*s = d*s
    //   tx → tx*s + ty*0 + T.tx = tx*s + T.tx
    //   ty → tx*0 + ty*s + T.ty = ty*s + T.ty
    const s = st.botScale;
    const Tx = slot.x + st.swfOriginInSlotX;
    const Ty = slot.y + st.swfOriginInSlotY;
    const newTx = M.tx * s + Tx;
    const newTy = M.ty * s + Ty;
    M.a *= s;
    M.b *= s;
    M.c *= s;
    M.d *= s;
    M.tx = newTx;
    M.ty = newTy;
    acc.sprite.setFromMatrix(M);
  }

  private retireSlotState(st: SlotStateV2): void {
    st.requestedAnimKey = "<retired>";
    st.currentAnimKey = "<retired>";
    st.player = null;
    // Wake up any awaiters with false so they bail out instead of
    // acting on a detached slot.
    if (st.pendingAnim) {
      this.discardPending(st.pendingAnim);
      st.pendingAnim = null;
    }
    // Release band-instance slots. Try to dispose batches whose last
    // instance was ours, on this bot's PAGE.
    const releasedBands: AtlasBand[] = [];
    if (st.atlas && st.variant) {
      for (const bi of st.bandInstances.values()) {
        bi.batch.release(bi.instanceIdx);
        const band = st.variant.bands.find((b) => b.bandIndex === bi.bandIndex);
        if (band) releasedBands.push(band);
      }
    }
    st.bandInstances.clear();
    if (st.atlas) {
      const stAtlas = st.atlas;
      const stVariant = st.variant;
      const stPageIndex = st.compositionSlot?.pageIndex;
      this.cache.releaseClassAtlas(stAtlas);
      st.atlas = null;
      st.variant = null;
      if (stPageIndex !== undefined && stVariant) {
        const page = stAtlas.pages[stVariant.pageIndex];
        if (page) {
          for (const band of releasedBands) {
            this.atlas.releaseBatchIfEmpty(
              stPageIndex,
              page.combinedTexture,
              band,
            );
          }
        }
      }
    }
    // Detach + destroy accessory sprites. They live as direct
    // children of `atlas.globalCompositionRoot` (Phase 5).
    for (const hook of st.accessories.values()) {
      if (hook.strip) this.cache.releaseAccessory(hook.strip);
      try {
        hook.sprite.parent?.removeChild(hook.sprite);
        hook.sprite.destroy();
      } catch {}
    }
    st.accessories.clear();
    // Release the atlas slot. The bot's pixels stay in the slot until
    // the next `composeAll()` clears the whole atlas — invisible
    // because no composite sprite samples a released slot until the
    // allocator hands it to a new bot.
    if (st.compositionSlot) {
      this.atlas.releaseSlot(st.compositionSlot);
      st.compositionSlot = null;
      this.compositionDirty = true;
    }
    // Composite sprite owns a Texture wrapping `atlas.source` with a
    // slot-specific frame; destroy the wrapper so it doesn't keep
    // referencing the atlas's source after the slot is gone. The
    // source itself is owned by SharedCompositionAtlas and survives.
    try {
      st.compositeSprite.texture.destroy(false);
    } catch {}
    try {
      st.root.parent?.removeChild(st.root);
      st.root.destroy({ children: true });
    } catch {}
  }
}

// Scratch object reused across accessory tick updates to avoid GC.
const mountScratch = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

// Pooled Pixi Matrix instance used by `applyMountToAccessory` — see
// the comment there. Module-level so it's shared across every
// PlayerStripRendererV2 instance (in practice there's only one).
const pixelMatrixScratch = new Matrix();

// Silence unused import warning when `MAX_SLOT` reference is removed in
// future cleanup. Kept as a compile-time tap so this module flags if
// the cache's max slot value changes underneath us.
void MAX_SLOT;

/**
 * Last-constructed renderer instance. Exposed so the stress-test
 * snapshot can pull atlas pressure (`slotsUsed/slotsCapacity`) without
 * threading a reference through the scene tree. Cleared on `destroy()`
 * so a torn-down renderer doesn't leak into post-destroy snapshots.
 */
let activeStripRenderer: PlayerStripRendererV2 | null = null;

export function getActivePlayerStripRendererStats(): {
  atlas: {
    slotsUsed: number;
    slotsCapacity: number;
    batchCount: number;
    pageCount: number;
  };
} | null {
  if (!activeStripRenderer) return null;
  const s = activeStripRenderer.getStats();
  return { atlas: s.atlas };
}
