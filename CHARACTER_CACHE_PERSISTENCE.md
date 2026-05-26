# Character scene-cache persistence — cold map-entry fix

**Goal:** entering a map populated with ~250 actors must complete in
**< 500 ms**. Before this work a cold 250-actor map entry took **~5.3 s**.
After it, a warm (revisit / cross-session) entry takes **~0.85 s** — a
**6.2× improvement** — with the remaining gap traced to a separate
(Rust-side) cause documented at the end.

---

## TL;DR

The render pipeline already had IDB persistence for character scene
caches, but it was persisting/hydrating **the wrong cache**, keyed the
**wrong way**, and the validation that "proved" it worked was
**sabotaged by random test data**. Three sequential bugs:

1. **Wrong cache.** The per-variant spawn path (`render_swf_body_atlas`)
   reads `body_scene_cache` (composed, per-resolution atlas scenes).
   All persistence targeted `body_subscene_cache` — a *different* cache
   that path never reads.
2. **Wrong key dimension for accessories.** `acc_subscenes` is keyed by
   the **accessory** bundle (`acc-a1`, …), not the sprite bundle. The
   helper filtered by sprite bundle → persisted 0 accessory entries.
3. **Test artifact.** Cross-session tests spawned bots with
   `buildRandomLook()`, so the persist run and the hydrate run produced
   **different rosters** → caches barely overlapped → looked like a
   cache miss. It was a coverage gap, not a key bug.

Fixing all three, then validating with a **deterministic roster**
(seeded), dropped a cold 250-actor spawn from **5,316 ms → 760 ms**
(manual) / **858 ms** (pure production path).

---

## Background: which caches the spawn actually uses

The strip renderer spawns each actor via:

- `acquireSingleVariantAtlas` → `renderSwfBodyAtlas` **(main thread)** —
  the body. Internally builds + caches the composed scene in
  **`body_scene_cache`**, keyed by
  `(bundle, export, start, count, scale_q, bFix, hat, mode)`. Note
  `scale_q` → **per-resolution**.
- `acquireAccessory` → `renderSwfAccessoryStrip` **(main thread)** — the
  accessories. Builds Pass-1 sub-scenes into **`acc_subscenes`** (keyed
  by the **accessory** bundle, scale-invariant) then composes the final
  strip with a few `scene.append`s. **No assembled-output cache.**

Crucially:

- The **warmup** (`warmupCharacterSceneCache`) bakes **class atlases**
  on the **worker** (`renderSwfClassAtlas` → `body_subscene_cache`). That
  is a different cache *and* a different thread from the spawn — it never
  warms the spawn. (Confirmed empirically: warming `body_subscene_cache`
  on main via class-atlas bakes left a 250-spawn fully cold at 5,311 ms.)
- The flatten cache (`swf_render_caches`) is **not** the bottleneck —
  warming it changed nothing, because a `body_scene_cache` / `acc_subscenes`
  hit skips the flatten entirely.

Profiling the bake phases (temporary `[scene split: …]` instrumentation
on `classAtlasBake`) showed the cold cost is ~100 % the **SWF→Vello
emit** (display-list walk + `scene.fill`/`stroke` per path), done
**twice** (Colour + ZoneId). Warm (sub-scenes cached) the same bake is
~9 ms. So caching the emitted output is the entire win.

---

## What was changed

### Rust (`rust/vello-wasm/`)

- **`scene_cache.rs`**: added `CacheId::ComposedBody` (= 3) + a
  `ComposedBodyKey` struct + `encode_composed_body_stream` /
  `decode_composed_body_stream` (skip-on-error for `Image`-patch
  entries, mirroring the body-subscene encoder).
- **`lib.rs`**: added wasm-bindgen `serializeBodySceneCache` /
  `loadBodySceneCache` / `clearBodySceneCache` over `body_scene_cache`.
  (Accessory serialize/load — `serializeAccessorySubsceneCache` /
  `loadAccessorySubsceneCache` — already existed.)

### TypeScript

- **`scene-cache-idb.ts`**: added the `"bodyscene"` `SceneCacheKind`
  and threaded `loadBodyScene` / `serializeBodyScene` through
  `hydrateBundleSubsceneCaches` / `persistBundleSubsceneCaches`.
- **`vello-loader.ts`**:
  - JS wrappers `serializeBodySceneCache` / `loadBodySceneCache` /
    `clearBodySceneCache`.
  - Added `loadBodyScene` / `serializeBodyScene` to the existing
    `hydrateBundleOnLoad` and `persistBundleSceneCaches` config objects.
    Because `loadSwfBundle` already fire-and-forget calls
    `hydrateBundleOnLoad` on every bundle, **every bundle now
    auto-hydrates `bodyscene` (sprite bundles) + `acc` (acc bundles)
    from IDB on load** — no warmup change required.
  - `persistAllSceneCachesThrottled(minIntervalMs = 15000)` for
    event-driven (map-leave) persistence.
- **`session.ts`**: fire-and-forget `persistAllSceneCachesThrottled()`
  at the top of `loadMapsAsset` (map-leave), so a busy map's actors are
  persisted before leaving even if the 30 s periodic flush hasn't fired.

### How persist / hydrate now flow (production)

- **Hydrate (cold start / revisit):** `loadSwfBundle` →
  `hydrateBundleOnLoad` → loads `bodyscene` for sprite bundles and `acc`
  for acc bundles from IDB into the main renderer's caches — the exact
  caches the spawn reads.
- **Persist:** `persistAllSceneCaches` (30 s periodic flush in
  `battlefield-scene.ts` + page-unload) and the throttled map-leave call
  serialize `bodyscene` (sprite) + `acc` (acc) per bundle to IDB.

The persisted artifacts are **vector** scene encodings (resolution-
independent for accessories; per-`scale_q` for body), not pixels — so
they're small (~0.5 MB per sprite bundle's body scenes) and exact.

---

## Measured results

All on the live WebSocket client, 250 actors, single map.

| scenario | time | notes |
|---|---|---|
| Cold (empty IDB) | **5,316 ms** | first-ever map entry; full SWF→Vello emit |
| Warm, deterministic roster (manual hydrate) | **760 ms** | 7.0×; only 4 body-cache misses |
| Warm, deterministic roster (**production** auto-hydrate + flush-persist) | **858 ms** | 6.2×; no manual helpers |

The earlier "cross-session = still cold" results were the random-roster
artifact: with `buildRandomLook()`, run A and run B spawned different
actors, so the persisted cache didn't cover what was looked up. Adding a
seeded `spawnBurst(n, move, seed)` (deterministic roster, mirroring "same
map = same actors") made the persisted cache hit. The key formats were
identical all along (`BSC-LOAD` vs `BSC-MISS` diff confirmed it).

---

## Remaining gap to < 500 ms (next: Rust)

Warm is **~858 ms**, not the ~227 ms an all-in-memory re-spawn hits. The
difference is **not** accessories (no assembled cache; the Pass-2 append
is cheap once `acc_subscenes` is warm). It's two things:

1. **~4 body variants with `Image` patches can't persist** (the encoder
   skips bitmap-fill scenes — their bytes aren't portable across
   instances). On a fresh session those re-bake cold on the main thread
   with a cold `swf_render_caches`, ~90 ms each ≈ ~360 ms.
2. **The 250-actor compose/Pixi cost** is inherent.

Both point at the **bake itself being slow when it does run** — the
SWF→Vello emit is done in **two full passes (Colour + ZoneId)** and the
class-atlas path appends sub-scenes through **two scene levels**. That's
the optimization target: collapse the 2× emit and the double append so
that *any* cold bake (the unavoidable first-ever map, the Image-patch
misses, new actors) is cheap enough that even the un-cacheable cases
stay under budget.

---

## Test / diagnostic surface added (uncommitted, can be gated/removed)

`window` helpers (registered in `measurement-sweep.ts`):
`__serializeBodySceneCache`, `__loadBodySceneCache`, `__clearBodySceneCache`,
`__persistSpawnCaches`, `__hydrateSpawnCaches`, `__persistAllSceneCaches`,
`__spawnBurst(n, move, seed)`, `__triggerCharRebake`, `__dispatchOverheadProbe`.
The `BSC-LOAD` / `BSC-MISS` `console_log!`s in `lib.rs` and the
`[scene split: …]` suffix on `classAtlasBake` are temporary key/phase
diagnostics — keep behind a flag or strip before shipping.
