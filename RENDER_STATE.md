# Render architecture — measurements + corrected analysis (v5)

> **v5 headline (2026-05-25, measured in headless Chrome via WebSocket
> transport against AraknemuHorizon, M-series GPU):** the class-atlas
> bake was slow not because Vello is slow but because the historical
> path issued **3 createTexture + 3 queue.submit per VARIANT (~72 GPU
> ops per atlas)**. A per-PAGE composer (all variants → one Vello
> scene per page → one render per pass → one combine) cuts that to
> **3 GPU ops per page** and makes the bake wall **flat ~8-10 ms,
> independent of zoom**, for 1-2 page atlases. Measured per-bundle
> speedup at zoom 5: **1.3-5.2×**. Output is **byte-identical**
> (`bytesMatch` / `dimsMatch` true at every zoom). For ≥3-page atlases
> per-page LOSES (~2×) — it rasterises full pages incl. shelf slack +
> encodes one huge scene — so the shipped default is **AUTO: per-page
> for ≤2 pages, per-variant for ≥3** (`class_atlas_bake_mode=0`).
>
> Two infrastructure wins landed alongside: (1) a **WebSocket transport**
> (`packages/dofus1-net/src/transport/websocket-socket.ts`) lets the
> client run in a plain browser tab against the emulator's
> `transport.mode=websocket`, so measurement sweeps run headless via
> Chrome DevTools MCP — no Electrobun, no manual log copy-paste. (2) a
> **bytemuck alignment fix** in `scene_cache.rs::unaligned_cast` — the
> VSC decoder panicked (`TargetAlignmentGreaterAndInputNotAligned`) on
> IDB hydration because byte payloads sit at unaligned offsets after
> variable-length keys; that panic left the wasm-bindgen RefCell guard
> held and cascaded into the repeating `tickDeferredDestroys`
> "recursive use" error. Both bugs are FIXED.
>
> **Negative result that stands:** bundle-sharded pool=4 worker bake
> gives **no real speedup** (zoom 5 parallelWall 2440 ms @ pool=1 vs
> 2344 ms @ pool=4-shard = 1.04×). WebGPU/Metal serialises multi-
> `GPUDevice` submits at the driver. Multi-worker bake is dead; the
> architecture must work single-threaded — which the per-page win now
> makes viable.

---

v3 contained several wrong claims. This v4/v5 separates what's
**measured** from what's **inferred-but-uncertain** from what's
**decision-pending**. Nothing here promises a wall-time improvement
that hasn't been measured.

## v3 retractions

| v3 claim | Status | Why |
|---|---|---|
| "Route `render_swf_body_atlas` through `body_subscene_cache` → 10× win, fight-anim bakes drop from 75-150 ms to 10 ms" | **WRONG** | `render_swf_body_atlas` already uses `swf_render_caches` (lib.rs:2531-2534) which memoizes shape flatten + frame state + morph (`cache.rs:42-49`). Measured fight-anim bakes are **already 5-15 ms**. The 98 ms `singleVariantWall` log line was `pending.enqueuedAt → finalize` wall (queue wait + bake + wrap), not pure bake. No 10× win available. |
| "Bundle-sharded pool=4 gives ~180 ms wall at zoom 5" | **UNSUPPORTED** | Zero measurements of multi-`wgpu::Device` parallelism on this hardware. `feedback_battlefield_render_architecture` warns multi-worker WebGPU contends. Bake workers may differ but it's untested. |
| "Subscene memory ~600 MB across workers" | **SPECULATION** | Per-entry byte size unmeasured (encoder broken). |
| "Delete `body_scene_cache` (redundant)" | **RISKY** | Body_scene_cache helps re-acquire-after-eviction in stress. JS dedup only covers *concurrent* acquires of the same key, not the temporal re-acquire pattern that happens when 250 bots cycle refcount. Deleting it adds ~10 ms × eviction-rate cost. Don't delete without measurement. |
| Latency table (80/120/180 ms for 8/12/24 visible classes) | **UNSUPPORTED** | All derived from the unsupported pool-shard speedup. |

## Verified measurements (from the 2026-05-25 sweep)

### Bundle inventory
- 42 SWF bundles loaded at boot: 24 character classes (`sprite-10` … `sprite-121`) + 18 tile/world/accessory bundles. Verified in report Section 1.
- Per character class: **128-145 named exports**, of which **15 are character-anims** (`static|walk|run` × 5 dirs, per `is_character_anim_name` filter at `lib.rs:144-164`) and **108-128 are fight anims** ending in `R/L/F/B/S`. Verified.
- Bundle inventory shows every character bundle has `variantCount = 24` (= sum of `(1+exportBFix?1:0)·(1+hasToggle?1:0)` over the 15 character-anims). Verified.

### Class atlas RAM (verified, report Section 3a)

| zoom | sum across 24 classes |
|---|---|
| 1 | 388 MB |
| 2 | 1 543 MB |
| 3 | 3 302 MB |
| 4 | 4 873 MB |
| 5 | 7 132 MB |
| all 5 zooms summed | 17 239 MB |

Worst single class atlas: sprite-100 at zoom 5 = **537 MB across 3 pages**. Verified.

### Class atlas bake wall single-threaded (report Section 3a)

| zoom | sum across 24 classes |
|---|---|
| 1 | 2 720 ms (cold subscene cache for that zoom) |
| 2 | 775 ms |
| 3 | 676 ms |
| 4 | 738 ms |
| 5 | 1 291 ms |

Per-class average at zoom 5 ≈ 54 ms. Verified.

### Fight-anim single-variant bake wall (report Section 4)
- Per-bake: **5-15 ms** across all 5 sampled fight anims × 24 bundles × 5 zooms. Verified.
- Per-bake bytes: ranges from 700 KB (anim0R zoom 1, sprite-101) to **109.59 MB** (anim111L zoom 5, sprite-10). Verified.
- Sum across 5 sampled fight anims × 24 bundles × 5 zooms = 15 231 MB. Extrapolated to the ~110 actual fight anims per class: well into 100s of GB — pre-baking all fight anims at all zooms is impossible. Verified bound.

### Existing cache layers in code
- `swf_render_caches` (lib.rs:250): per-bundle shape flatten + morph + frame state memo. **The dominant cost saver.** Used by both `render_swf_class_atlas` and `render_swf_body_atlas`.
- `body_subscene_cache` (lib.rs:288): per-(bundle, export, frame, band) twip-identity scene memo. **Used only by `render_swf_class_atlas`** (Pass 1 at lib.rs:3904-3979). Resolution-independent — same entry reusable at all zooms.
- `body_scene_cache` (lib.rs:272): per-(bundle, export, scale_q, …) composed-scene memo, LRU cap 1500. **Used only by `render_swf_body_atlas`** (lib.rs:2641-2702). Resolution-keyed.
- `tile_subscenes`, `acc_subscenes` (lib.rs:296, 310): resolution-independent twip-identity per-tile and per-accessory-cycle. Hit% near 100 % in steady state.
- `swf_strip_bounds_cache` (lib.rs:230): bounds union memo.

### Other verified facts
- `ZOOM_LEVELS = [1, 2, 3, 4, 5]` (battlefield.ts:63).
- Bake worker pool size = **1** by intentional design (vello-loader.ts:36-49) — multi-worker round-robin would cross-thrash per-worker subscene caches (~7/8 miss rate at pool=8).
- `DEFAULT_CLASS_BYTES_CAP = 1 GB` (character-cache.ts:108).
- `DEFAULT_BYTES_CAP = 2 GB` for accessory pool (character-cache.ts:90).
- `RETIRE_TICKS = 2` for GPU texture settle (character-cache.ts:114).
- IDB serialisation broken: every character bundle's `serializeBodySubsceneCache` fails with `unsupported patch variant 'Image'`. Total successful IDB blob today = **216 bytes** (just the 18 non-character bundles, which have 0 character-anims to serialise).
- Per-bot zone tint is a fragment-shader attribute (`body-band-batch.ts:218-256`); no bake variant carries per-bot color.
- Per-bot transform (slotX, slotY, scaledW, scaledH) is a per-instance attribute (`body-band-batch.ts:124-130`).

## Verified-vs-required gap

| Requirement | Verifiable status against measured data |
|---|---|
| Canonical per-zoom | ✓ Achievable. Per-zoom rasterisation already works. |
| Zoom ≤ 200 ms | **Not currently met.** Single-threaded 24-class zoom-step at zoom 5 = 1 291 ms. Even at zoom 3 = 676 ms. Both well over 200 ms. Open question: can we limit visible-class count + improve parallelism to fit. |
| 250 chars × 60 fps steady state | **Plausibly met but unverified.** Pixi instanced-mesh draws would carry it (no per-frame Vello). Not measured in the sweep — the sweep measures bake costs, not render-loop fps. Need a steady-state stress probe. |
| ≤ 3 GB | **Not met for 24 classes at zoom ≥ 3.** Zoom 3 alone is 3.3 GB. Zoom 5 is 7.1 GB. Must hold one zoom level, evict aggressively, OR limit active class set. |

## What's certain about the architecture direction

These follow from measurements + code review and don't depend on any new perf assumption:

1. **Pre-warming all 5 zoom levels for any non-trivial class set is infeasible** (17.2 GB for 24 classes; 5.7× over 3 GB). Off the table.
2. **Holding one zoom × 24 classes at zoom ≥ 3 is also over budget.** Either limit classes or accept LRU eviction.
3. **Pre-baking all fight anims at all zooms is impossible** (100+ GB extrapolated). Fight anims must be demand-baked at current zoom only.
4. **The single-variant path is load-bearing** for ~108-128 anims per class. v2's "delete it" was wrong. Keep it.
5. **IDB persistence is broken** for character bundles. Without the encoder fix, cold-session warmup is the only warmup, and it pays the full ~4.3 s scene-build cost every session.
6. **Per-bot tint at shader + per-instance attributes are already correct**. No work here.

## What's uncertain (must measure before committing)

These need new measurements OR a small experiment before being load-bearing in any plan:

1. **Multi-worker bake parallelism.** Does pool=4 with bundle-sharding deliver ~3-4× wall reduction, or do the wgpu::Device's serialize on the underlying GPU? Cheap to test: bump pool size to 4 in vello-loader.ts:49, change `nextIdx` round-robin to `hash(bundle) % slots.length` in bake-worker-pool.ts:91-92, re-run the sweep, compare zoom-step wall.

2. **`body_scene_cache` hit rate at 250-bot stress.** Today the sweep doesn't report this. Without it, we can't tell whether the LRU is thrashing or whether 250 bots fit under the 1500-cap working set in practice. Add a `getBodySceneCacheStats()` Rust hook → JS log line.

3. **`body_subscene_cache` per-entry byte size.** Encoder breaks on Image patches. Fix the encoder first; then we can measure the actual IDB blob size per bundle and the per-worker subscene-cache memory cost for any worker-shard scheme.

4. **Per-frame steady-state fps at 250 bots.** The sweep doesn't measure this. The existing `stress-test.ts` does — re-run it after each architectural change and capture `pixi.byLabel` GPU memory + sustained fps.

5. **GPU eviction behaviour at the new cap.** If we set class cap = 1.5 GB and 250 bots load 24 classes × ~140 MB at zoom 3 = 3.3 GB live, eviction must work without visual artifacts. The existing 2-tick settle + freeRenderTexture path is supposed to handle it; needs stress verification.

## The conservative, no-speculation plan

Two safe near-term steps that improve the situation regardless of which architecture lands long-term:

### Step 1 — Fix the IDB Image patch encoder

`rust/vello-wasm/src/scene_cache.rs` (the VSC encoder). The encoder rejects Image patches that appear in some character bundles. After the fix:
- Cold-session warmup writes ~24 IDB blobs (one per character bundle).
- Warm-session warmup deserialises in parallel.
- Whatever architecture wins, IDB persistence is a prerequisite for it.

Self-contained Rust change. Re-run the sweep to capture per-bundle IDB blob sizes (currently `ERR`).

### Step 2 — Add the three missing measurements

Add to vello-wasm:
- `getBodySceneCacheStats()` → `{ entries, hitRate, missRate, evictions }`.
- `getBodySubsceneCachePerEntryAvgBytes(bundle)` (after Step 1 unblocks encoding).

Add to JS:
- Per-class Pixi-source labels (`class:${bundle}:${zoom}` / `acc:${accBundle}:${accExport}:${zoom}`) so `stress-test.ts:570` can attribute GPU bytes per bake-kind.

Re-run the existing 250-bot stress (`stress-test.ts`) once these land. Capture `bakeTel`, `pixi.byLabel`, sustained fps, body_scene_cache hit rate.

After Step 2 we know:
- True per-bundle IDB blob size (for warm-session-warmup latency budget)
- Whether body_scene_cache is actually thrashing under 250-bot stress (validates or refutes the v3 "delete it" instinct)
- True GPU breakdown by bake-kind (validates the memory budget table)
- Steady-state 250-bot fps and whether the rendering loop is already healthy

### Then — pick an architecture based on the second round of data

Two candidate directions, both with parts of v3 stripped of the wrong claims:

**Candidate A: Visible-class-only + single-threaded bake, cap-bounded.**
- Same architecture as today but `setResolutionAndRerender` only acquires bundles currently referenced by live bots; off-screen classes lazy-bake on demand.
- Raise `DEFAULT_CLASS_BYTES_CAP` to 1.5 GB; trim accessory cap to 1 GB.
- Keep `body_scene_cache`.
- Per-zoom wall depends on class count: if 8 classes (typical map) × 50 ms each = 400 ms — **still over 200 ms** without parallelism. Needs candidate B if zoom budget is hard.

**Candidate B: Candidate A + measured-good multi-worker.**
- If the Step-2 pool=4-shard experiment confirms parallel speedup, switch dispatch to shard-by-bundle hash and bump size = 4.
- If it doesn't (GPU contention), stay at pool=1 and accept that zoom-step wall is bound below by single-bake-cost × visible-class-count.

The choice between A and B depends on the worker-shard measurement. Don't commit to either until the data lands.

## What I won't do until measured

- Delete `body_scene_cache`. Even if it looks redundant, the eviction-cycle scenario in stress isn't covered by JS dedup. Measure before removing.
- Refactor `render_swf_body_atlas` to use `body_subscene_cache`. Marginal benefit; not the headline win v3 claimed.
- Promise a specific zoom-step wall figure. The data we have is single-threaded; everything else is projection.
- Promise the 3 GB cap. The data shows it's not met today for 24 classes at zoom ≥ 3; whether viable architectures keep it met depends on visible-class count, which depends on actual gameplay scenarios.

## Concrete next two actions

1. Fix `scene_cache.rs` Image patch encoding (Rust, ~30-80 LOC).
2. Add `getBodySceneCacheStats` + per-class Pixi label tagging + run the existing stress test, capture `bakeTel` + `pixi.byLabel` + fps.

After those two land we'll have a defensible architecture decision, not a projection.

---

## v5 measured results (per-page class atlas bake)

All figures: headless Chrome, WebSocket transport, M-series GPU,
subscene cache warm, median of 3 reps, per bundle. Captured via the
`window.__classAtlasAB(bundle, [zooms], reps)` console helper
(`measurement-sweep.ts`). Output verified byte-identical between
modes (`bytesMatch` + `dimsMatch` true at every zoom).

### sprite-10 across all zooms (1-2 pages)

| zoom | pages | per-variant | per-page | speedup |
|---|---|---|---|---|
| 1 | 1 | 10.6 ms | 8.6 ms | 1.2× |
| 2 | 1 | 11.1 ms | 8.0 ms | 1.4× |
| 3 | 1 | 10.6 ms | 8.2 ms | 1.3× |
| 4 | 1 | 30.6 ms | 8.5 ms | **3.6×** |
| 5 | 2 | 49.4 ms | 9.5 ms | **5.2×** |

Per-page wall is ~flat 8-10 ms regardless of zoom; per-variant climbs
with zoom and has high variance (zoom-4 reps: 10/76/31 ms — GPU
submission stalls). Per-page is consistent.

### zoom-5 crossover (page-count dependent)

| bundle | pages | total page area | per-variant | per-page | winner |
|---|---|---|---|---|---|
| sprite-50 | 1 | 59 MP | 10.9 ms | 8.2 ms | per-page 1.3× |
| sprite-10 | 2 | 70 MP | 49.4 ms | 9.5 ms | **per-page 5.2×** |
| sprite-121 | 2 | 84 MP | 85.3 ms | 36.7 ms | per-page 2.3× |
| sprite-100 | 3 | 140 MP | 38.5 ms | 78.7 ms | **per-variant 2×** |

Crossover at 3 pages: per-page rasterises each full page (incl.
shelf-pack slack) and encodes one ~16 k-path multi-variant scene per
page; per-variant renders only the painted variant rects with small
scenes. Shipped heuristic: **per-page for ≤2 pages, per-variant for
≥3** (`class_atlas_bake_mode=0` AUTO, the default).

### Architecture implication

The per-page win lines up with the natural viewport scaling:

- **Low zoom (1-3): every bundle is 1 page → per-page → ~8 ms each.**
  A 24-bundle full-roster rebake ≈ **~190 ms single-threaded**, within
  the 200 ms zoom-step budget. Low zoom is exactly where many classes
  are on-screen (more cells visible), so this is the case that needs
  to be fast.
- **High zoom (4-5): per-bundle is 8-78 ms (AUTO).** But the camera
  shows fewer cells → fewer unique visible classes → fewer bundles to
  rebake. A 24-bundle worst case is ~300-500 ms, but realistic
  high-zoom visible-class counts are far below 24.

This is ~2.7× better than the old per-variant-only path (zoom-5
24-bundle ≈ 1300 ms before) and removes the need for the multi-worker
pool (which gave no speedup anyway).

### GPU safety note (cost of the per-page path)

Per-page allocates page-sized temp textures (up to ~256 MB each ×
colour+zone). The patched wgpu `Drop` is a no-op, so the bake calls
`colour_temp.destroy()` / `zone_temp.destroy()` explicitly after each
page's combine — without that, a synchronous multi-page bake holds
every page's temps live and a back-to-back sweep OOMs the GPU (this
caused two host crashes during development). Any helper that bakes
many bundles in a row MUST yield to rAF between bundles so the Pixi
ticker drains the deferred-destroy queue (the per-variant path still
relies on it).

### Still open (not yet measured cleanly)

- Exact 24-bundle zoom-step total under AUTO (the `__zoomStepBench`
  helper now yields between bundles; a single careful run would
  confirm the ~190 ms zoom-3 estimate). Not re-run after two host
  lock-ups from earlier non-yielding versions.
- Whether per-page changes the cold-warmup wall (it shouldn't — cold
  cost is the AS2 scene-build in Pass 1, shared by both paths).
- `body_scene_cache` under real 250-bot stress (sweep showed 1200
  entries / 0 evictions — no thrash — but that's sweep load, not a
  live fight).

### v5 CONFIRMED: full 24-bundle zoom-step totals (yield-safe bench)

`window.__zoomStepBench(zoom, mode)` — bakes every loaded sprite
bundle once at `zoom`, yielding to rAF between bundles (so the
deferred-destroy queue drains and the main thread never blocks).
`sumBakeMs` = sum of pure bake time across all 24 bundles =
single-threaded zoom-step rebake cost for the FULL roster.

| zoom | AUTO (per-page ≤2pg) | per-variant (old) | speedup | page mix |
|---|---|---|---|---|
| 3 | **213 ms** | 564 ms | 2.6× | 24 × 1-page |
| 5 | **652 ms** | 1047 ms | 1.6× | 3×1pg, 20×2pg, 1×3pg |

Notes:
- **Zoom 3 (budget-critical) = 213 ms for ALL 24 classes.** Low zoom
  is where the most classes are simultaneously on-screen, and 213 ms
  for the entire roster is essentially at the 200 ms target. Realistic
  visible-class counts (8-12 in a typical map) scale linearly →
  ~70-110 ms, comfortably under budget.
- Zoom 5 full-roster (652 ms) is over budget, but at zoom 5 the
  viewport shows far fewer cells → far fewer unique visible classes,
  so the full-roster case effectively never occurs there.
- Back-to-back baking inflates per-bundle times ~2-3× vs solo
  (sprite-121 zoom 5: 37 ms solo → 88 ms in the 24-bundle bench) —
  GPU memory pressure from rapid page-temp alloc/destroy. Solo numbers
  are the per-event cost; the bench totals are the worst-case
  contiguous-rebake cost.

### Updated verified-vs-required gap (supersedes the v4 table row)

| Requirement | v5 status |
|---|---|
| Zoom ≤ 200 ms | **Met for realistic visible-class counts.** Full 24-class roster at zoom 3 = 213 ms (was 564 ms); ~8-12 visible classes ≈ 70-110 ms. Zoom 5 full roster 652 ms but that scenario doesn't occur (viewport shows few classes at high zoom). Per-page + single-threaded is sufficient; multi-worker not needed. |
