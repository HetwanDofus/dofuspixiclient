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
import { getSharedInputAtlas } from "@/game/render/shared-input-atlas";
import { getVelloGpu } from "@/game/render/vello-loader";
import { recordProbe } from "@/game/render/render-probes";
import { createLogger } from "@/utils/logger";

const log = createLogger("PlayerStripRendererV2");

/** One equipped accessory ref in a crowd snapshot row. */
export interface CrowdAccSnapshot {
  bundle: string;
  export: string;
  slot: number;
  animType: number;
}

/**
 * One player's live render state, captured for the Vello-direct crowd
 * renderer. Consumed by `crowd-renderer.ts` → `realCrowdSetup`.
 */
export interface CrowdPlayerSnapshot {
  /** Stable player id (drives ordered position updates + picking). */
  id: number;
  /** Body has committed (atlas slot rendered + sprite visible). */
  committed: boolean;
  /** Player is mounted (has mount sub-slots) — excluded from the crowd
   *  (mount layers stay on the per-player strip path). */
  mounted: boolean;
  bundle: string;
  export: string;
  frame: number;
  frameCount: number;
  fps: number;
  dir: DirSuffix;
  flipped: boolean;
  c1: number;
  c2: number;
  c3: number;
  x: number;
  y: number;
  acc: CrowdAccSnapshot[];
}

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
  // ── Diagnostics (anim-watchdog) ───────────────────────────────
  /** Last `player.frameIndex` observed in swapFrame. */
  diagLastIdx: number;
  /** Consecutive swapFrame ticks where `player.frameIndex` was
   *  unchanged AND `variant.frameCount > 1` AND the anim key is a
   *  cycling one (not "static*"). Saturates at a large value so
   *  print can clamp. */
  diagStuckTicks: number;
  /** Consecutive swapFrame ticks where `variant === null` while
   *  `currentAnimKey` is non-empty + non-"<retired>". This signals
   *  an in-flight anim swap that never landed (bake stale, dedup
   *  drop, or refcount race). */
  diagVariantMissingTicks: number;
  /** Set when we've already emitted the one-shot "stuck" warning
   *  for the current freeze episode. Reset to false when frameIndex
   *  moves (i.e., the freeze ends). */
  diagStuckLogged: boolean;
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

/**
 * One-shot diagnostic captured around a single
 * `setResolutionAndRerender(res)` call. Emits a structured summary
 * to the log once every dispatched bot's pending animation has
 * resolved (committed OR abandoned), giving a per-zoom-step view of
 * where main-thread time + bake latency + composition work went.
 *
 * Not a continuous profiler — it's deliberately scoped to the zoom
 * re-stage event because that's the only path where dozens-to-
 * hundreds of bots all stage fresh animations in one burst.
 * Steady-state per-bot animation changes don't get profiled and
 * incur zero overhead.
 *
 * Lifecycle: created by `setResolutionAndRerender`, garbage-
 * collected once `finalizeIfDone` flushes and the renderer drops
 * its `zoomProfile` reference.
 */
class ZoomBotProfile {
  private readonly startedAt: number;
  private readonly fromRes: number;
  private readonly toRes: number;
  /** Cache-counter snapshots at start; delta vs final snapshot tells
   *  us how many unique class atlases / accessories actually missed
   *  the cache for this zoom event. */
  private readonly cacheHitsStart: number;
  private readonly cacheMissesStart: number;
  private readonly cacheEvictsStart: number;
  /** Bots `setResolutionAndRerender` actually re-dispatched
   *  (excludes detached / slot-less / null-animation states). */
  private dispatched = 0;
  /** Sum of wall time spent inside each `applyAnimation` call from
   *  the re-dispatch loop. The synchronous JS scheduling cost —
   *  doesn't include async bake or commit time. */
  private applyMs = 0;
  /** Bots whose pending has resolved (commit OR abandoned). When
   *  this reaches `dispatched`, the profile flushes. */
  private resolved = 0;
  /** Of the resolved, how many actually installed a new atlas. */
  private committedOk = 0;
  /** Bots whose atlas bake landed (even if commit later failed). */
  private atlasLanded = 0;
  /** Earliest `onAtlasLanded` timestamp across all bots — the
   *  worker pool's first finish. */
  private firstAtlasLandAt = 0;
  /** Latest `onAtlasLanded` timestamp — the worker pool's last
   *  finish. The (last-first) span tells us how parallel the
   *  worker pool actually was. */
  private lastAtlasLandAt = 0;
  /** Sum of wall time `commitBody` spent on the main thread. */
  private commitMs = 0;
  /** Slowest single `commitBody` call observed. */
  private maxCommitMs = 0;
  /** Compose passes that fired between `start` and `finalize` —
   *  each one is one `pixiRenderer.render` into the shared atlas. */
  private composePasses = 0;
  /** Sum of compose-pass wall time. */
  private composeMs = 0;
  /** Slowest compose pass observed. */
  private maxComposeMs = 0;

  constructor(
    fromRes: number,
    toRes: number,
    cacheSnapshot: { hits: number; misses: number; evicts: number },
  ) {
    this.startedAt = performance.now();
    this.fromRes = fromRes;
    this.toRes = toRes;
    this.cacheHitsStart = cacheSnapshot.hits;
    this.cacheMissesStart = cacheSnapshot.misses;
    this.cacheEvictsStart = cacheSnapshot.evicts;
  }

  recordDispatch(applyMs: number): void {
    this.dispatched += 1;
    this.applyMs += applyMs;
  }

  /** `null` atlas means stale-skipped or failed bake — still counts
   *  as a "landing" (worker reported back) so we see how many
   *  pendings actually got past the queue. */
  recordAtlasLand(): void {
    const now = performance.now();
    if (this.firstAtlasLandAt === 0) this.firstAtlasLandAt = now;
    this.lastAtlasLandAt = now;
    this.atlasLanded += 1;
  }

  recordCommit(durationMs: number, success: boolean): void {
    this.commitMs += durationMs;
    if (durationMs > this.maxCommitMs) this.maxCommitMs = durationMs;
    if (success) this.committedOk += 1;
  }

  recordResolve(): void {
    this.resolved += 1;
  }

  recordCompose(durationMs: number): void {
    this.composePasses += 1;
    this.composeMs += durationMs;
    if (durationMs > this.maxComposeMs) this.maxComposeMs = durationMs;
  }

  /** True when every dispatched bot has reported in (committed or
   *  abandoned). Caller flushes + drops the profile. */
  isDone(): boolean {
    return this.dispatched > 0 && this.resolved >= this.dispatched;
  }

  /** Dispatch happened but nothing got dispatched — common when
   *  `setResolutionAndRerender` is called with no live bots. Caller
   *  flushes immediately and drops the profile. */
  isEmpty(): boolean {
    return this.dispatched === 0;
  }

  flush(cacheSnapshot: {
    hits: number;
    misses: number;
    evicts: number;
  }): void {
    const totalMs = performance.now() - this.startedAt;
    const bakeSpanMs =
      this.lastAtlasLandAt > 0
        ? this.lastAtlasLandAt - this.startedAt
        : 0;
    const bakeParallelismMs =
      this.firstAtlasLandAt > 0
        ? this.lastAtlasLandAt - this.firstAtlasLandAt
        : 0;
    const cacheHitsDelta = cacheSnapshot.hits - this.cacheHitsStart;
    const cacheMissesDelta = cacheSnapshot.misses - this.cacheMissesStart;
    const cacheEvictsDelta = cacheSnapshot.evicts - this.cacheEvictsStart;
    log.info(
      `zoomProfile from=${this.fromRes} to=${this.toRes} bots=${this.dispatched} ` +
        `applySum=${this.applyMs.toFixed(1)}ms ` +
        `cacheHits=${cacheHitsDelta} cacheMiss=${cacheMissesDelta} cacheEvicts=${cacheEvictsDelta} ` +
        `atlasLanded=${this.atlasLanded} ` +
        `firstLand=${(this.firstAtlasLandAt > 0
          ? this.firstAtlasLandAt - this.startedAt
          : 0
        ).toFixed(1)}ms ` +
        `lastLand=${bakeSpanMs.toFixed(1)}ms ` +
        `landSpread=${bakeParallelismMs.toFixed(1)}ms ` +
        `committed=${this.committedOk}/${this.resolved} ` +
        `commitSum=${this.commitMs.toFixed(1)}ms ` +
        `commitMax=${this.maxCommitMs.toFixed(1)}ms ` +
        `composes=${this.composePasses} ` +
        `composeSum=${this.composeMs.toFixed(1)}ms ` +
        `composeMax=${this.maxComposeMs.toFixed(1)}ms ` +
        `wall=${totalMs.toFixed(1)}ms`,
    );
  }
}

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
  /**
   * Active zoom re-stage profile, or null when no zoom event is
   * currently in flight. Set by `setResolutionAndRerender`; flushed
   * + cleared by `maybeFinalizeZoomProfile` once every dispatched
   * bot's pending has resolved. Steady-state per-bot animation
   * changes don't touch this.
   */
  private zoomProfile: ZoomBotProfile | null = null;

  constructor(pixiRenderer: PixiRenderer, resolution = 3) {
    this.pixiRenderer = pixiRenderer;
    this.resolution = Math.max(1, resolution);
    this.atlas = new SharedCompositionAtlas();
    // Register globally so the stress-test snapshot can read atlas
    // pressure without threading a reference through the scene tree.
    activeStripRenderer = this;

    // ── TEMP DIAG: window.__dumpAtlases() ──────────────────────────
    // Extracts the input super-atlas pages (what BodyBandBatch samples)
    // and the composition pages (the per-bot output) to on-screen
    // canvases, cropping the packed top-left region for detail. Lets us
    // see whether garbage lives in the Vello render/blit (input) or in
    // band sampling/transform (composition). Remove once root-caused.
    if (typeof window !== "undefined") {
      (
        window as unknown as {
          __dumpAtlases?: (opts?: {
            inputCrop?: number;
            inputOut?: number;
            compCrop?: number;
            compOut?: number;
          }) => void;
        }
      ).__dumpAtlases = (opts) => {
          try {
            const inputCrop = opts?.inputCrop ?? 2048;
            const inputOut = opts?.inputOut ?? 700;
            const compCrop = opts?.compCrop ?? 4096;
            const compOut = opts?.compOut ?? 1100;
            const r = this.pixiRenderer as unknown as {
              extract: {
                canvas: (
                  t: unknown,
                ) => CanvasImageSource & { width: number; height: number };
              };
            };
            const host =
              document.getElementById("__atlasdump") ??
              (() => {
                const d = document.createElement("div");
                d.id = "__atlasdump";
                d.style.cssText =
                  "position:fixed;left:0;top:0;z-index:99999;background:#222;display:flex;flex-wrap:wrap;gap:4px;padding:4px;max-width:100vw;";
                document.body.appendChild(d);
                return d;
              })();
            host.innerHTML = "";
            const addCrop = (
              label: string,
              tex: unknown,
              cropDim: number,
              outDim: number,
            ) => {
              const full = r.extract.canvas(tex);
              const out = document.createElement("canvas");
              out.width = outDim;
              out.height = outDim;
              const ctx = out.getContext("2d");
              if (!ctx) return;
              ctx.fillStyle = "#101010";
              ctx.fillRect(0, 0, outDim, outDim);
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(full, 0, 0, cropDim, cropDim, 0, 0, outDim, outDim);
              const wrap = document.createElement("div");
              const cap = document.createElement("div");
              cap.textContent = label;
              cap.style.cssText = "color:#0f0;font:10px monospace";
              wrap.appendChild(cap);
              wrap.appendChild(out);
              host.appendChild(wrap);
            };
            const input = getSharedInputAtlas() as unknown as {
              pages: Array<{ texture: unknown }>;
            };
            // Optional precise input rect (atlas px) → magnified view.
            const ir = (
              opts as unknown as {
                inputRect?: {
                  x: number;
                  y: number;
                  w: number;
                  h: number;
                  out: number;
                };
              }
            )?.inputRect;
            if (ir) {
              const r = (
                this.pixiRenderer as unknown as {
                  extract: {
                    canvas: (
                      t: unknown,
                    ) => CanvasImageSource & {
                      width: number;
                      height: number;
                    };
                  };
                }
              ).extract;
              input.pages.forEach((p, i) => {
                const full = r.canvas(
                  (p as { texture: unknown }).texture,
                );
                const outW = ir.out;
                const outH = Math.round((ir.out * ir.h) / ir.w);
                const out = document.createElement("canvas");
                out.width = outW;
                out.height = outH;
                const cx = out.getContext("2d");
                if (!cx) return;
                cx.fillStyle = "#101010";
                cx.fillRect(0, 0, outW, outH);
                cx.imageSmoothingEnabled = false;
                cx.drawImage(
                  full,
                  ir.x,
                  ir.y,
                  ir.w,
                  ir.h,
                  0,
                  0,
                  outW,
                  outH,
                );
                const wrap = document.createElement("div");
                const cap = document.createElement("div");
                cap.textContent = `input p${i} rect(${ir.x},${ir.y} ${ir.w}x${ir.h})`;
                cap.style.cssText = "color:#0f0;font:10px monospace";
                wrap.appendChild(cap);
                wrap.appendChild(out);
                host.appendChild(wrap);
              });
            } else {
              input.pages.forEach((p, i) =>
                addCrop(
                  `input p${i} (${inputCrop}->${inputOut})`,
                  p.texture,
                  inputCrop,
                  inputOut,
                ),
              );
            }
            const comp = this.atlas as unknown as {
              pages: Array<{ renderTexture: unknown }>;
            };
            comp.pages.forEach((p, i) =>
              addCrop(
                `comp p${i} — all looks (${compCrop}->${compOut})`,
                p.renderTexture,
                compCrop,
                compOut,
              ),
            );
            // eslint-disable-next-line no-console
            console.warn(
              `[dumpAtlases] inputPages=${input.pages.length} compPages=${comp.pages.length}`,
            );
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error("[dumpAtlases] failed", e);
          }
        };

      // ── TEMP DIAG: window.__composeBenchmark(iters) ──────────────
      // Measures the cost of compositing every live bot's full look
      // into the composition atlas in ONE render pass per page. Drives
      // SharedCompositionAtlas.renderAll in a tight loop (each call
      // re-renders every non-empty page — N instanced band draws +
      // accessory sprites), reporting:
      //   - CPU submit per compose (JS flush + render() dispatch)
      //   - wall per compose incl GPU (tight submit loop → GPU-bound)
      //   - draw count (totalBatches = instanced band draws)
      // Spawn N static bots first (e.g. __spawnBurst(100,false,1)).
      (
        window as unknown as {
          __composeBenchmark?: (
            iters?: number,
            res?: number,
          ) => Promise<unknown>;
        }
      ).__composeBenchmark = async (iters = 120, res) => {
        try {
          // Optional: re-bake every live bot at a new strip resolution
          // (the RENDER_RESOLUTION dial) before measuring. The re-stage
          // is async through the worker pool; give it time to settle.
          if (res != null && res !== this.resolution) {
            this.setResolutionAndRerender(res);
            await new Promise((r) => setTimeout(r, 12000));
          }
          const atlas = this.atlas;
          const renderer = this.pixiRenderer;
          const gpu = getVelloGpu();
          // Warm + drain so the first measured iter isn't cold.
          atlas.renderAll(renderer);
          if (gpu) await gpu.device.queue.onSubmittedWorkDone();

          let cpuSum = 0;
          let flushSum = 0;
          let renderSum = 0;
          let pages = 0;
          let batches = 0;
          const wall0 = performance.now();
          for (let i = 0; i < iters; i++) {
            const t0 = performance.now();
            const tm = atlas.renderAll(renderer);
            cpuSum += performance.now() - t0;
            flushSum += tm.flushMs;
            renderSum += tm.renderMs;
            pages = tm.renderedPages;
            batches = tm.totalBatches;
          }
          // Drain the GPU: wall from loop start → all submitted work
          // done. Under a tight submit loop this is GPU-bound, so
          // wall/compose ≈ GPU time per compose.
          if (gpu) await gpu.device.queue.onSubmittedWorkDone();
          const totalWall = performance.now() - wall0;
          const stats = atlas.getStats();
          const inStats = getSharedInputAtlas().stats();
          const inputLiveSlots = inStats.liveSlots.reduce((a, b) => a + b, 0);
          const result = {
            bots: stats.slotsUsed,
            resolution: this.resolution,
            inputAtlasPages: inStats.pages,
            inputLiveSlots,
            pages,
            drawsPerCompose: batches,
            iters,
            cpuSubmitPerComposeMs: +(cpuSum / iters).toFixed(3),
            flushPerComposeMs: +(flushSum / iters).toFixed(3),
            renderDispatchPerComposeMs: +(renderSum / iters).toFixed(3),
            wallPerComposeMs: +(totalWall / iters).toFixed(3),
            totalWallMs: +totalWall.toFixed(1),
          };
          // eslint-disable-next-line no-console
          console.warn(
            `[composeBench] res=${result.resolution} bots=${result.bots} ` +
              `inputPages=${result.inputAtlasPages} inputSlots=${result.inputLiveSlots} ` +
              `compPages=${result.pages} draws/compose=${result.drawsPerCompose} iters=${iters}\n` +
              `  CPU submit/compose = ${result.cpuSubmitPerComposeMs}ms ` +
              `(flush ${result.flushPerComposeMs} + dispatch ${result.renderDispatchPerComposeMs})\n` +
              `  wall/compose (GPU-bound) = ${result.wallPerComposeMs}ms ` +
              `over ${result.totalWallMs}ms total`,
          );
          return result;
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("[composeBench] failed", e);
          return { error: String(e) };
        }
      };

      // ── TEMP DIAG: window.__renderAudit() ────────────────────────
      // Real data for three questions:
      //  1) band counts of live variants  → why the input atlas shows
      //     near-full bodies (a band is a contiguous Z-slice, not a limb)
      //  2) composition-page utilization  → how much of the 4096² is
      //     real character pixels vs empty slots + per-slot margin
      //  3) real GPU breakdown            → isolates clear-cost vs
      //     draw-cost by timing full / clear-only / draw-only passes
      //     against queue.onSubmittedWorkDone (wall is GPU-bound).
      (
        window as unknown as { __renderAudit?: () => Promise<unknown> }
      ).__renderAudit = async () => {
        const out: Record<string, unknown> = {};
        const gpu = getVelloGpu();
        const dev = gpu?.device;
        // 1) device capabilities
        try {
          out.device = {
            features: dev ? [...dev.features] : [],
            hasTimestampQuery: dev
              ? [...dev.features].includes("timestamp-query")
              : false,
            maxTextureDimension2D: dev?.limits?.maxTextureDimension2D,
          };
        } catch (e) {
          out.device = { error: String(e) };
        }
        // 2) variant band-count distribution + dims
        try {
          const bandDist: Record<number, number> = {};
          const dims: Array<Record<string, number>> = [];
          for (const slots of this.states.values()) {
            for (const st of slots.values()) {
              const v = st.variant;
              if (!v) continue;
              bandDist[v.bandCount] = (bandDist[v.bandCount] ?? 0) + 1;
              if (dims.length < 6) {
                dims.push({
                  bandCount: v.bandCount,
                  stripW: v.stripWidth,
                  stripH: v.stripHeight,
                  frameW: v.frameWidth,
                  frameH: v.frameHeight,
                  gridCols: v.gridCols,
                  frameCount: v.frameCount,
                });
              }
            }
          }
          out.variants = { bandCountDistribution: bandDist, sampleDims: dims };
        } catch (e) {
          out.variants = { error: String(e) };
        }
        // 3) composition-page utilization
        try {
          const SLOT = this.atlas.slotSize;
          let slotsUsed = 0;
          let charPixelArea = 0;
          for (const slots of this.states.values()) {
            for (const st of slots.values()) {
              if (!st.compositionSlot || !st.variant) continue;
              slotsUsed += 1;
              const b = this.computeBotBounds(st, st.variant);
              const w = (b.maxX - b.minX) * st.botScale;
              const h = (b.maxY - b.minY) * st.botScale;
              charPixelArea += Math.max(0, w) * Math.max(0, h);
            }
          }
          const cs = this.atlas.getStats();
          const pageArea = 4096 * 4096 * cs.pageCount;
          const usedSlotArea = slotsUsed * SLOT * SLOT;
          out.compPage = {
            slotsUsed,
            slotSize: SLOT,
            pages: cs.pageCount,
            slotsCapacity: cs.slotsCapacity,
            pageUtilizationPct: +((usedSlotArea / pageArea) * 100).toFixed(1),
            slotFillPct: +((charPixelArea / usedSlotArea) * 100).toFixed(1),
            effectiveCharPctOfPage: +(
              (charPixelArea / pageArea) *
              100
            ).toFixed(1),
          };
        } catch (e) {
          out.compPage = { error: String(e) };
        }
        // 4) REAL GPU breakdown: full vs clear-only vs draw-only.
        // Each timed against onSubmittedWorkDone (GPU-bound wall).
        try {
          const r = this.pixiRenderer;
          const page0 = (
            this.atlas as unknown as {
              pages: Array<{ globalRoot: unknown; renderTexture: unknown }>;
            }
          ).pages[0];
          const empty = new Container();
          const iters = 150;
          const timeGpu = async (fn: () => void): Promise<number> => {
            fn();
            if (dev) await dev.queue.onSubmittedWorkDone();
            const t0 = performance.now();
            for (let i = 0; i < iters; i++) fn();
            if (dev) await dev.queue.onSubmittedWorkDone();
            return +((performance.now() - t0) / iters).toFixed(3);
          };
          const full = await timeGpu(() =>
            r.render({
              container: page0.globalRoot as Container,
              target: page0.renderTexture as RenderTexture,
              clear: true,
            }),
          );
          const clearOnly = await timeGpu(() =>
            r.render({
              container: empty,
              target: page0.renderTexture as RenderTexture,
              clear: true,
            }),
          );
          const drawOnly = await timeGpu(() =>
            r.render({
              container: page0.globalRoot as Container,
              target: page0.renderTexture as RenderTexture,
              clear: false,
            }),
          );
          empty.destroy();
          out.gpuBreakdownMs = {
            fullCompose: full,
            clearOnly,
            drawOnly,
            note: "per-pass wall via onSubmittedWorkDone (GPU-bound)",
          };
        } catch (e) {
          out.gpuBreakdownMs = { error: String(e) };
        }
        // eslint-disable-next-line no-console
        console.warn("[renderAudit]", JSON.stringify(out, null, 2));
        return out;
      };

      // ── TEMP DIAG: window.__gpuTimeCompose(iters) ────────────────
      // REAL per-pass GPU nanoseconds for the compose, via WebGPU
      // timestamp-query (needs the rebuilt device with the feature).
      // Patches beginRenderPass/finish to inject timestampWrites ONLY
      // around a controlled renderAll, resolves the query set, reads
      // back the GPU timestamps. Falls back gracefully if unsupported.
      (
        window as unknown as {
          __gpuTimeCompose?: (iters?: number) => Promise<unknown>;
        }
      ).__gpuTimeCompose = async (iters = 60) => {
        const gpu = getVelloGpu();
        const dev = gpu?.device as GPUDevice | undefined;
        if (!dev || ![...dev.features].includes("timestamp-query")) {
          return { error: "timestamp-query not available on device" };
        }
        const atlas = this.atlas;
        const renderer = this.pixiRenderer;
        const MAX_PASSES = 16;
        const querySet = dev.createQuerySet({
          type: "timestamp",
          count: MAX_PASSES * 2,
        });
        const resolveBuf = dev.createBuffer({
          size: MAX_PASSES * 2 * 8,
          usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        });
        const readBuf = dev.createBuffer({
          size: MAX_PASSES * 2 * 8,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const EncProto = (
          globalThis as unknown as {
            GPUCommandEncoder: { prototype: GPUCommandEncoder };
          }
        ).GPUCommandEncoder.prototype as unknown as {
          beginRenderPass: (d: GPURenderPassDescriptor) => GPURenderPassEncoder;
          finish: (d?: GPUCommandBufferDescriptor) => GPUCommandBuffer;
        };
        const origBegin = EncProto.beginRenderPass;
        const origFinish = EncProto.finish;
        let capturing = false;
        let passIdx = 0;
        const toResolve = new WeakSet<object>();
        try {
          EncProto.beginRenderPass = function (
            this: GPUCommandEncoder,
            desc: GPURenderPassDescriptor,
          ) {
            if (capturing && desc && passIdx < MAX_PASSES) {
              const patched = {
                ...desc,
                timestampWrites: {
                  querySet,
                  beginningOfPassWriteIndex: passIdx * 2,
                  endOfPassWriteIndex: passIdx * 2 + 1,
                },
              } as GPURenderPassDescriptor;
              passIdx++;
              toResolve.add(this);
              return origBegin.call(this, patched);
            }
            return origBegin.call(this, desc);
          };
          EncProto.finish = function (
            this: GPUCommandEncoder,
            d?: GPUCommandBufferDescriptor,
          ) {
            if (toResolve.has(this) && passIdx > 0) {
              try {
                this.resolveQuerySet(querySet, 0, passIdx * 2, resolveBuf, 0);
              } catch {}
              toResolve.delete(this);
            }
            return origFinish.call(this, d);
          };

          atlas.renderAll(renderer); // warm
          await dev.queue.onSubmittedWorkDone();

          const durs: number[] = [];
          let lastPasses = 0;
          for (let i = 0; i < iters; i++) {
            passIdx = 0;
            capturing = true;
            atlas.renderAll(renderer);
            capturing = false;
            lastPasses = passIdx;
            await dev.queue.onSubmittedWorkDone();
            const enc = dev.createCommandEncoder();
            enc.copyBufferToBuffer(resolveBuf, 0, readBuf, 0, passIdx * 2 * 8);
            dev.queue.submit([enc.finish()]);
            await readBuf.mapAsync(GPUMapMode.READ);
            const ts = new BigInt64Array(
              readBuf.getMappedRange(0, passIdx * 2 * 8).slice(0),
            );
            readBuf.unmap();
            let total = 0n;
            for (let p = 0; p < passIdx; p++) {
              total += ts[p * 2 + 1] - ts[p * 2];
            }
            durs.push(Number(total) / 1e6); // ns → ms
          }
          durs.sort((a, b) => a - b);
          const result = {
            iters,
            passesPerCompose: lastPasses,
            gpuMsMedian: +durs[Math.floor(durs.length / 2)].toFixed(4),
            gpuMsMin: +durs[0].toFixed(4),
            gpuMsMax: +durs[durs.length - 1].toFixed(4),
            gpuMsAvg: +(durs.reduce((a, b) => a + b, 0) / durs.length).toFixed(4),
          };
          // eslint-disable-next-line no-console
          console.warn("[gpuTimeCompose]", JSON.stringify(result));
          return result;
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("[gpuTimeCompose] failed", e);
          return { error: String(e) };
        } finally {
          EncProto.beginRenderPass = origBegin;
          EncProto.finish = origFinish;
          try {
            querySet.destroy();
            resolveBuf.destroy();
            readBuf.destroy();
          } catch {}
        }
      };

      // ── TEMP DIAG: window.__hideBotAcc() / __showBotAcc() ────────
      // Isolate body vs accessories: hide all accessory sprites and
      // force a recompose, so the comp slot shows ONLY the body bands.
      // If the body then renders clean → garbage was the accessories.
      (window as unknown as { __hideBotAcc?: () => void }).__hideBotAcc =
        () => {
          for (const slots of this.states.values()) {
            for (const st of slots.values()) {
              for (const acc of st.accessories.values()) {
                acc.sprite.renderable = false;
              }
            }
          }
          this.compositionDirty = true;
          this.composeAll();
        };
      (window as unknown as { __showBotAcc?: () => void }).__showBotAcc =
        () => {
          for (const slots of this.states.values()) {
            for (const st of slots.values()) {
              this.setAccessoriesFrame(st, st.lastCompositionFrame);
            }
          }
          this.compositionDirty = true;
          this.composeAll();
        };

      // ── TEMP DIAG: window.__findOverflows() ──────────────────────
      // Scans every bot for (a) comp-slot COLLISIONS (two bots sharing a
      // page+slot index) and (b) band OVERFLOW — a band's draw quad
      // (aTransform x,y,w,h in page px) exceeding its 256² slot bounds,
      // which spills into the neighbour slot → "multiple players in one
      // sprite". Reports counts + samples.
      (
        window as unknown as { __findOverflows?: () => unknown }
      ).__findOverflows = () => {
        try {
          const slotOwners = new Map<string, number[]>();
          const overflows: Array<Record<string, unknown>> = [];
          let bots = 0;
          for (const [pid, slots] of this.states) {
            for (const st of slots.values()) {
              const slot = st.compositionSlot;
              if (!slot || !st.variant) continue;
              bots += 1;
              const key = `${slot.pageIndex}:${slot.index}`;
              (slotOwners.get(key) ?? slotOwners.set(key, []).get(key)!).push(
                pid,
              );
              const sx0 = slot.x;
              const sy0 = slot.y;
              const sx1 = slot.x + slot.w;
              const sy1 = slot.y + slot.h;
              for (const [bi, inst] of st.bandInstances) {
                const batch = inst.batch as unknown as {
                  instanceData: Float32Array;
                };
                const d = batch.instanceData;
                const o = inst.instanceIdx * 20;
                const x = d[o + 16];
                const y = d[o + 17];
                const w = d[o + 18];
                const h = d[o + 19];
                const overL = sx0 - x;
                const overT = sy0 - y;
                const overR = x + w - sx1;
                const overB = y + h - sy1;
                const maxOver = Math.max(overL, overT, overR, overB);
                if (maxOver > 0.5 && overflows.length < 12) {
                  overflows.push({
                    pid,
                    band: bi,
                    slot: [slot.x, slot.y, slot.w, slot.h],
                    quad: [
                      +x.toFixed(1),
                      +y.toFixed(1),
                      +w.toFixed(1),
                      +h.toFixed(1),
                    ],
                    overflowPx: {
                      L: +overL.toFixed(1),
                      T: +overT.toFixed(1),
                      R: +overR.toFixed(1),
                      B: +overB.toFixed(1),
                    },
                    botScale: +st.botScale.toFixed(3),
                    variant: st.variant.exportName,
                    frameWH: [st.variant.frameWidth, st.variant.frameHeight],
                  });
                }
              }
            }
          }
          const collisions = [...slotOwners.entries()].filter(
            ([, owners]) => owners.length > 1,
          );
          const result = {
            bots,
            slotCollisions: collisions.length,
            collisionSamples: collisions.slice(0, 8),
            overflowBandCount: overflows.length,
            overflowSamples: overflows,
          };
          // eslint-disable-next-line no-console
          console.warn("[findOverflows]", JSON.stringify(result, null, 2));
          return result;
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("[findOverflows] failed", e);
          return { error: String(e) };
        }
      };

      // ── TEMP DIAG: window.__realCrowdSnapshot() ──────────────────
      // Snapshots EVERY live player's REAL render state (body bundle/
      // export, current frame, direction, flip, zone colors, equipped
      // accessory refs, and real map-space screen position) so the
      // Vello-direct real-crowd benchmark can render the actual crowd
      // with real mounts + real positions (no fakery).
      (
        window as unknown as {
          __realCrowdSnapshot?: () => Array<Record<string, unknown>>;
        }
      ).__realCrowdSnapshot = () => {
        const out: Array<Record<string, unknown>> = [];
        for (const [, slots] of this.states) {
          const st = slots.get("main");
          if (!st) continue;
          const a = st.lastAnimation;
          const p = st.player;
          if (!a || !p) continue;
          const c = p.container as unknown as { x: number; y: number } | null;
          out.push({
            bundle: a.bundle,
            export: a.exportName,
            frame: Math.max(0, st.lastCompositionFrame | 0),
            frameCount: a.frameCount,
            fps: a.fps,
            dir: st.lastDir ?? "R",
            flipped: !!st.lastFlipped,
            c1: st.zone1 | 0,
            c2: st.zone2 | 0,
            c3: st.zone3 | 0,
            x: c?.x ?? 0,
            y: c?.y ?? 0,
            acc: a.accessories.map((ac) => ({
              bundle: ac.bundle,
              export: ac.exportName,
              slot: ac.slot,
              animType: ac.animType,
            })),
          });
        }
        return out;
      };

      // ── TEMP DIAG: window.__dumpBot(playerId?) ───────────────────
      // Dumps one bot's full compose state + the REAL per-band GPU
      // instance values (aAtlasUV it samples, aTransform it draws to)
      // read straight from the band-batch instance buffer. Lets us see
      // exactly where the band math goes wrong for a garbage look
      // (seed-5). With no playerId, picks the first bot whose
      // exportName/look differs from the real player (a test bot).
      (
        window as unknown as {
          __dumpBot?: (playerId?: number) => unknown;
        }
      ).__dumpBot = (playerId) => {
        try {
          let pid = -1;
          let st: SlotStateV2 | undefined;
          for (const [id, slots] of this.states) {
            if (playerId != null && id !== playerId) continue;
            const s = slots.get("main");
            if (s && s.variant && s.compositionSlot) {
              pid = id;
              st = s;
              if (playerId != null || this.states.size === 1) break;
              // else: take the last (test bots are added after the player)
            }
          }
          if (!st || !st.variant || !st.atlas) {
            return { error: "no committed bot found", playerId };
          }
          const v = st.variant;
          const page = st.atlas.pages[v.pageIndex];
          const bands: unknown[] = [];
          for (const [bi, inst] of st.bandInstances) {
            const batch = inst.batch as unknown as {
              instanceData: Float32Array;
            };
            const d = batch.instanceData;
            const o = inst.instanceIdx * 20;
            bands.push({
              bandIndex: bi,
              instanceIdx: inst.instanceIdx,
              srcAtlasX: inst.atlasX,
              srcAtlasY: inst.atlasY,
              aAtlasUV: [d[o], d[o + 1], d[o + 2], d[o + 3]],
              aTransform_xywh: [d[o + 16], d[o + 17], d[o + 18], d[o + 19]],
            });
          }
          const accessories: unknown[] = [];
          for (const [slotId, acc] of st.accessories) {
            const sp = acc.sprite;
            accessories.push({
              slotId,
              hasStrip: !!acc.strip,
              stripDims: acc.strip
                ? {
                    frameWidth: acc.strip.frameWidth,
                    frameHeight: acc.strip.frameHeight,
                    anchorX: acc.strip.anchorX,
                    anchorY: acc.strip.anchorY,
                    frameCount: acc.strip.frameCount,
                  }
                : null,
              spriteRenderable: sp.renderable,
              spriteVisible: sp.visible,
              spritePos: [sp.x, sp.y],
              spriteScale: [sp.scale.x, sp.scale.y],
              spriteRotation: sp.rotation,
              spriteAnchor: [sp.anchor.x, sp.anchor.y],
              spriteZ: sp.zIndex,
              texValid: !!sp.texture && !sp.texture.destroyed,
              texFrame: sp.texture
                ? [
                    sp.texture.frame.x,
                    sp.texture.frame.y,
                    sp.texture.frame.width,
                    sp.texture.frame.height,
                  ]
                : null,
            });
          }
          const out = {
            playerId: pid,
            botScale: st.botScale,
            swfOriginInSlot: [st.swfOriginInSlotX, st.swfOriginInSlotY],
            lastCompositionFrame: st.lastCompositionFrame,
            compositionSlot: st.compositionSlot,
            accessories,
            atlasDims: page
              ? [page.atlasWidth, page.atlasHeight]
              : null,
            variant: {
              exportName: v.exportName,
              applyBFix: v.applyBFix,
              hatEquipped: v.hatEquipped,
              pageIndex: v.pageIndex,
              bandCount: v.bandCount,
              slotCount: v.slotCount,
              frameWidth: v.frameWidth,
              frameHeight: v.frameHeight,
              stripWidth: v.stripWidth,
              stripHeight: v.stripHeight,
              gridCols: v.gridCols,
              frameCount: v.frameCount,
              anchorX: v.anchorX,
              anchorY: v.anchorY,
              bandPadding: v.bandPadding,
              bands: v.bands.map((b) => ({
                bandIndex: b.bandIndex,
                atlasX: b.atlasX,
                atlasY: b.atlasY,
              })),
            },
            bandInstances: bands,
          };
          // eslint-disable-next-line no-console
          console.warn("[dumpBot]", JSON.stringify(out, null, 2));
          return out;
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("[dumpBot] failed", e);
          return { error: String(e) };
        }
      };
    }
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
    // Reclaim super-atlas slots whose bots have moved on (runs every
    // frame, before the dirty early-out, so slots free even when the
    // composition isn't re-rendering). Ground-truth, drift-free.
    this.reclaimInputAtlasSlots();
    // Crowd cutover: while the Vello-direct crowd draws every body, the
    // per-bot atlas compose is pure waste — skip the expensive renderAll
    // (animation STATE still advances on the tick, so the crowd snapshot
    // stays fresh). NOTE: also suppresses mount-slot compose; mounts are
    // handled separately in the crowd integration.
    if (this.composeSuppressed) return;
    if (!this.compositionDirty) return;
    if (this.atlas.getStats().slotsUsed === 0) {
      this.compositionDirty = false;
      return;
    }
    // Phase 5 + multi-page atlas: each page flushes its own batches
    // and renders into its own RT. Skip empty pages internally.
    const t0 = performance.now();
    const timings = this.atlas.renderAll(this.pixiRenderer);
    const dur = performance.now() - t0;
    recordProbe("composeBot", dur);
    recordProbe("composeFlush", timings.flushMs);
    recordProbe("composeRender", timings.renderMs);
    // Zoom profile: count + time each compose pass that fires
    // during the zoom re-stage window. A long re-stage typically
    // produces N passes (one per main frame) as bots commit
    // staggered across worker landings; the sum tells us how much
    // GPU compose work the zoom event provoked total.
    this.zoomProfile?.recordCompose(dur);
    this.compositionDirty = false;
    // Stash latest counts for the stress monitor's log line.
    this.lastComposeBatches = timings.totalBatches;
    this.lastComposeDirtyBatches = timings.dirtyBatches;
    this.lastComposePages = timings.renderedPages;
  }

  /** Latest renderAll snapshot — read by stress monitor for context. */
  private lastComposeBatches = 0;
  private lastComposeDirtyBatches = 0;
  private lastComposePages = 0;
  /** Accessors for the stress monitor. */
  getComposeCounts(): { batches: number; dirty: number; pages: number } {
    return {
      batches: this.lastComposeBatches,
      dirty: this.lastComposeDirtyBatches,
      pages: this.lastComposePages,
    };
  }

  /**
   * Anim-watchdog diagnostics — scans every live slot for either
   *  (a) `variant === null` while `currentAnimKey` is set (variant
   *      never landed: bake stale / dedup drop / refcount race), OR
   *  (b) `player.frameIndex` not moving while the variant has
   *      `frameCount > 1` and the anim is a cycling one
   *      ("walk*"/"run*"/...): tick-side freeze (animation.ts:276
   *      bails on `textureCount <= 1`; check whether fc was 1 here).
   *
   *  Returns aggregate counts + up to `sampleCap` of each failure
   *  mode so the stress monitor can show specific examples.
   *
   *  Cheap: O(slots) iteration; called once per ~5 s snapshot.
   *  Read-only — does NOT clear the counters; persistent ticks
   *  accumulate so a freeze that started 30 s ago still shows up. */
  getAnimDiagnostics(threshold = 30, sampleCap = 5): {
    totalSlots: number;
    frameStuckCount: number;
    variantMissingCount: number;
    frameStuckSamples: Array<{
      playerId: number;
      slotKey: string;
      animKey: string;
      stuckTicks: number;
      fc: number;
      animReady: boolean;
      moving: boolean;
      frameTimer: number;
      frameIndex: number;
    }>;
    variantMissingSamples: Array<{
      playerId: number;
      slotKey: string;
      animKey: string;
      missingTicks: number;
    }>;
  } {
    let total = 0;
    let stuckCount = 0;
    let missingCount = 0;
    const frameStuckSamples: Array<{
      playerId: number;
      slotKey: string;
      animKey: string;
      stuckTicks: number;
      fc: number;
      animReady: boolean;
      moving: boolean;
      frameTimer: number;
      frameIndex: number;
    }> = [];
    const variantMissingSamples: Array<{
      playerId: number;
      slotKey: string;
      animKey: string;
      missingTicks: number;
    }> = [];
    for (const [playerId, slots] of this.states) {
      for (const [slotKey, st] of slots) {
        total += 1;
        if (st.diagStuckTicks >= threshold) {
          stuckCount += 1;
          if (frameStuckSamples.length < sampleCap) {
            const p = st.player;
            frameStuckSamples.push({
              playerId,
              slotKey,
              animKey: st.currentAnimKey,
              stuckTicks: st.diagStuckTicks,
              fc: st.variant?.frameCount ?? 0,
              animReady: p?.animReady ?? false,
              moving: p?.moving ?? false,
              frameTimer: p?.frameTimer ?? 0,
              frameIndex: p?.frameIndex ?? -1,
            });
          }
        }
        if (st.diagVariantMissingTicks >= threshold) {
          missingCount += 1;
          if (variantMissingSamples.length < sampleCap) {
            variantMissingSamples.push({
              playerId,
              slotKey,
              animKey: st.currentAnimKey,
              missingTicks: st.diagVariantMissingTicks,
            });
          }
        }
      }
    }
    return {
      totalSlots: total,
      frameStuckCount: stuckCount,
      variantMissingCount: missingCount,
      frameStuckSamples,
      variantMissingSamples,
    };
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

  /** Picking layer adapter — returns the slot's hit-test Sprite.
   *
   *  V2 returns the `compositeSprite` (the visible composite that
   *  samples the bot's composition-atlas slot). It has the correct
   *  world-space AABB (anchor=SWF origin, scale=1/botScale, root
   *  scale=1/resolution) AND the bot's fully composited silhouette
   *  including accessories — so picking matches what's rendered.
   *
   *  The previous `hitSprite` shim pointed at the entire class atlas
   *  PAGE (e.g. 7680×4480) with no `texture.frame` restriction, so
   *  the picking system's AABB extent was page-sized rather than
   *  bot-sized — hovering anywhere in a ~7000-px halo around any bot
   *  returned a false hit, and clicks on empty ground often selected
   *  distant bots. The class atlas was the wrong surface to begin
   *  with: a variant is laid out as multiple vertically-stacked
   *  band strips, so there's no single rect that maps to the bot's
   *  silhouette — only the composition atlas slot has the bot
   *  fully assembled. */
  getSlotSprite(
    playerId: number,
    slot: PlayerStripSlot = "main",
  ): Sprite | null {
    const st = this.states.get(playerId)?.get(slot);
    if (!st) return null;
    // Only pickable once the body has committed: until then the
    // composite slot hasn't been rendered to and the bot is invisible.
    // `compositeSprite.visible === true` is the canonical signal —
    // it's set in commitBody after the slot is populated, and the
    // picking system already skips `!sprite.visible` candidates, so
    // returning the sprite when invisible is safe but pointless.
    if (!st.atlas || !st.compositeSprite.visible) return null;
    return st.compositeSprite;
  }

  /**
   * LIVE crowd cutover: snapshot EVERY committed player's real render
   * state for the Vello-direct crowd renderer (`crowd-renderer.ts`).
   * One row per player keyed by `id`, carrying the body look (bundle/
   * export/frame/frameCount/fps), direction + flip, the three zone
   * colors, equipped accessory refs, and the live map-space screen
   * position read off the player container. Mirrors the throwaway
   * `window.__realCrowdSnapshot` diagnostic but as a real method with
   * the player id (needed to drive per-player position updates in a
   * stable order) and a `committed` flag (uncommitted bots have no
   * body to render yet and must be skipped by the crowd setup).
   */
  crowdSnapshot(): CrowdPlayerSnapshot[] {
    const out: CrowdPlayerSnapshot[] = [];
    for (const [id, slots] of this.states) {
      const st = slots.get("main");
      if (!st) continue;
      const a = st.lastAnimation;
      const p = st.player;
      if (!a || !p) continue;
      const committed = !!st.atlas && st.compositeSprite.visible;
      const mounted = slots.has("mount-rider") || slots.has("mount-back");
      const c = p.container as unknown as { x: number; y: number } | null;
      out.push({
        id,
        committed,
        mounted,
        bundle: a.bundle,
        export: a.exportName,
        frame: Math.max(0, st.lastCompositionFrame | 0),
        frameCount: a.frameCount,
        fps: a.fps,
        dir: st.lastDir ?? "R",
        flipped: !!st.lastFlipped,
        c1: st.zone1 | 0,
        c2: st.zone2 | 0,
        c3: st.zone3 | 0,
        x: c?.x ?? 0,
        y: c?.y ?? 0,
        acc: a.accessories.map((ac) => ({
          bundle: ac.bundle,
          export: ac.exportName,
          slot: ac.slot,
          animType: ac.animType,
        })),
      });
    }
    return out;
  }

  /**
   * Pixel-perfect alphaTest for the given slot, sampling the
   * pre-extracted variant silhouette baked at class-atlas wrap
   * time. See `VariantInfo.silhouette` for why we own the
   * extraction (Pixi v8's `source.resource` can't be read back
   * via `copyTextureToBuffer`, so `PickingSystem`'s alpha cache
   * can't populate for our sources).
   *
   * The closure ignores its `alphas` accessor argument — kept in
   * the signature only to satisfy `PickableObject.alphaTest`'s
   * shape. All sampling goes against `variant.silhouette` which
   * already encodes the multi-band union at cell (0, 0).
   */
  getSlotAlphaTest(
    playerId: number,
    slot: PlayerStripSlot = "main",
  ): ((adjX: number, adjY: number, alphas: import("@/game/types").AlphaMapAccessor) => boolean) | null {
    const st = this.states.get(playerId)?.get(slot);
    if (!st) return null;
    return (adjX, adjY, _alphas) => {
      const variant = st.variant;
      if (!st.atlas || !variant || !st.compositionSlot || st.botScale <= 0) {
        return true; // AABB fallback — bot not yet committed
      }
      const silhouette = variant.silhouette;
      if (!silhouette) return true; // extraction unavailable → AABB fallback

      // Inverse slot-fit transform: bot rendered into the slot at
      // `botScale` with SWF origin at `(swfOriginInSlotX, ...)`.
      const fx = (adjX - st.swfOriginInSlotX) / st.botScale + variant.anchorX;
      const fy = (adjY - st.swfOriginInSlotY) / st.botScale + variant.anchorY;
      const fxi = Math.floor(fx);
      const fyi = Math.floor(fy);
      if (
        fxi < 0 || fxi >= variant.frameWidth ||
        fyi < 0 || fyi >= variant.frameHeight
      ) {
        return false;
      }
      return silhouette[fyi * variant.frameWidth + fxi] !== 0;
    };
  }

  getSlotContainer(
    playerId: number,
    slot: PlayerStripSlot = "main",
  ): Container | null {
    return this.states.get(playerId)?.get(slot)?.root ?? null;
  }

  /** Current strip bake resolution (RENDER_RESOLUTION dial). The crowd
   *  renderer matches this so its character scale lines up. */
  getResolution(): number {
    return this.resolution;
  }

  /** Crowd cutover: when true, `composeAll` skips the per-bot atlas
   *  render (the crowd draws bodies instead). Resuming forces a recompose. */
  private composeSuppressed = false;
  setComposeSuppressed(on: boolean): void {
    if (this.composeSuppressed === on) return;
    this.composeSuppressed = on;
    if (!on) this.compositionDirty = true;
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
   * No-op since per-variant baking became the primary path.
   *
   * History: prewarmAtlas existed to bake the full 24-variant class
   * atlas (walk/static/run × R/L/F/B/S × bFix × hat) once per class
   * so the bot's first acquireVariantAtlas was a cache hit. With
   * `acquireVariantAtlas` now demand-driven (one variant per bot,
   * ~5–15 ms warm-cache, sub-frame at 60 fps), pre-baking 24
   * variants up-front is exactly the over-bake we removed — costs
   * ~150 MB GPU per class for variants no bot will use.
   *
   * Bots bake their actual variant on first applyAnimation. Sub-
   * frame cost; not worth pre-warming.
   */
  prewarmAtlas(
    _animation: CharacterAnimation,
    _animName: string,
    _flipped: boolean,
  ): void {
    // intentionally empty
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
      if (!variant) {
        // Diagnostic: count ticks we keep waiting for a variant
        // while the bot has an active anim request. High counts here
        // indicate a bake stale-skip or dedup-drop race.
        if (
          st.currentAnimKey !== "" &&
          st.currentAnimKey !== "<retired>" &&
          st.diagVariantMissingTicks < 1_000_000
        ) {
          st.diagVariantMissingTicks++;
        }
        continue;
      }
      st.diagVariantMissingTicks = 0;
      const fc = variant.frameCount;
      if (fc === 0) continue;
      const frame = idx % fc;
      // Diagnostic: count ticks since `player.frameIndex` last moved.
      // Only meaningful for variants that SHOULD cycle (fc > 1) and
      // for cycling anim keys (not "static*"). For static frames we
      // expect no movement and don't flag.
      const animPrefix = st.currentAnimKey.split("|", 1)[0];
      const expectCycle = fc > 1 && !animPrefix.startsWith("static");
      if (expectCycle) {
        if (idx === st.diagLastIdx) {
          if (st.diagStuckTicks < 1_000_000) st.diagStuckTicks++;
          // One-shot warn the moment a freeze episode becomes
          // user-perceivable (~170 ms at 60 Hz). Captures full state
          // at the freeze, including the TWO frame-count fields that
          // can disagree:
          //   - `variant.frameCount` (from Rust bake) — what
          //     `swapFrame`'s `idx % fc` uses below.
          //   - `currentAnimData.frameCount` — what
          //     `tickFrame` uses as `textureCount`. A 1-here triggers
          //     the `animation.ts:276` early-exit and freezes the
          //     bot without animReady/movement involvement.
          // (one-shot stuck-frame warn kept as regression sentinel: still
          // triggers if currentAnimData.frameCount goes back to 1 while a
          // cycling variant is committed — i.e. the deferred-commit fix
          // regresses)
          if (st.diagStuckTicks === 10 && !st.diagStuckLogged) {
            st.diagStuckLogged = true;
            const animDataFc =
              player.currentAnimData?.frameCount ?? -1;
            if (animDataFc === 1) {
              log.warn(
                `stuckFrame REGRESSION player=${player.id} anim=${st.currentAnimKey} ` +
                  `variantFc=${fc} currentAnimDataFc=${animDataFc} ` +
                  `animReady=${player.animReady} moving=${player.moving} ` +
                  `frameIdx=${idx} frameTimer=${player.frameTimer.toFixed(3)} ` +
                  `pendingAnim=${st.pendingAnim ? "yes" : "no"}`,
              );
            }
          }
        } else {
          st.diagStuckTicks = 0;
          st.diagStuckLogged = false;
        }
      } else {
        st.diagStuckTicks = 0;
        st.diagStuckLogged = false;
      }
      st.diagLastIdx = idx;
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
    const fromRes = this.resolution;
    this.resolution = clamped;
    // If a previous zoom profile is still in flight (user wheeled
    // again before all bots committed) flush what we have and start
    // fresh. Without this we'd compound timing across two zoom
    // events and the report would be unreadable.
    if (this.zoomProfile) {
      this.zoomProfile.flush(this.cacheCounterSnapshot());
      this.zoomProfile = null;
    }
    const profile = new ZoomBotProfile(
      fromRes,
      clamped,
      this.cacheCounterSnapshot(),
    );
    this.zoomProfile = profile;
    for (const slots of this.states.values()) {
      for (const [slotKey, st] of slots) {
        st.currentAnimKey = "";
        this.applyFlipToSlot(st, st.lastFlipped);
        if (st.lastAnimation && st.player) {
          const applyStart = performance.now();
          this.applyAnimation(
            st.player,
            slotKey,
            st.lastAnimation,
            st.lastAnimName,
            st.lastDir,
            st.lastFlipped,
          );
          profile.recordDispatch(performance.now() - applyStart);
        }
      }
    }
    // Edge case: re-stage triggered but no live bots had pending
    // animations to dispatch. Flush an empty report immediately so
    // the user sees the "0 bots" signal rather than a silently-
    // dropped event.
    if (profile.isEmpty()) {
      profile.flush(this.cacheCounterSnapshot());
      this.zoomProfile = null;
    }
  }

  /**
   * Snapshot the character cache's running hit/miss/evict counters.
   * The profile takes one snapshot at start and one at flush; the
   * delta tells us how many bakes the zoom event actually
   * provoked (vs. cache hits) and whether eviction churn fired
   * mid-event. Cheap (3 number reads).
   */
  private cacheCounterSnapshot(): {
    hits: number;
    misses: number;
    evicts: number;
  } {
    const s = this.cache.getStats();
    return { hits: s.hits, misses: s.misses, evicts: s.evicts };
  }

  /**
   * Bump the zoom profile's "resolved" counter for the current
   * pending and flush if every dispatched bot has reported in.
   * Called from the two terminal sites: the success path
   * (`commitBody` returned true) and the abandon path
   * (`commitBody` returned false / null atlas). Steady-state
   * (non-zoom) animation changes don't hit the bump because
   * `zoomProfile` is null outside the zoom window.
   */
  private maybeFinalizeZoomProfile(): void {
    const p = this.zoomProfile;
    if (!p) return;
    p.recordResolve();
    if (p.isDone()) {
      p.flush(this.cacheCounterSnapshot());
      this.zoomProfile = null;
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
      diagLastIdx: -1,
      diagStuckTicks: 0,
      diagVariantMissingTicks: 0,
      diagStuckLogged: false,
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
    // Probe: count every landed bake (including stale-discarded
    // ones), so the zoom profile sees the full worker-pool finish
    // pattern. Recording BEFORE the stale check keeps the
    // bake-spread metric honest — a worker still did the work even
    // if the result was discarded.
    this.zoomProfile?.recordAtlasLand();
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

    // Pop-in prevention: gate body commit on every accessory having
    // reported (real strip OR null on stale-skip / failed bake). The
    // previous policy committed body as soon as the class atlas
    // landed and let accessories pop in via `installLandedAccessories`
    // — fine in low-N gameplay (acc bakes take <1 ms each) but
    // produced a visible "naked bot dresses itself" flicker during
    // stress bursts and on first-ever character load.
    //
    // `accStrips.size` is monotonic (each slotId is set exactly once,
    // either to a strip or to null on failure) — the gate is
    // guaranteed to release once all queued bakes drain. Naked bots
    // (`accSlots.length === 0`) pass instantly. The previous body
    // remains visible during the wait because the bot's atlas /
    // accessory hooks haven't been swapped yet — same UX as legacy
    // pre-class-atlas behavior.
    if (!pending.bodyCommitted &&
        pending.accStrips.size < pending.accSlots.length) {
      return;
    }

    // Body half — runs exactly once per pending. After this the bot
    // is visible with every accessory already wired up.
    //
    // CRITICAL: resolve the readyPromise with `true` HERE. The
    // promise gates `player.animReady` (renderer.ts:140-155): bots
    // whose promise never resolves true freeze mid-anim because
    // `tickFrame` skips unready players. With the gate above, all
    // accessories are guaranteed installed at commit time — late
    // arrival is impossible — so `installLandedAccessories` will
    // never run for this pending.
    if (!pending.bodyCommitted) {
      const commitStart = performance.now();
      const committed = this.commitBody(st, pending);
      const commitMs = performance.now() - commitStart;
      this.zoomProfile?.recordCommit(commitMs, committed);
      if (committed) {
        pending.bodyCommitted = true;
        pending.resolve(true);
        // Profile bookkeeping: this pending has now reached a
        // terminal state (committed). Tell the profile so it can
        // flush once every dispatched bot has resolved.
        this.maybeFinalizeZoomProfile();
      } else {
        // commitBody refused to install a null atlas (stale-skipped
        // or failed bake). Discard the pending so the bot's next
        // applyAnimation gets a fresh slate; resolve(false) so the
        // caller knows this request didn't land. The bot keeps its
        // previous atlas visible — no "moves without animation"
        // state.
        pending.resolve(false);
        st.pendingAnim = null;
        // Profile bookkeeping: terminal state (abandoned). Same
        // contract as the committed branch — bump the resolved
        // counter so the report can land.
        this.maybeFinalizeZoomProfile();
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
    // Picking surface: the visible `compositeSprite` IS the hit
    // target — it samples the bot's composition-atlas slot which
    // already holds the fully-composited body + accessories. AABB
    // extent = slot dims = bot's world bounds (after compositeSprite
    // scale + root scale). Anchor = SWF origin. This is what
    // `getSlotSprite()` returns to the picking system below;
    // `hitSprite` itself is kept around for legacy compat (it's
    // already in the scene tree, removing it would touch the slot-
    // state struct) but is no longer the picking source.
    //
    // Why not the class atlas page? A variant is rendered as
    // multiple vertically-stacked band strips with padding (one
    // strip per Z-band). There's no single "bot silhouette" rect in
    // the class atlas — the bot is reassembled by composition.
    // Framing to one band would only cover that band's body part
    // (e.g. just the torso, miss the head). Framing the multi-band
    // region would inflate the hit-test ~Nx vertically because the
    // bands are stacked but they all draw at the SAME world Y.
    //
    // Composition atlas alpha map trade-off: the slot's pixels
    // change every frame (anim cycling), but `PickingSystem`
    // extracts the alpha once and caches forever — so picks beyond
    // the first frame use a slightly stale silhouette. In practice
    // bots' silhouettes are stable across walk/run cycles (legs
    // swing ~5 world units); the trade-off is acceptable. AABB
    // still binds the outer bounds correctly even when alpha is
    // off-by-a-frame, so the worst case is "click on an arm tip
    // mid-swing misses" — never "click on empty ground selects
    // bot".
    const fw = nextVariant.frameWidth || 1;
    const fh = nextVariant.frameHeight || 1;
    void fw; void fh;
    // Keep hitSprite's texture wired to something safe so any stale
    // reference doesn't dangle (e.g. external code calls
    // `getSlotSprite` and reads it). `Texture.EMPTY` is Pixi's
    // shared sentinel — zero-size, never destroyed.
    if (st.hitSprite.texture !== Texture.EMPTY) {
      const oldHit = st.hitSprite.texture;
      st.hitSprite.texture = Texture.EMPTY;
      try {
        oldHit?.destroy(false);
      } catch {}
    }
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
          // CRITICAL: also rebind the sprite's texture to Texture.EMPTY.
          // We just `releaseAccessory(hook.strip)`d at line ~1261, dropping
          // the strip's refcount; the cache may evict + retire-destroy
          // the underlying Texture within RETIRE_TICKS. If we leave
          // `hook.sprite.texture` pointing at the old (destroyed) Texture,
          // the next renderAll on this page builds a bind group from the
          // sprite (Pixi v8's batcher inspects children's texture
          // sources BEFORE per-sprite visibility culling) → `textureSource1`
          // is null → "Cannot read properties of null (reading
          // 'textureSource1')" + downstream WebGPU sync warnings on the
          // page render target. `visible=false` alone is NOT enough.
          hook.strip = null;
          hook.sprite.texture = Texture.EMPTY;
          hook.sprite.visible = false;
        }
      } else {
        // Same dangling-texture hazard as above; reset to EMPTY before
        // hiding so the destroyed Texture can be GC'd cleanly.
        hook.strip = null;
        hook.sprite.texture = Texture.EMPTY;
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

  /**
   * Drift-free super-atlas slot reclaim. Recompute, from GROUND TRUTH
   * (every live slot-state's current variant), the set of input-atlas
   * slot ids actually referenced this frame, and hand it to the atlas so
   * it can recycle any deferred-free slot absent from the set. Because
   * the set is rebuilt every frame from current state, there is no
   * incremental ref count to drift — the failure mode of the earlier
   * bind/unbind attempt. O(live slot-states); called once per frame.
   */
  private reclaimDiagFrame = 0;
  private reclaimInputAtlasSlots(): void {
    // DIAG: window.__noReclaim disables input-atlas slot reuse entirely
    // (freed slots never recycle). If the moving-bot garbage clears with
    // this on, the reuse/eviction race is the cause.
    if ((globalThis as unknown as { __noReclaim?: boolean }).__noReclaim) {
      return;
    }
    const live = new Set<number>();
    let divergent = 0;
    let divergSample = "";
    for (const slots of this.states.values()) {
      for (const st of slots.values()) {
        const variant = st.variant;
        const atlas = st.atlas;
        if (!variant || !atlas) continue;
        const id = atlas.pages[variant.pageIndex]?.inputAtlasSlot?.id;
        if (id !== undefined) live.add(id);
        // DIAG: does any band-instance's stored anchor (set at commit)
        // diverge from the CURRENT variant's band coords? If so, the bi
        // samples stale super-page coords the liveness check can't cover.
        for (const bi of st.bandInstances.values()) {
          const band = variant.bands.find((b) => b.bandIndex === bi.bandIndex);
          if (band && (band.atlasX !== bi.atlasX || band.atlasY !== bi.atlasY)) {
            divergent += 1;
            if (!divergSample) {
              divergSample = `bi(${bi.atlasX},${bi.atlasY}) vs variant(${band.atlasX},${band.atlasY}) slot=${id}`;
            }
          }
        }
      }
    }
    const superAtlas = getSharedInputAtlas();
    const recycled = superAtlas.reclaimDeferredSlots(live);
    if (divergent > 0 || ++this.reclaimDiagFrame % 90 === 0) {
      log.warn(
        `[RECLAIM DIAG] liveIds=${live.size} recycled=${recycled} deferred=${superAtlas.deferredCount()} divergent=${divergent} ${divergSample}`,
      );
    }
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
    // hitSprite holds a Texture wrapper around the class atlas page
    // source (frame restricted to one variant cell). Wrapper must be
    // destroyed; source survives — it's owned by CharacterCache.
    try {
      const t = st.hitSprite.texture;
      if (t && t !== Texture.EMPTY) t.destroy(false);
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

export function getActivePlayerStripRendererAnimDiagnostics(): ReturnType<
  PlayerStripRendererV2["getAnimDiagnostics"]
> | null {
  if (!activeStripRenderer) return null;
  return activeStripRenderer.getAnimDiagnostics();
}

/**
 * Headless-measurement hook: drive the active strip renderer's
 * resolution rebake directly — the exact heavy path a settled zoom
 * fires for characters (re-bake every live slot at the new render
 * resolution through the async bake queue / worker, with atomic
 * "never frozen" swaps). Returns the live slot count that was
 * re-dispatched, or null if no active renderer. Used by
 * `window.__triggerCharRebake` to bracket a real zoom rebake with a
 * frame-pacing recorder under a spawned bot roster.
 */
export function triggerActiveStripRebake(res: number): number | null {
  if (!activeStripRenderer) return null;
  const before = activeStripRenderer.getStats().atlas.slotsUsed;
  activeStripRenderer.setResolutionAndRerender(res);
  return before;
}
