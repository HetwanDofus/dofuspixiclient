/**
 * CrowdRenderer — unified-atlas Step 3: per-actor atlas cells.
 *
 * The wasm slab renders every crowd-managed actor's CURRENT frame into
 * its OWN tight-packed cell of one or more shared atlas PAGES (one
 * Vello slab dispatch per page per frame). Each actor is an ordinary
 * Pixi `Sprite` sampling its cell (zero-copy `ExternalSource` over the
 * shared GPUDevice — the Step-2 tile-page pattern, commit 639b85bbc0),
 * placed at the actor's world position with
 * `zIndex = playerZIndex(cellId)` — so Pixi Y-sorts actors among the
 * object2 tiles natively (one sort domain, canonical per-actor
 * occlusion).
 *
 * GENERATION lifecycle — (rosterKey, resMilli), like Step 2's tile
 * pages:
 *   • `realCrowdSetup` mints a new generation (new pages + cells) on a
 *     roster change (debounced), a resolution change (immediate — the
 *     zoom re-render), or a reported cell MISFIT (a look outgrew its
 *     cell).
 *   • Per-id sprites are STABLE across generations. Each sprite keeps
 *     sampling its OLD generation's (frozen) cell until the actor's
 *     first rendered frame lands in the new one (`rendered` flags from
 *     the wasm) — no empty-cell flash while the paced bake warms up.
 *   • Once every actor swapped (or the swap window times out), the old
 *     generation retires wholesale after a 2-tick settle:
 *     `Texture.destroy` + `ExternalSource.destroy` +
 *     `freeRenderTexture(pageId)` (patched-wgpu requirement).
 *
 * Per tick while the roster is stable:
 *   • `crowdUpdatePositions` + `crowdUpdateFrames` (flat, hot path),
 *     `crowdUpdateLooks` (sparse; returns a misfit count → re-fit),
 *   • `realCrowdRenderBatched` (slab; one dispatch per page),
 *   • per-actor sprite position/zIndex writes + page-source dirtying.
 *
 * Picking: sprites route through the normal `PickingSystem` sprite
 * pass via `getActorSprite`/`getActorAlphaTest` (the alpha test defers
 * to the wasm point-in-path hit test for a canonical silhouette); the
 * sprite-less `crowdResolver` path remains as fallback while a sprite
 * has no rendered content yet.
 */
import { ExternalSource, Rectangle, Sprite, Texture, type Container } from "pixi.js";

import {
  freeRenderTexture,
  getMaxTextureSize,
  getPixiRenderer,
  getVelloRenderer,
  trackRenderTexture,
} from "@/game/render/vello-loader";
import type { CrowdPlayerSnapshot } from "@/game/render/player-strip-renderer-v2";
import { playerZIndex } from "@/game/constants/z-index";
import { createLogger } from "@/utils/logger";

const log = createLogger("CrowdRenderer");

/** DIAG ring buffer of generation-lifecycle events (rebuilds, retire
 *  scheduling/firing, sweep re-points) — correlated against crash
 *  timestamps from the QA error hook. Read via `__crowdEvents`. */
const crowdEvents: Array<Record<string, unknown>> = [];
function pushEvent(ev: string, data: Record<string, unknown>): void {
  crowdEvents.push({ t: Date.now(), ev, ...data });
  if (crowdEvents.length > 400) crowdEvents.splice(0, 100);
}
(globalThis as Record<string, unknown>).__crowdEvents = () => crowdEvents;

/** Players per Vello scene/composite source (legacy batch path knob;
 *  the slab path renders each page in one dispatch regardless). */
const BATCH_CAP = 500;

/** Debounce window for a ROSTER-change rebuild. A spawn burst trickles
 *  bots online over seconds; without debouncing we'd re-setup dozens of
 *  times per second. Resolution changes / misfits bypass this — they
 *  rebuild on the next sync tick (the zoom path is already debounced
 *  upstream in `BattlefieldZoom`). */
const ROSTER_DEBOUNCE_MS = 500;

/** 2-tick settle before destroying a retired generation's pages — Pixi
 *  may still have an in-flight frame sampling them (Step-2 lesson). */
const RETIRE_DELAY_MS = 2 * (1000 / 60);

/** Max time a new generation waits for every actor's first rendered
 *  frame before force-swapping the stragglers (an actor whose bundle
 *  can't bake would otherwise pin the old pages forever). */
const GEN_SWAP_TIMEOUT_MS = 3000;

interface CrowdPageHandle {
  texture: GPUTexture;
  textureId: number;
  width: number;
  height: number;
}

interface CrowdAtlasInfo {
  count: number;
  pages: CrowdPageHandle[];
  cellPage: Uint32Array;
  cellX: Uint32Array;
  cellY: Uint32Array;
  cellW: Uint32Array;
  cellH: Uint32Array;
  anchorX: Float64Array;
  anchorY: Float64Array;
}

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
  /** Sparse look updates. Returns the number of actors whose new look
   *  needs a bigger atlas cell (misfit → caller re-fits). */
  crowdUpdateLooks(updates: unknown): number;
  realCrowdRenderBatched(
    cap: number,
    timeMs: number,
  ): (Record<string, unknown> & { rendered?: Uint8Array }) | null;
  /** Per-actor atlas layout + zero-copy page handles (Step 3). */
  crowdAtlasInfo(): CrowdAtlasInfo | null;
  realCrowdFree(): void;
  tickDeferredDestroys?(a: number, n: number): void;
  /** Tier-7 slab path toggle (wc3 port). */
  realCrowdSetSlab?(enabled: boolean): void;
  /** Per-pass GPU timings of the last slab recording (gpu-timing builds only). */
  slabGpuTiming?(): Record<string, unknown> | null;
  /** Point-in-path hit test over the crowd's current frame, in the
   *  crowd's world hit space (`world × posScale + off`). Returns the
   *  index into `order` of the topmost actor hit, or -1. */
  crowdHitTest?(x: number, y: number): number;
  /** Toggle the wasm crowd's deferred-bake mode. Forced OFF: the crowd
   *  bakes each miss inline on the main thread (one wasm instance). */
  setCrowdOffThreadBake?(on: boolean): void;
}

interface SetupInfo {
  offX: number;
  offY: number;
  texW: number;
  texH: number;
  posScale: number;
  pages: number;
}

/** One adopted atlas generation: the Pixi-visible half of a
 *  `realCrowdSetup` (pages + per-actor cell textures + swap state). */
interface CrowdGeneration {
  id: number;
  resMilli: number;
  sources: ExternalSource[];
  textureIds: number[];
  /** Per-actor cell texture (index-aligned with `order`). */
  textures: Texture[];
  cellW: Uint32Array;
  cellH: Uint32Array;
  /** Feet anchor in cell px (picking + sprite anchor). */
  anchorX: Float64Array;
  anchorY: Float64Array;
  /** Per-actor: sprite has cut over to this generation's cell. */
  swapped: Uint8Array;
  swappedCount: number;
  startedAt: number;
  pageBytes: number;
}

/** A player is in the crowd when its body has committed and it is not
 *  mounted (mount layers render through the per-player strip path). */
const isEligible = (p: CrowdPlayerSnapshot): boolean =>
  p.committed && !p.mounted;

/** Retained per-id look state (TS-side, for diffing only — the wasm
 *  recomputes its own cache key). Stored across frames and compared
 *  field-by-field so the common (unchanged) case allocates nothing. */
interface LookState {
  bundle: string;
  export: string;
  flipped: boolean;
  c1: number;
  c2: number;
  c3: number;
  /** Per-actor gfx scale, percent (100 = default). Part of the sparse
   *  look-update diff so a wire scale change reaches the wasm crowd. */
  scaleX: number;
  scaleY: number;
  accB: string[];
  accE: string[];
  accS: number[];
}

export class CrowdRenderer {
  private readonly parent: Container;
  /** Live bake density, milli-quantized (exact float × 1000) — the
   *  generation key's resolution half. Seeded from the LIVE zoom at
   *  construction (boot crispness) and re-seeded by `setResolution`
   *  on every zoom settle (actors re-rasterize like tiles). */
  private resMilli: number;

  /** Stable per-player-id sprites — created when an id first enters the
   *  roster, destroyed when it leaves (or on disable). Textures swap
   *  per generation; the sprite object survives, so picking references
   *  and Pixi batching stay warm across zooms/rebuilds. */
  private readonly spriteById = new Map<number, Sprite>();
  /** Ids whose sprite has NO valid cell content yet (fresh spawn whose
   *  first bake hasn't landed) — kept invisible until first swap. */
  private readonly freshIds = new Set<number>();

  private gen: CrowdGeneration | null = null;
  private prevGens: CrowdGeneration[] = [];
  /** Retired generations whose GPU storage is freed but whose Pixi
   *  Texture/ExternalSource wrappers are kept alive (never destroyed
   *  mid-session — see `retireGeneration`). Destroyed at teardown. */
  private orphanedGens: CrowdGeneration[] = [];
  private genSeq = 0;

  /** Guards the one-time switch of the crowd to inline main-thread baking. */
  private inlineBakeInit = false;

  /** Eligible player ids in the exact order handed to `realCrowdSetup`
   *  (sorted by id, frozen until the next rebuild). All flat per-tick
   *  uploads are written in this order. */
  private order: number[] = [];
  /** id → index into `order` (sparse look updates + picking). */
  private indexOf = new Map<number, number>();
  private xy = new Float64Array(0);
  private frames = new Uint32Array(0);
  private lastLook = new Map<number, LookState>();
  private byIdScratch = new Map<number, CrowdPlayerSnapshot>();
  /** Eligible-player SET signature — roster half of the generation key. */
  private rosterKey = "";
  private pendingRosterKey = "";
  private pendingRosterAt = 0;
  /** Set by `setResolution` (zoom) or a reported cell misfit: rebuild on
   *  the next sync tick WITHOUT the roster debounce. */
  private refitPending = false;
  private setup: SetupInfo | null = null;
  private active = false;
  private lastRenderMs = 0;
  private lastStats:
    | (Record<string, unknown> & { rendered?: Uint8Array })
    | null = null;
  /** Slab toggle applied inside the next render tick (re-entrancy-safe
   *  call window). Defaults to `true`: the wc3 Tier-7 slab is the
   *  primary actor render path. */
  private pendingSlabMode: boolean | null = true;

  constructor(parent: Container, resolution = 3) {
    this.parent = parent;
    this.resMilli = Math.round(Math.max(0.5, resolution) * 1000);
    const g = globalThis as Record<string, unknown>;
    g.__crowdSlab = (enabled: boolean) => {
      this.pendingSlabMode = enabled;
      log.info(`slab mode ${enabled ? "ON" : "OFF"} queued for next tick`);
    };
    g.__crowdHitTest = (x: number, y: number) => this.hitTest(x, y);
    // DIAG: scan the whole object2 layer for sprites whose texture
    // source has been destroyed (the batch-poison signature). Reports
    // label + visibility so a post-crash console call pins the leaker.
    g.__crowdScanStale = () => {
      const out: Array<Record<string, unknown>> = [];
      const scan = (node: Container, depth: number) => {
        const sp = node as unknown as {
          texture?: { destroyed?: boolean; source?: { destroyed?: boolean; label?: string } };
          label?: string;
          visible?: boolean;
          renderable?: boolean;
        };
        if (sp.texture && (sp.texture.destroyed || sp.texture.source?.destroyed)) {
          out.push({
            label: sp.label ?? "?",
            source: sp.texture.source?.label ?? "?",
            visible: sp.visible,
            renderable: sp.renderable,
            depth,
          });
        }
        for (const c of node.children ?? []) scan(c as Container, depth + 1);
      };
      scan(this.parent, 0);
      return out;
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
        atlas: this.getStats(),
        gpu,
      };
    };
  }

  isActive(): boolean {
    return this.active;
  }

  /** Live atlas/generation stats (mem snapshot + QA). */
  getStats(): {
    resMilli: number;
    pages: number;
    pageBytes: number;
    sprites: number;
    retiring: number;
    swapped: number;
    actors: number;
  } {
    return {
      resMilli: this.resMilli,
      pages: this.gen?.sources.length ?? 0,
      pageBytes: this.gen?.pageBytes ?? 0,
      sprites: this.spriteById.size,
      retiring: this.prevGens.length,
      swapped: this.gen?.swappedCount ?? 0,
      actors: this.order.length,
    };
  }

  /**
   * Point-in-path hit test for crowd-rendered actors. `globalX/globalY`
   * are Pixi global (screen) coords, mapped into the wasm's world hit
   * space (`parent local × posScale + off`). Returns the hit player id
   * or null on miss.
   */
  hitTest(globalX: number, globalY: number): number | null {
    if (!this.active || !this.setup) return null;
    const r = getVelloRenderer() as unknown as CrowdVelloApi | null;
    if (!r?.crowdHitTest) return null;
    const local = this.parent.toLocal({ x: globalX, y: globalY });
    const hx = local.x * this.setup.posScale + this.setup.offX;
    const hy = local.y * this.setup.posScale + this.setup.offY;
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

  /** The actor's live Pixi sprite for the picking system's sprite pass
   *  (null while it has no rendered cell content yet — picking then
   *  falls back to the sprite-less crowd resolver). */
  getActorSprite(id: number): Sprite | null {
    const sp = this.spriteById.get(id);
    return sp && sp.visible ? sp : null;
  }

  /** Pixel-true alpha test for the actor's sprite: maps the sprite-frame
   *  point `(adjX, adjY)` into the wasm's world hit space and requires
   *  the point-in-path test to resolve to THIS actor — canonical
   *  silhouette + correct actor-vs-actor overlap, no CPU alpha map. */
  actorAlphaHit(id: number, adjX: number, adjY: number): boolean {
    const i = this.indexOf.get(id);
    const gen = this.gen;
    if (i == null || !gen || !this.setup || !this.active) return true;
    const r = getVelloRenderer() as unknown as CrowdVelloApi | null;
    if (!r?.crowdHitTest) return true;
    const wx =
      this.xy[i * 2] * this.setup.posScale +
      this.setup.offX +
      (adjX - gen.anchorX[i]);
    const wy =
      this.xy[i * 2 + 1] * this.setup.posScale +
      this.setup.offY +
      (adjY - gen.anchorY[i]);
    try {
      return r.crowdHitTest(wx, wy) === i;
    } catch {
      return true;
    }
  }

  /** Player ids the crowd is currently rendering (so the caller hides
   *  exactly their per-player main sprites). */
  getRenderedIds(): number[] {
    return this.active ? this.order : [];
  }

  /** Zoom settle → new bake density. Milli-quantized exact float; a
   *  change re-fits every cell on the NEXT sync tick (no roster
   *  debounce — this is the "zoom re-renders actors like tiles" path). */
  setResolution(res: number): void {
    const milli = Math.round(Math.max(0.5, res) * 1000);
    if (milli === this.resMilli) return;
    this.resMilli = milli;
    this.refitPending = true;
  }

  /** Drive the crowd for this tick from the live snapshot. */
  sync(snapshot: CrowdPlayerSnapshot[]): void {
    const r = getVelloRenderer() as unknown as CrowdVelloApi | null;
    if (!r?.realCrowdSetup) return;

    const eligible = snapshot.filter(isEligible);
    if (eligible.length === 0) {
      this.hideAll();
      return;
    }

    const key = eligible
      .map((p) => p.id)
      .sort((a, b) => a - b)
      .join(",");
    if (key === this.rosterKey) {
      if (this.refitPending) {
        // Same roster, new density or cell misfit: rebuild NOW. The
        // zoom path is debounced upstream; deferring here was the
        // "zoom doesn't re-render actors" bug.
        this.rebuild(r, eligible, key);
        return;
      }
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
      // bots stay visible. Bots that JOINED this tick are temporarily
      // invisible (not in `order`); they appear at the next rebuild.
      if (this.setup) this.updateAndRender(r, eligible);
      return;
    }
    this.rebuild(r, eligible, key);
    this.pendingRosterKey = "";
  }

  setEnabled(on: boolean): void {
    if (!on) {
      this.teardown();
    }
  }

  destroy(): void {
    this.teardown();
    const g = globalThis as Record<string, unknown>;
    if (g.__crowdSlabStats) delete g.__crowdSlabStats;
  }

  getLastRenderMs(): number {
    return this.lastRenderMs;
  }

  // ── internals ────────────────────────────────────────────────────

  /** Full stop: free the wasm crowd, destroy sprites, retire every
   *  generation's pages (2-tick settle). Used by disable + destroy. */
  private teardown(): void {
    const r = getVelloRenderer() as unknown as CrowdVelloApi | null;
    try {
      r?.realCrowdFree();
    } catch {
      // Re-entrancy guard; the deferred-disable path calls us post-tick,
      // but be safe against direct console-driven teardowns.
    }
    for (const sp of this.spriteById.values()) sp.destroy();
    this.spriteById.clear();
    this.freshIds.clear();
    const gens = this.gen ? [...this.prevGens, this.gen] : [...this.prevGens];
    const orphans = this.orphanedGens;
    this.prevGens = [];
    this.orphanedGens = [];
    this.gen = null;
    // Full teardown: the sprites are gone, so after the 2-tick settle
    // the Pixi wrappers (including the orphaned ones parked by
    // `retireGeneration`) can be destroyed for real.
    setTimeout(() => {
      for (const g of [...gens, ...orphans]) {
        for (const t of g.textures) t.destroy();
        for (const s of g.sources) s.destroy();
        // Idempotent for orphans (already freed at retire).
        for (const id of g.textureIds) freeRenderTexture(id);
      }
    }, RETIRE_DELAY_MS);
    this.order = [];
    this.indexOf.clear();
    this.rosterKey = "";
    this.pendingRosterKey = "";
    this.refitPending = false;
    this.setup = null;
    this.lastLook.clear();
    this.active = false;
  }

  /** Destroy a generation's Pixi + GPU resources after the 2-tick
   *  settle (Step-2 retire pattern: cell textures, page sources, then
   *  `freeRenderTexture` — patched-wgpu needs the explicit destroy).
   *
   *  HARD INVARIANT before destroying: no live sprite may still sample
   *  this generation. Swap accounting normally guarantees it, but a
   *  rebuild storm (spawn burst + zoom + misfit refits overlapping)
   *  can leave a straggler — and ONE visible sprite over a destroyed
   *  `ExternalSource` poisons Pixi's batch bind group (`textureSource1`
   *  null read → every subsequent frame throws → black canvas until
   *  the watchdog halts). Sweep and re-point stragglers to the live
   *  generation (or hide them) first. */
  private retireGeneration(gen: CrowdGeneration): void {
    pushEvent("retire-sched", { gen: gen.id });
    setTimeout(() => {
      let repointed = 0;
      // Validity sweep: a sprite may sample ONLY the live generation,
      // a still-pending previous generation, or EMPTY. Anything else
      // (this retiring gen OR a straggler from an already-freed one —
      // observed once as a solid-magenta cell after a rebuild storm)
      // gets re-pointed before the storage is freed.
      const valid = new Set<Texture>([Texture.EMPTY]);
      if (this.gen) for (const t of this.gen.textures) valid.add(t);
      for (const g of this.prevGens) for (const t of g.textures) valid.add(t);
      for (const [id, sp] of this.spriteById) {
        if (valid.has(sp.texture)) continue;
        repointed++;
        const live = this.gen;
        const i = this.indexOf.get(id);
        if (live && i != null && live.textures[i]) {
          sp.texture = live.textures[i];
          sp.anchor.set(
            live.anchorX[i] / live.cellW[i],
            live.anchorY[i] / live.cellH[i],
          );
          sp.scale.set(1000 / live.resMilli);
          if (!live.swapped[i]) {
            live.swapped[i] = 1;
            live.swappedCount++;
          }
        } else {
          sp.texture = Texture.EMPTY;
          sp.visible = false;
          this.freshIds.add(id);
        }
      }
      pushEvent("retire-fire", { gen: gen.id, repointed });
      // Free the GPU STORAGE (the actual VRAM) — nothing samples these
      // pages anymore. But do NOT `destroy()` the Pixi Texture /
      // ExternalSource objects mid-session: a source destroy emits
      // events that self-destruct its cached batch `BindGroup`s
      // (`resources = null`), and Pixi's batcher can retain/pool a
      // batch that still points at that BindGroup — executing it one
      // frame later crashes the WHOLE render pass (`textureSource1`
      // null read → black canvas until the watchdog halts; reproduced
      // 3× under rebuild storms with the crash landing 1 ms after the
      // destroy, with zero sprites referencing the retired pages).
      // The orphaned JS wrappers are tiny; they're destroyed in one
      // sweep at `teardown()` (map change / disable), when Pixi's
      // scene for them is gone anyway.
      for (const id of gen.textureIds) freeRenderTexture(id);
      this.orphanedGens.push(gen);
    }, RETIRE_DELAY_MS);
  }

  /** True when the player's look differs from the last committed state. */
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
      prev.scaleX !== p.scaleX ||
      prev.scaleY !== p.scaleY ||
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

  /** Commit the player's current look into the retained `LookState`. */
  private storeLook(p: CrowdPlayerSnapshot, prev?: LookState): void {
    const state = prev ?? {
      bundle: "",
      export: "",
      flipped: false,
      c1: 0,
      c2: 0,
      c3: 0,
      scaleX: 100,
      scaleY: 100,
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
    state.scaleX = p.scaleX;
    state.scaleY = p.scaleY;
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

  /** Mint a new generation: wasm re-setup (new pages + cells at the
   *  current density) + Pixi adoption. The OLD generation's pages stay
   *  alive and sampled (frozen last pose) until each actor's first
   *  rendered frame lands in the new one — `realCrowdFree` is NOT
   *  called here (its old views drop safely: pages were extracted
   *  before any view existed). */
  private rebuild(
    r: CrowdVelloApi,
    eligible: CrowdPlayerSnapshot[],
    key: string,
  ): void {
    // Stable order = sorted by id (matches the roster key derivation).
    const sorted = [...eligible].sort((a, b) => a.id - b.id);
    this.order = sorted.map((p) => p.id);
    this.indexOf.clear();
    this.order.forEach((id, i) => this.indexOf.set(id, i));
    this.xy = new Float64Array(sorted.length * 2);
    this.frames = new Uint32Array(sorted.length);
    this.lastLook.clear();

    // Coordinates are passed in WORLD units; the wasm multiplies by
    // `pos_scale = resolution` and bakes each look at `resolution/20`,
    // so cells are at display-zoom density. Sprites mount at
    // `scale = 1/resolution` so texture pixels map back to world units
    // 1:1 and the container zoom applies once.
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
        scaleX: p.scaleX,
        scaleY: p.scaleY,
        x: p.x,
        y: p.y,
        acc: p.acc,
      };
    });

    const cap = Math.min(getMaxTextureSize() || 8192, 8192);
    const resolution = this.resMilli / 1000;
    const info = r.realCrowdSetup(setupPlayers, cap, resolution, true);
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
      posScale: info.posScale ?? resolution,
      pages: info.pages ?? 1,
    };
    this.rosterKey = key;
    this.refitPending = false;

    this.adoptGeneration(r);
    this.updateAndRender(r, eligible);
    log.info(
      `generation ${this.genSeq}: ${eligible.length} actors, ${this.setup.pages} page(s), res ${resolution}`,
    );
  }

  /** Adopt the freshly-set-up atlas: page `ExternalSource`s + per-actor
   *  cell textures, and reconcile the stable per-id sprites. */
  private adoptGeneration(r: CrowdVelloApi): void {
    const pixiRenderer = getPixiRenderer();
    if (!pixiRenderer) {
      log.warn("adoptGeneration: no Pixi renderer yet");
      return;
    }
    const atlas = r.crowdAtlasInfo();
    if (!atlas || atlas.count !== this.order.length) {
      // The wasm crowd and our order/gen bookkeeping would be skewed —
      // NEVER render against a mismatched generation (commitSwaps
      // would index past `gen.textures` and hand sprites undefined
      // textures). Force a clean rebuild retry next tick.
      log.warn(
        `adoptGeneration: bad atlas info (count ${atlas?.count ?? "null"} vs order ${this.order.length}) — retrying next tick`,
      );
      this.rosterKey = "";
      return;
    }
    const gen: CrowdGeneration = {
      id: ++this.genSeq,
      resMilli: this.resMilli,
      sources: [],
      textureIds: [],
      textures: [],
      cellW: atlas.cellW,
      cellH: atlas.cellH,
      anchorX: atlas.anchorX,
      anchorY: atlas.anchorY,
      swapped: new Uint8Array(atlas.count),
      swappedCount: 0,
      startedAt: performance.now(),
      pageBytes: 0,
    };
    for (let pi = 0; pi < atlas.pages.length; pi++) {
      const page = atlas.pages[pi];
      const source = new ExternalSource({
        resource: page.texture,
        renderer: pixiRenderer,
        width: page.width,
        height: page.height,
        label: `crowd-page-g${gen.id}-${pi}`,
      });
      source.alphaMode = "no-premultiply-alpha";
      source.scaleMode = "linear";
      source.format = "rgba8unorm";
      source.autoGarbageCollect = false;
      gen.sources.push(source);
      gen.textureIds.push(page.textureId);
      gen.pageBytes += page.width * page.height * 4;
      trackRenderTexture(page.textureId, "crowdAtlasPage");
    }
    for (let i = 0; i < atlas.count; i++) {
      gen.textures.push(
        new Texture({
          source: gen.sources[atlas.cellPage[i]],
          frame: new Rectangle(
            atlas.cellX[i],
            atlas.cellY[i],
            atlas.cellW[i],
            atlas.cellH[i],
          ),
        }),
      );
    }

    // Reconcile stable per-id sprites with the new order.
    const live = new Set(this.order);
    for (const [id, sp] of this.spriteById) {
      if (!live.has(id)) {
        sp.destroy();
        this.spriteById.delete(id);
        this.freshIds.delete(id);
      }
    }
    for (const id of this.order) {
      if (!this.spriteById.has(id)) {
        const sp = new Sprite(Texture.EMPTY);
        sp.label = `crowd-actor-${id}`;
        sp.visible = false;
        this.parent.addChild(sp);
        this.spriteById.set(id, sp);
        this.freshIds.add(id);
      }
    }

    if (this.gen) this.prevGens.push(this.gen);
    this.gen = gen;
    this.active = true;
    pushEvent("adopt", {
      gen: gen.id,
      actors: this.order.length,
      pages: gen.sources.length,
      resMilli: gen.resMilli,
      prevGens: this.prevGens.map((g) => g.id),
    });
  }

  private updateAndRender(
    r: CrowdVelloApi,
    eligible: CrowdPlayerSnapshot[],
  ): void {
    if (!this.setup) return;
    if (!this.gen) {
      // Adoption failed earlier (e.g. Pixi renderer not ready) — retry.
      this.adoptGeneration(r);
      if (!this.gen) return;
    }
    if (this.pendingSlabMode !== null) {
      r.realCrowdSetSlab?.(this.pendingSlabMode);
      log.info(`slab mode ${this.pendingSlabMode ? "ON" : "OFF"} applied`);
      this.pendingSlabMode = null;
    }

    // Index the live snapshot by id; build the flat per-tick uploads in
    // the frozen setup order; collect sparse look changes.
    const byId = this.byIdScratch;
    byId.clear();
    for (const p of eligible) byId.set(p.id, p);

    const looks: Array<Record<string, unknown>> = [];
    for (let i = 0; i < this.order.length; i++) {
      const id = this.order[i];
      const p = byId.get(id);
      const sp = this.spriteById.get(id);
      if (!p) {
        // Eligible last rebuild, gone this tick (despawn before roster
        // rebuild) → hide until the rebuild drops it.
        this.xy[i * 2] = -1e6;
        this.xy[i * 2 + 1] = -1e6;
        this.frames[i] = 0;
        if (sp) sp.visible = false;
        continue;
      }
      this.xy[i * 2] = p.x;
      this.xy[i * 2 + 1] = p.y;
      this.frames[i] = Math.max(0, p.frame | 0);
      if (sp) {
        // The slab renders this actor into its static atlas cell; the
        // sprite carries world movement + per-cell depth so it
        // interleaves with the map's object2 tiles natively.
        sp.position.set(p.x, p.y);
        sp.zIndex = playerZIndex(p.cellId);
        sp.visible = !this.freshIds.has(id);
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
          scaleX: p.scaleX,
          scaleY: p.scaleY,
          acc: p.acc,
        });
      }
    }

    r.crowdUpdatePositions(this.xy);
    r.crowdUpdateFrames(this.frames);
    if (looks.length > 0) {
      const misfits = r.crowdUpdateLooks(looks);
      if (misfits > 0) {
        // A look outgrew its tight cell — re-fit with a fresh
        // generation on the next sync tick (clips at the cell edge
        // until then; the grow-only bundle-max makes the re-fit stick).
        this.refitPending = true;
      }
    }

    this.ensureInlineBake(r);

    const t0 = performance.now();
    this.lastStats = r.realCrowdRenderBatched(BATCH_CAP, 0);
    this.lastRenderMs = performance.now() - t0;

    this.commitSwaps(this.lastStats?.rendered ?? null);

    // The pages were re-rendered in place: invalidate the live sources.
    if (this.gen) {
      for (const s of this.gen.sources) s.update();
    }
    r.tickDeferredDestroys?.(2, 8192);
  }

  /** Cut each sprite over to the live generation's cell on the actor's
   *  FIRST rendered frame in it (wasm `rendered` flags); retire the old
   *  generations once everyone swapped (or the window times out). */
  private commitSwaps(rendered: Uint8Array | null): void {
    const gen = this.gen;
    if (!gen) return;
    // Never index a generation with a skewed order (failed adoption
    // after a wasm re-setup) — `gen.textures[i]` past the end would
    // hand sprites undefined textures.
    if (gen.textures.length !== this.order.length) return;
    const inv = 1000 / gen.resMilli;
    const timedOut = performance.now() - gen.startedAt > GEN_SWAP_TIMEOUT_MS;
    for (let i = 0; i < this.order.length; i++) {
      const id = this.order[i];
      // Missing flags (legacy batch path) count as rendered — the whole
      // page was composed this frame.
      const wasRendered = !rendered || rendered[i] === 1;
      // A fresh sprite becomes showable the first time its cell has
      // real content, regardless of when its swap committed.
      if (wasRendered) this.freshIds.delete(id);
      if (gen.swapped[i]) continue;
      if (!timedOut && !wasRendered) continue;
      const sp = this.spriteById.get(id);
      if (!sp) continue;
      sp.texture = gen.textures[i];
      sp.anchor.set(
        gen.anchorX[i] / gen.cellW[i],
        gen.anchorY[i] / gen.cellH[i],
      );
      sp.scale.set(inv);
      gen.swapped[i] = 1;
      gen.swappedCount++;
    }
    if (
      this.prevGens.length > 0 &&
      (gen.swappedCount >= this.order.length || timedOut)
    ) {
      const gens = this.prevGens;
      this.prevGens = [];
      for (const g of gens) this.retireGeneration(g);
    }
  }

  /** Single-instance INLINE bake: the wasm emit loop bakes each actor's
   *  current `(look|frame)` miss synchronously on the main thread under
   *  the per-frame bake budget — every rendered actor is at its EXACT
   *  current frame; misses past the budget defer a frame (brief pop-in,
   *  wc3's prewarm behaviour). One-time switch. */
  private ensureInlineBake(r: CrowdVelloApi): void {
    if (this.inlineBakeInit) return;
    if (!r.setCrowdOffThreadBake) return;
    this.inlineBakeInit = true;
    r.setCrowdOffThreadBake(false);
    log.info("inline main-thread crowd bake (single instance)");
  }

  private hideAll(): void {
    for (const sp of this.spriteById.values()) sp.visible = false;
    this.active = false;
  }
}
