# vello_cpu feasibility — the no-WebGPU fallback path (2026-07-06)

**Question:** wc2 (PixiJS + vello-wasm) is the keeper client, but it requires
WebGPU, which older machines don't have. Can `vello_cpu` (linebender's
sparse-strips CPU renderer, 0.0.9) rasterize our real bake workloads fast
enough in WASM to serve as the fallback renderer?

**Answer: yes, for the bake-and-composite architecture.** The realistic
bake unit — a **full composed actor** (body + hat/cape/shield + palette),
all 45-48 frames — costs **0.5-1.2 ms per frame / 23-59 ms per variant,
single-threaded in Chrome/WASM+SIMD128** on the dev machine, ~3-4× the
measured GPU-path cost (5-15 ms/variant, RENDER_STATE.md v5); the bare
body is 10-31 ms/variant (~2×). Bakes are async and cached, so warmup
slack is invisible in steady state, and **sharding bakes across web
workers scales near-linearly (measured 3.6× @ 4, 5.9× @ 8)** — which the
GPU bake could never do. Steady-state fps is PixiJS instanced draws
either way. The slab per-frame crowd renderer stays WebGPU-only (it IS
compute shaders) — the fallback tier is strip/bake + PixiJS-WebGL.

## How it's measured (all real content, byte-level real pipeline)

- `rust/vello/src/record.rs` (new): opt-in display-list recording on the
  forked `vello::Scene`. `enable_recording()` mirrors every
  fill/stroke/push_layer/pop_layer/append into an owned `Recording`;
  instanced appends + glyph runs bump a `lossy` counter instead of lying.
  Zero overhead when off (one `Option` check per op).
- `swf_spike::render::cache::set_record_fragments(true)`: makes the
  pre-encoded per-shape fragment scenes record too (they're `Scene::append`ed
  by the shape emit path — without this the recording is lossy).
- `rust/cpu-bench` (new): walks class-sprite exports through the standard
  swf-spike renderer (`render_symbol_tinted_nogpu`, warm palette, HSL zone
  recolor live) into a recording scene, replays into
  `vello_cpu::RenderContext`, times replay (flatten+strips) and
  `render_to_buffer` (fine raster) separately. Types transfer 1:1 —
  vello_cpu 0.0.9 sits on the same peniko 0.6/kurbo 0.13 as the fork.
- `rust/cpu-bench-wasm` (new): same core via wasm-bindgen;
  `index.html` harness. The workspace `.cargo/config.toml` already forces
  `+simd128` for wasm32, and `simdLevel()` confirms `WasmSimd128` at runtime.
- Output verified visually: `target/cpu-bench/*.png` render the correct
  characters with correct per-zone tints.

Reproduce:

```
# native table + sanity PNGs (from rust/)
cargo run --release -p cpu-bench -- 10,50,100,121 1,3,5 0,7 3

# native GPU reference (same composed workload, strip bake, from rust/)
cargo run --release -p swf-spike --bin bench-gpu-strip -- 10,50,100,121 1,3,5 5

# wasm: build, serve wc2 root, open the harness
cd rust/cpu-bench-wasm && wasm-pack build --target web --release
python3 -m http.server 8791   # from dofuswebclient2/
# http://localhost:8791/rust/cpu-bench-wasm/index.html   (table + worker scaling)
# http://localhost:8791/rust/cpu-bench-wasm/compare.html (build-variant A/B)
```

## Numbers (dev machine: M-series; variant = ALL frames of walkR)

Native, single thread (t0) — replay + raster ms per variant:

| class | frames | z1 | z3 | z5 |
|---|---|---|---|---|
| 10 (2-page heavy) | 45 | 2.5 | 3.5 | 4.8 |
| 50 (1-page light) | 48 | 2.5 | 3.6 | 4.5 |
| 100 (3-page heaviest) | 48 | 3.8 | 6.0 | 7.9 |
| 121 (2-page) | 45 | 2.2 | 3.6 | 5.2 |

Chrome WASM + SIMD128, single thread — replay + raster ms per variant:

| class | z1 | z3 | z5 |
|---|---|---|---|
| 10 | 9.7 | 14.5 | 19.2 |
| 50 | 9.9 | 13.1 | 16.0 |
| 100 | 14.5 | 21.9 | 30.5 |
| 121 | 9.5 | 13.9 | 20.7 |

Reference points:
- GPU in-browser (measured, RENDER_STATE.md): 5-15 ms per variant,
  ~8-10 ms per atlas page, 213 ms full 24-class roster at zoom 3.
- WASM/native ratio ≈ 3-4×. WASM per-frame at zoom 3 ≈ 0.3-0.5 ms.
- Replay (flatten + strip gen) dominates over fine raster at sprite sizes
  (e.g. class 100 z5: 22.4 replay vs 8.1 raster). Replay cost is
  resolution-insensitive; raster scales with area.
- Scene walk with warm caches is negligible (0.05-0.08 ms/frame); cold
  first-walk 0.2-3.4 ms.
- Native multithreading (t7) halves replay but HURTS raster at sprite
  sizes (dispatch overhead > work). Single-thread is correct for
  per-variant bakes. vello_cpu 0.0.9 multithreading uses std threads =
  unavailable on wasm anyway.

## Full composed actor — realistic per-frame cost (2026-07-06, round 2)

The realistic bake unit: body + hat + cape + shield mounted through the
production accessory path (`AccessoryDict`, identity look-slot→mount-slot;
weapon has no static mount, exactly like production) + player palette.
Accessories are the median gfx of each type pool from the real bundles
(`16_203 + 17_155 + 82_101`). Cell size is the exact bbox of everything
drawn (computed from the recording), so cape/shield overhang is paid like
the production accessory-padded strip. PNG-verified (hat + shield mounted,
tint correct).

**Chrome WASM + SIMD128, single thread — ms per composed-actor frame**
(replay + raster; add ~0.12-0.15 ms/frame walk when the scene isn't cached):

| class | z1 | z3 | z5 | body-only z3 (ref) |
|---|---|---|---|---|
| 10 | 0.51 | 0.72 | 0.98 | 0.30 |
| 50 | 0.50 | 0.66 | 0.83 | 0.25 |
| 100 | 0.65 | 0.91 | 1.23 | 0.48 |
| 121 | 0.54 | 0.78 | 1.05 | 0.33 |

Native (M-series) is ~3-4× faster: 0.13-0.31 ms per composed frame.
Composed ≈ 2.4× the bare body (ops 6.9-9.9k → 13-18.5k per variant).

So per full composed VARIANT (45-48 frames) in wasm: **23-59 ms** — the
number to compare against the GPU path's 5-15 ms/variant: ~3-4× on the
realistic unit. Still bake-budget material, not per-frame material:
at ~0.8-1.4 ms per composed frame (walk included), a 16 ms frame budget
live-renders only ~12-20 fully-unique actors on one thread — fine for a
small map, nowhere near the 300-crowd. Bake-and-composite remains the
architecture on the CPU tier.

## The per-frame matrix (2026-07-06, round 3)

One composed-actor frame (body + hat/cape/shield + palette), zoom 3,
range across classes 10/50/100/121, all measured on the dev machine:

| | native (M-series) | WASM (Chrome) | wasm/native |
|---|---|---|---|
| **GPU (vello 0.8)** | **0.03 ms** (strip render, Metal) | **0.10-0.31 ms** (production bake, 5-15 ms per 45-48f variant) | ~3-9× |
| **CPU (vello_cpu)** | **0.13-0.24 ms** | **0.66-0.91 ms** (0.65-0.81 with wasm-opt) | ~3.9× |
| cpu/gpu | ~4-7× | ~3-4× | |

Zoom scaling for CPU-wasm composed: z1 0.50-0.65, z3 0.66-0.91,
z5 0.83-1.23 ms/frame. Body-only is ~2.4× cheaper (z3 0.25-0.48
ms/frame wasm, 0.07-0.13 native). Walk (scene traversal, cached shapes)
adds ~0.12-0.15 ms/frame when not scene-cached.

Native GPU notes: the whole 45-48-frame strip renders in a flat ~1.5 ms
regardless of strip size (dispatch-bound on Metal, `bench-gpu-strip` in
swf-spike) — per-frame cost is amortization, meaningful only because
production bakes whole variants per submit. The interesting symmetry:
**CPU-native ≈ GPU-in-browser** for this content.

## Making the WASM CPU path faster — measured + ranked

Measured this round (compare.html, composed bakes, classes 10/100):

- **wasm-opt -O4: ~10% faster** (per-frame 0.74→0.65, 0.91→0.81,
  1.22→1.11) and 13% smaller binary. Zero risk here (no atomics in this
  crate) — now the default in `cpu-bench-wasm/Cargo.toml`.
- **relaxed-simd: no effect** (±1%, within noise). fearless_simd 0.4
  doesn't emit relaxed intrinsics, and LLVM finds nothing to relax on
  its own. Not worth the dual-build + feature-detect machinery (Safari
  lacks relaxed-simd anyway). Re-test if vello_common's fearless_simd
  grows a WasmRelaxedSimd128 level.
- **Web-worker sharding: 1.95× / 3.6× / 5.9× at 2/4/8 workers** (see
  next section) — the dominant lever, effectively bringing a composed
  variant from ~30 ms to ~5-8 ms of wall time during warmup storms.

Ranked plan for production:

1. **Worker pool for bakes** (measured 3.6× at 4 workers): 2-4 CPU bake
   workers behind the existing bake queue, each holding parsed bundles,
   `navigator.hardwareConcurrency`-capped. Plain postMessage — no
   SAB/COOP/COEP/atomics build.
2. **wasm-opt -O4** (measured ~10%): free.
3. **Rasterize less, not faster** (architecture, biggest real-world win):
   per-(variant, zoom) results are cached atlases — CPU tier must keep
   IDB persistence (fix the VSC Image-patch encoder) so warm sessions
   skip bakes entirely; bake current-zoom + visible-actors first with
   last-pose fallback (machinery exists); recordings are
   resolution-independent, so walk once and replay per zoom.
4. **Stream the variant**: bake frame 0 → show → fill remaining frames
   in later ticks. Cuts first-visible latency ~45×; throughput unchanged.
5. **vello_hybrid (CPU coarse + WebGL2 fine)** — only if big rasters
   (map-scale) become the bottleneck: replay/coarse dominates sprite
   bakes (75-85%), so hybrid's GPU fine-raster helps little there, but
   it wins on area-heavy work. Old machines all have WebGL2.
6. **Upstream watch**: vello_cpu multithreading is wasm-incompatible by
   construction today (private rayon pool, blocking recv) and loses at
   sprite sizes even natively — skip. Track newer vello_cpu releases for
   wasm-compatible dispatch or strip-level caching (Graphite pushes this).

## Threads in WASM — measured answer

Two distinct levels:

1. **Inside one render (vello_cpu `multithreading`): NOT usable on wasm.**
   The MT dispatcher builds a private rayon pool
   (`ThreadPoolBuilder::new().build()`, no `spawn_handler`) and its
   workers block on `crossbeam` `recv()` — wasm can't spawn std threads,
   wasm-bindgen-rayon only patches the *global* pool, and blocking waits
   are forbidden on the main thread. Making it work means forking
   vello_cpu — and the native t7 data says it would LOSE at sprite bake
   sizes anyway (thread dispatch > work). Not worth pursuing.
2. **Across bakes (web workers, one wasm instance each): works today,
   measured.** Bakes are independent; each worker holds its own parsed
   bundles (`BenchPool` in `cpu-bench-wasm`) and takes (class, zoom)
   tasks from a queue. Fixed batch of 24 composed bakes, Chrome:

   | workers | wall | speedup |
   |---|---|---|
   | 1 | 1218 ms | 1.0× |
   | 2 | 625 ms | 1.95× |
   | 4 | 341 ms | 3.6× |
   | 8 | 207 ms | 5.9× |

   Near-linear to 4 workers, still strong at 8. No SharedArrayBuffer, no
   COOP/COEP, no atomics build needed — plain workers + postMessage
   (SWF bytes are structured-cloned once per worker at init). This is
   the exact opposite of the GPU multi-worker bake, which the driver
   serialized to 1.04×. Production shape: a small pool (2-4) of CPU bake
   workers behind the existing bake-queue, `navigator.hardwareConcurrency`
   -capped.

## Architectural conclusions

1. **Renderer tiering.** `navigator.gpu` present → today's WebGPU path
   (slab crowd + GPU bakes). Absent → PixiJS WebGL renderer + vello_cpu
   bakes. Steady-state architecture (bake → atlas → instanced composite)
   is identical; only the rasterizer swaps.
2. **The strip renderer is the fallback architecture — don't delete it.**
   The P1/P2 plan (CROWD_PERF_HEADTOHEAD.md) retires it for crowd bots on
   the WebGPU tier; it must stay buildable as the CPU-tier path.
3. **Integration seam already exists.** Production integration = build
   scenes exactly as today with recording enabled, replay the recording
   into vello_cpu instead of `render_to_texture`, upload the pixmap to a
   Pixi texture (same ImageBitmap-ish blit as the GPU bake path). The
   subscene/frag caches keep working — a cached subscene's recording
   replays at whatever transform it's appended with.
4. **Old-machine budget.** These are M-series numbers; budget 2-4× for an
   old Intel laptop → ~20-120 ms per variant. Still fine: bakes are async,
   cached per (gfx, anim, dir, zoom) and shared across actors; prioritize
   visible actors, show last-pose fallback while baking (all machinery
   that already exists).
5. **Scaling bakes without GPU-style contention.** The GPU multi-worker
   bake was a dead end (driver serializes submits). CPU bakes have no such
   limit — MEASURED: 2/4/8 web workers give 1.95×/3.6×/5.9× on a fixed
   composed-bake batch (see "Threads in WASM"). (vello_hybrid — CPU
   coarse + WebGL2 fine — is a second option between the tiers if
   pure-CPU raster ever becomes the bottleneck; not needed on current
   numbers.)
6. **Full-roster prewarm on CPU** (24 classes × ~24 variants × ~15 ms) ≈
   9 s single-thread wasm — do NOT prewarm the world on the CPU tier;
   bake visible-only on demand (which the current architecture already
   prefers) or shard across workers.

## Fleet reality (2026-07-06): WebGPU-present-but-broken exists in the wild

Tester screenshots + console logs from the deployed wc3 build
(dofus.jean-walrave.com) on a 2017 MacBook (Intel Gen9.5, Metal driver
frozen, macOS capped at Ventura, Chrome current):

- WebGPU is EXPOSED and runs — `AdapterInfo { name: "", vendor: 0,
  backend: BrowserWebGpu }` (blank identity in-browser) — but bevy_render
  already self-downgraded ("Some GPU preprocessing are limited on this
  device").
- **Output is corrupted at the BAKE level**: shredded triangle garbage,
  progressively-shifted smeared texture rows, misplaced tiles — cached
  into the tile atlas, so the corruption persists. Classic old-Intel
  vello-compute failure class (buffer garbage reads / barrier-atomics
  miscompiles; the row smear looks like a copy row-pitch mismatch).
- **Perf disqualifying regardless**: FRAME-GAP 27-250 ms in wgpu
  submit/present, GPU(render_world) spikes 53-155 ms, real fps 43-51
  (frame.between max 145-250 ms) while the in-page overlay claims
  "60.0 fps" (the lying-rAF-counter trap). `paint 7965 ms` for one map's
  65 tiles.
- Unrelated bug seen: winit web backend throws uncaught on synthetic
  KeyboardEvents with `code === undefined` (extension-dispatched);
  needs a guard in the winit fork. Moot on the PixiJS client.

Consequences (supersede "presence-based" tiering):

1. **Tier by self-test, not by `navigator.gpu`.** Boot probe: render 1-2
   golden scenes to texture → read back → checksum vs embedded reference
   + time-threshold. Fail either → tier 2 for the session, verdict
   persisted. Collect `adapter.info` from JS (wgpu's is blank in-browser)
   into telemetry to learn the fleet.
2. **On broken-WebGPU machines vello_cpu is the ONLY trustworthy
   rasterizer** — GPU bakes are what's corrupted, so the CPU tier serves
   three fleets: no WebGPU, broken WebGPU, too-slow WebGPU. PixiJS WebGL
   composite is the safe GPU path everywhere (decade-hardened on old
   Intel Macs).
3. "Post-2019 machines" does not exclude this class: Intel MacBooks sold
   new until mid-2021; UHD-620-class Windows laptops later still; testers
   hand URLs to older hardware anyway.
4. If salvaging GPU bakes on old Intel is ever attempted, timebox it:
   read back vello bump-allocator overflow flags after bakes (plumbing
   exists at `vello/src/lib.rs:1786`), golden-test per pass, try with the
   slab fork-shaders disabled. Expectation: even correct runs don't meet
   the perf bar there (155 ms GPU spikes).

## Post-mortem (2026-06-19 incident): the "PC crash" was a WindowServer
## watchdog kill caused by GPU-memory flooding — mechanism now proven

Evidence: `~/Desktop/test.json`, a macOS WATCHDOG stackshot (bug_type 409,
Mac16,5, macOS 26.5.1). Chain, all in the capture:

1. `Google Chrome Helper` (the GPU process) at **8.61 GB resident**,
   2.5 h uptime, ~48 min CPU — a long stress session with the documented
   GPU floods (15 GB texture churn, ~256 MB back-to-back page temps,
   eviction thrash, per-frame buffer churn). On Apple-Silicon unified
   memory those Metal allocations are system RAM.
2. The helper is flagged `terminatedSnapshot`, `suspendCount 2`, last
   thread in `TH_WAIT, TH_UNINT` — dying but STUCK in an uninterruptible
   kernel wait inside the GPU driver; its 8.6 GB and the GPU channel
   never freed.
3. WindowServer (same GPU) stalls → watchdog kills it → session dies.
   The WindowServer in this report has **uptime 39 s**: it's the
   restarted compositor, which blocked on the still-wedged channel and
   was killed again at the 40 s checkin ("40 seconds since last
   successful checkin"). Hence the repeated full-session "PC crash".

Interpretation: this is an OS-level property — ANY process (native or
browser) that wedges the AGX channel kills the compositor; native
clients have MORE direct access to do it, not less. The browser normally
adds a recovery boundary (GPU-process death → "WebGPU hit a snag");
this incident blew past it because the driver wedged during teardown.
The proximate causes were fixed (`stop vello.scene buffer churn
(GPU-watchdog machine freeze)`, slack-pooled buffers, persistent
sub_library, caps), but the class must be closed by construction:

1. **GPU allocation accountant** in the patched wgpu: one global byte
   budget covering ALL allocations incl. bake temp pages; exceeding it
   fails the bake + telemetry, never allocates. The deferred-destroy GC
   already sees every resource — attach the ledger there.
2. **Allocation-rate watchdog** in-client: > X MB in Y frames → pause
   bakes / degrade tier / log. Floods become stutters, not host kills.
3. **CI stress gate asserts the ledger**: resident plateau, evict≈0,
   zero budget refusals over the 300-bot run.

## Not yet measured / next

- Tile/map bakes on vello_cpu (tile subscenes are simpler than bodies;
  expected same ratio, worth one bench row).
- Fight-anim variants (bigger cells at zoom 5, up to 109 MB GPU pages) —
  per-variant CPU cost will scale with area; needs the same bench run.
- An actual old Intel machine data point.
- vello_cpu `RenderMode::OptimizeQuality` vs `OptimizeSpeed` output diff
  (bench uses OptimizeSpeed; AA quality looked correct in the PNGs).
- Production wiring: recording-based bake path behind a renderer-tier
  flag in vello-wasm + Pixi WebGL fallback init in the client.
