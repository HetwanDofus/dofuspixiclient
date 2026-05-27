# Vello-direct character rendering — findings

Investigation into whether a **Vello-direct** character pipeline (render each
Dofus 1.29 SWF character as a vector scene, batched, the way Flash did) can
replace the current **cache/atlas** architecture (`PlayerStripRendererV2` +
`SharedInputAtlas` + `SharedCompositionAtlas`).

Targets: 200–250 players @ 60fps, no dips, canonical rendering, modest RAM.

All numbers below are **measured** in headless Chrome on an M-series, 16 logical
cores, via temporary diagnostic hooks in `rust/vello-wasm/src/lib.rs` +
`apps/electrobun/src/game/render/vello-loader.ts`. Player looks are the real
24 character-class gfx (10, 11, 20, 21, … 120, 121) with real equipped
accessories, real colors, real isometric positions.

---

## TL;DR

1. **Retaining encoded vector geometry is the whole game.** Re-encoding the
   scene every frame (naive Flash redraw) is **~53ms/frame @ 201 actors (≈19fps)**
   — encode-bound. Caching each unique `(look, frame)` encoded `vello::Scene`
   once and `scene.append`-ing it per frame is **~4.9ms/frame @ 201 (≈200fps)**
   — **11× faster**. This is exactly what Flash's *retained display list* did;
   Vello re-encodes from scratch unless you retain.
2. This retained cache is **not** the rejected pixel/composition atlas (thrash,
   leaks, ~3GB). It is a tiny **encoded-vector** cache — **8,692 entries for 201
   unique looks**, and that count is bounded by *unique looks*, not actor count
   (800 and 1500 replicated actors → still 8,692).
3. **For the 200–250 target the architecture is validated**: ~4.9ms/frame,
   60fps+ with huge headroom, correct canonical rendering, tiny RAM.
4. **Scaling** (measured, end-to-end, non-empty renders): 800 → 60fps+ with
   CPU↔GPU pipelining; 1500 → ~36fps, **build-bound** (single-threaded append).
5. Two correctness root-causes were found and fixed (canonical band-interleave
   mounting + per-bundle caches), and three engineering hazards were
   characterized (resource lifetime, readback poison, texture leaks).

---

## 1. Retained vs naive (the core result)

Head-to-head, 201 animated characters (walk cycles), clean (live render path
halted so nothing competed):

| model | per-frame CPU | fps | encode work |
|---|---|---|---|
| **naive** (re-emit + re-encode every frame) | **53 ms** (p99 80) | ~19 | every frame |
| **retained** (encode once, `scene.append` per frame) | **4.9 ms** (p99 7) | ~200 (63 rAF-capped, measured) | one-time (7,048 sub-scenes), steady-state ~0 |

- The naive cost is **scene encoding** (~0.2ms × 201 looks), *not* GPU (~3ms)
  and *not* shape flattening (already memoized per-bundle). Flash hit 60fps
  redrawing every frame because it retained encoded geometry; Vello must too.
- Retained: each unique `(bundle, export, frame, flipped, colors, accessories)`
  is emitted into a `vello::Scene` once (lazy, on first use), then every frame is
  pure `scene.append(cached, transform)`. After one anim cycle, **zero re-encode**.

## 2. Canonical correctness (two bugs fixed)

The character look is body **bands** interleaved with **accessories** at the
mount depths declared by `GAC.applyAccessory(this, slot, side)` in
`assets/sources/client-code/ank/battlefield/GlobalSpriteHandler.as` (accessory
attaches at depth 10 inside a named mount clip → **z-order = the mount clip's
depth among the body parts**: cape behind, hat in front).

- **Bug 1 — wrong render path.** The first implementation used the inline
  `render_symbol_with_ctx_tinted_accessorized_bfixed` path; production uses the
  **band-interleave** (emit `band0 → accessory@slot0-mount → band1 → …`, z =
  append order). Fixed by replicating the band interleave with
  `extract_slot_depths` + `band_range` + `extract_mount_transforms` +
  `pick_accessory_frame`.
- **Bug 2 — shared cache id collision (the "10× accessory" bug).** A single
  `RenderCache` shared across bundles returns the wrong flattened shapes for
  colliding symbol ids → giant/wrong accessory geometry. **Per-bundle caches are
  mandatory** (`swf_render_caches.entry(bundle)`), including for each accessory's
  own bundle.
- **Recolor** is baked into the cached per-look encoding (correct for *batched*
  rendering). A deferred recolor-as-shader-pass would need per-pixel
  player→color association, which is impossible in one batched scene without
  per-actor regions — i.e. the atlas-slot machinery we're removing.
- Result: hats on heads, capes/shields at correct mount + z + size, correct
  colors, correct per-direction frames + flip (bFix). Verified visually.

## 3. Scaling — measured, batched, end-to-end (non-empty renders confirmed)

A single `vello::Scene` **overflows its encoder past ~300–400 actors-worth of
shapes** (300 renders fine, 500 renders empty). So high counts must be **batched**:
split the Y-sorted actors into ~250-actor scenes, render each to its own texture
(one Vello dispatch each), then **alpha-composite back-to-front** onto the final
target.

| actors | batches | CPU build | GPU+composite | end-to-end (serialized) | **fps (serialized)** | **fps (pipelined)** |
|---|---|---|---|---|---|---|
| 201 | 1 | 4.9 ms | ~3 ms | ~8 ms | ~125 | — |
| 800 | 4 | 17 ms | ~14 ms | 31 ms | ~32 | **66** |
| 1500 | 6 | 29 ms | ~10 ms | 40 ms | ~25 | **36** |

- **CPU build (single-threaded `scene.append` + submit) dominates at high
  counts** and is linear (~21µs/actor). It crosses the 16.6ms (60fps) budget at
  **~790 actors**.
- GPU+composite is ~10–14ms (includes full-size batch-texture clears; a
  content-bbox-bounded batch would reduce it).
- The composite requires the target texture to have **`RENDER_ATTACHMENT`** usage
  (the composite writes via a render pass, not Vello's STORAGE compute write) and
  a **straight-alpha SrcAlpha/OneMinusSrcAlpha "over"** blend, composited in
  batch order (back-to-front) to preserve global Y-sort.

## 4. Parallelization

Two levers (multi-worker WebGPU is **not** one — GPU contention is harmful and
WebGPU textures don't transfer across workers):

- **(A) CPU↔GPU pipelining** — don't block on the GPU each frame (build frame
  N+1 while the GPU renders frame N). **Measured:**

  | actors | serialized fps | pipelined fps | speedup |
  |---|---|---|---|
  | 800 | 34.8 | **66.0** | 1.9× |
  | 1500 | 24.8 | **35.8** | 1.44× |

  This alone takes **800 actors over 60fps**. 1500 stays build-bound.

- **(B) Multi-core build (wasm-threads)** — *BUILT + measured*. `wasm-bindgen-rayon`
  thread pool (8 threads), `into_par_iter` builds each batch's scene on its own
  core; render + composite stay single-threaded on the one GPU device. Renders
  verified correct (non-empty, workers reading the shared cache). **Measured
  (simd128 + threads, ~8 batches = thread count):**

  | actors | serial build | parallel build | speedup | serial fps | parallel fps |
  |---|---|---|---|---|---|
  | 800 | 20.5 ms | **15.6 ms** | 1.31× | 49 | **64** |
  | 1500 | 39.9 ms | 34 ms | 1.17× | 25 | 29 |

  **Modest, and Amdahl-bound.** Parallelizing the `scene.append` shifts the
  bottleneck onto the **serial per-frame work that can't be parallelized on a
  single GPU device**: the N `render_to_texture` submits + the N-pass composite +
  per-frame bookkeeping. With simd128 the build is already fast, so that serial
  fraction is relatively larger → lower ratio. Batch count should equal the
  thread count: fewer batches under-uses cores; more batches (e.g. 14) add serial
  submit/composite overhead that erases the gain (measured 1.05× at 14 batches).
  800 crosses 60fps on the parallel build; 1500 needs more (finer parallelism of
  the submits, or a second GPU-submission strategy).

  **Infra cost (real, now documented):** nightly ≥1.92 + `-Z build-std` +
  `+atomics,+bulk-memory,+mutable-globals`, **and the linker flag set that took
  the most iteration:** `--import-memory --shared-memory --max-memory=4294967296`
  (imported shared memory — wasm-bindgen 0.2.121 asserts `mem.import.is_some()`)
  **plus** force-exporting the thread-init symbols that recent wasm-ld no longer
  auto-exports under `--import-memory`: `--export=__heap_base`,
  `--export=__wasm_init_tls`, `--export=__tls_size`, `--export=__tls_align`,
  `--export=__tls_base`. Plus COOP/COEP headers (`Cross-Origin-Embedder-Policy:
  credentialless`) for SharedArrayBuffer, and `await initThreadPool(n)` after
  wasm init. wasm-opt must be disabled (binaryen mangles atomics without
  `--enable-threads`). wasm-pack can't forward `-Z build-std`; build with
  `cargo +nightly build` then `wasm-bindgen` directly.

**Combined:** lever A (pipeline, 1.9× @800) overlaps GPU with the lever-B
parallel build, so the practical ceiling is ~`1000 / max(parallel_build, GPU)`.
At 800 that's ~64fps. The single GPU device + serial composite is the structural
ceiling beyond ~800 — the next real lever is reducing the serial submit/composite
cost (content-bbox batch textures, fewer/cheaper composite passes), not more cores.

## 5. Engineering hazards found (must-fix for production)

1. **GPU-resource lifetime.** Cached `vello::Scene`s reference transient GPU
   resources (image-fill / filter intermediates) that get recycled after a few
   hundred `render_to_texture` calls under the **patched wgpu** (no-op texture
   `Drop`) → renders silently go **empty** after ~1s of sustained rendering. All
   measurements above were taken within that budget (modest warm + short window +
   a non-empty validity check). **This is the #1 blocker for sustained rendering**
   and must be fixed (self-contained scenes / pinned resources) before shipping.
2. **Readback poison.** `texture_to_bitmap` (blit-to-canvas readback) leaves the
   target in a state the **next** `render_to_texture` can't write → any render
   after a readback comes out empty. Implication: **display via a Pixi-adopted
   texture (no readback)** — which is how the live game already shows Vello
   output. Readback is only safe as a one-shot (or render-all-then-readback, as
   in the flipbook capture).
3. **Texture leaks.** Internal target/scratch textures leak under the patched
   wgpu's no-op `Drop`; production must retire them via `freeRenderTexture`.

## 6. Verdict

- **200–250 target: validated.** Retained Vello-direct = ~4.9ms/frame, 60fps+
  with large headroom, canonically correct, tiny RAM (8.7k vector entries +
  small target). The cache/atlas architecture is unnecessary for this range.
- **800 actors:** 60fps+ with CPU↔GPU pipelining + batched composite (and the
  multi-core build holds it at 60fps even serialized).
- **1500 actors:** ~36fps (pipelined) / ~29fps (multi-core build, serialized).
  Multi-core build was built + measured but only ~1.2× here — the wall past ~800
  is the **serial GPU-submit + composite on one device**, not core count.
- The right architecture: **retained encoded-vector cache** (per
  `(gfx,anim,dir,frame,colors,acc)`, shared across identical looks) →
  **`scene.append` per frame** → **batched render + alpha composite** above
  ~300 actors → **CPU↔GPU pipeline** → (optional) **multi-core build** for very
  large crowds. No pixel atlas, no composition atlas, no eviction thrash.

### Remaining work, in priority order
1. Fix the GPU-resource-lifetime bug (the only thing blocking sustained render).
2. Display via Pixi-adopted texture (no readback) + `freeRenderTexture` discipline.
3. Productionize: replace `PlayerStripRendererV2` with the retained cache +
   batched composite; wire CPU↔GPU pipelining.
4. (For >800) the lever is **reducing serial submit/composite cost** (content-bbox
   batch textures, fewer composite passes), NOT more cores — multi-core build is
   already implemented (`--features threads`, wasm-bindgen-rayon) but Amdahl-bound
   at ~1.2–1.3× because the per-frame serial work (GPU submits + composite on one
   device) dominates once the build is parallelized.

Note: the threaded build is a separate artifact (`--features threads` + the
linker-flag recipe in §4 + COOP/COEP). The normal production build is unaffected —
build without `--features threads` and it's the standard single-thread + simd128 wasm.

---

## Appendix — measurement harness (temporary diagnostics, to remove/productionize)

Rust (`rust/vello-wasm/src/lib.rs`), on `VelloRenderer`:
- `emit_player_look(...)` — emits one full look (band-interleave + accessories at
  real mounts, recolored) into a `vello::Scene`. Shared by all paths.
- `realCrowdSetup(players, targetDimMax, resolution, retain)` — parses real
  per-player look specs, fits a target, pre-computes look signatures.
- `realCrowdTick(timeMs)` — single-scene frame; `retain=false` re-emits every
  player (naive), `retain=true` appends cached encodings (retained).
- `realCrowdRenderBatched(batchSize, timeMs)` — batched render + back-to-front
  alpha composite (the high-count path). Composites into the crowd target.
- `realCrowdCaptureFlipbook(nFrames, stepMs)` — renders N frames to separate
  targets then reads them all back (dodges readback poison) for visual playback.
- `bitmap_bridge::CompositePipeline` — straight-alpha "over" compositor.

TS (`apps/electrobun/src/game/render/`):
- `player-strip-renderer-v2.ts`: `window.__realCrowdSnapshot()` — dumps every
  live player's real render state (bundle, export, frame/frameCount/fps, dir,
  flip, zone colors, equipped accessory refs, map position).
- `vello-loader.ts`: `window.__getVelloRenderer()`, `__getVelloGpuDevice()`,
  `__realCrowdStart/Status`, `__benchCrowd`, etc.

Conditions: live render path halted (`__renderHalt`) for clean CPU where noted;
GPU timed via `device.queue.onSubmittedWorkDone()`; every cost cross-checked with
a non-empty pixel-count probe so empty (overflow / resource-recycled) frames are
never reported as valid.

---

## 2026-05-27 UPDATE — the "#1 blocker" was a harness artifact; the path is shippable

**Correction to §"Engineering hazards #1".** The "cached scenes go black after ~1s
sustained" symptom is **NOT a real resource-lifetime bug** — it is **deferred-destroy
GC starvation in the benchmark harness.**

- Vello rebuilds **one image-atlas texture per `render_to_texture`** (it packs all the
  scene's `ImageBrush` SWF bitmaps into a fresh atlas — `vello/src/render.rs` ~149).
- Those atlas textures are *unextracted* (never handed to Pixi), so the patched-wgpu
  `Drop` queues them in the **deferred-destroy queue**, drained by
  `renderer.tickDeferredDestroys(2, 256)` which `CharacterCache.tick()` calls **once per
  Pixi rAF tick** (the production GC).
- A **tight synchronous bench loop** (or stopping the Pixi ticker) prevents rAF from
  firing between renders → the per-render atlas textures pile up unfreed → **transient
  OOM → black renders + WindowServer crash.** It is *not* a permanent leak: measured
  **53 GB of textures created AND all 53 GB destroyed** once the ticker resumes.
- With per-render GC, peak live texture memory stays **bounded: 155–372 MB** (800–1500
  actors, scaling with batch count). **Production renders once per rAF and GCs once per
  rAF → bounded → the Vello-direct crowd path is viable for sustained rendering.**
- Verify health via `renderer.rustGpuByteStats()` (live/pending GPU bytes), **not**
  `texture_to_bitmap` readback — readback is unreliable in WASM (can't block on the GPU)
  and was the source of the false "readback poison" reading.

**Clean isolated numbers (live path OFF via `__killLiveRender`, per-render GC, 800
DIVERSE actors — 24 gfx, 200 w/ accessories, tex 4096×2994):**

| config             | batches | avg ms | p50  | fps | peak VRAM |
|--------------------|---------|--------|------|-----|-----------|
| serial  cap-250    | 4       | 16.78  | 15.48| 60  | 267 MB    |
| parallel cap-250   | 4       | 17.26  | 15.78| 58  | 267 MB    |
| **serial cap-500** | 2       | **16.19** | **14.37** | **62** | **157 MB** |
| parallel cap-500   | 2       | 17.65  | 16.22| 57  | 157 MB    |

- **Fewer/bigger batches + single-pass composite is the win on realistic diverse loads:**
  marginally faster *and* ~40% less peak VRAM (peak VRAM scales with batch count — fewer
  batches = fewer concurrent atlas textures). On a trivial single-look workload it's
  neutral-to-slightly-negative, which is why earlier light-look runs disagreed.
- **Threading does NOT help warm.** The per-frame build is cheap cached `scene.append`s,
  so rayon + merge overhead exceeds the gain. Keep `--features threads` gated, not default.
- 800 diverse ≈ 60 fps means the real **200–250 target is far under budget.**

**Isolation fix.** `__renderHalt` is BATTLEFIELD-scene only and silently no-ops on a map,
so the old live render path kept running and contaminated/crashed every isolation test.
Added cross-scene `window.__killLiveRender()` / `__resumeLiveRender()` (stop/start the
Pixi `app.ticker`) in `engine.ts`. The watchdog's `emergencyHalt` refuses test-bot spawns
— click the RenderDebugOverlay **RESUME** button to clear.

**Biggest remaining lever (bigger than submit count):** the image atlas is rebuilt +
re-uploaded **every** render (~50 MB/render of churn — the 53 GB). Cached looks' bitmaps
are static, so retaining/reusing the atlas across frames would cut GPU upload bandwidth
and alloc/free churn substantially. Not yet done.

**New durable artifacts this session:** `bitmap_bridge::MultiCompositePipeline` (single-pass
N-source composite), vendored+patched `rust/vello_encoding` (2× bump buffers → ~500
actors/scene), `__killLiveRender`/`__resumeLiveRender` (engine.ts), `__rcBench` harness
(vello-loader.ts). Threaded wasm is a separate `--features threads` artifact; the normal
production build is unaffected.

---

## 2026-05-27 (later) — CPU breakdown, the real bottleneck, and the architecture decision

Once isolation was fixed (`__killLiveRender`) and renders were GC'd (`tickDeferredDestroys` every frame — the "black after 1s" was harness GC-starvation, NOT a real bug), the clean per-phase CPU breakdown at 800 diverse actors (vendored Vello split into `resolve_scene` + `run_resolved`, timed with `web_time`):

| phase | 800 | what it is |
|-------|-----|------------|
| build | 6.3 ms | append cached looks + per-actor key hashing |
| resolve | **2.1 ms** | Scene → Recording (the part I'd planned to parallelize — it's tiny) |
| **run** | **13.5 ms** | `run_recording`: upload the scene encoding + record dispatches + submit |
| composite | 0.08 ms | single-pass |

We are **CPU-bound ~2:1 over GPU** (GPU-only ≈ 8.7 ms@800 via `onSubmittedWorkDone`). The bottleneck is **`run` = re-uploading the whole scene encoding every frame** — NOT resolve (so the "parallelize resolve across rayon" plan was killed). Threading the *build* made it slower (rayon+merge overhead > the small build), confirming build isn't the wall either.

**Constraints clarified by the user:** 1000 players @ 60fps (250 was a floor, not a target), ≤2.5 GB, MSAA fine (Pixi AA on top if needed), NO bitmap caching, **NO viewport culling** (whole Dofus map always visible), **looks are UNIQUE per player** (so no whole-character instancing/dedup). This rules out culling and instancing-the-character, and rules out immediate-mode Vello (it busts RAM via the per-`(sig,frame)` pose-cache and can't hit 1000@60 on the upload wall).

**Offline SWF feature analysis** (standalone `swf 0.2` tool, all 24 base gfx + 6,707 items): filters **0** in bodies / 4.4% items; blends **0** in bodies / 6.0% items; masks 25% of bodies (2 heavy) / 8.4% items; morphs all bodies (1–8, few) / 0.1% items; bitmap-fills ~1–3/body, 8% items (~99% vector); translucency ~17% bodies / ~20% items. → the hard features (filters/blends) are absent in bodies and a minority in items; masks/morphs bounded.

**DECISION — retained Vello (NOT lyon/tessellation, NOT a custom rasterizer):** Verified `path_data` (local) and `transforms` are separate encoding streams; geometry is frame-invariant, only the pose changes. **Measured: 95.7% of the per-frame encoding is static (23 MB) vs 4.3% transforms (1 MB) at 800 actors.** So persist the static encoding on the GPU once and upload only the transforms stream per frame → cuts the `run` upload **~22×** and eliminates the per-frame geometry re-append, while keeping Vello's analytic AA + every SWF feature (masks/blends/morphs/gradients/color-zones) for free. Lyon was rejected (slow + MSAA + would force reimplementing all SWF semantics). The fork = persist the packed scene GPU buffer, write only the transform byte-range in `run_recording` (layout stable frame-to-frame; full re-upload only on spawn/despawn/anim-shape change). If retained-Vello alone misses 1000@60 (Vello rasterizes all geometry every frame, no instancing), the next lever is a deeper Vello fork adding instancing — still keeping the rasterizer. Full architecture + budget math in memory `project_character_render_architecture`.

**Next:** build the retained-Vello fork (persistent scene buffer + transforms-only upload) and measure the real per-frame drop. Temporary swf-spike feature counters were reverted (superseded by the offline tool); the Vello split methods (`resolve_scene`/`run_resolved`/`shaders`) + vello-wasm encoding-size diag are kept as the fork's foundation.

---

## 2026-05-27 (later still) — retained-Vello BUILT; Phase-2 gate PASSED

The retained-Vello fork is implemented and the persistence MECHANISM is validated
end-to-end in the browser (threaded wasm, 8 threads, COI on, 800 actors @ 4 batches).

**What was built**
- `rust/vello` (vendored): `render::SceneSource{Upload,External}` + `render_full_reuse`
  (External mode skips the scene `Command::Upload` AND the end-of-coarse free, returns
  `(recording, out_image, scene_buf, layout, packed)`). `Renderer` gained
  `reused_scene_bufs: HashMap<u64, ReusedScene>` + `ReuseToken` + `ResolvedReuse` and
  the methods `resolve_scene_reuse` / `run_reuse_full` / `run_reuse_transforms` /
  `free_reused` / `free_all_reused`. The persistent buffer is bound via the
  already-wired `ExternalResource::Buffer` variant (un-`expect`-ed). No `WgpuEngine`
  change beyond that — the resident buffer is owned by `Renderer` (disjoint-field borrow
  vs `&mut engine.run_recording`).
- `rust/vello-wasm`: `RealAnimCrowd.retained_batches: Vec<Option<RetainedBatch>>` +
  `realCrowdRenderRetainedFrozen(batch_size, frozen_frame, frame_idx, move_px)`. First
  call per batch = SLOW (`resolve_scene_reuse` + `run_reuse_full`); later = FAST
  (`run_reuse_transforms`: partial transform write + **replay the cached recording**).
  `realCrowdFree` now calls `free_all_reused`.
- Harness: `window.__rcBenchRetained` in `vello-loader.ts`.

**Recording replay is SAFE (the #1 risk).** The Vello recording is fully balanced —
`record_fine` frees every derived buffer, coarse frees the rest — so after each run the
bind_map returns empty and a cached recording re-materializes cleanly from the pool. The
external scene buffer (never freed, re-injected each run) is the only thing that persists.
Confirmed empirically: **6 consecutive replays of one cached recording → pixel-correct.**

**Gate result (clean single readback — readback poisons subsequent renders, so trust only
the FIRST readback of a session):**
- content = **0.348, valid** — pixel-identical to baseline (0.35).
- Fast path, 800 actors / 4 batches: **runMs 0.88 / resolveMs 0 / buildMs 0 /
  compositeMs 0.015**, vs baseline **runMs 9.89 / resolveMs 2.2 / buildMs 2.87**.
  → ~**11× drop** on the GPU submit; total GPU work ~0.9 ms for 800 actors → huge 60fps
  headroom. liveMB ≈ 618 (resident buffers + Vello working set; well under 2.5 GB).

**Measurement hazard (re-learned):** `realCrowdBitmap`/`texture_to_bitmap` poisons every
subsequent render's readback. A multi-config bench that reads back per config gives false
`content=0` on configs 2+. Validate content with exactly ONE readback from a fresh page
(use `rustGpuByteStats`/timing for everything else).

**Caveat / not-yet-confirmed:** the gate proved the FROZEN path (fixed positions, identical
transforms = the binding + replay). The MOVING path (`move_px>0`, real transform rebuild +
partial upload of NEW bytes) was exercised for timing but its content was not independently
confirmed (one-readback budget). Phase 3 (union bake → real per-frame transforms) will
validate that with its own clean readback.

**Next: Phase 3 — union-geometry bake** (`rust/swf-spike/src/render/union.rs`) so real
animation keeps per-batch geometry resident: one stable-structure encoding per
`(sig, anim, dir)`, per-frame transform tables (hide absent slots via scale-0), then
`realCrowdRenderRetained` consuming it. Plan: `~/.claude/plans/melodic-wobbling-hellman.md`.

---

## 2026-05-27 (Phase 3 prep) — cross-frame geometry stability MEASURED → design pivot

Added `analyzeFrameStability(max_looks)` (vello-wasm): bakes each distinct look across
EVERY anim frame, hashes `path_data + draw_data`, reports `distinctGeomHashes` /
`distinctTxCounts` per look. Ran on a 201-player crowd (146 distinct looks), all bots
actively walking/running (a deliberate WORST case; real map crowds are idle-dominated).

**Result — player-weighted retainable (`distinctGeomHashes==1`): 43%** in this all-moving
crowd. By anim: **static 100%** (52/52, 1-frame), **walk ~33%** (23 ret / 47 dyn),
**run ~15%** (12 ret / 67 dyn). Worst dynamic looks change geometry nearly every frame
(`walkB` 40/42, `walkL` 38/48, `runL` 25/36), `distinctTxCounts` mostly 1.

**The plan's union+hide approach was based on a wrong model.** It assumed cross-frame
geometry change = shapes appearing/disappearing (solved by hide-matrices). The data shows
the dominant cause is **morph shape interpolation** — geometry coordinates tween every
frame — which hide-matrices do NOT solve. So union+hide would not retain morph anims.

**Design pivot → two-lane partition (v1):**
- **Retained lane:** looks with `distinctGeomHashes==1` (all static + morph-free walk/run).
  Geometry resident (frame-0), per-frame transforms = `sub_f.encoding().transforms` composed
  with `place`. Retainable ⟹ stable transform count ⟹ frames align with NO hide-matrices,
  NO slot reordering — much simpler than the union plan. Morph-free walk/run animate FULLY
  via transforms-only. This is the gate's proven 0.88ms path generalized to real positions +
  per-(sig) geometry + per-frame transform tables.
- **Dynamic lane:** morph looks (`distinctGeomHashes>1`) → existing baseline per-frame full
  upload. Partition players into retained vs dynamic batches; composite both.

For idle-dominated real crowds the retained lane ≈ everything (huge win). v1 is also the
strict foundation for a future **v2** (per-shape stable/morph split to retain morph-runners
too) — gated on a morph BYTE-fraction measurement (`distinctGeomHashes` over-counts: one
small morph flips the whole-look hash). Building v1 now.

---

## 2026-05-27 (Phase 3 COMPLETE) — v1 + v2 + v3 built & validated

Unified retained render landed (`realCrowdRenderRetained`), driven by per-player
partial uploads into a GPU-resident packed scene buffer (vello fork: `SceneSource::
External` + `prepare_reuse`/`reuse_write`/`reuse_replay`). One mechanism, three classes:

- **v1** (non-morph length-stable, incl. static + morph-free walk/run): transforms-only
  re-upload. **Validated: content 0.268, runMs 0.95 / 600, retainedBatches 3/3.**
- **v2** (length-stable MORPH, incl. heavy `walkB`): transforms + per-player path_data
  re-upload only on the frames where a player's geometry index changes (deduped per
  `(sig, geom)`). **Validated: content 0.373, animating; runMs spikes on morph frames
  (~5-8ms) vs ~1ms transforms-only — exactly the expected v2 profile.**
- **v3 union/hide** (length-VARYING / appear-disappear): a new swf-spike capture sink
  (`RenderCtx::depth_path` identity + `render/union.rs`) records leaves per frame; the
  union of all leaves is re-emitted EVERY frame in stable sorted-depth-path order
  (== hierarchical z-order) with absent leaves at a scale-0 HIDE transform → constant
  byte layout → flows through the v1/v2 path. Routed automatically when
  `bake_retained_look` classifies a look length-varying. **Validated: it SOLVES the
  dilution — an all-moving 800 crowd went `retainedBatches 0/4 → 4/4`, runMs ~1.8ms;
  content 1.0 at a safe batch size.**

**Known remaining issue — Vello bump-buffer OVERFLOW at large batch×big-look.** Some
looks are large (`sprite-70 runR` = 231 leaves/frame). At batch=250, a batch's combined
geometry exceeds the (DOFUS-bumped) tile/segment/ptcl buffers → silent geometry drop →
BLACK. CONFIRMED a sizing issue, not a v3 defect: the SAME crowd at
**batch=32 → content 1.0, valid, runMs 1.5ms** (`retainedBatches 7/7`).

**CORRECTION (overflow is per-batch GEOMETRY, NOT texture size — tested & disproven).**
First hypothesis (the 4096×2993 res=3 bench target inflated tile/ptcl pressure) was tested:
at realistic res=1 the target is **1073×741 = 3MB** (textures are small ~3-8MB screen-sized,
NOT 49MB — the 49MB was a bench-res-3 artifact), yet **batch=250 is STILL black there**
(content 0, clean first probe). So 250 union-looks/batch overflows the bump buffers
INDEPENDENT of texture size; `medRunMs` ~1.6ms either way (the ~500ms spikes are
intermittent GC pauses from the tight off-ticker bench loop, NOT the blackness — would be
fine in production with the live ticker draining per rAF). Would hit the baseline path too.
**Fix (Phase-4): geometry-budgeted batching (cap n_paths/segments per batch so none
overflows) + multi-pass composite (`MultiCompositePipeline` is ≤8 sources; >8 small batches
need ping-pong folding). Memory is CHEAP — batch textures are ~3-8MB, so many batches fine.**

**Verification hazard (persists):** `realCrowdBitmap` AND the new buffer-copy
`realCrowdContentRatio` probe are only reliable on the FIRST readback per page-load
(GPU-readback poisoning). Use exactly one content probe per session; use runMs / batch
counts (non-poisoning) for everything else.

**Vello fork is generic + committable.** swf-spike `depth_path` is additive/inert for
normal rendering (only read under union capture). The dynamic baseline lane in
`realCrowdRenderRetained` is now dead (union makes every look retainable).

---

## 2026-05-27 (DEFINITIVE / DECISION) — append model MEETS the production target; union & retained-union are dead ends

Target: **60fps for 500+ MOVING actors at scale 6, random colors + accessories, + animated
tiles, with a safe gap.**

**Measured — append model (`realCrowdRenderBatched`, re-encode + re-upload current frame),
500 MOVING (walk/run) actors, diverse + accessories + colors:**

| | wall | fps | build | resolve | run | composite | tex | VRAM |
|---|---|---|---|---|---|---|---|---|
| scale 3, cap250 | 10.3ms | 97 | 3.2 | 0.8 | 6.3 | 0.04 | 2048×1497 | 395MB |
| **scale 6, cap250** | **10.0ms** | **100** | 3.2 | 0.7 | 6.1 | 0.04 | 3967×2866 | 490MB |
| scale 6, cap500 | 10.0ms | 100 | 3.2 | 0.7 | 6.0 | 0.04 | 3967×2866 | 473MB |

**Three decisive facts:**
1. **Scale 6 is FREE** — scale 3 and 6 cost the *same* 10ms; `compositeMs` 0.04ms. The cost
   is 100% geometry **upload/CPU** (build 3.2 + run 6.0), which is **scale-independent**.
   Fine rasterization is negligible. Texture stays 3967×2866 (under the 8192 wgpu limit).
2. **500 moving @ scale 6 = 10ms = 100fps** crowd-only, content-validated, 490MB. The
   *append* model already meets the target with headroom for tiles + Pixi (~3–6ms → ~60–77fps).
3. The bottleneck is exactly the CPU upload retention attacks — so retention extends this to
   higher counts, but is **not needed to reach 500@scale6**.

**WHY the union (v3) failed (negative result, kept for the record):** to make appear/disappear
looks length-stable it bakes the UNION of every frame's shapes and emits all every frame
(hiding absent ones scale-0). Vello processes ALL union slots in the coarse pipeline (only
fine raster skips zero-coverage), so a union look is ~7–12× one frame's geometry. That
overflows dense batches (forcing 25 small batches → 25 submits) and bloats coarse → **151ms /
7fps @ 800**. Retention only wins when the resident geometry is SMALL (= one frame ≈ static /
length-stable, i.e. v1/v2). For appear/disappear, **re-encoding the single current frame
(append) is far cheaper than retaining the bloated union.** No cheap union fix exists (Vello
has no per-draw frame skip without changing encoding structure).

**ARCHITECTURE DECISION:**
- **Ship the append model** (`realCrowdRenderBatched`) — proven, simple, meets 500 moving @
  scale 6 @ 100fps. This is the production render path.
- **Retained v1/v2** (transforms-only for static/length-stable; +path_data for length-stable
  morphs) is a validated *optimization* to push past 500 toward 1000 by retaining the
  length-stable bulk — layer in later for extra headroom.
- **Union/hide (v3) is abandoned** (measured 20× slower than append for animated looks).
- Geometry-budgeting + multi-pass composite were built for the union path and are unneeded
  for append (single-frame looks fit cap250/500, ≤8 batches, single-pass composite).

**Remaining: live cutover** — wire `realCrowdRenderBatched` into the battlefield render path
(replace the per-player strip/sprite path), composite the crowd texture(s) into the Pixi
stage, keep position-based picking + mounts + tile z-order. Substantial, careful integration;
do it behind a flag and validate live with the animated tiles for the true production number.
