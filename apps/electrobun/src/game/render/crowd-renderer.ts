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
import { ExternalSource, Rectangle, Sprite, Texture, type Container } from "pixi.js";

import {
  getMaxTextureSize,
  getPixiRenderer,
  getVelloRenderer,
} from "@/game/render/vello-loader";
import type { CrowdPlayerSnapshot } from "@/game/render/player-strip-renderer-v2";
import { playerZIndex } from "@/game/constants/z-index";
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
  /** Atlas layout for the per-actor compositing path. Optional: absent on
   *  older wasm builds (falls back to the single world-composite sprite). */
  crowdAtlasInfo?(): {
    cols: number;
    cellW: number;
    cellH: number;
    anchorX: number;
    anchorY: number;
    count: number;
  } | null;
  realCrowdFree(): void;
  tickDeferredDestroys?(a: number, n: number): void;
  /** Tier-7 slab path toggle (wc3 port). Optional: absent on older wasm builds. */
  realCrowdSetSlab?(enabled: boolean): void;
  /** Per-pass GPU timings of the last slab recording (gpu-timing builds only). */
  slabGpuTiming?(): Record<string, unknown> | null;
  /** Point-in-path hit test over the crowd's current frame. Input is in
   *  crowd-texture pixel space (== the crowd sprite's local space).
   *  Returns the index into `order` of the topmost actor hit, or -1.
   *  Optional: absent on older wasm builds. */
  crowdHitTest?(x: number, y: number): number;
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

/** Retained per-id look state (TS-side, for diffing only — the wasm
 *  recomputes its own cache key). Stored across frames and compared
 *  field-by-field so the common (unchanged) case allocates nothing — no
 *  string building, no array allocation. The three small arrays hold the
 *  last accessories' bundle/export/slot and are rewritten in place only
 *  when a change is committed. */
interface LookState {
  bundle: string;
  export: string;
  flipped: boolean;
  c1: number;
  c2: number;
  c3: number;
  accB: string[];
  accE: string[];
  accS: number[];
}

export class CrowdRenderer {
  private readonly parent: Container;
  private resolution: number;

  private sprite: Sprite | null = null;
  private source: ExternalSource | null = null;
  private texture: Texture | null = null;

  /** Per-actor atlas path: one Pixi sprite per actor sampling its cell of the
   *  shared crowd atlas texture, placed at its world position + per-cell
   *  zIndex (canonical interleave with object2 tiles, composed by Pixi).
   *  `atlasSprites[i]` is the sprite for `order[i]`. Empty when the band/atlas
   *  path isn't active (older wasm → single-sprite fallback above). */
  private atlasSprites: Sprite[] = [];
  private atlasSource: ExternalSource | null = null;
  private atlasInfo: {
    cols: number;
    cellW: number;
    cellH: number;
    anchorX: number;
    anchorY: number;
  } | null = null;
  private atlasActive = false;

  /** Eligible player ids in the exact order handed to `realCrowdSetup`
   *  (sorted by id, frozen until the next roster rebuild). All the flat
   *  per-tick uploads are written in this order. */
  private order: number[] = [];
  /** id → index into `order` (for sparse look updates). */
  private indexOf = new Map<number, number>();
  private xy = new Float64Array(0);
  private frames = new Uint32Array(0);
  /** Last committed look state per id — diffed field-by-field each tick to
   *  build sparse look updates without allocating in the unchanged case. */
  private lastLook = new Map<number, LookState>();
  /** Reused id → snapshot index map (rebuilt each tick in `updateAndRender`)
   *  — avoids allocating a fresh Map per frame. */
  private byIdScratch = new Map<number, CrowdPlayerSnapshot>();
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
  /** Slab toggle applied inside the next render tick — direct wasm calls
   *  from the console throw the wasm-bindgen re-entrancy guard while the
   *  live render's async borrows are in flight; the tick is the
   *  proven-safe call window. Defaults to `true`: the wc3 Tier-7 slab is
   *  the primary actor render path (and the only one with a point-in-path
   *  hit-test for picking). `__crowdSlab(false)` reverts to the batched
   *  append path for A/B comparison. */
  private pendingSlabMode: boolean | null = true;

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
    // TEMP DIAG: verify the wasm point-in-path hit test in isolation.
    g.__crowdHitTest = (x: number, y: number) => this.hitTest(x, y);
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

  /**
   * Point-in-path hit test for crowd-rendered actors. `globalX/globalY`
   * are Pixi global (screen) coords. Maps them into the crowd sprite's
   * local space (== crowd-texture px, the `place` space the wasm
   * hit-test expects), runs the wasm point-in-path test, and returns the
   * hit player id (mapped through `order`) or null on miss.
   */
  hitTest(globalX: number, globalY: number): number | null {
    if (!this.active || !this.setup) return null;
    const r = getVelloRenderer() as unknown as CrowdVelloApi | null;
    if (!r?.crowdHitTest) return null;
    let hx: number;
    let hy: number;
    if (this.atlasActive) {
      // The wasm hit-test runs in world space (place_world =
      // world·posScale + off), independent of the atlas layout. Map the
      // screen point → parent (world) units → that hit space.
      const local = this.parent.toLocal({ x: globalX, y: globalY });
      hx = local.x * this.setup.posScale + this.setup.offX;
      hy = local.y * this.setup.posScale + this.setup.offY;
    } else if (this.sprite) {
      const local = this.sprite.toLocal({ x: globalX, y: globalY });
      hx = local.x;
      hy = local.y;
    } else {
      return null;
    }
    let idx: number;
    try {
      idx = r.crowdHitTest(hx, hy);
    } catch {
      // Re-entrancy guard while the live render holds the borrow.
      return null;
    }
    if (idx < 0 || idx >= this.order.length) return null;
    return this.order[idx];
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
    this.teardownAtlas();
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

  /** True when the player's look differs from the last committed state.
   *  All comparisons are `===`/`!==` — no string building, no array
   *  allocation in the common (unchanged) case. */
  private lookChanged(
    p: CrowdPlayerSnapshot,
    prev: LookState | undefined,
  ): boolean {
    if (!prev) return true;
    if (
      prev.bundle !== p.bundle ||
      prev.export !== p.export ||
      prev.flipped !== p.flipped ||
      prev.c1 !== p.c1 ||
      prev.c2 !== p.c2 ||
      prev.c3 !== p.c3 ||
      prev.accB.length !== p.acc.length
    ) {
      return true;
    }
    for (let i = 0; i < p.acc.length; i++) {
      const a = p.acc[i];
      if (
        prev.accB[i] !== a.bundle ||
        prev.accE[i] !== a.export ||
        prev.accS[i] !== a.slot
      ) {
        return true;
      }
    }
    return false;
  }

  /** Commit the player's current look into the retained `LookState`,
   *  reusing `prev` (and its accessory arrays) in place when present. Only
   *  called on an actual change, so the array rewrites are rare. */
  private storeLook(p: CrowdPlayerSnapshot, prev?: LookState): void {
    const state = prev ?? {
      bundle: "",
      export: "",
      flipped: false,
      c1: 0,
      c2: 0,
      c3: 0,
      accB: [] as string[],
      accE: [] as string[],
      accS: [] as number[],
    };
    state.bundle = p.bundle;
    state.export = p.export;
    state.flipped = p.flipped;
    state.c1 = p.c1;
    state.c2 = p.c2;
    state.c3 = p.c3;
    state.accB.length = p.acc.length;
    state.accE.length = p.acc.length;
    state.accS.length = p.acc.length;
    for (let i = 0; i < p.acc.length; i++) {
      const a = p.acc[i];
      state.accB[i] = a.bundle;
      state.accE[i] = a.export;
      state.accS[i] = a.slot;
    }
    if (!prev) this.lastLook.set(p.id, state);
  }

  private rebuild(
    r: CrowdVelloApi,
    eligible: CrowdPlayerSnapshot[],
    key: string,
  ): void {
    // Drop the old atlas sprites BEFORE freeing the wasm crowd — their
    // textures alias the GPU atlas that `realCrowdFree` destroys.
    this.teardownAtlas();
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
      this.storeLook(p, this.lastLook.get(p.id));
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

  private teardownAtlas(): void {
    for (const s of this.atlasSprites) s.destroy({ texture: true });
    this.atlasSource?.destroy();
    this.atlasSprites = [];
    this.atlasSource = null;
    this.atlasInfo = null;
    this.atlasActive = false;
  }

  private adoptTexture(r: CrowdVelloApi): void {
    const pixiRenderer = getPixiRenderer();
    if (!pixiRenderer || !this.setup) return;
    const handle = r.crowdTextureHandle();
    if (!handle) {
      log.warn("crowdTextureHandle returned null");
      return;
    }
    const inv = 1 / this.resolution;

    // PER-ACTOR ATLAS path: the crowd texture is an atlas (one cell per
    // actor). Make one Pixi sprite per actor sampling its cell, placed at the
    // actor's world position + per-cell zIndex each frame — so they interleave
    // canonically with object2 tiles in `objectLayer2`. All sprites share the
    // one atlas source → Pixi batches them. Falls back to the single
    // world-composite sprite on older wasm without `crowdAtlasInfo`.
    const atlas = r.crowdAtlasInfo?.() ?? null;
    if (atlas && atlas.cols > 0 && atlas.count > 0) {
      this.teardownAtlas();
      this.teardownSingleSprite();
      const source = new ExternalSource({
        resource: handle.texture,
        renderer: pixiRenderer,
        width: handle.width,
        height: handle.height,
        label: "crowd-atlas",
      });
      source.alphaMode = "no-premultiply-alpha";
      source.scaleMode = "linear";
      source.format = "rgba8unorm";
      source.autoGarbageCollect = false;
      this.atlasSource = source;
      this.atlasInfo = {
        cols: atlas.cols,
        cellW: atlas.cellW,
        cellH: atlas.cellH,
        anchorX: atlas.anchorX,
        anchorY: atlas.anchorY,
      };
      const n = this.order.length;
      const ax = atlas.anchorX / atlas.cellW;
      const ay = atlas.anchorY / atlas.cellH;
      for (let i = 0; i < n; i++) {
        const col = i % atlas.cols;
        const row = Math.floor(i / atlas.cols);
        const tex = new Texture({
          source,
          frame: new Rectangle(
            col * atlas.cellW,
            row * atlas.cellH,
            atlas.cellW,
            atlas.cellH,
          ),
        });
        const sprite = new Sprite(tex);
        sprite.label = `crowd-actor-${i}`;
        sprite.anchor.set(ax, ay);
        sprite.scale.set(inv);
        sprite.visible = false; // shown per-frame once positioned
        this.parent.addChild(sprite);
        this.atlasSprites.push(sprite);
      }
      this.atlasActive = true;
      this.active = true;
      return;
    }

    // Single world-composite sprite fallback.
    this.atlasActive = false;
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
    this.sprite.scale.set(inv);
    this.sprite.position.set(-this.setup.offX * inv, -this.setup.offY * inv);
    this.sprite.visible = true;
    this.active = true;
  }

  private teardownSingleSprite(): void {
    this.sprite?.destroy();
    this.source?.destroy();
    this.sprite = null;
    this.source = null;
    this.texture = null;
  }

  private updateAndRender(
    r: CrowdVelloApi,
    eligible: CrowdPlayerSnapshot[],
  ): void {
    if (!this.setup) return;
    if (!this.atlasActive && !this.sprite) return;
    if (this.pendingSlabMode !== null) {
      r.realCrowdSetSlab?.(this.pendingSlabMode);
      log.info(`slab mode ${this.pendingSlabMode ? "ON" : "OFF"} applied`);
      this.pendingSlabMode = null;
    }

    // Index the live snapshot by id; build the flat per-tick uploads in
    // the frozen setup order; collect sparse look changes. The id→snapshot
    // map is a reused scratch field (cleared, not reallocated, per tick).
    const byId = this.byIdScratch;
    byId.clear();
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
        if (this.atlasActive) this.atlasSprites[i].visible = false;
        continue;
      }
      this.xy[i * 2] = p.x;
      this.xy[i * 2 + 1] = p.y;
      this.frames[i] = Math.max(0, p.frame | 0);
      if (this.atlasActive) {
        // The slab renders this actor into its static atlas cell; the sprite
        // carries world movement + per-cell depth so it interleaves with the
        // map's object2 tiles in `objectLayer2`.
        const sp = this.atlasSprites[i];
        sp.position.set(p.x, p.y);
        sp.zIndex = playerZIndex(p.cellId);
        sp.visible = true;
      }

      const prev = this.lastLook.get(id);
      if (this.lookChanged(p, prev)) {
        this.storeLook(p, prev);
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

    // The wgpu target was re-rendered in place: invalidate the Pixi source(s).
    if (this.atlasActive) {
      this.atlasSource?.update();
    } else {
      this.source?.update();
      this.texture?.update();
    }
    r.tickDeferredDestroys?.(2, 8192);
  }

  private hideSprite(): void {
    if (this.sprite) this.sprite.visible = false;
    for (const s of this.atlasSprites) s.visible = false;
    this.active = false;
  }
}
