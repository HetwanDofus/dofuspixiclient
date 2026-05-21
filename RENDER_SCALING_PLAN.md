# Render scaling — fixing the long-runtime fps dip

## Status (2026-05-21)

**Memory wins shipped, fps stability still failing.** Memory at
200-bot stress sits at ~3 GB process (down from ~7 GB earlier this
month). Cache stable at ~830 MB, Pixi GPU at ~943 MB, no leaks
visible.

**The dip we still see at 200 bots:**

| t (s) | fps avg | frameMs avg | tickerMsAvg | jsHeap |
|---|---|---|---|---|
| 15 | 60.0 | 16.67 | 0.71 | 116 |
| 20 | 60.0 | 16.67 | 0.71 | 195 |
| 25 | 60.0 | 16.67 | 0.69 | 189 |
| 30 | 60.0 | 16.67 | 0.69 | 195 |
| 35 | 60.0 | 16.67 | 0.70 | 178 |
| 40 | 60.0 | 16.67 | 0.68 | 215 |
| 45 | 60.0 | 16.67 | 0.69 | 174 |
| **50** | **55.96** | **17.03** | **0.68** | **125** |
| 55 | 52.97 | 17.92 | 0.68 | 100 |
| 60 | 53.98 | 18.62 | 0.67 | 232 |

The diagnostic line `tickerMsAvg` measures total time spent in every
`Ticker.shared` callback per frame — Pixi's render, our cache tick,
every ticker listener combined. **It is flat at 0.68-0.71 ms across
the entire run.** It does not grow when fps drops.

`frameMsAvg` grows from 16.67 to 18.62 over 60 seconds (+1.95 ms).
That growth is **outside our ticker callbacks**. Specifically: it's
in the browser's paint+composite phase, the GPU process executing
queued commands, and JS major-GC pauses on the slowly-growing old
space.

## What this proves about the search direction

Past attempts that did NOT move the needle on this dip:

- ❌ Bitmap close strategies (poll → batch-poll → force-upload). All
  bug-free now but none addressed fps.
- ❌ Cache cap tuning (1.5 GB → 800 MB → 1024 MB → 1.5 GB).
- ❌ Color+zone atlas merge. Saved ~600 MB memory but fps trajectory
  unchanged.
- ❌ Accessory animType dedup. Saved ~50% acc entries; fps unchanged.
- ❌ Wasm-crossing memoisation. Eliminated ~75 ms/sec of crossings;
  fps unchanged.
- ❌ Bind group / texture view deferred-destroy counters. Confirmed
  there's no Rust-side leak (`liveBindGroups=0` throughout).

None of these targeted the actual bottleneck because they were all
in the ticker path, which the diagnostic proves is fine.

## What the data points at as the real cause

The 1.95 ms / 60 s growth in browser-side work is consistent with
two factors that both scale with the cumulative count of Pixi
resources active in the WebGPU device:

1. **Per-frame draw call count.** At 200 bots × 4 body bands + ~5
   accessory sprites = ~1800 draws per frame. Each `setBindGroup`
   has ~5 µs of overhead in WebGPU on the browser side. With ~850
   bind-group switches per frame (bands aren't batched), that's
   ~4 ms/frame just for bind-group state transitions. As Pixi's
   internal bind-group cache grows (more unique sources), state
   transition cost increases.

2. **JS heap promotion pressure.** `jsHeap` bounces 100-232 MB.
   That bounce is V8's major-GC freeing ~100 MB of short-lived
   allocations every ~5 seconds. Each major GC pause is 30-50 ms
   = one missed vsync = one slow frame at ~33 ms. `slowFrames1s`
   shows 5 slow frames in 1s at the bottom of the dip — matching
   ~one major GC per 200ms in that window.

Both root causes are confirmed by the data. Each contributes
separately. Fixing one without the other will leave the dip
present but smaller.

## Plan

Two work-streams. Both can land independently; both are required
for stable 60 fps at 200+ bots.

---

### Phase A — Reduce per-frame draw count

**Current state:** 200 bots × 9 draws/bot = 1800 draws/frame.

**Target state:** 200 bots × 2-3 draws/bot = ~500 draws/frame.

**Expected fps impact:** ~3x reduction in setBindGroup overhead,
reducing browser-side per-frame work by ~3 ms. Brings frameMs
ceiling from ~19 ms back to ~16 ms — 60 fps sustained.

#### A.1 Body band merge into a single mesh per bot

**Why bands exist today:** body composition splits into 4-5
Z-ordered bands so accessories can slot between them at correct
depths (e.g., cape behind back, weapon in front of arm).

**The constraint:** if we collapse bands into one draw, accessories
can no longer interleave Z-wise. They have to be either fully
behind or fully in front of the body.

**The escape hatch:** measure what fraction of Dofus accessories
actually need mid-body Z-slotting. Strong hypothesis: in canonical
Dofus 1.29, **the only mid-body accessory is a cape behind the
body's mid Z-plane.** Hats sit above head (front). Weapons sit in
hand (front). Shields sit on back arm (back). The cape's "mid"
position is what motivates the band split.

**The fix:**
1. Define exactly 3 Z slots: `BEHIND` (cape, shield), `BODY`,
   `FRONT` (hat, weapon).
2. Render order per bot: `BEHIND` accessories → 1× body mesh →
   `FRONT` accessories.
3. Per-bot body mesh: single Mesh with one quad covering the full
   atlas region. Drops body draws from 4 → 1 per bot.

**Saves:** 600 draws/frame (200 bots × 3 fewer band draws).

**Visual risk:** accessories that the SWF authored as mid-body Z
are now either fully behind or fully in front. For canonical
characters this is invisible (they don't have mid-body slots
beyond what BEHIND/FRONT covers). For custom mounts and exotic
art, a per-class audit is needed.

**Implementation:**
- `extract_slot_depths.rs` (Rust): return only `behindSlots[]` and
  `frontSlots[]` instead of N depth bands.
- `character-cache.ts`: drop `bands[]`, drop `BodyAtlasBand`, drop
  band slicing in the body atlas wrapper.
- `body-band-shader.ts`: drop band-Y uniform, simplify mesh to
  cover full atlas.
- `player-strip-renderer-v2.ts`: instantiate 1 BodyMesh per slot
  instead of N BodyBandMeshes.
- `swf_body_band_info` Rust function: change return shape
  accordingly.

**Effort:** medium. ~1 day. The data restructure is mechanical;
the visual audit is the gating risk.

**Validation:** A/B comparison render of a canonical character in
isolation (cape + hat + weapon + body) between current and merged
pipelines. Each frame should be pixel-identical. If not, the
unmodified character has accessories slotting at non-{BEHIND, FRONT}
depths and the merge isn't safe for that class.

#### A.2 Accessory sprite batching

**Current state:** each accessory is its own `Sprite`. Pixi v8
batches sprites with the same shader + same texture. Each unique
accessory texture = its own batch. With ~2700 unique acc sources
at stress, batches are ~16-source wide → ~170 batches.

**Target state:** Pixi batching is already doing what it can; the
remaining lever is to **reduce unique accessory texture count**.

**Already shipped:** animType dedup (cut acc entries ~50%).

**Remaining options:**
- **Per-slot texture atlasing.** Pack multiple accessories' frames
  into one atlas keyed by `(slot, dir)`. Different bots referencing
  the same slot use the same atlas with different UVs → all in one
  batch.
- Cost: rebuild atlas when a new acc is added. Cache eviction in
  current cache becomes evict-and-repack. Complex.

**Recommendation:** defer until A.1 lands. A.1 cuts draws by ~3 ms.
Accessory batching's residual win is ~0.5 ms — same scope of work
but smaller payoff.

#### A.3 Render-to-texture per-bot composition (architectural fallback)

If A.1 visual audit fails (accessories DO slot mid-body in some
classes) AND we need 60 fps sustained at 200+ bots, the fallback is
per-bot composition:

1. For each bot, on anim-frame change, render `body + accessories`
   into a single per-bot RenderTexture in one render pass.
2. Per main-render frame: draw 1 sprite per bot from its cached
   RenderTexture.
3. Result: 200 draws/frame total (down from 1800).

**Cost:**
- 1 composition per bot per anim-frame change. At 12 fps anim ×
  200 bots = 2400 compositions/sec. Each composition is ~0.1 ms
  GPU-side (very light, no shader work, just texture copies).
  ~240 ms/sec CPU work.
- Memory: 200 × ~256×256 RGBA = ~50 MB GPU. Acceptable.

**Trade-off:** 240 ms/sec CPU vs ~3 ms/frame win from current
~1800 draws. Composition wins if GPU per-frame ceiling is the
bottleneck (which the diagnostic suggests it is).

**Effort:** large. ~2-3 days. Multi-app-renderer plumbing, RT
lifecycle, eviction-on-anim-change.

---

### Phase B — Reduce JS GC pressure

**Current state:** jsHeap bounces 100-232 MB at 200 bots.
~100 MB of garbage collected per major GC cycle, every ~5 seconds.
Each major GC = 30-50 ms pause = 1-3 missed vsyncs.

**Target state:** keep jsHeap stable below 100 MB, major GC every
~30 seconds. ~1 missed vsync per 30 seconds = effectively invisible.

**Expected fps impact:** removes the spike component of frameMs
(p99 33ms → 17ms). Doesn't fix the sustained 18ms — that's A's job.

#### B.1 Audit per-frame allocation hot paths

**Suspects in priority order:**

1. **Pixi v8 batcher's vertex/index buffer rebuilds.** Each frame,
   Pixi rebuilds the batch's vertex array. With ~1800 sprites × 4
   vertices × 8 floats = ~230 KB of Float32Array per frame. If
   Pixi's buffer pool fits, no allocation. If it has to grow, a
   new TypedArray is allocated per frame.
2. **Per-bot animation tween allocations.** Every player.tick
   creates Point or similar small objects.
3. **Stress test movement loop's Promise.race per iteration.**
   `cancelled.then(() => "cancel")` allocates a Promise per
   movement iteration × 200 bots × ~0.5 iterations/sec = 100
   Promises/sec. Small but cumulative.
4. **Bake-queue callbacks.** Each bake adds a callback array
   entry. Cleared on completion but allocates.

**Method:**
- Install Chrome DevTools' allocation profiler during a 60s run.
- Capture top-10 allocation sites by size.
- Bisect those against suspect list above.

**Effort:** small. ~2 hours of profiling, then targeted fixes for
each found source.

#### B.2 Reuse Pixi batcher buffers

If the audit confirms (1) is a top source, the fix is to pre-size
Pixi's batch buffer pool to hold the worst-case per-frame batch
size + 25% headroom. Configurable via Pixi v8's BatchSystem
constructor options.

**Effort:** small. ~30 min change + verification.

#### B.3 Eliminate Promise.race-per-iteration in stress test

**Current pattern in `stress-test.ts`:**

```typescript
const raceCancel = <T>(p) =>
  Promise.race([p, cancelled.then(() => "cancel")]);
```

Each call allocates a new Promise.race + a new `.then()` chain.
After many iterations the cancelled Promise has many attached
callbacks.

**Fix:**
- Cache `cancelAsCancel = cancelled.then(() => "cancel")` ONCE per
  bot. Reuse it in `Promise.race`.
- Or replace with `AbortSignal` pattern: bot's cancel becomes a
  synchronous abort flag checked in movement code.

**Effort:** small. ~30 min.

**Caveat:** this is in the stress test, not in production game
code. It improves stress measurement fidelity but doesn't help
real gameplay. Worth doing because clean stress data is what we
need to validate Phase A.

#### B.4 Verify deferred-destroy tick allocation profile

Our `tickDeferredDestroys` runs every frame, crosses the wasm
boundary, allocates a Float64Array return value. With ~30 pending
textures per tick at warmup, this allocates per-frame. Investigate
whether it can return tuple-of-numbers via JS-side cache instead.

**Effort:** small. ~1 hour.

---

## Measurement protocol

After each phase change, capture a stress monitor dump at 200 bots
for ≥60 seconds. Compare these metrics:

| Metric | Current | Phase A target | Phase A+B target |
|---|---|---|---|
| fps avg @ t=60s | 53.98 | 58-60 | 60 |
| frameMs avg @ t=60s | 18.62 | 16.7-17.0 | 16.7 |
| tickerMsAvg @ t=60s | 0.67 | 0.5 | 0.5 |
| frameMs p99 @ t=60s | 33.7 | 33.7 | 17 |
| slowFrames1s @ t=60s | 3 | 1-2 | 0 |
| jsHeap volatility | 100-232 MB | 100-232 MB | 60-100 MB |

**Acceptance criteria for "fixed":**
- fps avg @ t=300s (5 minutes) stays at 58-60 with no monotonic
  decline.
- frameMs p99 @ t=300s ≤ 18 ms.
- No slowFrames1s consistently > 2.

**Test at 300 bots:** repeat the same protocol. Acceptance is fps
avg @ 60s ≥ 55. 300-bot is the stated production stress target;
500-bot is benchmark-only and outside scope of this plan.

---

## Architectural alternatives if Phase A+B falls short

Reserved for the case where 300-bot stress refuses to hit 55 fps
after both phases land.

### Alt 1: Lower render-resolution / DPR-cap

Drop the canvas DPR cap from 2 to 1.5 (or 1.0 in zoomed-out mode).
Halves compositor cost, halves GPU fragment shader work. Visible
detail loss at native resolution.

### Alt 2: Render bots to a worker thread

Pixi v8 supports offscreen-canvas rendering. Move all bot rendering
to a worker; the main thread does HUD + UI only. Removes main-thread
contention but adds a transfer cost per frame.

### Alt 3: Cull off-screen bots

Don't render bots outside the viewport. Trivial at the cost of one
visibility test per bot per frame. Saves draws proportionally to
camera zoom. Currently we render all 200 bots regardless of camera;
typical viewport at 1× zoom holds 30-50 bots.

This is probably the highest-payoff alternative if Phase A struggles.

---

## What we explicitly do NOT do, and why

- **No Pixi version downgrade or fork.** Pixi v8 internals have
  bugs we hit (bind group layout extraction, ImageBitmap detach
  race) but we've worked around them. Forking creates a long-term
  maintenance burden disproportionate to the wins.
- **No reverting the bridge migration.** Memory is in a good place
  now. Going back to shared-GPUDevice + ExternalSource would mean
  re-introducing the patched-fork dependency for memory accounting
  that we now handle via deferred-destroy.
- **No texture compression (BC1, ETC, ASTC).** The texture memory
  ceiling is no longer the bottleneck — Pixi GPU at 943 MB out of
  ~4 GB device memory is fine. Compression saves memory but
  doesn't help fps.
- **No further accessory key dimension dedup.** AnimType dedup gave
  ~50%; further reductions hit diminishing returns. Each remaining
  dimension corresponds to a real visual difference.

---

## Why this plan and not earlier ones

This is the fourth iteration. Previous plans (now deleted):
`STEP_11_BRIDGE_NOTES.md` (bridge migration — completed),
`OFFSCREEN_CANVAS_BRIDGE_PLAN.md` (Path B — superseded by what
shipped). Both were memory-focused. The current plan is the first
that's grounded in **measured per-section frame timing**
(`tickerMsAvg`), which is what conclusively isolated the bottleneck
to draw count + GC pressure rather than to anything in our app code.
