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
   * bake failure. Phase 2 progressive commit: body commits as soon
   * as the atlas lands; accessories follow as their strips land.
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
  /** ── Shared composition atlas ────────────────────────────
   *  Container parenting the bands + accessory sprites. Parented
   *  to `SharedCompositionAtlas.globalCompositionRoot` at slot-
   *  acquire time (see `RENDER_SHARED_ATLAS_PLAN.md`). Position
   *  inside the global root = slot origin + (-bounds.min × scale),
   *  so when the global root is rendered into the atlas, this
   *  bot's content lands inside its own slot rect. */
  compositionStage: Container;
  /** Sprite the main scene actually sees. Texture samples the
   *  bot's slot sub-rect of the shared atlas. Pixi's sprite
   *  batcher fuses every bot's compositeSprite into ONE draw call
   *  because they all share `atlas.renderTexture.source`. */
  compositeSprite: Sprite;
  /** Atlas slot this bot occupies. Null if acquisition failed
   *  (slot exhaustion) — the bot will not render until a slot
   *  frees up. */
  compositionSlot: CompositionSlot | null;
  /** Last frame index composited into the slot. -1 = needs first
   *  composition (set on every anim commit). Drives swapFrame's
   *  early-out and the global compose dirty flag. */
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
    const t0 = performance.now();
    try {
      this.pixiRenderer.render({
        container: this.atlas.globalCompositionRoot,
        target: this.atlas.renderTexture,
        clear: true,
      });
    } catch (e) {
      log.warn("composeAll render failed", e);
    }
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
    atlas: { slotsUsed: number; slotsCapacity: number };
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
    // Pre-warm BOTH hat variants. 80 % of stress bots equip hats; the
    // original "no-hat only" prewarm meant 80 % of bots cache-missed
    // on every transition → bake → freeze. CharacterCache's
    // `normalizeHatEquipped` collapses the two variants into one for
    // classes without a hair-toggle sprite (canonical Dofus 1.29:
    // only Iop has the toggle, see
    // `feedback_swf_apply_color_zones` + `BodyAtlasKeyParts`), so
    // the doubled prewarm only doubles work for Iop. Every other
    // class dedupes at the cache layer — no extra memory cost.
    const keyBase = {
      bundle: animation.bundle,
      exportName: animation.exportName,
      start: 0,
      count: animation.frameCount,
      totalFrameCount: animation.frameCount,
      resolution: this.resolution,
      applyBFix: flipped,
    };
    for (const hatEquipped of [false, true]) {
      this.cache.acquireBodyAtlas(
        { ...keyBase, hatEquipped },
        (atlas) => {
          // Drop the refcount we just added. Atlas stays in cache for
          // the first live acquire to hit.
          if (atlas) this.cache.releaseBodyAtlas(atlas);
        },
        // Always wanted — we want this baked unconditionally. If the
        // queue is overwhelmed and the bake gets stale, the queue's
        // stale-skip path now fires the callback with null (see
        // strip-bake-queue.ts).
        () => true,
      );
    }
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
      const atlas = st.atlas;
      if (!atlas) continue;
      const fc = atlas.frameCount;
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

    // Shared atlas: compositionStage gets parented to the atlas's
    // `globalCompositionRoot` and positioned at the slot's origin
    // (via `applyCompositionTransform` on first commit). The single
    // global compose pass then renders this stage's content into
    // the bot's slot rect of the shared atlas.
    const compositionStage = new Container();
    compositionStage.sortableChildren = true;
    const compositionSlot = this.atlas.acquire(compositionStage);
    if (!compositionSlot) {
      log.warn(
        `createSlot: atlas exhausted (${this.atlas.getStats().slotsCapacity} slots), ` +
          `player ${player.id} slot '${slot}' will not render until a slot frees up`,
      );
    }

    // Composite sprite samples this bot's slot sub-rect of the
    // shared atlas. The texture is set immediately on slot
    // acquisition (frame won't change for the slot's lifetime) so
    // Pixi's sprite batcher can fuse every bot's compositeSprite
    // into a single batched draw in the main pass — same source,
    // different frame rects per bot.
    const compositeSprite = new Sprite();
    compositeSprite.anchor.set(0, 0);
    compositeSprite.visible = false;
    if (compositionSlot) {
      compositeSprite.texture = new Texture({
        source: this.atlas.renderTexture.source,
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
      compositionSlot,
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
      this.commitBody(st, pending);
      pending.bodyCommitted = true;
      pending.resolve(true);
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

  /** Phase 2 body half — runs once per pending. Idempotent on st.atlas
   *  (releases old, installs new), st.bands (mesh reuse / destroy),
   *  st.accessories (hook reuse / destroy), st.mounts / st.slotZ /
   *  st.currentAnimKey, and the per-bot RT. Accessories whose strips
   *  have already landed get their textures wired up here; the rest
   *  get hooks with `strip=null` + `sprite.visible=false`. */
  private commitBody(st: SlotStateV2, pending: PendingAnim): void {
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
        // Phase A.3: accessories live in the detached
        // compositionStage; the bot's visible content is the
        // composited RT.
        st.compositionStage.addChild(sprite);
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
          // Ownership transferred from pending → hook. Null the
          // accStrips entry so a subsequent `discardPending` (caused
          // by a later `applyAnimation` superseding this one) doesn't
          // double-release the strip ref. The Map entry stays so
          // `accStrips.size` continues to count it as "reported"
          // toward the final resolve gate.
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

    // 4. Promote mount-transform table + Z order + current key.
    //    `st.pendingAnim` stays pointed at `pending` so subsequent
    //    accessory-landed callbacks know they're for this anim and
    //    can install themselves via `installLandedAccessories`.
    st.mounts = pending.mounts;
    st.slotZ = pending.slotZ;
    st.currentAnimKey = pending.key;

    // 5. Position the bot's compositionStage inside its atlas slot,
    //    drive bands + accessories to frame 0, and mark the global
    //    compose pass dirty. The actual atlas render happens once
    //    per tick in `composeAll()`. The composite sprite's texture
    //    is fixed for the slot's lifetime (set in createSlot) — we
    //    only update its anchor here to keep SWF (0,0) at the bot's
    //    world origin regardless of how the bbox fits in the slot.
    //
    //    Phase 2 caveat: at body-commit time, accessories that
    //    haven't landed yet contribute body-frame bounds (their hook
    //    has `strip=null`, so `computeBotBounds` skips them). Late
    //    accessories that land outside that bbox get clipped at the
    //    slot edge until the next anim commit re-fits. Accepted
    //    trade-off — a few hundred ms of edge clipping is much less
    //    ugly than an invisible bot for the full bake window.
    if (nextAtlas && st.compositionSlot) {
      const bounds = this.computeBotBounds(st, nextAtlas);
      this.applyCompositionTransform(st, bounds);
      // Force one sort here — zIndex was just (re)assigned on every
      // band + accessory. After this, the composition stage's child
      // order is correct; subsequent composeAll calls inherit it
      // unless zIndex changes again (next anim commit).
      st.compositionStage.sortChildren();
      // Drive the band meshes + accessories to frame 0 BEFORE the
      // first composition so the atlas shows frame 0 without a
      // one-frame gap.
      this.setBandsFrame(st, 0);
      this.setAccessoriesFrame(st, 0);
      st.lastCompositionFrame = 0;
      // The bot is now ready to be rendered by the next composeAll().
      this.compositionDirty = true;
      st.compositeSprite.visible = true;
    } else if (nextAtlas && !st.compositionSlot) {
      // Atlas exhausted at createSlot time — bot stays hidden.
      // composite sprite remains visible=false; root.visible below
      // is also a no-op visually because the sprite carries no
      // texture. Logging happened in createSlot.
      st.compositeSprite.visible = false;
    }

    // 6. Body-commit reveals the bot. Subsequent body-commits stay
    //    visible from here on; the visibility flag is not toggled
    //    again until detach.
    st.root.visible = true;
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
    if (installed > 0 && st.atlas) {
      // Drive the new sprite to the current frame + mark the global
      // compose pass dirty. The actual atlas render happens once per
      // tick in `composeAll()`.
      //
      // CRITICAL: re-run `computeBotBounds` + `applyCompositionTransform`
      // now that the bot has accessories the original `commitBody` call
      // didn't have. Without this, the slot scale + compositionStage
      // offset stays sized to body-only bounds; the freshly-installed
      // accessory (hat, cape, weapon) extends past the original bbox,
      // gets either CROPPED at the slot edge OR SPILLS pixels into
      // the adjacent atlas slot — showing up as "pieces of other
      // players inside some bots" plus visible crop. The whole-atlas
      // `clear: true` on each `composeAll` keeps the spill from
      // persisting once we re-apply correct bounds, so the fix is
      // immediate and self-healing.
      if (st.atlas && st.compositionSlot) {
        const bounds = this.computeBotBounds(st, st.atlas);
        this.applyCompositionTransform(st, bounds);
      }
      const fc = st.atlas.frameCount;
      if (fc > 0) {
        const frame =
          st.lastCompositionFrame >= 0 ? st.lastCompositionFrame : 0;
        this.setAccessoriesFrame(st, frame);
        this.compositionDirty = true;
      }
    }
  }

  /**
   * Position `compositionStage` inside its atlas slot so the bot's
   * bbox.min lands at `(slot.x, slot.y)` (= upper-left of the slot
   * in atlas pixels). compositionStage's local origin is SWF (0, 0);
   * the offset `(-bbox.min × scale)` puts that origin inside the
   * slot. When the entire `globalCompositionRoot` is rendered into
   * the atlas, this bot's content lands in its slot rect.
   *
   * The composite sprite's anchor normalises the SWF (0, 0) point
   * relative to the slot dims — `swfOriginInSlot / slot.size` — so
   * the bot's world-space anchor stays at SWF (0, 0) regardless of
   * how the bbox fits inside the slot. Sprite scale is `1/scale` to
   * convert atlas-pixel-size back to SWF-pixel-size (so
   * `root.scale = 1/resolution` lands the visible composite at
   * screen pixels).
   */
  private applyCompositionTransform(
    st: SlotStateV2,
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    const slot = st.compositionSlot;
    if (!slot) return;
    const scale = this.slotScaleFor(bounds);
    const swfOriginInSlotX = -bounds.minX * scale;
    const swfOriginInSlotY = -bounds.minY * scale;
    // compositionStage's position INSIDE globalCompositionRoot — in
    // atlas pixels. When the root is rendered into the atlas, this
    // stage's content lands at (slot.x + offset, slot.y + offset).
    st.compositionStage.position.set(
      slot.x + swfOriginInSlotX,
      slot.y + swfOriginInSlotY,
    );
    st.compositionStage.scale.set(scale);
    // Anchor the composite sprite at SWF (0, 0) inside the slot.
    // Denominator is slot.w/h because the sprite's frame is the slot
    // sub-rect; the anchor is normalised against the frame size.
    st.compositeSprite.anchor.set(
      swfOriginInSlotX / slot.w,
      swfOriginInSlotY / slot.h,
    );
    // The composite sprite renders at SWF-pixel scale (so
    // `root.scale = 1/resolution` lands it at screen pixels). If the
    // bbox was scaled down to fit the slot, scale the sprite UP by
    // 1/scale so the on-screen size matches the original.
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
    // Release the atlas slot. The bot's pixels stay in the slot until
    // the next `composeAll()` clears the whole atlas — invisible
    // because no composite sprite samples a released slot until the
    // allocator hands it to a new bot.
    if (st.compositionSlot) {
      this.atlas.release(st.compositionStage, st.compositionSlot);
      st.compositionSlot = null;
      // The slot's freshly-released area in the atlas will be cleared
      // on the next composeAll's `clear: true`. Mark dirty so that
      // pass runs even if no other bots changed this tick — protects
      // against stale pixels showing through if the slot is reused.
      this.compositionDirty = true;
    }
    // Composite sprite owns a Texture wrapping `atlas.source` with a
    // slot-specific frame; destroy the wrapper so it doesn't keep
    // referencing the atlas's source after the slot is gone. The
    // source itself is owned by SharedCompositionAtlas and survives.
    try {
      // destroy(false) — do NOT destroy the wrapped source (shared
      // across all bots and owned by the atlas).
      st.compositeSprite.texture.destroy(false);
    } catch {}
    // The composition stage is OUR property. Destroy children
    // (leftover Mesh/Sprite refs) so we don't leak GPU buffers in
    // band geometry. Pixi v8 Mesh.destroy doesn't recurse, so band
    // meshes were already explicitly destroyed above; this is a
    // defensive sweep for accessories.
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

/**
 * Last-constructed renderer instance. Exposed so the stress-test
 * snapshot can pull atlas pressure (`slotsUsed/slotsCapacity`) without
 * threading a reference through the scene tree. Cleared on `destroy()`
 * so a torn-down renderer doesn't leak into post-destroy snapshots.
 */
let activeStripRenderer: PlayerStripRendererV2 | null = null;

export function getActivePlayerStripRendererStats(): {
  atlas: { slotsUsed: number; slotsCapacity: number };
} | null {
  if (!activeStripRenderer) return null;
  const s = activeStripRenderer.getStats();
  return { atlas: s.atlas };
}
