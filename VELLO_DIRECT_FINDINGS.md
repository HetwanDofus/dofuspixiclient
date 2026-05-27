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
