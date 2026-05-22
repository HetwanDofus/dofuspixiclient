# Render performance — findings & CPU optimisation plan

**Stress profile**: 250 bots, sprite-10/-20/-21/-30/-31/-40/-41/-50/-51/-60/-61/-70/-71/-80/-81/-90/-91/-100/-101/-110/-111/-120/-121, all walking. resolution=3.

## 1 — Headline numbers

| Signal | Steady state | Warmup peak |
|---|---|---|
| fps avg1s | 60 locked | drops to 49 |
| frameMs avg | 16.7 | 22.9 |
| frameMs p99 | 17.7 | 100 |
| bakeDrain perFrame | 1.5–2.9 ms | **381 ms** |
| classAtlas avg per bake | n/a (cache hit) | **258 ms** |
| Renderer-helper CPU (single thread) | 50–55% | **110–124%** |
| Total RSS | 1.85 GB after cooldown | **2.81 GB at warmup peak** |

The class atlas warmup window is the only pain point: 24 unique class atlases × ~258 ms each = ~6 s of serialised Rust work, blocking the rAF queue. Steady state is healthy and the architecture is fine — but warmup is unacceptable, and it’s entirely CPU-bound on **one core**.

## 2 — Real memory usage (from `/Users/grandnainconnu/Desktop/electrobun-process-stats-2026-05-22T20-55-22-656Z.log`)

| Phase | t (s) | totalRSS | mainProc | rendererHelper (52636) | jsHelper (52718) |
|---|---|---|---|---|---|
| Idle login | 2 | 698 MB | 301 | 168 | — |
| Map loaded | 12 | 1.38 GB | 351 | 357 | 317 |
| First class bakes | 14 | 2.02 GB | 351 | 888 | 353 |
| Bake burst (peak CPU) | 22 | 2.20 GB | 354 | 1036 | 400 |
| 250 bots active | 30 | 2.42 GB | 295 | 1249 | 481 |
| Stress at saturation | 58 | **2.81 GB** | 302 | 1416 | 677 |
| Stress ended | 64 | 1.85 GB | 279 | 661 | 609 |

**RSS = 2.81 GB at peak.** The renderer-helper process (which hosts the Vello WASM runtime and the Pixi GPU-side bookkeeping) climbs to **1.42 GB** — that's the Vello render cache (`swf_render_caches` is doc-scoped + persistent), the Pixi `ImageSource` bitmap proxies, and the WASM linear memory. The JS thread (52718) climbs to **677 MB** for the bake-queue, ActivePlayer state, accessory cache, etc. Main bun process stays flat at ~300 MB.

After the stress test ends and bots are detached, the renderer-helper drops from 1.42 GB → 661 MB (–760 MB freed). The JS helper drops from 677 → 609 MB. So the "live working set" steady-state is ~1.27 GB; the warmup spike is real and recovered.

The note that `pixi.gpu = 5.5 GB` from the stress JSON is **GPU-side bookkeeping in shared GPU memory**, separate from process RSS. The macOS WindowServer reports `gpuRssMB = 0` because we don't have a dedicated GPU process being polled.

## 3 — CPU breakdown (the data-driven verdict)

Per-class breakdown (from Rust-side instrumentation, average across 24 classes):

| Phase | Mean ms | % of total | What it actually does |
|---|---|---|---|
| **scene encoding** (CPU) | **240** | **90.6%** | Walk SWF display list per `(variant × frame × band)`, emit ~20–40 k Vello `scene.fill()` calls into the Vello encoding stream |
| render submit (CPU+GPU dispatch) | 14 | 5.3% | Vello `render_to_texture` (encode compute commands + queue.submit) for colour + zone temps, per variant |
| combine + copy | 1 | 0.4% | `CombineBodyPipeline` fullscreen pass + `copy_texture_to_texture` into page sub-rect |
| bridge | 2 | 0.8% | Final per-page `texture_to_bitmap` (canvas surface present + `transferToImageBitmap`) |
| enumerate | 10 | 3.8% | `swf_bundle_exports`, `swf_anim_frame_count`, slot/band layout, bin-pack |

`pixiUpload` (Pixi `ImageSource.uploadAndCloseBitmap`) is well under 1 ms per class and stays flat — JS wrap cost is negligible.

**Per-variant** (from the same instrumentation, sprite-10 representative):

| Anim type | Variants per class | Frames | Bands | sceneBuild per variant | render submit per variant |
|---|---|---|---|---|---|
| walk* | 5 dirs × 4 dims = 20 | 8 | 5 | **7–10 ms** | 0–1 ms |
| run* | 5 dirs × 4 dims = 20 | 5–8 | 5 | **4–7 ms** | 0–1 ms |
| static* | 5 dirs × 4 dims = 20 | 1 | 5 | **0–1 ms** | 0–1 ms |

Per `render_body_band` call: ~0.15 ms (= 8 ms / 40 calls). **The cost is per call**, not per output pixel — render submit is essentially free at these dimensions. Per call we’re paying:

1. `build_frame_state` — walk the sprite’s display list at the requested frame (~30 placements typical), apply per-placement matrix composition
2. Path resolution per placement — already shape-flatten-cached by `swf_render_caches`
3. Vello `scene.fill(...)` for each shape — append path tags, path data, draw tag, draw data, transform to the scene’s `Encoding` byte streams

Profiling (renderer-helper at 110–124% CPU, isolated single-thread) means **one CPU core is the entire bake throughput**. We have 7+ idle cores. The rendering helper is *not waiting on GPU*; it is *waiting on its own CPU work in WASM*.

## 4 — Where the redundancy is

### 4a. Variant blow-up from over-permissive `body_has_toggle_sprite`
For 11 of 24 classes, the Rust enumeration baked **52 variants** (full hat × bFix cross product) when the body has no actual hair-toggle behaviour. The legacy memory notes confirm only Iop has the canonical `mcToHide` hair toggle, but `body_has_toggle_sprite` matches *any* multi-frame sub-sprite that swaps children. False positives double the variant count for those 11 classes.

Per-class cost: half of 240 ms = **120 ms wasted scene encoding × 11 classes = 1.32 s** of pure CPU waste per warmup, plus ~110 MB × 11 = ~1.2 GB of GPU memory holding pixel-identical duplicates.

### 4b. Per-band redundant tree walks
`render_swf_class_atlas` calls `render_body_band` once per `(variant × frame × band)`. For 5 bands per variant, each frame is walked **5 times** through the SWF display list. The walk filters to the band’s depth range and emits only the in-range placements’ fills — but the walk itself (frame state build + matrix composition) is independent of the band.

If the walk cost is even 30% of `render_body_band`, sharing the walk across all 5 bands per frame saves **0.3 × 4/5 = 24%** of scene encoding time → drops 240 ms → **~182 ms per class.**

### 4c. Static-by-construction variants encoded redundantly
A `staticS` variant baked with `applyBFix=false` and `applyBFix=true` produces *literally the same pixels* unless any mount declares `b_fix=true` AND is placed at frame 0. The Rust enumeration uses bundle-level `b_fix_used` to expand the dimension — but for non-flipped exports of bodies whose bFix mount only appears in walking poses, the static* variants are identical.

Today: ~5 dirs × 2 bFix × 2 hat = 20 static variants per class. Many are byte-identical. Per-export bFix/hat analysis would collapse half of static’s variants.

### 4d. Class atlas LRU eviction-rebake cycle
`bodyEntries=24` (stable live set) but `classAtlas count=34` in warmup window 1 = **10 redundant re-bakes** caused by refcount-transient eviction. Each re-bake = 257 ms → **2.57 s of fully wasted work** in the first 5 s.

### 4e. `enumerate` cost is too high for what it does (10 ms / class)
`swf_bundle_exports` returns the FULL export list and we filter to character-anim names by string prefix match. For sprite-10 with 132 exports, that’s 132 string comparisons + 132 lookups + 132 `swf_anim_frame_count` recursions. Could be cached per-bundle.

## 5 — CPU optimisation paths (ranked by data-driven ROI, **not caching**)

### Tier 1 — Eliminate redundant work (algorithmic wins, no parallelism, no caching)

#### Opt-1: Tighten `body_has_toggle_sprite` to the canonical Iop pattern
**Location**: `rust/swf-spike/src/render/slot_depths.rs::body_has_toggle_sprite`

Current logic: returns `true` if any descendant sprite has `num_frames > 1` and swaps children between frames. Too permissive.

Fix: walk only the slots that the body explicitly designates as `applyAccessory(slot=1)` mounts (the hair slot). Check whether the placed character at that depth is a multi-frame sprite. Only Iop's vanilla body has this.

**Expected impact**: ~11 classes drop from 52 → 26 variants. Scene encoding for those classes halves: 240 → 120 ms. **Average class bake: 258 → 188 ms (–27%).** Memory drops ~1.2 GB GPU.

**Risk**: low. The variants we’re collapsing are byte-identical (the toggle never fires for non-Iop bodies). Pure deduplication.

**Effort**: 1 hour. ~20 LOC.

#### Opt-2: Per-export bFix detection
**Location**: same file, new function `export_uses_b_fix(doc, body_symbol)`

Today: bundle-level `b_fix_used` expands the bFix dimension for ALL exports of the class. Many exports never use bFix mounts (e.g., static poses if the cape is only placed in walking frames).

Fix: per-export, walk the display list at any reachable frame; check if any placement’s `accessory_mounts` contains a `b_fix=true` entry. If none, the variant is byte-identical regardless of `applyBFix` → collapse.

**Expected impact**: Static variants likely collapse universally (the cape mount is rarely at frame 0). ~10 static variants per class × 11 classes = 110 fewer variants. **Average class bake: –10–15 ms.**

**Risk**: low. Same deduplication argument as Opt-1.

**Effort**: 2 hours. ~40 LOC.

#### Opt-3: Single-pass per-frame band rendering
**Location**: `rust/swf-spike/src/render/band.rs::render_body_band` and `rust/vello-wasm/src/lib.rs::build_class_variant_scene`

Today: per `(frame, band)`, we walk the SWF display tree from scratch. For 5 bands per frame, that’s 5 redundant tree walks. The walk’s `build_frame_state` (which composes per-placement matrices and resolves character refs) is band-independent.

Fix: add `render_body_bands_multi(ctx, doc, sym, scenes: &mut [Scene; 5], xform, frame_idx, bands: &[BandRange; 5], mode, ...)`. Walk the tree once; for each visited placement, determine which band it belongs to (depth lookup) and emit the fill into the appropriate scene.

**Expected impact**: 5 walks → 1 walk per frame. If walk overhead is 30% of `render_body_band` cost (educated guess based on the cost of `build_frame_state` being a recursive hashmap-backed walk), this saves **0.3 × 4/5 = 24%** of scene encoding. **Class bake: 240 → 182 ms.**

**Risk**: medium. The band filter currently happens inside the recursive sprite walker — we need to thread an array of scenes through the same walker and pick the destination per-placement instead of pre-filtering the input.

**Effort**: 1 day. Touches `render_body_band` + callers + WgpuCtx wiring.

#### Opt-4: Class atlas eviction hold during warmup ramp
**Location**: `apps/electrobun/src/game/render/character-cache.ts::evictIfOverCap`

Today: when the last bot of a class detaches (e.g., during bot ramp where bot N+1 supersedes bot N’s applyAnimation request), the refcount transiently hits 0 and LRU candidates the entry. If `classAtlasBytes > capBytes` at that moment, the entry is evicted before the next applyAnimation hits.

Fix: hold a "warmup pin" on every freshly-baked class atlas for N seconds OR until M bots have committed against it. Alternative: don’t LRU-evict class atlases at all — let only accessories evict; class atlases live forever until `clearAll` or manual purge.

**Expected impact**: ~10 re-bakes × 257 ms = **2.57 s saved during warmup.** Steady state unchanged. Memory: +0 (the entries were already live in the live set).

**Risk**: low. The "evict class atlas to make room for accessories" path doesn’t actually help — accessories are 100× smaller than class atlases.

**Effort**: 1 hour. ~20 LOC in `evictIfOverCap`.

#### Opt-5: Move enumerate work out of the bake hot path
**Location**: `rust/vello-wasm/src/lib.rs::render_swf_class_atlas` (the enumerate-variants section)

10 ms × 24 classes = 240 ms of pure CPU on every warmup. This includes `swf_bundle_exports` (returns Vec<String> for the whole bundle), per-export `is_character_anim_name` filter, `swf_anim_frame_count` recursion, `body_has_toggle_sprite`, `extract_slot_depths`.

Fix: at `loadSwfBundle` time (already on the "load" path which is async), precompute the variant table for the bundle (anim names × directions × dims) and stash it on `SwfDoc`. The class atlas bake reads the prepared table.

**Expected impact**: –10 ms per class × 24 = **240 ms saved per warmup**. The amortised cost moves to bundle load (already async-friendly).

**Risk**: low. Pure precomputation.

**Effort**: 2 hours.

### Tier 2 — Cheaper per-call hot path (micro-optimisation in `render_body_band`)

The 0.15 ms / call cost is paid 2000–5000 times per class atlas. Per-call wins compound.

#### Opt-6: Avoid HashMap allocations in `build_frame_state`
**Location**: `rust/swf-spike/src/render/bounds.rs::build_frame_state` (or wherever sprite frame state is materialised)

Likely allocates a `HashMap<depth, PlaceState>` per call. For a typical body with 30 placements, that’s a fresh allocation each call × 2000 calls = 2000 HashMap allocs/sec of bake.

Fix: replace with a stack-allocated `[Option<PlaceState>; MAX_DEPTH]` array, or a thread-local arena. Display-list depths in Dofus 1.29 fit in `u16` and are typically dense in [0, 100].

**Expected impact**: hard to predict without profiling, but allocation-bound code in tight loops is usually 20–40% improvable when moved to stack/arena. If `build_frame_state` is 30% of `render_body_band` and arena-allocating cuts it 50% → **15% of scene encoding shaved.** ~36 ms per class.

**Risk**: low. Allocation pattern change only.

**Effort**: half a day. Profile-guided; profile first with `perf` or wasm-bindgen-test.

#### Opt-7: Inline & specialise the band-filter hot loop
Currently `render_body_band` takes a `BandRange { lo_exclusive, hi_inclusive }` and per-placement decides "is this depth in the band". The check fires per visited placement.

Fix: pre-sort the placements by depth (already kinda done), then take an O(log n) range slice into the relevant depth window, iterate it linearly. Skip out-of-band placements entirely without per-placement match work.

**Expected impact**: ~5% of scene encoding. ~12 ms per class. Compounds with Opt-3 — once we’re doing 1 walk per frame, the per-band slicing happens just once.

**Risk**: low.

**Effort**: 2 hours.

#### Opt-8: Quantise transform/path data to f32 in the scene encoder hot path
Vello’s `Encoding` stores f32 path coordinates already. But our path resolution likely runs through f64 → f32 conversions per fill. Each path has dozens to hundreds of coords; per-fill conversion compounds.

Fix: at flatten-cache write time (in `swf_render_caches`), store path data already in the destination f32 format. Skip per-fill conversion entirely.

**Expected impact**: ~3–5% of scene encoding. ~10 ms per class.

**Risk**: low. Type system change at one boundary.

**Effort**: half a day.

### Tier 3 — Parallelism (the big lever)

**One core is saturated; seven are idle.** The architectural ceiling on a single-threaded WASM scene encoder is the cycles of one CPU. The only way past it is parallelism.

#### Opt-9: WASM workers for parallel class-atlas baking
**Location**: new file `apps/electrobun/src/game/render/bake-worker.ts`, plus changes to `strip-bake-queue.ts`

Strategy:
1. Spin up N worker threads, each with its own copy of the Vello WASM module and its own `wgpu::Device` (the patched fork allows multiple instances).
2. Workers receive `{bundle, exportName, applyBFix, hatEquipped, resolution}` and produce `{combinedBitmap, atlasWidth, atlasHeight, variants[...]}` via `postMessage` with `transferable` ImageBitmap.
3. The main thread bake-queue dispatches class atlas bakes round-robin to workers.

Issues to solve:
- **SWF bundle data**: each worker needs to load SWF bundles. Solution: share the raw bytes via `SharedArrayBuffer`, OR load lazily on-demand per worker (~30 ms each, amortised across many class bakes).
- **GPU device sharing**: WebGPU GPUDevice is per-thread; workers each create their own device. They render to bitmaps and transfer back. Pixi’s render path stays on the main thread.
- **Cache state**: per-bundle `swf_render_caches` becomes per-worker. First bake of a class on a worker is slower (cold cache); subsequent same-bundle bakes are fast. Workers don’t need to share render cache state.

**Expected impact**: 4 workers × 240 ms = ~60 ms wall-clock per class atlas (1 core × 4 workers in parallel). For 24 classes, warmup drops from 6 s to **~1.5 s** — a **4× speedup**. With 8 workers and 8 cores, ~0.75 s warmup.

**Risk**: high complexity. WebGPU multi-thread on Chromium is now stable but has edge cases (resource sharing, lifetime). Pixi uses a separate device — workers’ bitmaps are transferred and then sampled on Pixi’s device.

**Effort**: 1 week. The biggest single win available. The work breaks into: worker harness, message protocol, lifetime management, per-worker WASM init, integration with `strip-bake-queue`.

#### Opt-10: Pipeline encoding and rasterisation across the bake queue
Today: bake N fully completes (encode → render → combine → bridge → bitmap) before bake N+1 starts. The CPU encoding of N+1 could start while GPU rasterises N.

Strategy: split `renderSwfClassAtlas` into `prepareBake → submitRender → presentAndBridge`. The main thread can dispatch `prepareBake` for class N+1 while GPU is busy with N’s render.

**Expected impact**: marginal on single-thread (CPU encoding dominates anyway, GPU is barely loaded), but combines well with Opt-9.

**Risk**: medium. State machine becomes more complex.

**Effort**: half a day. Skip unless Opt-9 is deferred.

### Tier 4 — Quality dial (memory wins, modest CPU wins)

#### Opt-11: Reduce class-atlas resolution from 3 → 2
**Location**: `apps/electrobun/src/game/render/player-strip-renderer-v2.ts::constructor`

Halving each axis cuts pixel count 4×. Scene encoding cost stays roughly the same (path count isn’t scale-dependent) but Vello’s path flattening at lower resolution produces fewer line segments per curve → **~10–15% encoding reduction** + **~50% reduction in Vello render compute work** (less pixel work).

GPU memory: 5.5 GB → ~1.4 GB.

**Expected impact**: class bake –35 ms (–14%). Memory huge. Visual: small AA softness, mostly invisible at default zoom.

**Risk**: visual quality trade-off. User-visible.

**Effort**: 1 line change + visual review.

#### Opt-12: Progressive LOD bake
Strategy: bake every class atlas at resolution=1 first (fast, ~40 ms per class), make bots visible immediately. Queue a resolution=3 refinement bake at LOW priority that swaps in once ready.

**Expected impact**: bots visible in ~1 s of warmup (instead of 6 s). High-quality version lands over the next 5–10 s in the background.

**Risk**: medium. Need to handle the atomic swap from low-res to high-res atlas across all active bots (mid-anim handover).

**Effort**: 2 days.

## 6 — Recommended sequence

**Round 1 — quick wins (1 day total)**:
1. Opt-4 (eviction hold) — 1h, saves 2.5 s warmup
2. Opt-1 (hat-toggle predicate) — 1h, –70 ms per affected class, –1.2 GB GPU
3. Opt-5 (precompute enumerate) — 2h, saves 240 ms warmup
4. Opt-2 (per-export bFix) — 2h, –10 ms per class

**Cumulative impact**: warmup drops from ~6 s to **~2.5 s**. Memory drops –1.2 GB. Zero risk.

**Round 2 — algorithmic (3–4 days)**:
5. Opt-3 (single-pass band rendering) — 1 day, –58 ms per class
6. Opt-6 (arena for `build_frame_state`) — half day, –36 ms per class
7. Opt-7 (band slice instead of filter) — 2h, –12 ms per class
8. Opt-8 (f32 path data) — half day, –10 ms per class

**Cumulative impact**: per-class bake 258 → ~70 ms. Warmup 6 s → ~1.7 s. Hits the plan's "50–100 ms whole-class bake" target.

**Round 3 — parallelism (1 week)**:
9. Opt-9 (WASM workers, 4 threads)

**Cumulative impact**: warmup 1.7 s → **~0.4 s**. The 24-class ramp finishes inside a single rAF burst. fps drops vanish.

**Round 4 — memory polish**:
10. Opt-11 if memory is a problem at the user's hardware tier. Default value flip.

## 7 — Profiling next steps (do this before Round 2)

Round 1 is data-justified by the existing instrumentation. Round 2 needs a finer profile to verify the assumed costs.

Add Rust-side per-phase timing inside `render_body_band`:
- `build_frame_state` ms (the SWF tree walk)
- `render_symbol_with_ctx` ms (the path resolution + scene.fill loop)
- `apply_b_fix` time
- `apply_color_zones` time

Log these per-class as percentages. After Round 1, look at the breakdown to confirm which of Opt-3/6/7/8 has the actual leverage.

## 8 — What we’re NOT going to do (rejected approaches)

- **Cache scene encodings** (the `body_scene_cache` revival). The cap-sizing race destroyed bots in earlier iterations. Even with proper eviction guards, first-bake CPU work is unchanged. Cache only helps re-bakes — Opt-4 (no eviction) already removes the re-bake problem.

- **Per-page merged scene rendering** (already tried). The merged scene overflows Vello's tile encoder per `feedback_vello_scene_overflow`. Per-variant dispatch is the safe path. Render submit is only 5% of total cost anyway; the win wouldn't be visible.

- **Bake everything into a global atlas across classes** (e.g., 16k² mega-texture). GPU texture binding limits + dynamic loadout = batch consolidation gets worse, not better.

- **Move work to GPU** (e.g., Vello scene encoding via compute shader). Vello's encoding is fundamentally CPU; the GPU step is the existing fine.wgsl rasterisation. The bottleneck is encoding, not rasterisation.
