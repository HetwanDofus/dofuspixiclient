# Next session: make wc2's crowd render match Bevy/vello (wc3)

## The one-line goal
Render **300–500 fully-unique, accessorised, animating actors** in wc2
(PixiJS + `vello-wasm`) at a framerate comparable to the Bevy client
(wc3). Today wc2 does **~17 fps at 300** (user-observed on screen) — about
**4× slower than wc3** — and the crowd doesn't even draw all the actors.
The previous session fixed the crashes/correctness but **did not close the
framerate gap and could not reliably measure it.** Start fresh on the perf,
measurement-first.

## READ THIS FIRST — the traps that wasted the last session
1. **Every fps counter available in-page LIES.** `requestAnimationFrame`
   deltas and the game's own render-watchdog fps both measure the
   *main-thread loop cadence*, not the compositor present rate. They
   happily report ~120 fps while the screen is frozen or running at 17.
   Do **not** trust them. The user's eyes were right every time mine
   disagreed.
2. `device.queue.onSubmittedWorkDone()` polling gave contradictory
   numbers (it races the game's own submits). The Chrome DevTools
   perf-trace MCP does **not** surface a clean fps. The `gpu-timing`
   feature works but its readback rarely lands through the
   reuse-replay path. **You need a reliable GPU-time measurement before
   doing anything else** (see Plan step 1).
3. wc2 uses a **patched wgpu with a deferred-destroy GC**
   (`tickDeferredDestroys`, called every frame). It reclaims any GPU
   resource whose Rust handle was dropped. Two bugs last session came
   from this: a composite **dummy texture** and the **SubLibrary buffer**
   getting destroyed while still bound. **Any GPU texture/buffer you
   create must keep its handle alive for its whole usable life.**
4. The stress test (`stress-test.ts`) is a **correct, representative**
   Dofus workload — unique looks + accessories per player is normal, NOT
   an edge case. Do not "fix" measurements by making looks uniform. There
   is a `window.__stressLookPoolSize` knob (0 = stock fully-unique) for
   controlled experiments only.

## Current state (branch `slab-migration` in wc2)
What works now (verified on screen), do NOT redo:
- Slab path ported into `vello-wasm`, toggled by `realCrowdSetSlab(true)`
  / console `__crowdSlab(true)`.
- Correct actor size (sprite mounts at `1/resolution`, like the strip path).
- Rebuild/roster-growth renders the full crowd (fixed a destroyed dummy
  texture).
- No more OOM freeze: slab caches **compact handles** (not `vello::Scene`
  + `Arc<Encoding>`), and the SubLibrary resets at 384 MB. Heap plateaus
  ~2.5 GB instead of aborting.
- `bakePoolSize=0` (localStorage) forces synchronous main-thread bakes —
  the threaded bake-worker pool panics over shared atomics memory and
  corrupts the renderer. The pkg is currently built **non-threaded**.

What is still BROKEN (the actual job):
- **~17 fps at 300 unique animated actors (~4× slower than wc3).** Not
  main-thread bound (ticker ~3.5 ms). Not fillrate (resolution 1/2/3 all
  equal → GPU-compute bound on geometry). Root cause NOT pinned down.
- The crowd renders only ~100–140 of 300 at once — a per-frame bake
  budget + per-signature fallback hack, not a real solution.
- The cumulative `(look,dir,frame)` set is unbounded for fully-unique
  turning actors (mitigated by the 384 MB reset, but that causes periodic
  hitches).

## Why wc3 is fast and wc2 isn't (hypotheses to verify, not gospel)
Same vello, same shaders, same wgpu — so the 4× gap is in HOW each drives
it. Prime suspects:
- **wc3 PREBAKES** the full `static/walk/run × 8-dir` grid per body up
  front (see wc3 `actor_batch/prebake.rs`, `pump_deferred/prewarm.rs`,
  "1-decode-per-frame" throttle). wc2 bakes lazily per frame → stalls +
  incompleteness. This is probably the biggest single difference.
- **wc3's slab `reuse_fast` fires every frame** (stable byte layout via
  the high-water pin) so the GPU buffer is resident and only transforms
  update. wc2's slot count fluctuates (because of the lazy-bake budget)
  → likely `reuse_full` re-encode every frame. Confirm with GPU timing.
- wc3 renders into the Bevy render graph (one vello pass). wc2 renders
  the crowd to a texture then **composites via Pixi `ExternalSource`** +
  the rest of the Pixi scene → possible extra GPU passes / sync.
- wc3 resets the SubLibrary **per MapEpoch** + content-hash dedups; that
  bounds memory without the mid-frame resets wc2 now does.

## The plan (measurement-first — do NOT skip step 1)
1. **Get one trustworthy GPU frame-time number, two ways:**
   - Measure **wc3 itself** at 300 and 500 unique animated actors with its
     own `gpu-timing` (`vello.prepare_ms` / `replay_ms` + per-pass
     timestamps) and `devSpawnStress(N)`. This establishes the REAL target
     and tells you whether wc3's "89 fps" was real GPU time or a CPU
     counter. wc3 dev server is on :5173; enter via
     `?net=ws://127.0.0.1:5555&login=admin&password=admin` (emulator must
     run with `TRANSPORT_MODE=websocket`) or a scenario boot.
   - In wc2, build `vello-wasm` with `--features gpu-timing` and drive a
     **controlled, non-game render loop** (call `realCrowdRenderBatched`
     yourself in a tight loop, `await onSubmittedWorkDone()` each iter, and
     read `slabGpuTiming()` which returns per-pass ms — note it returns
     BigInts, convert before JSON). Fix the readback so it lands for the
     reuse-replay path if it still doesn't. Get the per-pass breakdown
     (instance_expand_slab vs flatten vs fine vs the SubLibrary copy).
2. With both breakdowns, **identify the specific pass that's 4× off** and
   whether wc2 is doing `reuse_full` every frame.
3. **Port wc3's prebake** so looks are baked off the hot path (eliminates
   the per-frame bake + the partial-render + the fluctuating slot count
   that likely defeats `reuse_fast`).
4. Make `reuse_fast` fire every frame (stable slab fingerprint).
5. Re-evaluate the Pixi composite step vs wc3's single-pass render.
6. Bound memory the wc3 way (per-map reset + content-hash dedup) instead
   of the 384 MB hard reset.
7. Re-measure with the step-1 methodology and compare to wc3 head-to-head.

## Key files
wc2 (target):
- `rust/vello-wasm/src/slab_crowd.rs` — compact handle cache + slab compose.
- `rust/vello-wasm/src/lib.rs` — `real_crowd_render_batched` (the `if
  self.slab_mode` branch is the slab path; the batch loop below it is the
  legacy path), `intern_sub_transient`, the bake budget + fallback,
  `SLAB_SUBLIB_RESET_BYTES`, `slabGpuTiming`.
- `rust/vello/src/{lib.rs,sub_library.rs,render.rs}`,
  `rust/vello_encoding/src/{slabbed.rs,resolve_slabbed.rs}` — the vello fork.
- `apps/electrobun/src/game/render/crowd-renderer.ts` — drives the wasm
  crowd, mounts the texture (resolution-density coords + `1/resolution`
  sprite scale), `__crowdSlab` / `__crowdSlabStats` console hooks.
- `apps/electrobun/src/game/render/vello-loader.ts` — init, `bakePoolSize`,
  optional `initThreadPool`.
- `apps/electrobun/src/game/scene/battlefield/stress-test.ts` — the bots +
  `__stressLookPoolSize` knob.
- `VELLO_DIRECT_FINDINGS.md` — the threaded-build recipe (nightly
  build-std + atomics + `--import-memory --shared-memory
  --max-memory=4G` + TLS exports + matching wasm-bindgen CLI).

wc3 (reference to port FROM):
- `rust/client/src/game/world/actor/systems/actor_batch/` —
  `world_compose_slab.rs`, `prebake.rs`, `slab_high_water.rs`,
  `slab_slot_table.rs`, `pump_deferred/` (prewarm/throttle), `deferred_cache.rs`.
- `rust/client/src/engine/render/plugin/render.rs` — `render_with_reuse`
  (the reuse_fast/full driver + per-pass diag).

## How to run / test (exact)
- Emulator: `cd /Users/grandnainconnu/Work/personal/dofus/dofus1.29/emulators/AraknemuHorizon`
  then `TRANSPORT_MODE=websocket /opt/homebrew/opt/openjdk@25/bin/java -jar build/libs/araknemu-0.13-SNAPSHOT-jar-with-dependencies.jar`
  (the `transport{}` block in `config.conf` is already uncommented). Listens :5555, ws upgrade 101.
- wc2 client: `cd dofuswebclient2/apps/electrobun && bunx vite --port 5199 --strictPort --force`
  (COOP/COEP headers already in vite.config.ts). Vite root is
  `src/window/mainview`, so import app modules via
  `/@fs/<abs-path>/...` from the console.
- Build wasm: `cd rust/vello-wasm && wasm-pack build --target web --release`
  (add `-- --features gpu-timing` for the diagnostic build). Restart vite
  `--force` after, hard-reload the page.
- In game: login `admin`/`admin` → Server #1 → char "Felix" → wait for
  STRESS panel. Then in console:
  `__stressLookPoolSize=0; __crowdRenderer.enable(); __crowdSlab(true);
  spawnTestPlayers(300)`. `__crowdSlabStats()` for per-frame stats
  (mode/slots/fast/bakedThisFrame/cacheSize/renderMs).
- ALWAYS verify with a screenshot + `realCrowdContentRatio()` (fraction of
  non-transparent pixels) that the crowd is actually drawn, and confirm
  "is cacheSize advancing" before trusting any stat — the renderer can be
  poisoned/frozen while counters look fine.

## Definition of done
Per-pass GPU breakdown for wc2 AND wc3 at matched actor counts; wc2's
crowd rendering all N actors; framerate within ~1.5× of wc3 measured by
the same (non-lying) method; heap bounded without periodic hitches; a
short md writeup of the real numbers. No fabricated fps.
