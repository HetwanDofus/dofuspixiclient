# Render pipeline audit — conclusion (2026-05-26)

Measured live (test/test, server #612, 100 bots) via temporary hooks added to
`PlayerStripRendererV2`: `__composeBenchmark`, `__renderAudit`, `__dumpAtlases`,
`__gpuTimeCompose` (real WebGPU `timestamp-query`, enabled by adding
`Features::TIMESTAMP_QUERY` to the Vello device in `rust/vello-wasm/src/lib.rs`).

## UPDATE 2026-05-26 (root-cause pass)

**There are NO garbage bugs in the renderer.** The two suspects were both misjudged:
- **seed-5 "look-specific compose bug"** → it's a valid gfx-90 **Cra** recolored with random
  garish colors (yellow-green / blue / purple). Band UV/transform verified correct via
  `__dumpBot`; body shape coherent. Not garbage.
- **`grow()` "buffer-orphaning bug"** → resize-in-place is CORRECT in Pixi 8.18.1 (verified:
  80 bots at INITIAL_CAPACITY=8, grow firing constantly → every composite clean). `data=`
  recreates the GPUBuffer and the per-pass bind-cache clear rebinds it. grow() is just
  EXPENSIVE (GPUBuffer recreation churn → stalls). **FIXED: `INITIAL_CAPACITY=256`** (= comp
  page slot count = max instances per band-batch) so grow never fires.

**THE ONE REAL GARBAGE BUG — input-atlas slot REUSE race** (found on a clean session, 20
MOVING bots): freed input-atlas slots get recycled/re-blitted while a live anim-churning bot
still samples them → rectangular magenta/neon-green garbage. Disabling reuse
(`globalThis.__noReclaim = true`, gating `reclaimInputAtlasSlots`) makes the SAME bots render
perfectly clean at 60fps/0 stalls — before/after is unambiguous. The drift-free `live`-set +
`FREE_GRACE_TICKS=4` is insufficient under movement churn. **FIX:** crop bands (#2) shrinks
variants ~3× so the working set fits resident under a generous page budget → per-slot reuse
becomes unnecessary → disable it (close the race). If eviction is ever needed at the extreme,
use whole-page eviction (free a page only when fully unused), not the racy per-slot guillotine.

So: the architecture is correct, the band/compose math is sound, and the plan below is
optimization + this ONE reuse fix (which cropping enables). (Reminder: long CDP browser
sessions degrade — JS heap climbs to 2.5GB+ → GC stalls give false-low FPS; restart browser
for clean perf numbers.)

## CONFIRMED ROOT CAUSE (2026-05-26): eviction thrashing

The class-atlas LRU cap (`DEFAULT_CLASS_BYTES_CAP` = 1000MB, `character-cache.ts:108`) is
**smaller than the moving working set** (250 random-dir moving ≈ 572 variants ≈ 957MB, sitting
*at* the cap). Result: constant evict → re-bake → re-blit → free → recycle thrash
(`evict=14897` at 120 moving). **That thrash IS the stalls, the empty-flash-on-turn, AND the
reuse-race garbage** — when slots churn constantly the race fires and frames hitch.

PROOF: raising the cap to 2.6GB → `evict` 14897→**21**, `stall10s`=**0**, FPS avg **60**,
smooth + clean — but GPU hit **3.37GB** (full working set resident, over the 3GB budget).
Disabling reuse (`__noReclaim`) does NOT help — freed slots leak → shared page fills → 995MB
fallback textures + still thrashing. So reuse must STAY; the fix is to make the working set
**fit under a budget cap** so it stops thrashing.

Red herrings cleared this session: grow() (correct, pre-sized to 256), seed-5 (valid garish
Cra gfx 90), reuse-as-primary (it's a *symptom* of thrash). Canonical model (`mc/Sprite.as`
`setAnim`): dir→5 graphics+flip, atomic `attachMovie` swap (no gap), all dirs in SWF (no bake
delay) — our async-bake + thrash is the non-canonical part. We already share flips
(`character-cache.ts:702`).

### Crop: VALIDATED + in progress (2026-05-26)
- **Savings measured: 2.11× average** (median 2.14×, range 1.13–4.73×, 400 bakes) via
  `band_bounds` + a `[crop-measure]` log in `renderSwfBodyAtlas`. Working set 957MB → ~450MB →
  fits the 1GB cap → kills the thrash. Confirmed worth it.
- **DONE:** `swf-spike/src/render/bounds.rs` `band_bounds()` (added, exported, compiles);
  `[crop-measure]` diagnostic in `lib.rs renderSwfBodyAtlas` (remove when done).
- **REMAINING:** steps 2–7 below (per-band layout/emit in the bake → JS UV/mount/silhouette →
  verify pixel-identity + mount alignment → re-measure). This is the large, alignment-critical
  part.

### Crop execution plan (the fix — fit working set under cap)
1. **Rust** `swf-spike/src/render/bounds.rs`: add `band_bounds(doc, sym, frame, BandRange)` —
   like `sprite_bounds` but unioning only depths inside the band range.
2. **Rust** `lib.rs renderSwfBodyAtlas` (the band loop ~2656-2683 + layout ~2494-2579):
   replace the single uniform `frame_w/frame_h` cell with **per-band** `(px_min, w, h)` from
   `band_bounds`; pack bands with per-band dims; render each band at its own `px_min`.
3. **Rust**: emit per-band crop offset `(offsetX, offsetY)` (band content origin relative to
   the variant's SWF (0,0)) in the result.
4. **JS** `character-cache.ts` (`VariantBand`): carry per-band cell dims + offset.
5. **JS** `body-band-batch.ts` `computeBandFrameUV` + the compose `aTransform`: use per-band
   cell dims and add the crop offset so the band draws at the correct slot position.
6. **JS** picking silhouette extraction: account for per-band crop offsets.
7. VERIFY with the dump harness: pixel-identical composite + accessory-mount alignment
   unchanged (mounts are twip-space, orthogonal — should hold, MUST confirm); then re-measure
   working set + `evict` + stalls (target: fits ≤1GB cap, evict→~0, 0 stalls, GPU < 3GB).

Risk: breaks the uniform-cell invariant (`lib.rs:2494`) that mount alignment relies on — do it
as a focused pass, verifying each step, not rushed.

## TL;DR

**The architecture's bones are correct. We do NOT need a big refactor of the
approach.** Band separation is canonical and required; composing into a per-bot
atlas is load-bearing (not redundant); compose on Pixi is efficient. What we have
is a set of **quantified implementation wastes** plus **one genuinely wrong design
choice** (resolution baked into the variant key). All are fixable incrementally.

---

## The pipeline (4 hops)

1. **Vello (wgpu/WASM)** rasterises a body's Z-bands → `ImageBitmap`. Shared per
   `(gfx, anim, dir, flip, hat, resolution)` — look-independent.
2. **`SharedInputAtlas`** — `copyExternalImageToTexture` blits the bake into an
   8192² super-page sub-rect. `BodyBandBatch` keys collapse on the page
   `source.uid`.
3. **`SharedCompositionAtlas`** — instanced `BodyBandBatch` meshes sample the input
   atlas, apply per-bot HSL zone recolour (`body-band-batch.ts` shader) + accessory
   sprites, and render each bot into a fixed **256² slot** of a 4096² page.
4. **Scene** — one composite `Sprite` per bot samples its slot; Pixi batches by page
   source and the scene Y-sorts the sprites.

Plus a cross-frame cache layer: `compositionDirty` gating, input-atlas slot reuse
(`FREE_GRACE_TICKS` / `deferredFree` / `reclaimDeferredSlots`), `BodyBandBatch.grow()`.

---

## Real measured data (100 bots)

### Compose cost (real GPU timestamps)
- **1 render pass**, **5 instanced band draws** + accessory sprites for all 100 bots.
- **GPU: 0.59 ms median** per compose pass (min 0.26 / max 0.79) — real `timestamp-query`.
- CPU submit: **0.04–0.07 ms**.
- Of the 0.59 ms, **~0.45 ms is the load(clear)+store of the 64MB 4096² target**
  (≈134MB traffic ÷ ~300GB/s). The actual drawing is only ~0.1 ms.
- The earlier 0.26 ms `onSubmittedWorkDone` figure was *throughput* (back-to-back
  passes overlap store/clear); the isolated per-frame cost is 0.59 ms.

### Composition page utilisation
- Page utilisation (used slots / page): **39.5%** (101 of 256 slots).
- Slot fill (char pixels / 256² slot): **19%** — tall-thin chars in square slots + accessory-bbox padding.
- **Effective: 7.5%** of the 4096²/64MB page is real character pixels. **92.6% is cleared+stored every compose for nothing.**

### Input atlas / variants
- 100 random bots → **77 distinct body variants** (random `direction(8)` + ~24 gfx explodes the count; real players cluster).
- Band-count distribution: `{1:1, 2:20, 3:62, 4:18}` — **mostly 3 bands**.
- Each band is stored as a **full frame** (e.g. 57×127) with only its Z-slice opaque
  → **~3× pixel-area inflation** per variant (bands 0/2 are sparse when cropped).
- **6 variants overflow the 8192² page → standalone fallback textures = 950 MB** (`pixi.class: 6×`). This is the dominant VRAM cost, at both x3 and x6.
- x3→x6 left both resolutions resident (**154 slots**, `evict=18`): the bake key
  includes resolution, so every zoom level re-bakes the full set and eviction lags.

### Totals
- GPU memory ~1.4–1.5 GB at 100 bots (class 950MB + input 256MB + comp 64MB + tiles + acc).
- Device: `maxTextureDimension2D=16384`, `timestamp-query` now enabled.

---

## Are the approaches correct?

| Approach | Verdict | Why |
|---|---|---|
| **Band separation (Z-slices)** | ✅ correct, necessary | Canonical: SWF accessories mount at depths and must interleave with body parts. Cannot "body then gear on top." |
| **Shared per-class body bakes (Vello)** | ✅ correct | Re-rasterising 250 bots/frame in Vello is infeasible; bake once, composite many is the only way to hit 250@60. |
| **Per-bot composition atlas** | ✅ correct, load-bearing | Isometric Y-sort + alpha blending need each bot drawn *contiguously* in depth order. Drawing bands directly in-scene breaks both inter-bot occlusion and Pixi batching. The atlas lets us instance-draw bands into private slots, then Y-sort one sprite per bot. **Not redundant.** |
| **Compose on Pixi (instanced + recolour shader)** | ✅ correct | Cheap (0.1 ms draw), batches well, shader does HSL zone recolour in-pass. |
| **Cross-frame caching (dirty gating + slot reuse)** | ⚠️ concept fine, implementation is the bug source | Compose is cheap (0.59 ms, ~0.15 ms once packed), so the cache buys little but caused the grow()/reuse/grace garbage. Better to recompose every frame and drop the reuse machinery. |
| **Per-resolution rasterisation** | ✅ correct, REQUIRED | Dofus art is vector; canonical crispness needs vectors rasterised AT the display resolution. Downsampling a high-res master is NOT canonical (blurry edges, wrong AA) — do NOT do it. |
| **Re-bake ALL variants at once on zoom + keep multiple resolutions resident** | ⚠️ wasteful impl, not the rasterisation itself | The storm + the 154-slot multi-res residency are the waste, NOT per-res baking. Fix without downsampling (see resolution options below). |

**No fundamental redesign is warranted.** Drawing bands directly to scene (the
tempting "drop a hop" idea) is *worse* — it breaks isometric occlusion and batching.

---

## What to fix (ordered by measured impact)

1. **Tight-pack the composition atlas** (rect-pack by real bbox instead of square 256
   slots). 7.5% → ~90%+ utilisation. Expected: compose **0.59 → ~0.15 ms** (~4×) and
   comp VRAM **64 MB → ~5 MB** (~13×). Biggest single win; eliminates the empty-page
   clear/store waste.
2. **Crop bands to their content bbox** before packing the input atlas. Kills the
   ~3× inflation → variants stop overflowing the 8192² page → **the 950 MB fallback
   textures disappear**.
3. **Canonical zoom/resolution handling (NO downsampling — vectors must rasterise at
   display res).** The waste is the re-bake storm + multi-res residency, not per-res
   rasterisation. Fix with: **(A)** keep only ONE resolution's rasters resident, evict
   the previous res immediately on commit; **(B)** re-raster from the existing
   scale-invariant vector sub-scene cache (`lib.rs` Phase-1c) instead of a full
   re-bake — cheap, no SWF re-parse, canonical crisp; **(C)** re-raster on zoom-SETTLE
   (debounced), visible variants first, lazily for the rest — transient sprite scaling
   only DURING the gesture (mid-motion, not a persistent downsampled asset);
   **(D)** optionally quantise zoom to a few discrete canonical steps so re-rasters are
   rare. Bounds memory to one resolution and kills the storm, all canonical.
4. **Recompose every frame; drop the cross-frame cache + slot reuse**. Allocate comp
   slots per-bot-lifetime (spawn/despawn), pre-size or fix `BodyBandBatch.grow()`.
   Affordable once (1) lands (~0.15 ms × pages/frame). Deletes `compositionDirty`,
   `deferredFree`, `reclaimDeferredSlots`, `FREE_GRACE_TICKS`, and the grow() race.
5. **Still-open separate bug**: the look-specific compose garbage (reproduced with 1
   static bot, seed 5, no grow/reuse; input bake was CLEAN). It's a band UV/transform
   error for specific looks — must be debugged regardless of the above, but in a much
   smaller surface after (4).

## Temp diagnostics to remove when done
- `body-band-batch.ts`: `INITIAL_CAPACITY` reverted from 1024 (left high to isolate grow()).
- `player-strip-renderer-v2.ts`: `__dumpAtlases`, `__composeBenchmark`, `__renderAudit`,
  `__gpuTimeCompose` hooks + `RenderTexture`/`getVelloGpu` imports added for them; the
  `[RECLAIM DIAG]` log + `divergent` check.
- `shared-input-atlas.ts`: `[ATLAS OVERLAP]` DIAG.
- `rust/vello-wasm/src/lib.rs`: `TIMESTAMP_QUERY` request (harmless + useful to keep for profiling; gated on adapter support).
- Rust `[probe:…]` instrumentation.
