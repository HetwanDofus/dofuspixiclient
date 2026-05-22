# Class mega-atlas — design, current state, and Rust migration plan

## Status (2026-05-22, updated post-implementation)

### What shipped

Two stages of the original plan landed:

**Stage 1 — JS-side blit composition (current).** Each variant is
still baked individually in Rust (`render_swf_body_atlas`), but the
TS-side `CharacterCache` packs the resulting bitmap into a shared
per-class `RenderTexture` ("class atlas page") via
`renderer.render({clear: false})` with NEAREST sampling. All
variants of the same (bundle, resolution) tuple share one
`TextureSource.uid`, so `BodyBandBatch` consolidates batches by
class instead of per variant.

Implementation pieces in `character-cache.ts`:
- `ClassAtlasPage` — one per (bundle, resolution); owns a 4096² or
  8192² RenderTexture
- `GuillotinePacker` (replaces the buggy `ShelfPacker`) — supports
  `alloc(w, h)` and `free(rect)` with no merging on free
- `tryWrapIntoClassPage` — does the blit + sub-rect tracking
- `wrapBodyAtlasLegacy` — fallback for variants that don't fit any
  page (rare)

**Stage 2 — Priority bake queue.** Live `applyAnimation` enqueues
HIGH; `prewarmAtlas` enqueues LOW. HIGH drains first → bots become
visible within ~50-150 ms even under heavy spawn-ramp bursts.

### What works

Measured at 400-bot random-look stress (2026-05-22):
- **60 fps locked** for 14 of 15 snapshots (cold-start hits 51)
- **`composeBot.perFrameMs` 2.6-2.8 ms** (was 9 ms pre-class-atlas)
- **`atlas.batchCount` stable at ~210** (was 1156)
- **Class-atlas page count stable at 31** — no leak, guillotine
  free works
- **No more "moves without animation" bug** — `commitBody` now
  returns `false` on null atlas instead of nuking the bot's state

### What's broken: memory bloat

Same 400-bot run:
- **8 GB GPU** consumed by class-atlas pages (31 pages × 256 MB at
  8192²)
- **Only 1.87 GB of actual pixel data** lives in those 31 pages
- **~6 GB wasted** as unfilled page space

This is unacceptable for a 2D MMO. Original Dofus 1.29 shipped on
256 MB-VRAM machines in 2004. Even at modern targets (~2 GB GPU
budget for character art) we're 4× over.

The waste is intrinsic to the JS-side path:
1. Each per-variant atlas is baked into ITS OWN intermediate
   `ImageSource` (~3.4 MB at resolution=3)
2. Blitted into a class page via `renderer.render`
3. Class page is a fixed-size RT (64 MB or 256 MB) regardless of
   how full it is
4. Variants don't pack tightly because the JS-side guillotine
   operates on whole rects from a single page

At 4096² pages the waste is smaller (~4 GB total vs 8 GB) but
batch count rises (~540 vs ~210), pushing compose cost from 2.7 ms
back to ~5 ms.

**There's no page-size tuning that wins both axes. The JS path's
ceiling is here.**

## Why Rust-native baking is the real fix

A single `render_swf_class_atlas` Rust function that bakes ALL
needed variants into one tightly-packed texture eliminates the
waste:

| Aspect | JS-side (current, shipped) | Rust-native (target) |
|---|---|---|
| Per-variant intermediate | Pixi ImageSource (~3.4 MB, transient) | None — direct copy into class atlas |
| Page texture sizing | Fixed 4096² or 8192² | Sized to fit packed variants exactly (or fixed 4096² with no waste) |
| Cross-variant Vello cache | Some sharing via `body_scene_cache` | Full sharing — one scene per class encodes all variants |
| GPU memory at 400 bots | 8 GB | **~1.5-2 GB** |
| Memory waste | ~6 GB | ~0 |
| Batch count at 400 bots | ~210 | **~60 (12 classes × 5 bands)** |
| Compose cost | 2.7 ms | **~0.8-1.2 ms** |
| Per-class first-bake latency | spread over N variants × ~5 ms each | one Vello dispatch covering all variants (~50-100 ms) |
| Implementation cost | shipped | **3-5 sessions** |

The Rust path wins on both perf AND memory. The only reason we
went JS-first was shipping speed.

## Rust implementation outline

### New WASM-exported function

```rust
pub fn render_swf_class_atlas(
    &mut self,
    bundle: &str,
    resolution: f32,
) -> JsValue
```

Returns a JS object:

```typescript
{
  combinedBitmap: ImageBitmap,        // ONE bitmap, all variants packed
  atlasWidth: number,
  atlasHeight: number,
  variants: Array<{
    exportName: string;
    animName: string;        // canonical: walk / static / run / cast / ...
    dir: number;             // 1=R, 3=L, 5=F, 7=B, 0=S
    flipped: boolean;
    hatEquipped: boolean;
    atlasX: number;           // sub-rect origin in the class atlas
    atlasY: number;
    frameWidth: number;
    frameHeight: number;
    frameCount: number;
    gridCols: number;
    gridRows: number;
    anchorX: number;
    anchorY: number;
    bands: Array<{
      bandIndex: number;
      atlasYOffset: number;   // within the variant's sub-rect
      height: number;
    }>;
    mountTransformsBytes: Uint8Array;
  }>
}
```

### Bake algorithm

1. **Enumerate variants** for the bundle:
   - Iterate `doc.by_name` to find exports matching `walkR/L/F/B/S`,
     `staticR/L/F/B/S`, etc.
   - For each export × `applyBFix ∈ {false, true}` × `hatEquipped ∈
     {false, true}` (with normalization that collapses dimensions
     when the SWF doesn't use them, mirroring the existing JS-side
     `normalizeBFix` / `normalizeHatEquipped` heuristics).
   - Result: ~100-200 unique variants per class.

2. **Compute per-variant pixel dims** using the existing
   `cache_strip_bounds` + `compute_band_presence` logic from
   `render_swf_body_atlas`. Output per variant:
   - frame_w, frame_h
   - present_bands (which bands have content)
   - per-band atlasY offset within the variant sub-rect
   - variant bbox (strip_w, strip_h × num_bands + padding)

3. **Bin-pack** all variant bboxes into ONE atlas. Choose atlas
   dims that fit (4096² preferred, escalate to 8192² only if
   needed). Use MaxRectsBinPack with best-area-fit + 90° rotation
   heuristic (~93% efficiency in our typical workload).

4. **Render** in ONE pass:
   - Build ONE `vello::Scene` containing every variant × frame ×
     band, each translated to its packed sub-rect origin.
   - Render the scene to two textures (colour + zone-id) at the
     final atlas dims.
   - Run the existing `CombineBodyPipeline` to merge them into one
     RGBA8 atlas with zone IDs in alpha LSBs.
   - Bridge the combined texture → `ImageBitmap`.

5. **Serialise mount transforms** per variant (existing format,
   one Uint8Array per variant).

Implementation reuses ~80% of the existing
`render_swf_body_atlas` machinery — just the outer loop changes
from "one variant" to "every variant for this bundle."

### Caveats / risks

1. **Scene size.** One scene with ~200 variants × 12 frames × 5
   bands = ~12 000 `render_body_band` calls. The Vello tile
   encoder has overflow risk per
   `feedback_vello_scene_overflow`. Mitigation: build one scene
   per (variant set chunk) and render each into its own slice of
   the atlas via per-chunk render-to-texture + copy, fall back to
   per-variant if needed.

2. **Atlas dim ceiling.** 4096² holds ~1.6 M pixels of variant
   data per class at resolution=3 (12 frames × 5 bands × 120² ×
   ~12 variants/page ≈ huh). Need to verify empirically that a
   typical class fits in 4096². If not, the bake function returns
   multiple pages and the JS side tracks all of them as one logical
   class atlas with a `pageIdx` per variant.

3. **Cold-start latency.** First time we encounter a class:
   ~50-100 ms Vello dispatch. Acceptable — happens once per
   class per session, off the main bake-queue path.

4. **Memory while baking.** Two temp wgpu textures at atlas dims
   (colour + zone) + one combined = ~3× atlas size mid-bake. At
   4096² that's ~192 MB transient, dropped after bridge to
   `ImageBitmap`.

## TS-side migration (Phases B-D)

### Phase B — `ClassAtlas` cache

New types in `character-cache.ts`:

```typescript
export interface ClassAtlas {
  bundle: string;
  resolution: number;
  combinedTexture: Texture;
  atlasWidth: number;
  atlasHeight: number;
  variants: Map<string, VariantInfo>;  // key = `${anim}|${dir}|${flip}|${hat}`
  refcount: number;
  bytesEst: number;
}

export interface VariantInfo { /* matches the Rust output shape */ }
```

New cache API:

```typescript
acquireClassAtlas(bundle, resolution, onReady, isWanted): void
getVariant(atlas, animName, dir, flipped, hatEquipped): VariantInfo | null
releaseClassAtlas(atlas): void
```

LRU operates at the CLASS level (not per-variant). Eviction is
much cleaner: one class atlas = one texture = one LRU entry.

### Phase C — Renderer migration

`PlayerStripRendererV2.SlotStateV2`:
```typescript
{
  atlas: ClassAtlas | null;   // was BodyAtlas
  variant: VariantInfo | null;
  bandInstances: Map<bandIdx, {batch, instanceIdx}>;
}
```

`commitBody`:
- On variant-only change (same class): NO batch migration — just
  rewrite `aAtlasUV` for each band instance.
- On class change (rare): release instances from old class
  batches, allocate in new class batches.

This is where the bulk of the perf+memory win compounds: most
anim transitions stay on the same class, so the batch graph
stays stable across thousands of transitions.

### Phase D — Tear down JS-side class-page path

Delete:
- `ClassAtlasPage` type
- `GuillotinePacker`
- `tryWrapIntoClassPage` / `wrapBodyAtlasLegacy`
- `classPage` / `classPageRect` fields on `BodyAtlas`
- Most of `wrapBodyAtlas`'s logic

Replace `BodyAtlas` with `ClassAtlas` + `VariantInfo` throughout.

### Phase E — Validation

Targets at 400-bot stress:
| Metric | Current (JS path) | Target (Rust path) |
|---|---|---|
| fps.avg1s warm | 60 | 60 (locked) |
| composeBot.perFrameMs | 2.7 ms | **0.8-1.2 ms** |
| batchCount | 210 | **~60** |
| GPU memory (class atlas) | 8 GB | **1.5-2 GB** |
| First-bot-of-class latency | ~50 ms (priority queue) | **~50-100 ms** (whole-class bake) |
| Memory at real-game scale (5 classes) | ~1.5 GB | **~700 MB** |

## Phasing for shipping

| Phase | Effort | Risk | Outcome |
|---|---|---|---|
| Rust class-atlas function | 2-3 days | Vello scene size | Bake works, returns metadata + bitmap |
| TS ClassAtlas types + cache API | 1 day | Type plumbing | Acquire path lands |
| Renderer migration | 1-2 days | Variant lookup correctness | Bots use class atlas |
| Delete JS-side page path | 0.5 day | Type cleanup | One code path |
| Stress validation | 0.5 day | Cold-start latency | Numbers verified |

Total: **5-7 days focused work**. Worth it given the 4× memory
reduction and 2.7× compose-cost reduction.

## Resolved questions

- **Resolution.** Code asks for `resolution=3` by default. The bake
  must honour what the code requests for crisp rendering. Per-class
  atlas cache key includes resolution; different resolutions get
  different class atlases.
- **Class identity.** = `bundle` (SWF file name). One bundle = one
  class. Mount/chevauchor are separate bundles.
- **Hat toggle.** Canonical Dofus 1.29: only Iop. JS-side
  `normalizeHatEquipped` already collapses non-Iop variants. Rust
  baker mirrors this — Iop class atlas has 2× variant count along
  the hat dimension, other classes don't.
- **Page count per class.** Target: one 4096² page covers most
  classes at resolution=3. Multi-page support stays as fallback
  for edge cases.

## Open question

- **Variant set for prewarm.** Today the JS-side `prewarmSweep`
  fires per (bundle, resolution) for static + walk + run × 4 dirs
  × 2 hat. With Rust class atlas, ONE acquire covers everything in
  the class. Do we keep pre-warm explicit (start the bake early
  before bots need it) or lazy (bake on first bot acquire)? Lean
  toward keeping pre-warm explicit so the first bot of a class
  doesn't pay the ~50-100 ms whole-class bake latency.

## Out of scope (deferred)

- **Cross-class deduplication** (e.g. mounted variants of the
  same player sharing the base body)
- **Texture array binding** — 2D mega-atlas per class is simpler
  and gives the same batch-consolidation
- **LOD / mip levels**
- **Real-time atlas mutation** — variants packed once at
  class-load time, not edited later
