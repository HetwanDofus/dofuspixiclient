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
  RenderTexture,
  Sprite,
  Ticker,
  type Renderer as PixiRenderer,
} from "pixi.js";

import type { CharacterAnimation } from "@/game/assets/character-sprite";
import type { ActivePlayer } from "@/game/scene/player/types";
import {
  BodyBandColourZones,
  BodyBandMesh,
} from "@/game/render/body-band-shader";
import {
  type AccessoryStrip,
  type BodyAtlas,
  type CharacterCacheStats,
  getCharacterCache,
  MAX_SLOT,
  type MountTransforms,
} from "@/game/render/character-cache";
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
  sprite: Sprite;
  strip: AccessoryStrip | null;
  slot: number;
}

interface BandHook {
  bandIndex: number;
  mesh: BodyBandMesh | null;
}

interface PendingAnim {
  /** The anim key this staging is for. Stale-skip predicate matches against it. */
  key: string;
  animation: CharacterAnimation;
  animName: string;
  dir: DirSuffix;
  flipped: boolean;
  /**
   * The shared atlas covering EVERY band of this anim. Filled in by
   * the body-acquire callback; `undefined` while pending, `null` on
   * bake failure. Commit fires when this AND every required
   * accessory slot has reported.
   */
  atlas?: BodyAtlas | null;
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
   * Caller-side readiness signal. Resolves `true` on commit (strips
   * live and rendering); resolves `false` when superseded by a later
   * `applyAnimation` call (movement / AI should bail and re-issue
   * against the latest anim instead of acting on a stale strip).
   */
  resolve: (committed: boolean) => void;
  readyPromise: Promise<boolean>;
}

interface SlotStateV2 {
  /** Per-slot Pixi container under `player.container`.
   *  Holds ONLY `hitSprite` (picking shim) + `compositeSprite`
   *  (Phase A.3 per-bot RT). Bands + accessories live in
   *  `compositionStage` (detached). */
  root: Container;
  /**
   * Invisible (`renderable=false`) Sprite that tracks the band-0
   * strip's texture + anchor. Used by the picking layer for AABB +
   * alpha-test hovers — V2's actual visible content is the composite
   * sprite, which the picker doesn't sample; the atlas alpha pattern
   * is the right source for hit-test.
   */
  hitSprite: Sprite;
  /** Per-bot colour zone uniforms shared across all bands. */
  zones: BodyBandColourZones;
  /** Currently-live atlas (refcounted; null until the first commit). */
  atlas: BodyAtlas | null;
  /** Band meshes in Z-order — LIVE, parented to compositionStage. */
  bands: BandHook[];
  /** Equipped accessory sprites keyed by slot id, parented to
   *  compositionStage. */
  accessories: Map<number, AccessoryHook>;
  /** CPU mount-transform table for the active anim. */
  mounts: MountTransforms | null;
  /** Slot id → Z order between bands. Updated when band info loads. */
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
  /** ── Phase A.3 — per-bot RT composition ─────────────────
   *  Detached Container parenting the bands + accessory sprites.
   *  Never added to the scene graph; its only render destination is
   *  `compositeRT` via `renderer.render({ container, target })`. */
  compositionStage: Container;
  /** Sprite the main scene actually sees. Texture = `compositeRT`,
   *  anchor at SWF (0,0) inside the RT. Added to `root`. */
  compositeSprite: Sprite;
  /** Per-bot RT for the composited body+accessories. Reused for the
   *  bot's lifetime; resized on anim swap if the atlas frame dims
   *  changed. Retired with a 2-tick settle on detach (see
   *  `feedback_pixi_wgpu_texture_lifetime`). */
  compositeRT: RenderTexture | null;
  /** Last frame index composited into the RT. -1 = needs first
   *  composition (set on every anim commit). */
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
 * Hard cap on either dimension of the per-bot composite RT. Defends
 * against an outlier atlas (giant bosses, future class additions)
 * blowing the GPU budget. Bots whose atlas exceeds this get rendered
 * at a scaled-down composition (visible-pixel ratio still ≥ 1× at
 * the default camera zoom).
 */
const RT_MAX_DIM = 384;

/**
 * Quantization step for RT dimensions. Round computed dims UP to
 * this multiple so anim swaps with small bbox variations (the same
 * bot in a different anim) reuse the existing RT instead of
 * allocating a new one. Realloc + retire is the dominant cost
 * around anim transitions — quantizing turns N distinct sizes into
 * ⌈N / QUANT⌉ buckets. 32 px is a sweet spot: small enough to
 * keep memory waste under ~10 %, big enough to absorb most
 * frame-to-frame bbox jitter.
 */
const RT_QUANT = 32;

/** Two ticks of settle before destroying a per-bot RT. Mirrors
 *  CharacterCache's RETIRE_TICKS — the patched-wgpu Drop is a no-op,
 *  so the explicit `destroy(true)` is the ONLY release path. */
const RT_RETIRE_TICKS = 2;

/** Per-bot retire entry. Holds the RT until its grace window expires,
 *  then `destroy(true)` releases the underlying GPUTexture. */
interface RetireRTEntry {
  rt: RenderTexture;
  ticksRemaining: number;
}

export class PlayerStripRendererV2 {
  private states = new Map<number, Map<PlayerStripSlot, SlotStateV2>>();
  private resolution: number;
  private cache = getCharacterCache();
  private pixiRenderer: PixiRenderer;
  /** RTs awaiting their 2-tick settle before destroy(). Drained by
   *  `tickRetireRTs` on the shared ticker. */
  private retireRTQueue: RetireRTEntry[] = [];
  private rtTickerInstalled = false;
  private rtTickerCallback: (() => void) | null = null;

  constructor(pixiRenderer: PixiRenderer, resolution = 3) {
    this.pixiRenderer = pixiRenderer;
    this.resolution = Math.max(1, resolution);
  }

  private ensureRTTickerInstalled(): void {
    if (this.rtTickerInstalled) return;
    this.rtTickerInstalled = true;
    this.rtTickerCallback = () => this.tickRetireRTs();
    Ticker.shared.add(this.rtTickerCallback);
  }

  private tickRetireRTs(): void {
    if (this.retireRTQueue.length === 0) return;
    const remaining: RetireRTEntry[] = [];
    for (const entry of this.retireRTQueue) {
      entry.ticksRemaining -= 1;
      if (entry.ticksRemaining > 0) {
        remaining.push(entry);
        continue;
      }
      try {
        entry.rt.destroy(true);
      } catch (e) {
        log.warn("composite RT destroy threw", e);
      }
    }
    this.retireRTQueue = remaining;
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
  private computeBotBounds(st: SlotStateV2, atlas: BodyAtlas): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } {
    // Body extent. Band meshes draw their atlas cell with the cell's
    // SWF (0,0) at compositionStage's local origin. So body pixels
    // span (-anchorX, -anchorY) to (frameWidth-anchorX,
    // frameHeight-anchorY) in compositionStage local coords.
    let minX = -atlas.anchorX;
    let minY = -atlas.anchorY;
    let maxX = atlas.frameWidth - atlas.anchorX;
    let maxY = atlas.frameHeight - atlas.anchorY;

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
   * Per-bot RT dimensions + composition-side scale derived from the
   * tight bounding box. If the bbox exceeds `RT_MAX_DIM` on either
   * axis we shrink uniformly so the RT fits — quality cost is a
   * slight downsample at the default camera zoom.
   */
  private rtSizeFor(bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }): { w: number; h: number; scale: number } {
    const naturalW = Math.max(1, bounds.maxX - bounds.minX);
    const naturalH = Math.max(1, bounds.maxY - bounds.minY);
    const scale = Math.min(1, RT_MAX_DIM / Math.max(naturalW, naturalH));
    // Quantize UP to RT_QUANT so small frame-to-frame bbox jitter
    // doesn't trigger a fresh RT alloc (the dominant cost around
    // anim transitions). Same-bucket sizes hit the existing-RT
    // reuse path in ensureCompositeRT.
    const quant = (n: number) =>
      Math.max(RT_QUANT, Math.ceil(n / RT_QUANT) * RT_QUANT);
    return {
      w: quant(naturalW * scale),
      h: quant(naturalH * scale),
      scale,
    };
  }

  /**
   * Render the bot's compositionStage (bands + accessories at the
   * current frame) into its per-bot RT. Single render pass into a
   * 1-bot target; main render pass picks up the result via the
   * `compositeSprite` next time.
   *
   * Pre: `st.compositeRT` allocated, `st.compositionStage` positioned
   * via `applyCompositionTransform` so the bot's bbox.min lands at
   * RT (0,0). The composite sprite's anchor matches so the bot's
   * container origin stays at SWF (0,0).
   */
  private composeBot(st: SlotStateV2): void {
    if (!st.atlas || !st.compositeRT) return;
    // sortChildren is NOT called here — Pixi v8's `sortableChildren`
    // flag on `compositionStage` triggers automatic sort during the
    // render walk, and we already explicitly sort once at tryCommit
    // (after zIndices are assigned). Calling it per composition was
    // burning ~12k sortChildren/sec at 200 bots × 60 fps for no
    // benefit and contributing to the fps regression.
    try {
      this.pixiRenderer.render({
        container: st.compositionStage,
        target: st.compositeRT,
        clear: true,
      });
    } catch (e) {
      log.warn("composeBot render failed", e);
    }
  }

  setResolution(res: number): void {
    this.resolution = Math.max(1, res);
  }

  getStats(): { players: number; slots: number; cache: CharacterCacheStats } {
    let slots = 0;
    for (const m of this.states.values()) slots += m.size;
    return {
      players: this.states.size,
      slots,
      cache: this.cache.getStats(),
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
    flipped: boolean,
  ): void {
    this.cache.acquireBodyAtlas(
      {
        bundle: animation.bundle,
        exportName: animation.exportName,
        start: 0,
        count: animation.frameCount,
        totalFrameCount: animation.frameCount,
        resolution: this.resolution,
        applyBFix: flipped,
        // Pre-warm both variants would double work; pick the more
        // common "no hat" variant for warmup. Bots with hat will
        // miss on first acquire and bake on demand.
        hatEquipped: false,
      },
      (atlas) => {
        // Drop the refcount we just added. Atlas stays in cache for
        // the first live acquire to hit.
        if (atlas) this.cache.releaseBodyAtlas(atlas);
      },
      // Always wanted — we want this baked unconditionally. If the
      // queue is overwhelmed and the bake gets stale, the queue's
      // stale-skip path will free without us hitting the callback.
      () => true,
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
      const atlas = st.atlas;
      if (!atlas) continue;
      const fc = atlas.frameCount;
      if (fc === 0) continue;
      const frame = idx % fc;
      if (frame === st.lastCompositionFrame) {
        // No frame change → RT contents still valid. Saves a render
        // pass per bot for the (very common) case where the bot's
        // anim hasn't advanced this tick.
        continue;
      }
      this.setBandsFrame(st, frame);
      this.setAccessoriesFrame(st, frame);
      this.composeBot(st);
      st.lastCompositionFrame = frame;
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
  }

  private createSlot(
    player: ActivePlayer,
    slot: PlayerStripSlot,
  ): SlotStateV2 {
    this.ensureRTTickerInstalled();
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

    // Phase A.3: detached composition stage + visible composite
    // sprite. Bands + accessories will be added to compositionStage
    // on first commit; the composite sprite carries the composed RT
    // and is what the main scene actually renders.
    const compositionStage = new Container();
    compositionStage.sortableChildren = true;
    // NOT added to scene — rendered to RT directly.

    const compositeSprite = new Sprite();
    compositeSprite.anchor.set(0, 0);
    compositeSprite.visible = false;
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
      zones: new BodyBandColourZones(),
      atlas: null,
      bands: [],
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
      compositionStage,
      compositeSprite,
      compositeRT: null,
      lastCompositionFrame: -1,
    };
  }

  private updateZones(st: SlotStateV2, animation: CharacterAnimation): void {
    const cz = animation.colorZones;
    // Path B mirrors V1's `setSwfPlayerColors`: value 0 (or null look)
    // means "no override" — the SWF's authored palette renders
    // untouched. BodyBandColourZones.setColours encodes the inactive
    // flag in the UBO so the shader skips recolor for that zone.
    if (cz) {
      st.zones.setColours(cz[0], cz[1], cz[2]);
    } else {
      st.zones.setColours(0, 0, 0);
    }
  }

  private applyFlipToSlot(st: SlotStateV2, flipped: boolean): void {
    const s = 1 / this.resolution;
    st.root.scale.set(flipped ? -s : s, s);
  }

  /** Kick off the single body-atlas acquire for `pending`. The atlas
   *  bake produces colour + zone textures and the per-band sub-rect
   *  metadata in one call — `bandCount × 2` allocations collapse to
   *  exactly 2 per anim. */
  private stageBodyAtlas(st: SlotStateV2, pending: PendingAnim): void {
    // Canonical AS2 `mcToHide` signal: hat (slot 1) equipped means
    // hair-toggle sprites (e.g. Iop's R_tete) pin to the short-hair
    // frame. Becomes part of the atlas cache key so we bake two
    // variants per affected class.
    const hatEquipped = pending.accessoryRefs.some((a) => a.slot === 1);
    this.cache.acquireBodyAtlas(
      {
        bundle: pending.animation.bundle,
        exportName: pending.animation.exportName,
        start: 0,
        count: pending.animation.frameCount,
        totalFrameCount: pending.animation.frameCount,
        resolution: this.resolution,
        applyBFix: pending.flipped,
        hatEquipped,
      },
      (atlas) => this.onAtlasLanded(st, pending, atlas),
      () => st.pendingAnim === pending,
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
    atlas: BodyAtlas | null,
  ): void {
    // Pending was discarded (another applyAnimation superseded it)
    // — release the atlas here so we don't leak the ref.
    if (st.pendingAnim !== pending) {
      if (atlas) this.cache.releaseBodyAtlas(atlas);
      return;
    }
    pending.atlas = atlas;
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

  /** Atomic swap: only fires once the body atlas AND every staged
   *  accessory has reported. The live state (bands + accessories +
   *  mounts + zIndex map) flips in a single tick — bots never display
   *  a half-loaded anim. */
  private tryCommit(st: SlotStateV2): void {
    const pending = st.pendingAnim;
    if (!pending) return;
    if (!pending.atlasArrived) return;
    if (pending.accStrips.size < pending.accSlots.length) return;

    const nextAtlas = pending.atlas ?? null;

    // 1. Release the old atlas's refcount (eligible for LRU when 0).
    //    The MESH instances themselves are reused below — see (2).
    if (st.atlas) {
      this.cache.releaseBodyAtlas(st.atlas);
    }

    // 2. Mesh reuse: instead of destroy+create, call setStrip() on
    //    existing meshes to swap textures + UVs in place. Saves the
    //    per-anim-change cost of:
    //      - 4× new Shader (Pixi pipeline + bind group lookup),
    //      - 4× new Geometry + Buffers (GPU alloc),
    //      - 4× new Mesh wrapper (JS allocation),
    //    plus the matching destroys. At 200 bots × frequent anim
    //    transitions that's the bulk of the Pixi-side churn.
    //
    //    If band counts differ between old/new, destroy/create the
    //    delta only.
    const newBands: BandHook[] = [];
    if (nextAtlas) {
      const newBandCount = nextAtlas.bands.length;
      const oldBandCount = st.bands.length;
      for (let i = 0; i < newBandCount; i++) {
        const bandInfo = nextAtlas.bands[i];
        const existing = i < oldBandCount ? st.bands[i].mesh : null;
        let mesh: BodyBandMesh;
        if (existing) {
          existing.setStrip(nextAtlas, bandInfo);
          existing.mesh.zIndex = bandInfo.bandIndex * 2;
          mesh = existing;
        } else {
          mesh = new BodyBandMesh(nextAtlas, bandInfo, st.zones);
          mesh.mesh.zIndex = bandInfo.bandIndex * 2;
          // Phase A.3: bands live in the detached compositionStage,
          // NOT in the visible scene graph.
          st.compositionStage.addChild(mesh.mesh);
        }
        newBands.push({ bandIndex: bandInfo.bandIndex, mesh });
      }
      // Destroy any leftover meshes if the new anim has fewer bands.
      for (let i = newBandCount; i < oldBandCount; i++) {
        const old = st.bands[i].mesh;
        if (old) old.destroy();
      }
      // Picking shim: hit-test reads from the atlas. The bands all
      // share frame size + anchor so AABB matches the live render.
      st.hitSprite.texture = nextAtlas.combinedTexture;
      const fw = nextAtlas.frameWidth || 1;
      const fh = nextAtlas.frameHeight || 1;
      st.hitSprite.anchor.set(nextAtlas.anchorX / fw, nextAtlas.anchorY / fh);
    } else {
      // Atlas bake failed — tear down all existing meshes.
      for (const band of st.bands) {
        if (band.mesh) band.mesh.destroy();
      }
    }
    st.bands = newBands;
    st.atlas = nextAtlas;

    // 3. Release old accessory sprites + tear down those no longer
    //    worn; reuse the Sprite for slots that survive the swap.
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
        // Phase A.3: accessories live in the detached
        // compositionStage; the bot's visible content is the
        // composited RT.
        st.compositionStage.addChild(sprite);
        hook = { sprite, strip: null, slot: slotId };
      }
      hook.sprite.zIndex = pending.slotZ.get(slotId) ?? 1;
      if (strip) {
        hook.strip = strip;
        hook.sprite.texture = strip.frames[0] ?? strip.texture;
        hook.sprite.anchor.set(
          strip.anchorX / strip.frameWidth,
          strip.anchorY / strip.frameHeight,
        );
        hook.sprite.visible = true;
      } else {
        hook.strip = null;
        hook.sprite.visible = false;
      }
      newAccessories.set(slotId, hook);
    }
    st.accessories = newAccessories;

    // 4. Promote mount-transform table + Z order + current key.
    st.mounts = pending.mounts;
    st.slotZ = pending.slotZ;
    st.currentAnimKey = pending.key;
    st.pendingAnim = null;

    // 5. Phase A.3: (re)allocate the per-bot RT if needed, position
    //    the composition stage so the bot's bbox fits exactly inside
    //    the RT (no cropping), run the FIRST composition for frame 0,
    //    then update the composite sprite's texture+anchor to match.
    //    Texture swap is deferred to the END of this block so the
    //    sprite never points at an un-rendered RT.
    if (nextAtlas) {
      // Compute tight bounds once — accessory strips + mount table
      // are now committed, so bbox reflects the bot's actual extent
      // across every anim frame. Drives RT sizing AND stage offset.
      const bounds = this.computeBotBounds(st, nextAtlas);
      this.ensureCompositeRT(st, nextAtlas, bounds);
      this.applyCompositionTransform(st, bounds);
      // Force one sort here — zIndex was just (re)assigned on every
      // band + accessory. After this, the composition stage's child
      // order is correct; subsequent composeBot calls inherit it
      // unless zIndex changes again (which only happens on the
      // next anim commit).
      st.compositionStage.sortChildren();
      // Drive the band meshes + accessories to frame 0 BEFORE the
      // first composition. swapFrame normally does this on every
      // tick; here we do it once on commit so the RT shows frame 0
      // without a one-frame gap.
      this.setBandsFrame(st, 0);
      this.setAccessoriesFrame(st, 0);
      this.composeBot(st);
      st.lastCompositionFrame = 0;
      // NOW swap the sprite's texture to point at the freshly-filled
      // RT. Before this line the sprite still showed whatever it had
      // before (old RT from previous anim, or no texture on first
      // commit). Order matters — see ensureCompositeRT docstring.
      if (st.compositeRT && st.compositeSprite.texture !== st.compositeRT) {
        st.compositeSprite.texture = st.compositeRT;
      }
      st.compositeSprite.visible = true;
    }

    // 6. First successful commit reveals the bot. Subsequent commits
    //    are no-ops on visibility — bots stay visible from here on.
    st.root.visible = true;

    // 7. Signal awaiters that the anim is live. Caller can now
    //    trigger the action (movement, etc.) it was holding for.
    pending.resolve(true);
  }

  /**
   * Ensure `st.compositeRT` exists at the right dimensions for
   * `atlas`. If an existing RT is the correct size, reuse it; else
   * schedule the old one for retire and allocate a fresh one of the
   * new size. Anim swaps usually keep dims constant (static vs walk
   * share frame size on most classes); class swaps may differ.
   */
  /** Allocate a fresh RT into `st.compositeRT` if the existing one
   *  doesn't match dimensions. Crucially, does NOT update
   *  `compositeSprite.texture` — that swap is deferred until the
   *  caller has filled the new RT via `composeBot`. Without that
   *  deferral, the sprite would briefly sample an UN-rendered RT
   *  during anim swaps whose new atlas has different dims → visible
   *  as a 1-frame black flash on the bot.
   *
   *  Returns `true` if a fresh RT was allocated (so the caller knows
   *  it needs to call `composeBot` THEN swap the sprite texture);
   *  `false` if the existing RT was reused. */
  private ensureCompositeRT(
    st: SlotStateV2,
    atlas: BodyAtlas,
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
  ): boolean {
    const { w, h } = this.rtSizeFor(bounds);
    if (
      st.compositeRT &&
      st.compositeRT.width === w &&
      st.compositeRT.height === h
    ) {
      return false;
    }
    if (st.compositeRT) {
      this.retireRTQueue.push({
        rt: st.compositeRT,
        ticksRemaining: RT_RETIRE_TICKS,
      });
    }
    const rt = RenderTexture.create({ width: w, height: h });
    // Label MUST start with `bot-composite` so the stress monitor's
    // `byLabel` breakdown groups every per-bot RT in one bucket — the
    // labelPrefix split is on `:`, `|`, or `@`. Visibility matters
    // because these RTs may not show up in `_managedTextures` —
    // surfacing them somewhere observable is half the point of A.3
    // memory hygiene.
    rt.label = `bot-composite|${atlas.key}`;
    if (rt.source && typeof rt.source === "object") {
      // Tag the underlying source as well — Pixi's managed-texture
      // hash keys by source label in some paths.
      (rt.source as { label?: string }).label = rt.label;
    }
    st.compositeRT = rt;
    // DO NOT touch compositeSprite.texture here — see method docstring.
    return true;
  }

  /**
   * Position `compositionStage` so the tight bot bbox's `min` point
   * lands at RT (0, 0). Then update the composite sprite's anchor
   * to point at SWF (0, 0) — that point lands at RT
   * `(-bbox.min * scale)`. The world-space anchor of the bot stays
   * at SWF (0, 0) regardless of how far accessories extend in any
   * direction.
   */
  private applyCompositionTransform(
    st: SlotStateV2,
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    if (!st.compositeRT) return;
    const { scale } = this.rtSizeFor(bounds);
    // The bbox's min point lands at RT (0, 0). compositionStage's
    // local origin = SWF (0, 0). So compositionStage's position in
    // RT pixels = (-bbox.min * scale).
    const swfOriginXRT = -bounds.minX * scale;
    const swfOriginYRT = -bounds.minY * scale;
    st.compositionStage.position.set(swfOriginXRT, swfOriginYRT);
    st.compositionStage.scale.set(scale);
    // Anchor the composite sprite at SWF (0, 0) inside the RT so the
    // bot's world-space anchor stays at SWF (0, 0) regardless of how
    // far accessories extend.
    st.compositeSprite.anchor.set(
      swfOriginXRT / st.compositeRT.width,
      swfOriginYRT / st.compositeRT.height,
    );
    // The composite sprite needs to render at SWF-pixel scale (so
    // `root.scale = 1/resolution` lands it at screen pixels). If the
    // RT was scaled down to fit `RT_MAX_DIM`, scale the sprite UP by
    // 1/scale so the on-screen size matches V1.
    st.compositeSprite.scale.set(1 / scale);
  }

  /** Drive every band mesh of `st` to `frameIndex`. */
  private setBandsFrame(st: SlotStateV2, frameIndex: number): void {
    for (const band of st.bands) {
      if (!band.mesh) continue;
      band.mesh.setFrame(frameIndex);
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
      this.applyMountToAccessory(acc, tmp);
    }
  }

  /** Discard a staging in flight — release any strips that already
   *  landed and prevent any still-pending acquires from doing work.
   *  Resolves the staging's promise with `false` so awaiters know
   *  they were superseded and can decide whether to retry against
   *  the latest anim. */
  private discardPending(pending: PendingAnim): void {
    if (pending.atlas) {
      this.cache.releaseBodyAtlas(pending.atlas);
      pending.atlas = null;
    }
    for (const strip of pending.accStrips.values()) {
      if (strip) this.cache.releaseAccessory(strip);
    }
    pending.accStrips.clear();
    pending.resolve(false);
  }

  private applyMountToAccessory(
    acc: AccessoryHook,
    m: { a: number; b: number; c: number; d: number; tx: number; ty: number },
  ): void {
    // Mount affine is in TWIP space; translation needs scaling by
    // `resolution / 20` to land in pixel space. The accessory strip's
    // anchor (Pixi `Sprite.anchor`) accounts for the accessory's own
    // local origin offset; the mount affine then positions that
    // origin inside the per-bot container's coord space.
    //
    // Mutate the pooled scratch Matrix in place instead of `new
    // Matrix(...)`. At 300 bots × ~3 accessories × 60 fps that's
    // ~54 000 Matrix allocations/sec saved → meaningfully less JS
    // heap churn → fewer GC pauses (a major source of frame spikes).
    const scale = this.resolution / 20;
    pixelMatrixScratch.a = m.a;
    pixelMatrixScratch.b = m.b;
    pixelMatrixScratch.c = m.c;
    pixelMatrixScratch.d = m.d;
    pixelMatrixScratch.tx = m.tx * scale;
    pixelMatrixScratch.ty = m.ty * scale;
    acc.sprite.setFromMatrix(pixelMatrixScratch);
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
    for (const band of st.bands) {
      if (band.mesh) band.mesh.destroy();
    }
    st.bands = [];
    if (st.atlas) {
      this.cache.releaseBodyAtlas(st.atlas);
      st.atlas = null;
    }
    for (const hook of st.accessories.values()) {
      if (hook.strip) this.cache.releaseAccessory(hook.strip);
      try {
        hook.sprite.parent?.removeChild(hook.sprite);
        hook.sprite.destroy();
      } catch {}
    }
    st.accessories.clear();
    // Phase A.3: retire the per-bot RT through the 2-tick settle so
    // in-flight Pixi samplers complete before destroy. The patched
    // wgpu Drop is a no-op, so explicit destroy is the only release.
    if (st.compositeRT) {
      this.retireRTQueue.push({
        rt: st.compositeRT,
        ticksRemaining: RT_RETIRE_TICKS,
      });
      st.compositeRT = null;
    }
    // The detached composition stage is OUR property — destroy
    // children (any leftover Mesh/Sprite refs) so we don't leak GPU
    // buffers in the band geometry. Pixi v8 Mesh.destroy doesn't
    // recurse, so band meshes were already explicitly destroyed
    // above; this is a defensive sweep for accessories.
    try {
      st.compositionStage.destroy({ children: true });
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
