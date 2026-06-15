/**
 * CrowdRenderer — LIVE Vello-direct crowd cutover.
 *
 * Replaces the per-player `PlayerStripRendererV2` sprites with ONE
 * Vello-rendered texture holding the entire crowd. Validated path
 * (see `VELLO_DIRECT_FINDINGS.md`): retain the *encoded* look per
 * unique `(sig, frame)`, `scene.append` each player's cached encoding
 * at its world transform, batch ~500/scene, alpha-composite back to
 * front into one target. Measured 500 moving @ scale 6 @ ~100fps.
 *
 * Incremental driving (no full re-bake on anim swaps):
 *   • `realCrowdSetup` ONLY when the eligible-player SET changes
 *     (spawn/despawn) — re-fits the target + re-adopts the GPU texture.
 *   • Every tick while the roster is stable:
 *       - `crowdUpdatePositions` (flat f64) + `crowdUpdateFrames`
 *         (flat u32) — the hot path, each player at its real frame.
 *       - `crowdUpdateLooks` — SPARSE, only players whose look sig
 *         changed this tick (anim/dir/colour/accessory). New
 *         `(sig, frame)` combos bake lazily; old cache entries persist.
 *       - `realCrowdRenderBatched` → composite → mark sprite dirty.
 *   • Paint order (z) is re-derived per frame inside the wasm render
 *     from current Y; picking + mounts stay on the per-player path
 *     (mounted players are excluded here).
 *
 * The crowd target wgpu texture is adopted as ONE Pixi `ExternalSource`
 * sprite (no readback — `extract_gpu_texture` hands the live GPUTexture
 * straight to Pixi) mounted in the player world container at
 * `(-offX, -offY)` so texture-local coordinates map back to world.
 *
 * Gated behind `crowdEnabled` in `PlayerRenderer` — the per-player
 * strip path stays the default fallback.
 */
import { ExternalSource, Sprite, Texture, type Container } from "pixi.js";

import {
  getMaxTextureSize,
  getPixiRenderer,
  getVelloRenderer,
} from "@/game/render/vello-loader";
import type { CrowdPlayerSnapshot } from "@/game/render/player-strip-renderer-v2";
import { createLogger } from "@/utils/logger";

const log = createLogger("CrowdRenderer");

/** Players per Vello scene/composite source. Findings: cap 500 (≤2
 *  batches for ~800) is the fastest + lowest-VRAM point. */
const BATCH_CAP = 500;

/** Debounce window for a full crowd rebuild. The current wasm crowd
 *  is stateful and atomic — every roster change requires a teardown
 *  (`realCrowdFree`) + re-setup (`realCrowdSetup`) that re-bakes every
 *  unique look. A spawn burst trickles bots online over seconds; without
 *  debouncing we'd rebuild dozens of times per second, dropping frames
 *  and flashing the GPU target between teardowns. Waiting for the roster
 *  to settle for this many ms collapses the burst into one rebuild. */
const ROSTER_DEBOUNCE_MS = 500;

/** Minimal structural view of the wasm crowd API we call. */
interface CrowdVelloApi {
  realCrowdSetup(
    players: unknown,
    targetDimMax: number,
    resolution: number,
    retain: boolean,
  ): Record<string, number> | null;
  crowdUpdatePositions(xy: Float64Array): void;
  crowdUpdateFrames(frames: Uint32Array): void;
  crowdUpdateLooks(updates: unknown): void;
  realCrowdRenderBatched(
    cap: number,
    timeMs: number,
  ): Record<string, number> | null;
  crowdTextureHandle(): {
    texture: GPUTexture;
    width: number;
    height: number;
  } | null;
  realCrowdFree(): void;
  tickDeferredDestroys?(a: number, n: number): void;
  /** Tier-7 slab path toggle (wc3 port). Optional: absent on older wasm builds. */
  realCrowdSetSlab?(enabled: boolean): void;
  /** Per-pass GPU timings of the last slab recording (gpu-timing builds only). */
  slabGpuTiming?(): Record<string, unknown> | null;
}

interface SetupInfo {
  offX: number;
  offY: number;
  texW: number;
  texH: number;
  posScale: number;
}

/** A player is in the crowd when its body has committed and it is not
 *  mounted (mount layers render through the per-player strip path). */
const isEligible = (p: CrowdPlayerSnapshot): boolean =>
  p.committed && !p.mounted;

/** Look signature (TS-side, for diffing only — the wasm recomputes its
 *  own cache key). Changes on anim/dir/flip/colour/accessory change. */
function lookSig(p: CrowdPlayerSnapshot): string {
  const accSig = p.acc.map((a) => `${a.bundle}:${a.export}:${a.slot}`).join(",");
  return `${p.bundle}|${p.export}|${p.flipped ? 1 : 0}|${p.c1},${p.c2},${p.c3}|${accSig}`;
}

export class CrowdRenderer {
  private readonly parent: Container;
  private resolution: number;

  private sprite: Sprite | null = null;
  private source: ExternalSource | null = null;
  private texture: Texture | null = null;

  /** Eligible player ids in the exact order handed to `realCrowdSetup`
   *  (sorted by id, frozen until the next roster rebuild). All the flat
   *  per-tick uploads are written in this order. */
  private order: number[] = [];
  /** id → index into `order` (for sparse look updates). */
  private indexOf = new Map<number, number>();
  private xy = new Float64Array(0);
  private frames = new Uint32Array(0);
  /** Last look sig per id — diffed each tick to build sparse look updates. */
  private lastLook = new Map<number, string>();
  /** Eligible-player SET signature — rebuild when it changes. */
  private rosterKey = "";
  /** Roster key pending rebuild (the new one detected). Reset to "" once
   *  the rebuild commits. */
  private pendingRosterKey = "";
  /** Timestamp the pending roster was first observed; the debounce window
   *  starts from here and resets if a different new key arrives. */
  private pendingRosterAt = 0;
  private setup: SetupInfo | null = null;
  private active = false;
  private lastRenderMs = 0;
  private lastStats: Record<string, number> | null = null;
  /** Slab toggle requested from the console, applied inside the next
   *  render tick — direct wasm calls from the console throw the
   *  wasm-bindgen re-entrancy guard while the live render's async
   *  borrows are in flight; the tick is the proven-safe call window. */
  private pendingSlabMode: boolean | null = null;

  constructor(parent: Container, resolution = 3) {
    this.parent = parent;
    this.resolution = Math.max(1, resolution);
    // Dev console hooks for the Tier-7 slab path (wc3 port validation):
    //   __crowdSlab(true)  → route the crowd through the slab renderer
    //   __crowdSlabStats() → last per-frame stats + GPU pass timings
    const g = globalThis as Record<string, unknown>;
    g.__crowdSlab = (enabled: boolean) => {
      this.pendingSlabMode = enabled;
      log.info(`slab mode ${enabled ? "ON" : "OFF"} queued for next tick`);
    };
    g.__crowdSlabStats = () => {
      let gpu: unknown = null;
      try {
        const r = getVelloRenderer() as unknown as CrowdVelloApi | null;
        gpu = r?.slabGpuTiming?.() ?? null;
      } catch {
        // Re-entrancy guard while the live render holds the borrow.
      }
      return {
        lastRenderMs: this.lastRenderMs,
        lastStats: this.lastStats,
        gpu,
      };
    };
  }

  isActive(): boolean {
    return this.active;
  }

  /** Player ids the crowd is currently rendering (so the caller hides
   *  exactly their per-player main sprites). */
  getRenderedIds(): number[] {
    return this.active ? this.order : [];
  }

  setResolution(res: number): void {
    const clamped = Math.max(1, res);
    if (clamped === this.resolution) return;
    this.resolution = clamped;
    this.rosterKey = ""; // force rebuild
  }

  /** Drive the crowd for this tick from the live strip-renderer snapshot. */
  sync(snapshot: CrowdPlayerSnapshot[]): void {
    const r = getVelloRenderer() as unknown as CrowdVelloApi | null;
    if (!r?.realCrowdSetup) return;

    const eligible = snapshot.filter(isEligible);
    if (eligible.length === 0) {
      this.hideSprite();
      return;
    }

    const key = eligible
      .map((p) => p.id)
      .sort((a, b) => a - b)
      .join(",");
    if (key === this.rosterKey) {
      // Stable roster — fast path.
      this.updateAndRender(r, eligible);
      return;
    }
    // Roster differs from the active setup — debounce the rebuild so a
    // spawn burst settles to ONE rebuild instead of one-per-arrival.
    const now = performance.now();
    if (key !== this.pendingRosterKey) {
      this.pendingRosterKey = key;
      this.pendingRosterAt = now;
    }
    if (now - this.pendingRosterAt < ROSTER_DEBOUNCE_MS) {
      // Still settling — keep rendering the OLD setup so the existing
      // bots stay visible. Bots that JOINED the eligible set this tick
      // are temporarily invisible (not in `order`); they appear at the
      // next rebuild.
      if (this.setup) this.updateAndRender(r, eligible);
      return;
    }
    // Settled — commit the rebuild.
    this.rebuild(r, eligible, key);
    this.pendingRosterKey = "";
  }

  setEnabled(on: boolean): void {
    if (!on) {
      this.hideSprite();
      const r = getVelloRenderer() as unknown as CrowdVelloApi | null;
      r?.realCrowdFree();
      this.rosterKey = "";
      this.setup = null;
      this.lastLook.clear();
      this.active = false;
    }
  }

  destroy(): void {
    const r = getVelloRenderer() as unknown as CrowdVelloApi | null;
    r?.realCrowdFree();
    this.sprite?.destroy();
    this.source?.destroy();
    this.sprite = null;
    this.source = null;
    this.texture = null;
    this.active = false;
  }

  getLastRenderMs(): number {
    return this.lastRenderMs;
  }

  // ── internals ────────────────────────────────────────────────────

  private rebuild(
    r: CrowdVelloApi,
    eligible: CrowdPlayerSnapshot[],
    key: string,
  ): void {
    r.realCrowdFree();

    // Stable order = sorted by id (matches the roster key derivation).
    const sorted = [...eligible].sort((a, b) => a.id - b.id);
    this.order = sorted.map((p) => p.id);
    this.indexOf.clear();
    this.order.forEach((id, i) => this.indexOf.set(id, i));
    this.xy = new Float64Array(sorted.length * 2);
    this.frames = new Uint32Array(sorted.length);
    this.lastLook.clear();

    // Coordinates are passed in WORLD units; the wasm multiplies by
    // `pos_scale = resolution` and bakes each look at `resolution/20`, so
    // the crowd texture is at resolution (HiDPI) density — exactly like
    // the per-player strip renderer. The sprite is then mounted at
    // `scale = 1/resolution` (see `adoptTexture`) so texture pixels map
    // back to world units 1:1 and the container zoom applies once.
    // (Previously coords were pre-divided by resolution AND the sprite
    // was mounted at scale 1, so characters rendered `resolution`× too
    // large — the oversized-bots / fillrate-melt bug.)
    const setupPlayers = sorted.map((p) => {
      this.lastLook.set(p.id, lookSig(p));
      return {
        bundle: p.bundle,
        export: p.export,
        frameCount: p.frameCount,
        fps: p.fps,
        flipped: p.flipped,
        c1: p.c1,
        c2: p.c2,
        c3: p.c3,
        x: p.x,
        y: p.y,
        acc: p.acc,
      };
    });

    const cap = Math.min(getMaxTextureSize() || 8192, 8192);
    const info = r.realCrowdSetup(setupPlayers, cap, this.resolution, true);
    if (!info) {
      log.warn("realCrowdSetup returned null; crowd disabled this tick");
      this.rosterKey = "";
      return;
    }
    this.setup = {
      offX: info.offX ?? 0,
      offY: info.offY ?? 0,
      texW: info.texW ?? 1,
      texH: info.texH ?? 1,
      posScale: info.posScale ?? this.resolution,
    };
    this.rosterKey = key;

    this.adoptTexture(r);
    this.updateAndRender(r, eligible);
    log.info(
      `rebuild: ${eligible.length} players, tex ${this.setup.texW}x${this.setup.texH}, off (${this.setup.offX | 0},${this.setup.offY | 0})`,
    );
  }

  private adoptTexture(r: CrowdVelloApi): void {
    const pixiRenderer = getPixiRenderer();
    if (!pixiRenderer || !this.setup) return;
    const handle = r.crowdTextureHandle();
    if (!handle) {
      log.warn("crowdTextureHandle returned null");
      return;
    }

    // The underlying wgpu texture was just freed + recreated by setup,
    // so the previous adoption is stale.
    this.source?.destroy();
    this.texture?.destroy();

    const source = new ExternalSource({
      resource: handle.texture,
      renderer: pixiRenderer,
      width: handle.width,
      height: handle.height,
      label: "crowd-target",
    });
    source.alphaMode = "no-premultiply-alpha";
    source.scaleMode = "linear";
    source.format = "rgba8unorm";
    source.autoGarbageCollect = false;
    this.source = source;
    this.texture = new Texture({ source });

    if (!this.sprite) {
      this.sprite = new Sprite(this.texture);
      this.sprite.label = "crowd-sprite";
      this.sprite.zIndex = 0;
      this.parent.addChild(this.sprite);
    } else {
      this.sprite.texture = this.texture;
    }
    // Texture-local (offX, offY) == world (0,0): a player at world wx lands
    // at texture-local wx+offX, shown at -offX + (wx+offX) = wx.
    // Texture is at resolution density; downscale by 1/resolution so it
    // maps to world units (the container zoom then applies once), and
    // offset by the (also resolution-density) content origin converted to
    // world units. A player at world wx lands at texture-local
    // wx*resolution + offX, shown at (-offX + wx*resolution + offX)/
    // resolution = wx.
    const inv = 1 / this.resolution;
    this.sprite.scale.set(inv);
    this.sprite.position.set(-this.setup.offX * inv, -this.setup.offY * inv);
    this.sprite.visible = true;
    this.active = true;
  }

  private updateAndRender(
    r: CrowdVelloApi,
    eligible: CrowdPlayerSnapshot[],
  ): void {
    if (!this.setup || !this.sprite) return;
    if (this.pendingSlabMode !== null) {
      r.realCrowdSetSlab?.(this.pendingSlabMode);
      log.info(`slab mode ${this.pendingSlabMode ? "ON" : "OFF"} applied`);
      this.pendingSlabMode = null;
    }

    // Index the live snapshot by id; build the flat per-tick uploads in
    // the frozen setup order; collect sparse look changes.
    const byId = new Map<number, CrowdPlayerSnapshot>();
    for (const p of eligible) byId.set(p.id, p);

    const looks: Array<Record<string, unknown>> = [];
    for (let i = 0; i < this.order.length; i++) {
      const id = this.order[i];
      const p = byId.get(id);
      if (!p) {
        // Eligible last rebuild, gone this tick (despawn before roster
        // rebuild) → park off-screen until the rebuild drops it.
        this.xy[i * 2] = -1e6;
        this.xy[i * 2 + 1] = -1e6;
        this.frames[i] = 0;
        continue;
      }
      this.xy[i * 2] = p.x;
      this.xy[i * 2 + 1] = p.y;
      this.frames[i] = Math.max(0, p.frame | 0);

      const sig = lookSig(p);
      if (this.lastLook.get(id) !== sig) {
        this.lastLook.set(id, sig);
        looks.push({
          i,
          bundle: p.bundle,
          export: p.export,
          frameCount: p.frameCount,
          fps: p.fps,
          flipped: p.flipped,
          c1: p.c1,
          c2: p.c2,
          c3: p.c3,
          acc: p.acc,
        });
      }
    }

    r.crowdUpdatePositions(this.xy);
    r.crowdUpdateFrames(this.frames);
    if (looks.length > 0) r.crowdUpdateLooks(looks);

    const t0 = performance.now();
    this.lastStats = r.realCrowdRenderBatched(BATCH_CAP, 0);
    this.lastRenderMs = performance.now() - t0;

    // The wgpu target was re-rendered in place: invalidate the Pixi source.
    this.source?.update();
    this.texture?.update();
    r.tickDeferredDestroys?.(2, 8192);
  }

  private hideSprite(): void {
    if (this.sprite) this.sprite.visible = false;
    this.active = false;
  }
}
