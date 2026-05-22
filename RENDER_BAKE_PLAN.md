# Cache-dependency cliff — diagnosis & plan

## Status (2026-05-22 — Phase 0 measured, Phases 1 + 2 SHIPPED)

### Phase 0 — instrumentation (DONE)

Five timing probes added (`render-probes.ts`) and surfaced in the
5 s stress-monitor snapshot. Probes confirmed the diagnosis:

| Probe | Per call | Per frame | Verdict |
|---|---|---|---|
| `bodyAtlas` | 5.0 ms | 3.1-3.8 ms | ✅ Hypothesis confirmed |
| `accessoryStrip` | 0.78 ms | 2.2-2.6 ms | Cheaper than predicted; still meaningful at scale |
| `mountTransforms` | 1.2 ms × ~5/window | <0.1 ms | Negligible — ignore |
| `bakeDrain` | — | 6-8 ms/frame | Dominant ticker cost (~51 % of `tickerMsAvg`) |
| `composeBot` | 0.027 ms | 3.8 ms/frame | 5× cheaper than predicted; Phase 5 demoted |

At steady state on 200-bot stress: `tickerMsAvg = 12 ms`, of which
~6 ms is bake-drain + ~3.8 ms is compose + ~2 ms other. `frameMsAvg
= 26 ms` so ~14 ms lives outside ticker (browser GC / compositor /
GPU process) — a hard floor we can't shrink from app code.

### Phase 1b — scene-level cache (DONE)

Post-Phase-1 measurement showed body bakes were UNCHANGED at ~5 ms
while accessory bakes dropped ~55 % (0.78 → 0.34 ms). That falsified
the assumption that "tessellation is 80 % of body-bake cost." The
real dominant cost is **Vello scene encoding** — the ~90 k
`scene.fill()` calls per body atlas bake to lay out 5 bands × 12
frames × 2 modes of path data into the Vello encoder.

Phase 1b caches the pre-built `vello::Scene` per
`(bundle, export, start, count, scale, apply_b_fix, hat_equipped,
mode)` tuple in `body_scene_cache: HashMap<BodySceneCacheKey,
vello::Scene>`. Cache hit skips the entire `build_scene` step — the
bake then runs only `render_to_texture` twice + combine + bitmap
bridge.

Expected hit cost: ~1-1.5 ms (rasterization floor + bridge) versus
~5 ms on miss. At observed steady-state rate (~26 body bakes/sec
with 63 % cache hit rate at 200-bot stress), bakeDrain should drop
proportionally — ~3 ms/frame back from the ticker budget.

Memory cost: ~1100 scene entries × ~100 KB each = ~100-200 MB. On
top of the existing 2 GB Pixi GPU cache. Reclaimable via
`clearPathCache()`.

### Phase 1 — persistent per-bundle `RenderCache` (DONE)

`rust/vello-wasm/src/lib.rs`: the `tile_render_caches: HashMap<
String, RenderCache>` field (declared but never wired into bake
paths) was generalised to `swf_render_caches` and is now used by:
 - `render_swf_body_atlas`
 - `render_swf_accessory_strip` (via new
   `render_symbol_with_ctx_cached` helper in swf-spike/render/mod.rs)
 - `render_swf_strip_range_accessorized`
 - `render_swf_strip_range_accessorized_bitmap`
 - `render_swf_tile_static_base`
 - `render_swf_tile_dynamic_strip_range`

Each bake's local `let cache = RenderCache::new()` was thrown away
on return, re-flattening every shape on every bake. Per-bundle
caches share the work across all bakes of the same bundle; cache
content is keyed by SWF symbol id internally, so per-bundle keying
avoids cross-bundle id collisions.

Expected gain (extrapolating from `RenderCache`'s docstring "~99 %
hit rate after the first walk"):
 - First bake per (bundle, anim): ~5 ms (unchanged, populates cache)
 - Subsequent bakes per (bundle, *): ~1-1.5 ms (rasterize only)

At 200-bot stress's observed mix (~25 body bakes/sec, most for
already-seen bundles), bakeDrain should drop from 6-8 ms/frame to
~2-3 ms/frame. Wasm rebuilt with `wasm-pack build --target web
--release`.

### Phase 2 — progressive commit (DONE)

`apps/electrobun/src/game/render/player-strip-renderer-v2.ts`:
`tryCommit` was rewritten to split into two halves:

 1. `commitBody` — runs ONCE as soon as the body atlas lands.
    Sets up band meshes, accessory hooks (slot-by-slot; missing
    strips stay `visible=false`), the per-bot RT, and reveals the
    bot (`root.visible = true`).
 2. `installLandedAccessories` — runs on each subsequent
    `tryCommit` call. Plugs accessory strips into existing hooks
    as their bakes finish. No band/RT churn.

`pending.bodyCommitted` flag tracks which half is next.
`pending.accStrips` Map entries are nulled on transfer so a
subsequent `discardPending` (caused by a later `applyAnimation`
superseding this one) doesn't double-release strip refs.

Eliminates the "ghost bot during cold bake" UX failure — bots
appear within ~1 frame of the body atlas landing instead of
waiting for the entire body+accessory pipeline (which at 200-bot
stress was 1.2-1.6 s of invisibility).

Accepted trade-off: late-landing accessories that extend the bot's
bbox beyond the body-only RT can get clipped at the RT edge until
the next anim swap recomputes bounds. In practice accessories are
small relative to the body, and any clipping window is bounded by
the accessory bake latency (5-200 ms per slot).

### Phase 5 — kill per-bot RT, batch body bands (DEFERRED)

Phase 0 measurements demoted this. `composeBot` is 3.8 ms/frame at
200 bots, not the ~6 ms I'd predicted. Doing this right requires a
custom Pixi v8 `RenderPipe` (Mesh nodes don't auto-batch) and
rewriting `BodyBandColourZones` from a per-bot UBO to per-vertex
attributes. Multi-week effort, smaller win than Phases 1+2. Will
re-evaluate after the post-Phase-1/2 stress dump shows whether
composition is the new ceiling.

### Phase 4 — off-thread bakes (DEFERRED)

Same reasoning: with Phase 1 making bakes <1.5 ms, off-thread
bakes are protection against an edge case we no longer expect.
The validated worker architecture stays in `battlefield-worker.ts`
scaffolding for now.

---

## Original diagnosis (preserved for reference)

Cache cap was just bumped 1500 MB → 2000 MB to clear the 200-bot
stress thrash (`hitPct` was plateauing at 65 %, ~260 evicts/s,
`tickerMsAvg` ~15 ms). That works but does not address the real
problem the user raised:

> "I don't like that most of our game relies on CACHE to work
> properly, and that any non-cache will create massive FPS drops.
> I believe it can be much more powerful than this."

This plan captures the three-cost diagnosis, the corrections the
user made to my initial framing, and the architectural sequence
that breaks the cache dependency at its source. Implementation is
gated on instrumentation landing first.

## Three costs, not one

The cache-dependency cliff has three separate causes that all
read as "low FPS" but have different fixes.

| Source | Cost when bake misses | Fix shape |
|---|---|---|
| **Bake latency** (bot waits for atlas) | Visual lag, ghost bots | Faster bakes OR better fallback render |
| **Bake throughput** (main thread stalls) | FPS drop | Off-thread bakes |
| **Composition floor** (per-bot RT) | Constant ~6 ms even warm | Kill per-bot RT, let Pixi batch |

### Cost A — bake latency

Bot logical state advances (new direction, new anim) but the
visible state cannot until the bake commits. `tryCommit` in
`player-strip-renderer-v2.ts` waits for the body atlas AND every
equipped accessory before flipping the bot to the new anim. While
pending:

- **Existing bots** keep rendering the previous atlas at the
  previous frame count. Facing/anim mismatch persists until commit.
- **New bots** have no previous atlas; `root.visible = false` from
  `createSlot` and stays false until the very first commit. This
  is the cold-cache pop-in: at 200-bot stress with ~2-3 main-thread
  bakes per frame, all 200 take ~1.2-1.6 s to appear.

This cost is **independent of FPS** — even with infinite throughput
you still wait for the bake. Off-thread bakes don't fix latency.

### Cost B — bake throughput

`renderSwfBodyAtlas` and `renderSwfAccessoryStrip` execute on the
**main JS thread** (`battlefield-worker.ts` is scaffolding;
production mounts via `MapRenderer.tsx:93` on main). Bake queue
adaptive budget caps drain time at 3-12 ms/frame, but each Vello
dispatch is ~5 ms (assumed; **needs instrumentation to confirm**).
At a sustained miss rate > 2-3 per frame the queue grows
unboundedly, accessory strips lag bot direction changes, and
`tickerMsAvg` climbs to ~15 ms.

### Cost C — composition floor

Phase A.3 wraps each bot's bands + accessories in a per-bot
`RenderTexture` (`compositeRT`). At 200 bots × ~12 anim-fps that's
**~2400 `renderer.render({target: compositeRT})` calls per second**,
or ~40 RT passes per main frame. Each pass has fixed encoder /
bind-group / begin-end overhead estimated at ~150 µs. Total
estimated cost ~6 ms/frame **regardless of cache state**.

This is the warm-state ceiling. Even a 100 % hit rate cannot get
below ~6 ms of frame time at 200 bots with the current architecture.

## Two corrections that change the design

### Correction #1 — "bot keeps playing previous strip" is mostly false

My initial framing was that off-thread bakes (Cost B) would make
cache-miss FPS-drop-free because the bot would continue to play
its previous strip. Re-reading `tryCommit`:

```ts
// 6. First successful commit reveals the bot. Subsequent commits
//    are no-ops on visibility — bots stay visible from here on.
st.root.visible = true;
```

True for the second anim onward; false for the first. New bots
are invisible until the entire body + every accessory bake lands.
And even for existing bots, the "previous" atlas is from the
previous anim, so direction changes show the wrong facing for the
duration of the bake.

**Implication:** Cost B in isolation (off-thread bakes) doesn't
fix the bad gameplay feel. We also need either (a) faster bakes so
the latency window shrinks, or (b) a better fallback render so
"pending bake" doesn't mean "invisible/wrong bot."

### Correction #2 — accessory variance breaks the body-batching argument

I initially suggested per-instance batching as the warm-state fix
and quoted "60-120 draws total" as the post-fix budget. The 60-120
number is correct for **body atlases only** (12 classes × 5 bands).
Accessories are per-bot in real gameplay (unique hats / weapons /
capes / pets per player) — the per-instance attribute trick gives
no compression on the accessory axis.

What does help accessories: **Pixi's existing sprite batcher already
fuses sprites sharing a texture (~8-16 per batch)**. With the
current per-bot RT, accessories live in detached `compositionStage`s
and render in independent passes — actively defeating Pixi's
auto-batch. Killing the per-bot RT (putting accessories back in
the main scene graph) gives accessory batching for free, no custom
shader needed.

**Implication:** Move C ("kill per-bot RT") is still the right
warm-state fix, but the win comes from (1) body bands batching via
custom shader + (2) accessory sprites batching via Pixi's
out-of-the-box batcher — not from per-instance attributes on
accessories.

## The architectural lever I missed

The single biggest unexplored lever is **making bakes cheaper at
the source**, not faster to dispatch.

A body-atlas bake today is roughly:
1. Walk SWF display list for the body, all frames, all bands.
2. Tessellate each path into triangles.
3. Submit triangles to Vello.
4. Vello rasterizes to atlas texture.
5. Blit to bitmap.

Tessellation (step 2) is the expensive part. Rasterization is
fast on GPU. And tessellation is **independent of resolution,
hat-toggle, and color zones**:

- `(bundle, export, anim)` → tessellated mesh + display-list timing
  is invariant. Compute once per app session (~5 ms × ~600 anims
  = ~3 s of one-time work, can be split across boot frames).
- `(bundle, export, anim, resolution, hatEquipped)` → rasterized
  atlas drops from ~5 ms to <1 ms because it's just a GPU draw of
  pre-built buffers into a texture.

This is the standard retained-mode 2D pattern. Vello supports it:
keep a `Scene` of recorded commands and re-render against it.

**Why this attacks the right problem:**

- **Cost A (latency)** shrinks 5×: 200 fresh bots pop in over
  ~300 ms instead of ~1.6 s. Approaches "feels fine" territory.
- **Cost B (throughput)** dissolves: 12+ bakes/frame budget instead
  of 2-3. No death spiral. Off-thread bakes become a "nice to have."
- **Cache becomes a soft optimization** for a fast operation, not
  a load-bearing wall for a slow one. Working-set > cap stops
  being a cliff.
- **Doesn't depend on accessory variance** — every bake is cheap
  regardless of how unique the look is.

## Proposed sequence

### Phase 0 — instrument (this branch)

Wire timing probes so the next stress dump reports the cost split:

- Per-bake wall time (`renderSwfBodyAtlas`,
  `renderSwfAccessoryStrip`, `renderSwfMountTransforms`). Count,
  total ms, max ms per kind per snapshot window. **Validates the
  "~5 ms per body atlas" assumption.**
- Bake-queue drain wall time per frame. **Validates that
  `tickerMsAvg` is dominated by bakes when the queue is hot.**
- `composeBot` wall time per frame (aggregated). **Validates the
  ~6 ms composition-floor estimate at 200 bots.**

Surface all three in `STRESS_JSON` + the human-readable monitor
block in `stress-test.ts`.

**Gate:** if any of these numbers come in materially different
from the estimates, re-evaluate the plan before committing to
Phase 1.

### Phase 1 — cheap bakes via tessellation cache

Restructure `vello-wasm` to keep tessellated path geometry per
`(bundle, export, anim)`. `renderSwfBodyAtlas` becomes "select
cached tessellation, apply hat-toggle frame skip, rasterize at
resolution into a new GPU texture." Expected bake cost <1 ms.

Sub-tasks:
- Identify the tessellation pass in the Rust pipeline.
- Add a `TessellationCache` keyed by `(bundle, export, anim)`.
- Wire `renderSwfBodyAtlas` / `renderSwfAccessoryStrip` /
  `renderSwfMountTransforms` to consume the cached tessellation.
- Memory ceiling for the tessellation cache (every anim worth
  caching forever; LRU only if budget is exceeded).

**Estimated effort:** 1-2 weeks.

### Phase 2 — fix "invisible bot during bake"

Two options, pick one:

- **Progressive commit.** Allow body-atlas commit before
  accessories land; accessories appear as their bakes resolve.
  Bot is visible (body only) within ~1-2 frames of arrival; full
  look follows.
- **Silhouette placeholder.** Render a shared class-template sprite
  while pending. Pop to full look when commit lands. Single shared
  texture + bind group → effectively zero cost.

Either is small (days, not weeks). Phase 2 is independent of
Phase 1 — they don't share code surface.

### Phase 3 — re-measure & decide

After Phase 1 + 2 ship, run the 200-bot stress with empty cache.
If FPS holds at 50-55+ with no pop-in misery, the cache-dependency
cliff is broken. Phases 4 and 5 become "more bots" levers, not
robustness levers.

### Phase 4 (optional) — off-thread bakes

The validated `feedback_battlefield_render_architecture` note
already proves 1-worker WebGPU works. `battlefield-worker.ts` is
the scaffold. Move Vello bakes into the worker via postMessage +
`ImageBitmap` transfer, keep Pixi composition on main.

Only worth doing if Phase 1 isn't enough on its own.

### Phase 5 (optional) — kill per-bot RT, batch body bands

Revert Phase A.3. Bands and accessories go into the main scene
graph. Body bands use a custom batched shader: hoist
`BodyBandColourZones` from per-bot UBO to per-vertex attributes
(3× vec4 zones per vertex). Accessories get Pixi's existing
sprite-batcher for free.

Lifts the warm-state ceiling so bot count stops mattering.
Heavier lift (~3-4 weeks). Only worth doing if Phase 1 + 2 don't
get warm-state FPS where we want it.

## Open questions resolved by instrumentation

| Question | Answers / decision driver |
|---|---|
| Is each body-atlas bake really ~5 ms? | If <1 ms already, Phase 1 unnecessary. If >5 ms, Phase 1 is even more critical. |
| Is `composeBot` really ~6 ms/frame at 200 bots? | If <2 ms, Phase 5 dies. If ~6 ms, Phase 5 is on the path. |
| What fraction of `tickerMsAvg` is bake drain vs composition vs JS housekeeping? | Drives ordering — fix the dominant cost first. |
| Does the bake queue actually run at its claimed budget? | If it floors at MIN_BUDGET_MS for most of a stress run, the adaptive logic isn't doing what we think. |

## Non-goals

- This plan does **not** attempt to change the SWF source-of-truth
  pipeline. Path/curve/morph data still comes from canonical
  bundles via `swfBodyBandInfo` etc.
- This plan does **not** assume any change to the patched-wgpu
  fork. All texture lifetime rules
  (`feedback_pixi_wgpu_texture_lifetime`,
  `feedback_pixi_blurfilter_leak`) continue to apply.
- This plan does **not** propose touching the registry or
  worldmap render paths; the cache-dependency cliff is specific
  to character rendering.
