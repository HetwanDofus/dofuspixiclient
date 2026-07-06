# KICKOFF — wc2 consolidation branch (prompt + context)

You are working in `dofuswebclient2` (wc2) — the PixiJS + React + vello-wasm
Dofus 1.29 client. This is now THE client (strategic decision 2026-07-06;
the Godot/C++ and Bevy/wc3 clients are frozen reference implementations).
Your mission on this branch, in order:

1. Commit the current work, create the consolidation branch.
2. Enforce GPU memory discipline in the patched wgpu (allocation
   accountant + watchdog) and fix every remaining GPU leak.
3. Port the newer wc3 Rust code into wc2: swf-spike (major merge),
   minimap, AVM1, tile behaviors.
4. Implement canonical creature mode with a >300-actor auto-switch.
5. Hold a hard 60 fps floor — honestly measured — across all scenarios.

Work autonomously, measurement-first, one phase at a time. Never claim a
perf/memory result you didn't measure. Never trust an in-page rAF fps
counter — they read 60 while the compositor runs at 17 (proven repeatedly).

## Read these first (in order)

1. `CPU_RENDER_FEASIBILITY.md` (repo root) — tier strategy, the
   WindowServer-kill post-mortem (why memory discipline is Phase 1), the
   fleet-reality section, vello_cpu numbers.
2. `../dofuswebclient3/CROWD_PERF_HEADTOHEAD.md` — the slab architecture's
   final form, the degradation root-causes, P1–P3 plan (P1 still open:
   strip-renderer residue causes frameMs P99=41 hitches).
3. `docs/NEXT-SESSION-crowd-perf-port.md` — the traps list (READ THE
   TRAPS), run recipes, key file map.
4. `RENDER_STATE.md` + `RENDER_AUDIT_CONCLUSION.md` — bake pipeline
   measurements, cache inventory, what was already proven wrong.

## Phase 0 — commit + branch + baseline

Current branch is `slab-migration` with uncommitted session work:

- Keep and commit: `rust/vello/src/record.rs` + `scene.rs` recorder hooks,
  `rust/cpu-bench/`, `rust/cpu-bench-wasm/`, swf-spike nogpu entries +
  `set_record_fragments` (`render/{mod,band,cache}.rs`),
  `rust/swf-spike/src/bin/bench_gpu_strip.rs`, `CPU_RENDER_FEASIBILITY.md`,
  Cargo.toml/lock changes. Suggested message:
  `feat(cpu-bench): vello_cpu feasibility harness + Scene recorder + GPU strip reference`.
- Delete before committing (junk build dirs): `rust/target-nosimd/`,
  `rust/target-relaxed/`; gitignore `rust/cpu-bench-wasm/pkg*/`.
- Inspect `crowd-renderer.ts` and the `assets/sources/starloco/sorts.sql`
  deletion + `packages/dofus1-registry` submodule bump — commit or revert
  deliberately, don't sweep them in blind.

Then: `git checkout -b consolidation`.

Baseline measurements (record in a `BASELINE.md` on the branch, with the
exact commands): steady-state fps (honest, see Phase 4 methodology) at 0
and 300 crowd, GPU resident bytes plateau over a 10-min 300-crowd soak,
`__crowdSlabStats()` (buildMs, fast, cacheSize, sublibMB), map-load and
zoom-step walls. Every later phase must beat-or-match this baseline.

## Phase 1 — GPU memory discipline (do this BEFORE the big port)

Context: the dev-machine "PC crashes" were WindowServer watchdog kills —
Chrome's GPU process ballooned to 8.6 GB (unified memory) from our
allocation floods and wedged the GPU channel during teardown
(`CPU_RENDER_FEASIBILITY.md` post-mortem, evidence `~/Desktop/test.json`).
The proximate bugs are fixed; this phase closes the CLASS.

The fork already patches wgpu 28 with a deferred-destroy GC
(`tickDeferredDestroys`, Drop is a no-op). Do NOT attempt a wgpu major
version bump — vello 0.8 pins wgpu 28 and the fork delta is large;
instead formalize the patch:

1. **Allocation accountant**: a global ledger in the patched wgpu counting
   every buffer + texture byte (including bake temp pages — the ~256 MB
   colour/zone temps are the historical killers). One hard budget
   (configurable, default well under the machine's headroom). Exceeding it
   makes the allocation FAIL and surfaces a bake error + telemetry — it
   never allocates past budget. The deferred-destroy GC already sees every
   resource's lifecycle; hang the ledger there.
2. **Allocation-rate watchdog**: > X MB allocated within Y frames →
   pause bakes / degrade (log loudly, keep rendering last-known state).
   Floods must become stutters, never host kills.
3. **Leak audit**: with the ledger in place, run the 300-crowd stress +
   map-switch loop + zoom sweep for 30 min. Acceptance: resident bytes
   plateau (no monotonic growth), `evict` ≈ 0 steady-state, zero budget
   refusals, and a per-label breakdown (`pixi.byLabel`-style) showing no
   orphaned categories. Known past leak classes to re-verify: strip
   renderer residue (P1 — retire strip slots for crowd-managed bots),
   page-temp lifetimes, fallback textures, per-frame handle clones fed to
   the deferred GC.
4. Expose ledger counters in the debug overlay + a `window.__gpuLedger()`
   hook.

CRITICAL RULE from the traps doc: any GPU resource you create must keep
its Rust handle alive for its whole usable life — short-lived clones get
reaped by the deferred-destroy GC while still bound (this bug froze the
screen twice: dummy texture, SubLibrary buffer, sub_library per-frame
clone).

## Phase 2 — port wc3 → wc2 (swf-spike merge, minimap, AVM1, tiles)

wc3 (`../dofuswebclient3/rust/`) carries the newer, modularized swf-spike.
This is a MERGE, not a copy: inventory first (`diff -rq` both `src/`
trees), take wc3 as the base/spine, then REWIRE wc2's consumers onto
wc3's deferred-op bake pipeline — most "wc2-only" modules are capture
workarounds that wc3's pipeline makes unnecessary (map below). Only the
Pixi strip-tier machinery is genuinely wc2-specific.

wc3 adds (take): modular `avm1/` (`exec/`, `renderer/`, `effect.rs`,
`lang.rs` — lang catalogs power spell/dialog text), `bake.rs` +
`bake_body.rs`, `tile_script.rs` + `tile_behavior/`, `repack/`,
`native_bitmap.rs`, modularized `shape/`, `swf_doc/`, `wgpu_filters/`,
`render/{cmdlog,deferred,entry,tile_parts}.rs`, `render/filter/`, and a
large diagnostic bin suite.

wc2-only FILES are mostly NOT wc2-only FUNCTIONALITY — wc3 implements
richer equivalents inside its deferred-op bake pipeline. Equivalence map
(verify each during inventory, prefer the wc3 side where it subsumes):

- `zone_patch.rs` (thread-local capture) → SUBSUMED by wc3
  `bake_body.rs` (`PrebakedFill { zone, authored_rgb, gpu_patches }`,
  zones tagged natively in deferred ops). Adopt wc3's; delete the
  capture sink after rewiring.
- `hit_geometry.rs` (capture sink) → SUBSUMED by wc3
  `client/.../actor_batch/hit_test.rs` (walks retained deferred ops;
  wc2's own header says the sink exists only because wc2's bake didn't
  retain ops). Adopt deferred ops → delete the sink.
- `phased.rs` (static/dynamic tile split) → compare with wc3
  `render/tile_parts.rs` + `tile_behavior/`; keep whichever is
  strictly more capable.
- `slot_depths.rs` + `band.rs` (Z-band decomposition) → Z-bands are a
  COARSER PROJECTION of wc3's `DeferredBodyFrame` (ordered ops with
  inline `Mount` markers): a band = the segments between mount markers.
  Keep bands as the Pixi RASTER PACKAGING (atlas keys, body-band-batch
  UVs, silhouettes, IDB are band-keyed — don't churn that), but derive
  band contents FROM the deferred stream and retire `slot_depths.rs`'s
  timeline analysis (bFix-sensitive bands, presence maps, toggle
  special cases) as the source of truth. Keep
  `render_body_band_nogpu` until the strip tier reads deferred ops.
  Note: `DeferredOp` can also replay directly into vello_cpu (it's a
  display list with `recolor_zone` per op) — the CPU tier should feed
  off the same cached deferred ops as the slab; `vello::record` then
  remains only for whole-scene capture (tiles, spells, benches).
- `cache.rs` `set_record_fragments`, the `*_nogpu` entries,
  `bin/bench_gpu_strip.rs`, `vello::record` compatibility (cpu-bench
  depends on it), `mount_transforms.rs`/`union.rs`/`probe.rs` →
  genuinely wc2-only, keep.

KEY ADOPTION TARGET: wc3's `bake_body.rs` is wgpu-free with a
byte-identical worker transfer format (worker- and main-baked geometry
collapse in the content-dedup pool). Adopting it (a) replaces wc2's
broken threaded-bake-pool story, (b) plugs directly into the CPU-tier
web-worker bake sharding (measured 3.6× @ 4 workers), and (c) carries
`content_hash.rs` dedup. The merge goal is: wc3 pipeline as the spine,
wc2's consumers (`slab_crowd.rs`, `emit_player_look_split`, class-atlas
bake) REWIRED onto it — not wc2's capture hooks grafted forward.

Method: keep the workspace compiling at every step (grafts behind
temporary feature flags if needed). Verify pixel-parity old-vs-new with
the existing bins (`render-player-tinted`, `render-tile`,
`render-avm1-sheet`) — byte-compare or eyeball PNGs for a fixed set of
classes/tiles/spells. `cargo run --release -p cpu-bench` must still work
(it exercises the whole walk + recorder).

**Minimap**: port `../dofuswebclient3/rust/client/src/game/world/banner/minimap.rs`
— it is already React-facing (composes superarea bitmap
`clips/maps/<superarea>.swf` + `hints.swf` + player cursor into an
offscreen image, blits to a React `<canvas>`, publishes hover state).
Adapt the Bevy plumbing to vello-wasm exports + a React component in
`apps/electrobun`. Mirrors `MiniMap.as` placement math (comments carry the
exact line refs).

**AVM1**: wc2's `avm1/` is the old single-file version; the port brings
spell FX + interactive-object fidelity. After the merge, verify with
`render-avm1-sheet` on spell 802 + a few others against wc3's output.

Scope control: `dofus1-net` (Rust codec) and `repack/` are OPTIONAL —
inventory them, port only if they're load-bearing for the above; wc2's TS
net stack stays.

## Phase 3 — creature mode (canonical, from the AS2 source)

Read the canonical implementation in `assets/sources/client-code/`:
- `ank/battlefield/SpriteHandler.as:605` `setCreatureMode(bEnabled)` —
  for every `Character` (never `Mutant`), if `canSwitchInCreaturesMode`:
  save `gfxFile` + `mount`, clear the mount, swap the sprite gfx to
  `CLIPS_PERSOS_PATH + <breed> + "2.swf"` (the decompiler mangles the
  breed property as `.Guild` — verify: the creature files are
  `sprites/{breed}2.swf`; `12.swf`, `22.swf`, … `122.swf` all exist in
  `assets/sources/clips/sprites/`). Disable restores saved gfx + mount.
- `dofus/managers/GameManager.as:973` `applyCreatureMode()` — only when
  `!Game.isFight && gfx.isContainerVisible`; ON when
  `playerCount >= threshold`, OFF when `playerCount < threshold - 2`
  (hysteresis). Threshold = option `CreaturesMode`
  (`OptionsManager.as:6`, canonical default 50, slider in Options UI).
- `dofus/datacenter/Character.as:175` `canSwitchInCreaturesMode` =
  restriction bit `0x40` not set (server-controlled).

Implement in wc2:
- Option `CreaturesMode` threshold, **default 300** (product decision;
  keep the option UI so it's user-tunable like canonical). Hysteresis:
  canonical −2; at our scale use −10 to avoid flapping, note the
  deviation.
- In the crowd/slab path: creature-mode actors take look =
  `{breed}2.swf` body, NO accessories, NO mount, palette handling as the
  creature SWF supports (verify zones by rendering `12.swf` tinted with
  `render-player-tinted`). Effect on the slab: unique-sub set collapses to
  ≤12 breeds × dirs × frames — this is the canonical mechanism that makes
  huge crowds cheap.
- Respect restriction bit 0x40 per actor; never in fights.
- Verify: spawn 400 stress bots → auto-switch fires (screenshot: generic
  breed creatures), drop below 290 → restores full looks (screenshot),
  `__crowdSlabStats()` shows the sub-set collapse, fps holds (Phase 4
  methodology).

## Phase 4 — the 60 fps floor (hard acceptance gate)

Honest measurement ONLY:
- Present rate via the DevTools compositor/GPU track (DrawFrames over a
  ≥20 s window) or the engine diag `frame.between` p50/p95/max — NEVER
  the rAF overlay counter.
- On the 120 Hz dev display, "nothing under 60 fps" = after warmup, no
  frame interval > 16.7 ms in any scenario below (a single isolated
  >16.7 ms frame per 10 s window is tolerable ONLY if < 33 ms and
  documented with its cause).

Scenarios (each measured, each in `BASELINE.md` → final report):
1. Idle in-world, 0 crowd.
2. 300 unique crowd, walking (slab path, `__stressLookPoolSize=0`).
3. 400 crowd → creature-mode active.
4. Crowd spawn storm (0 → 300 in one command).
5. Map switch ×10 in a row.
6. Zoom step through all levels at 300 crowd.
7. 30-min soak: flat memory ledger, zero budget refusals, fps criteria
   still met at the end.

Known open cause to fix here (from the head-to-head doc, P1): the strip
renderer's residue for crowd-managed bots (3 GB + texture churn →
frameMs P99=41). Retire strip slots for crowd bots at spawn; keep the
strip renderer code alive — it is the CPU-tier fallback architecture, per
`CPU_RENDER_FEASIBILITY.md`. Do NOT delete it.

Automate what you can as a headless-Chrome gate (the measurement-sweep /
stress-test harness patterns exist) so regressions fail a disposable run.

## Run recipes (verified working)

- Emulator: `cd ../../emulators/AraknemuHorizon && TRANSPORT_MODE=websocket
  /opt/homebrew/opt/openjdk@25/bin/java -jar
  build/libs/araknemu-0.13-SNAPSHOT-jar-with-dependencies.jar`
  (listens :5555, ws upgrade).
- Client: `cd apps/electrobun && bunx vite --port 5199 --strictPort --force`
  (COOP/COEP already configured). Hard-reload after wasm rebuilds.
- Wasm build: `cd rust/vello-wasm && wasm-pack build --target web --release`
  (`bakePoolSize=0` stays — the threaded bake pool is broken/panics; the
  pkg is non-threaded).
- In game: login `admin`/`admin` → Server #1 → char Felix → console:
  `__stressLookPoolSize=0; __crowdRenderer.enable(); __crowdSlab(true);
  spawnTestPlayers(300)`. Stats: `__crowdSlabStats()`. ALWAYS verify with
  a screenshot + `realCrowdContentRatio()` that the crowd is actually
  drawn before trusting any number.

## Traps (each cost a past session — do not relearn them)

1. In-page fps counters lie. Compositor track or frame.between only.
2. Deferred-destroy GC reaps short-lived wgpu handle clones while still
   bound → keep handles alive for the resource's usable life.
3. `swf_render_caches` / fragment caches key by shape id per bundle —
   fill caches before flipping global toggles like `set_record_fragments`.
4. Multi-worker GPU bake is a measured dead end (driver serializes,
   1.04×). Don't retry it. CPU bake workers shard near-linearly instead.
5. Back-to-back page-temp bakes must yield to rAF so the deferred-destroy
   queue drains — synchronous sweeps OOM'd the GPU twice.
6. Long CDP sessions degrade (JS heap → GC stalls → false-low fps);
   restart the browser for clean numbers.
7. A pointer-keyed sub interner is fine only if upstream dedup produces
   stable Arcs (content-hash) — that invariant is what keeps the sublib
   bounded.

## Definition of done

- `consolidation` branch: committed, compiling, all phases' acceptance
  met, with `BASELINE.md` → final measured comparison table.
- GPU ledger live (budget enforced, counters in overlay), 30-min soak
  flat, zero refusals in normal play.
- wc3-parity: minimap rendering in React, AVM1 spell sheet parity,
  tile behaviors classified like wc3; pixel-parity checks archived.
- Creature mode: canonical semantics, auto ≥300 (hysteresis), verified
  by screenshots at 400 crowd, restriction bit respected.
- All seven fps scenarios pass the 60 fps floor with honest measurement,
  documented in a short final report (real numbers, no fabrication).
