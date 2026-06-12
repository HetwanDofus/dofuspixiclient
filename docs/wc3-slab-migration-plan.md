# WC3 → WC2 Renderer Performance Migration Plan

**Goal:** Port the performance work that gets dofuswebclient3 (Bevy) to **500 unique-gear animating actors @ ~89fps on wasm** into dofuswebclient2's PixiJS + `vello-wasm` architecture — then exceed it using the wasm threading that wc2 already has wired and wc3 structurally cannot use.

**Why wc2 is the base** (decided 2026-06-12, browser-only target): the wasm boundary here wraps only the renderer; game logic stays in TS; the vello fork is shallower; Bevy's per-frame machinery and its 0.x upgrade treadmill are left behind. wc3 becomes the donor: its slab/instancing tech lives in vello-layer Rust, not in Bevy, and transplants.

---

## 0. Success criteria

| # | Criterion | Target |
|---|-----------|--------|
| S1 | Actor scale, single-threaded wasm | ≥ parity with wc3: 500 unique-gear animating actors, no dropped geometry, no flashing |
| S2 | With threads enabled | ≥ 1.5× reduction in CPU frame cost vs S1 (measured `prepare_ms` + compose) |
| S3 | Correctness | Full fix-chain checklist (§6) green; visual parity on ≥ 5 random maps incl. bg, accessories, z-order |
| S4 | Stability | 20-minute soak @ 500 actors: no atlas growth, no VRAM creep, no ABA flicker |
| S5 | No regressions | Existing wc2 map/tile/portrait rendering unchanged; existing specs pass |

**The two numbers that validate the whole bet** (measure in Phase 0, before writing port code):
1. **Marginal Pixi composite cost** once crowd is one `ExternalSource` quad (the reported "5–10ms" must be shown to be the *current full scene*, not the floor).
2. **GPU-pass duration** of the vello slab replay at production resolution (the Amdahl floor that threads can't move).

---

## 1. Inventory: what made wc3 fast, and where it lands here

### A. Vello fork patches (wc3 `rust/vello*` @ 0.7 → rebase onto wc2 fork @ 0.8, wgpu 28)

| Patch | wc3 location | wc2 status |
|---|---|---|
| Bump-buffer doubling (tiles, lines, seg_counts, segments, ptcl, bin_data, blend_spill) | `vello_encoding/src/config.rs` | **Already present** (`config.rs:398`) — verify constant parity only |
| CPU/GPU resolve split (`resolve_with` / `run_resolved`, rayon-parallel) | — (wc2-original) | **Already present** — keep |
| Retained-scene reuse API: `ReuseToken`, `ResolvedReuse`, `Renderer::*_reuse` (~9 methods) | `vello/src/lib.rs` + engine | **Port** |
| Recording/replay + persistent textures bound as `ExternalResource::Image` (slab atlas, ramps — uploaded at intern, recordings carry no texture uploads) | `vello/src/` (DOFUS blocks) | **Port** |
| Tier-6/7 WGSL shader mods: instancing, NaN sentinels, per-zone color overlay | `vello_shaders/shader/*.wgsl` | **Port** (Tier 7 only; Tier 6 is superseded WIP — skip) |
| `Extend::Pad` for non-repeating bitmap fills | vello fill handling | **Port** (guards upscaled-tile bleed) |

Result: **one fork to maintain** (wc2's 0.8/wgpu 28), wc3's 0.7 fork retired. Expect mechanical churn rebasing across vello 0.7→0.8 and wgpu 27→28 (API renames in render graph / buffer binding). The pristine vendored `wgpu` copy stays pristine.

### B. Slab core (wc3 `rust/client/src/game/world/actor/systems/actor_batch/`)

Per-frame model to preserve exactly: **persistent GPU-resident bytes + fresh per-frame recording replay**. Persistent: `SubLibrary` (interned encoding segments, large GPU buffer), slab atlas (pinned, pre-sized 4096², reset per map epoch), ramps texture, `EncodingArcCache` (strong `Arc<Encoding>` — ABA guard), `SlabBandHighWater` (envelope pinning → `reuse_fast` 100%). Per frame: descriptor/aux tables in sorted emit order (`SlabSlotDesc` 5×u32, `SlabSlotAux` 12×u32), per-actor transforms + 3-zone color patches + **integer depth ordinals** in the sort key.

Portability split:
- **Plain Rust (move nearly as-is):** slot/aux table builders, intern caches, atlas manager, sort-key construction, color patching, `SlabStreamTotals`, prebake encoders.
- **Bevy-coupled (rewrite as functions):** ECS queries feeding the compose (becomes: read from typed-array inputs), `Res<>`/`Commands` plumbing, Bevy `Handle<Image>` targets (becomes: wgpu textures owned by `vello-wasm`), the pump/prewarm scheduling (becomes: explicit calls from the frame driver, keeping the **1-decode-per-frame throttle** — in-task yields do not work on the wasm executor).

**Destination: a new Bevy-free crate `rust/dofus-slab/`**, consumed by `vello-wasm`. Keeps the slab Pixi-agnostic and natively testable.

### C. Prebake & caches (wc3 `actor_batch/prebake.rs`, `pump_deferred/`, `deferred_cache.rs`)

Body grids (BodyKey × anim × 8 directions, path-aware for movers; local player's full static/walk/run grid), accessories with **`singleton_threshold_hint: true`** (expand-splice path otherwise deletes host geometry), 128-bit content-hash dedup, rkyv zero-copy archives in IndexedDB, 240-frame sweep + LRU.

**Scope decision — asset source:** wc2 feeds vello from offline `.dofasset` frames (paths, draw commands, color zones, accessory slots); wc3 decodes SWF at runtime via `swf-spike` lazy rkyv bundles (open <1ms, materialize-on-lookup). **The slab interns vello `Encoding`s and does not care where they came from.** Phase 2 therefore adapts the prebake to consume `.dofasset` frames (wc2's existing `queueFrame` path already produces encodings). Porting wc3's runtime SWF decode is **Track B — optional**, valuable only if/when the offline `tools/` pipeline becomes the bottleneck for asset coverage.

### D. Instrumentation & validation (port early, not last)

- `gpu-timing` feature: `vello.prepare_ms` / `replay_ms` split — the numbers every gate below reads.
- Headless visual snapshot harness (wc3 `rust/swf-spike/src/headless.rs`): renders scenes on a headless GPU for pixel-diff regression. Known gap: image-fill tiles in slab.
- Dev controls: `devSetSlab(n)` / `devSpawnStress(N)` analogs as `vello-wasm` exports driven from the browser console.

### E. Explicitly NOT ported

Bevy plugins/ECS, the React↔Rust `web_bridge` (snapshot/commands), Bevy render-app extract, band-compose scheduling specifics, Tier-6 WIP, the anim "frozen-frame hold" variants (rejected in wc3 — caused negative-hue colors; idle = intentional 1-frame clamp + comprehensive prebake instead).

---

## 2. Target architecture (end state)

```
TS (main thread)                      wasm (vello-wasm + dofus-slab)         GPU
─────────────────                     ────────────────────────────────       ─────────────
game stores/handlers ──looks──▶  slabIntern(look)  ──▶ prebake → SubLibrary (persistent)
crowd-renderer.ts ──Float32/Uint32──▶ slabUpdate(pos,frame,dir,ordinal)
rAF tick ───────────────────────▶ slabFrame() ── compose + resolve_with ──▶ run_resolved
                                          │        (rayon when threads on)        │
PixiJS ◀── one ExternalSource quad ◀── crowdTextureHandle() ◀── slab atlas target ┘
input  ──▶ slabPick(x,y) ──▶ actor id (hit_test port)
map transition ──▶ slabMapEpoch() ──▶ atlas reset + high-water release
```

Boundary rules: positions/frames/ordinals cross as flat typed arrays every frame (already the `crowdUpdatePositions`/`crowdUpdateFrames` shape); looks cross sparsely on change (already `crowdUpdateLooks`). **Nothing per-actor crosses as JSON, ever.**

---

## 3. Phases

### Phase 0 — Baselines & instrumentation *(no port code yet)*
1. Port the `gpu-timing` feature into wc2's fork; add `prepare_ms`/`replay_ms` readouts to a debug overlay or console export.
2. Measure wc2 today: crowd path @ 300/400 actors — CPU compose, resolve, GPU pass, and **isolated Pixi composite cost** (render the crowd texture quad against an empty stage).
3. Re-measure wc3 @ 500 on the same machine/browser for an apples-to-apples baseline (use existing `devSpawnStress`, gpu-timing).
4. Stand up the headless visual harness against wc2's vello fork (native target) with 2–3 golden scenes from `.dofasset` content.

**Gate G0:** baseline table exists; Pixi marginal composite confirmed ≤ ~1ms; GPU-pass floor known. *If the GPU floor alone exceeds ~8ms at production resolution, revisit scope before proceeding — threads won't save it.*

### Phase 1 — Unify the vello fork
1. Diff wc3's `vello*` 0.7 fork against upstream 0.7.0 → extract the patch set (reuse API, recording/replay + external-resource images, Tier-7 WGSL, `Extend::Pad`).
2. Rebase onto wc2's 0.8/wgpu-28 fork. Reconcile bump-buffer constants (take the max of each pair). Keep wc2's resolve split untouched.
3. Mark every divergence with a `// DOFUS:` block comment (wc2 convention) — this is the fork's survival manifest for the next vello rebase.
4. Build matrix green: native (harness) + wasm (no-threads) + wasm (threads).

**Gate G1:** harness goldens still pass on the unified fork; existing wc2 crowd path renders unchanged on it.

### Phase 2 — Prebake on `.dofasset`
1. Create `rust/dofus-slab/` crate. Move wc3's plain-Rust pieces: intern caches, atlas manager, slot/aux builders, sort key, prebake encoders, content-hash dedup.
2. Adapt prebake input from swf-spike symbols → `.dofasset` frame decode (reuse `queueFrame`'s existing decode path; share, don't duplicate).
3. Wire rkyv + IndexedDB warm cache for prebaked encodings (content-hash keys, version-stamped — bump on any encoding-format change).
4. Keep: accessory `singleton_threshold_hint`, the 1-decode-per-frame throttle, 240-frame sweep/LRU.

**Gate G2:** native test interns a full body grid + accessories from `.dofasset` input; dedup hit-rates logged; encodings byte-identical across runs (idempotency).

### Phase 3 — Slab core, headless
1. Port compose: per-frame descriptor/aux table build from flat input arrays, integer-ordinal depth sort, color patches, fresh recording referencing persistent `SubLibrary` + atlas + ramps.
2. Port atlas lifecycle: pinned 4096² pre-size, per-MapEpoch reset, high-water pinning.
3. Verify the GPU buffer sizing against **WebGPU device limits**: wc3's `SubLibrary` reserves up to 1 GiB on native — wasm must request `maxBufferSize`/`maxStorageBufferBindingSize` explicitly and degrade capacity gracefully if the adapter declines. (wc3 ran in-browser, but confirm the actual requested limits rather than assuming.)
4. Drive it from the harness: 500 synthetic stress actors, random looks, animating, headless render + pixel-diff.

**Gate G3:** 500 stress actors headless: correct output, `reuse_fast` 100% after warmup, stable memory across 10k frames.

### Phase 4 — `vello-wasm` + TS integration
1. New exports: `slabIntern(lookBytes)`, `slabUpdate(descArr, auxArr)` (or split pos/frame/look to mirror existing crowd API), `slabFrame()`, `slabPick(x,y)`, `slabMapEpoch()`, `slabStats()`.
2. Extend `crowd-renderer.ts` to drive the slab behind a flag (`renderer=slab` query param / dev toggle), reusing `crowdTextureHandle()` + `ExternalSource` mounting and the existing z-position vs map tiles.
3. Depth ordinals: compute in TS where battlefield order is known (reuse existing Y-sort/zIndex logic) and pass as integers — **the f32-epsilon mistake must not be reintroduced at the boundary**.
4. Picking: port `hit_test.rs`; reconcile with wc2's existing pickability so hover/click resolves through `slabPick` when the flag is on.
5. Map transitions: hook wc2's map-transition machine → `slabMapEpoch()`.
6. Submit ordering: slab `slabFrame()` submit must complete before Pixi samples the atlas texture in the same rAF — same queue, keep the existing crowd renderer's ordering pattern.

**Gate G4:** in-app, flag on: 500 stress actors on a real map, fps ≥ wc3 parity, gear/colors/z-order visually correct.

### Phase 5 — Correctness hardening
1. Run the **fix-chain checklist** (§6) as explicit manual/automated probes — each item is a bug wc3 already paid for once.
2. 20-minute soak @ 500 actors across ≥ 3 map transitions: watch atlas occupancy, JS heap, `slabStats()`.
3. Visual pass on ≥ 5 random maps with mixed crowd + per-player paths (mounted actors stay on the strip-renderer path, as today).
4. Add harness goldens for: accessory layering, recolor zones, image-fill tiles (the known wc3 harness gap — close it here).

**Gate G5:** checklist green, soak clean, specs green.

### Phase 6 — Threading
1. Enable the dormant `threads` feature (wasm-bindgen-rayon, 2–8 workers; COOP/COEP already in `vite.config.ts` — verify Electrobun/prod hosting serves the same headers).
2. Parallelize: `resolve_with` (already rayon-shaped) + slab compose table build (rayon over actor chunks). Main thread cannot `Atomics.wait` — accept the spin-join or move `slabFrame()` fully into a worker.
3. Measure single- vs multi-threaded on the Phase 0 rig; record parallel efficiency.
4. **Stretch:** whole-pipeline-in-worker via OffscreenCanvas (render loop immune to main-thread jank) — separate decision, not a blocker.

**Gate G6:** S2 met (≥1.5× CPU frame-cost reduction) or a written finding that the GPU floor now dominates (which is success of a different kind: scale actor count instead).

### Phase 7 — Cutover & cleanup
1. Default the flag on; one release cycle with `renderer=legacy` escape hatch; then delete the superseded crowd internals and the player-strip v1 path.
2. Retire wc3's vello fork; wc3 remains read-only reference + harness donor.
3. Write the fork-maintenance runbook (patch manifest from Phase 1, rebase procedure, upstream candidates: bump-buffer parameterization, resolve split — both plausibly upstreamable to shrink the fork).

---

## 4. Workstream view (parallelizable)

| Track | Phases | Independent of |
|---|---|---|
| Fork unification + harness | 0–1 | everything else |
| `dofus-slab` crate (prebake + compose) | 2–3 | TS work |
| TS boundary + picking + transitions | 4 | can start API design during 2–3 |
| Threading | 6 | needs 3; header verification can start day 1 |
| Track B: runtime SWF decode (swf-spike lazy rkyv) | optional | only if `.dofasset` coverage becomes the constraint |

---

## 5. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| vello 0.7→0.8 / wgpu 27→28 rebase churn breaks reuse API semantics | High | Harness goldens before/after (G1); patch manifest with `// DOFUS:` markers |
| "Pixi composite 5–10ms" turns out real | High | Measured at G0 before any port code; if real, profile/strip the Pixi stage first |
| GPU floor higher than expected at HiDPI | Medium | G0 measures it; fallback = wc3-style resolution scaling; threads still buy main-thread freedom |
| WebGPU buffer limits < `SubLibrary` sizing | Medium | Phase 3.3 explicit limit requests + graceful capacity degradation |
| Fix-chain regressions reintroduced during de-Bevy rewrite | High | §6 checklist is a gate, not advice; each item gets a probe |
| Boundary backslide to JSON / per-object calls | Medium | API review rule: per-frame data is typed arrays only |
| COOP/COEP breaks prod embedding/CDN | Low–Med | Threads are feature-flagged; S1 parity must hold without them |
| `.dofasset` frames missing content wc3 got from runtime SWF (morphs, AVM1-driven anims) | Medium | Audit during Phase 2; Track B exists as the escape hatch |
| Shared-queue ordering stall (slab submit vs Pixi sample) | Low | Existing crowd renderer already solves this pattern; keep it |

---

## 6. Fix-chain regression checklist (every item was a real wc3 bug)

| # | Guard | Symptom if regressed |
|---|---|---|
| 1 | Depth/paint order = **integer ordinal** in sort key, never f32 epsilons (depths ~46k have ULP 0.0039 > 0.0005 epsilons) | Accessory layering flickers/swaps |
| 2 | Intern caches hold **strong `Arc<Encoding>`** | ABA: wrong sprite bytes after pool reuse — random actor corruption |
| 3 | `SubHandle` offsets are **u32** (u16 wraps at 65535 words) | Large symbols corrupt neighbors |
| 4 | `bin_data_start` not clobbered across reuse | Frame-to-frame flashing |
| 5 | Atlas pinned + pre-sized; reset **only** on MapEpoch | Mid-map realloc → hitch + stale sprites across maps |
| 6 | `SlabBandHighWater` envelope pinning | `reuse_fast` misses → silent fallback to slow path |
| 7 | Accessories appended with `singleton_threshold_hint: true` | Host tile geometry silently deleted |
| 8 | Persistent atlas/ramps bound as `ExternalResource::Image`; recordings carry **no texture uploads** | Per-frame upload churn → the old 14MB/frame regression |
| 9 | Non-repeating bitmap fills use `Extend::Pad` | Tile edge bleed ("8× duplicated" look) |
| 10 | Never zero-fill large render targets at creation (uninit + first-use clear) | Multi-second entry stall |
| 11 | 1 decode per frame max; no in-task yields on wasm | Map-entry freeze |
| 12 | Empty band/target must clear once on becoming empty | Previous map's pixels ghosting |
| 13 | Diagnostics (stats walkers) on ~1Hz throttle, never 60Hz | Mystery 6ms/frame loss |
| 14 | Anim variant keys include rot_quarters + flip_x where applicable | Animated tiles flicker rotations |
| 15 | Idle anims = 1-frame static clamp via prebake; **no frozen-frame holds** | Direction-change twitch or negative-hue recolor |

---

## 7. Source map (wc3 → wc2)

| wc3 source | → wc2 destination |
|---|---|
| `rust/vello/src/lib.rs` reuse API (ReuseToken, ResolvedReuse, `*_reuse`) | `rust/vello/` fork (rebased) |
| `rust/vello_shaders/shader/*.wgsl` Tier-7 mods | `rust/vello_shaders/` fork |
| `rust/vello_encoding/src/config.rs` buffer consts | verify vs existing `rust/vello_encoding/src/config.rs:398` |
| `actor_batch/prebake.rs`, `deferred_cache.rs` | `rust/dofus-slab/src/prebake.rs`, `cache.rs` (input: `.dofasset`) |
| `actor_batch/world_compose_deferred.rs`, `setup.rs`, `resources.rs` (SubLibrary, EncodingArcCache, SlabBandHighWater, SlabSlotDesc/Aux) | `rust/dofus-slab/src/{compose,atlas,types}.rs` |
| `actor_batch/hit_test.rs` | `rust/dofus-slab/src/pick.rs` → `slabPick` export |
| `actor_batch/pump_deferred/` (throttle, prewarm) | `rust/dofus-slab/src/pump.rs`, driven by `slabFrame()` |
| `swf-spike/src/headless.rs` harness | wc2 harness target against the unified fork |
| gpu-timing (`prepare_ms`/`replay_ms`) | `vello-wasm` feature + `slabStats()` |
| `devSetSlab` / `devSpawnStress` | `vello-wasm` dev exports + console hooks in `crowd-renderer.ts` |
| swf-spike lazy rkyv S2 decode | **Track B only** |

---

*Baseline references: wc3 slab status (500 @ ~89fps, 20-min soak passed, user-verified 2026-06-10); wc2 crowd renderer (300–400 @ 60fps). Repo state at planning time: wc2 on `swf-integration`, clean tree.*
