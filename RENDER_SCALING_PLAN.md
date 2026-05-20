# Render scaling — Path B (shared-cache + depth-band split)

## Status

Next-session work. This supersedes the deleted `OFFSCREEN_CANVAS_BRIDGE_PLAN.md`:
once Path B lands, the steady-state strip-bake rate drops to ~0 and the
patched-wgpu fork removal becomes mechanical (pay the bridge cost ~500
times total over a session, invisibly).

## Problem statement

The current rendering architecture composites body + accessories + zone
recolour into ONE strip per `(bundle, anim, dir, flipped, look,
accessories)` tuple. Every player has a unique `look` (random colour
zones) AND in real Dofus 1.29 maps a unique accessory loadout. Result:
the cache key never collides across players, the strip cache is
effectively per-bot, and we pay one full Vello dispatch per direction
change per bot.

Observed ceiling on the current path:
- **400 bots**: ~4 GB GPU RAM (per-bot strips × in-flight retire window),
  bridge migration to ImageBitmap would saturate CPU at 200+ bots, the
  watchdog had to auto-halt the run.
- **Scaling**: linear with bot count for both bake rate AND RAM. There
  is no architectural cap.

What current session added (Tier 4 — already shipped):
- Per-frame-budgeted bake queue (`strip-bake-queue.ts`).
- Stale-bake skip (caller can opt out of a bake before it dispatches if
  the requested anim has moved on — saved ~43 % of bake CPU on the
  400-bot stress run).
- Adaptive frame budget (4 / 8 / 12 ms depending on backlog).
- Pixi `Texture` cleanup in retire — closed a real memory leak.
- Defer-until-strip-ready in the stress test.

These are the substrate for Tier 3. They don't fix the underlying
"each bot's strip is unique" cache-miss problem; they just absorb the
burst better. Tier 3 is what makes that problem go away.

## Goal

Steady-state strip-bake rate **bounded by the universe of unique
visual things on screen**, not bot count. RAM bounded by the same
quantity. Real Dofus maps at 200-500 players should be ~1 GB GPU,
60 fps, sub-second spawn-to-visible latency. 1000+ bots stable.

## Architectural overview

Three changes that ship together:

1. **Body symbol parsed into depth bands.** SWF's display list places
   accessory slot markers (`applyAccessory(this, slotId, side)`) at
   specific depths inside the body's display tree. We slice the body
   at those depths into per-direction "bands" that we can interleave
   accessory sprites between, preserving Dofus's authored Z-ordering.

2. **Body and accessories rendered separately and cached globally.**
   Body band cache keyed by `(bundle, anim, dir, flipped, bandIndex)` —
   shared across every bot of the same class. Accessory cache keyed by
   `(accBundle, accExport, animType, dir, flipped)` — shared across
   every bot wearing the same item.

3. **Colour zones become a Pixi shader uniform.** Vello bakes zone
   pixels with a sentinel alpha value (253/252/251 for zones 1/2/3).
   Pixi's custom shader detects sentinels and substitutes per-bot HSL
   tints. Strip pixels become independent of `look`.

Per-bot Pixi composition:

```
container (player)
├── body_band_0  Mesh    z=0   (back-most body parts)
├── slot-2  cape Sprite  z=1   (mount-positioned per frame)
├── body_band_1  Mesh    z=2   (torso, back legs)
├── slot-0 weapon Sprite z=3   (mount-positioned per frame)
├── body_band_2  Mesh    z=4   (front arm)
├── slot-1   hat Sprite  z=5   (mount-positioned per frame)
├── slot-4 shield Sprite z=6   (mount-positioned per frame)
└── body_band_3  Mesh    z=7   (head + hair on top)
```

Per-frame tick per bot (all O(1), just pointer + uniform updates):
- body bands: swap to `frames[frameIdx]`
- accessory sprites: swap to `accStrip.frames[frameIdx % 3]` and
  `setFromMatrix(mountTransforms[frameIdx][slotId])`

Number of bands per direction is data-driven by where slot markers
appear in the body symbol. Cape (slot 2) is usually the deepest insert
(behind everything), so band 0 might be empty for many directions —
that's fine, we just skip empty bands.

## Detailed design

### Rust — `swf-spike` changes

#### 1. Slot-depth table extraction

New function: `extract_slot_depths(doc, body_symbol_id) -> SlotDepthMap`.

Walks the body symbol's `PlaceObject` ops on each direction's authored
frame (matched by frame label: `staticR`, `staticL`, …). Records the
depth at which each `applyAccessory` AS2 call sits in the display
list.

Returns `Map<DirSuffix, Vec<(SlotId, Depth)>>` — sorted by depth, so
the bands fall out naturally:

```
band 0 = display-list entries with depth < depths[0].1
band 1 = entries with depths[0].1 < depth < depths[1].1
…
band N = entries with depth > depths[N-1].1
```

This runs once per `(bundle, direction)` on first request and caches.

#### 2. Body-band rasteriser

New entry point `renderSwfBodyBand`:

```
renderSwfBodyBand(
  bundle: &str, anim: &str, dir: &str, flipped: bool,
  band_index: u32,
) -> { bitmap, frame_w, frame_h, frame_count, grid_cols, anchor_x, anchor_y }
```

Internally:
- Looks up slot-depth table for `(bundle, dir)`.
- Computes the depth range for `band_index`.
- Runs the existing renderer but **filters PlaceObject ops by depth**
  during the body symbol walk. Out-of-band ops are skipped entirely
  (no shape commands emitted, no fill commands).
- Zone fills use sentinel alpha mode (see below).
- No accessory composition.
- Cached at the call-site by `(bundle, anim, dir, flipped, bandIndex)`.

Visual contract: rendering all bands of a direction with the slot
sprites in between produces pixels indistinguishable from today's
fully-composed body+accessories strip (modulo zone recolour which is
now a shader uniform).

#### 3. Accessory rasteriser

New entry point `renderSwfAccessoryStrip`:

```
renderSwfAccessoryStrip(
  acc_bundle: &str, acc_export: &str, anim_type: u32,
  dir: &str, flipped: bool,
) -> { bitmap, frame_w, frame_h, frame_count, grid_cols, anchor_x, anchor_y }
```

Accessories author 3 sub-frames per direction (cycled via
`char_frame % 3`). The output strip has the 3 sub-frames in a grid;
per-frame Pixi sampling picks the right cell.

Bakes from the accessory symbol's own coordinate origin (0, 0). Pixi
positions the sprite at the body's mount transform per frame.

Cached by `(accBundle, accExport, animType, dir, flipped)`.

#### 4. Mount-transform extraction

New entry point `renderSwfMountTransforms`:

```
renderSwfMountTransforms(
  bundle: &str, anim: &str, dir: &str, flipped: bool,
) -> Float32Array
```

Walks the body symbol for the requested anim/direction and, for each
frame in the anim's range, records the accumulated matrix at each
`applyAccessory` site. Returns `frame_count × max_slot × 6` floats
(each `(a, b, c, d, tx, ty)` is the 2D affine matrix; 6 floats per slot
per frame).

`slot_z_order` flag for each slot is also derived from the slot-depth
table — accessories know which band they slot between by their depth
index.

Cached by `(bundle, anim, dir, flipped)`. CPU-only, cheap. Small —
e.g. 24 frames × 5 slots × 6 floats × 4 bytes = ~2.8 KB per anim.

#### 5. Sentinel-alpha zone mode

In `swf-spike`'s fill processing, when the renderer encounters the AS2
apply-color zone byte pattern (see `feedback_swf_apply_color_zones`
memory note), instead of HSL-substituting the player colour inline,
emit the placeholder grey (or the SWF-authored colour) with a sentinel
alpha:

| Zone | Sentinel alpha |
|---|---|
| 1 | 253 |
| 2 | 252 |
| 3 | 251 |
| Non-zone opaque | 255 |
| Transparent | 0 |

The HSL substitution moves to the Pixi shader (see below).

Caveat: linear filtering on the alpha channel will smear sentinels at
zone edges. Two mitigations:

- Sample the alpha channel with NEAREST in the shader (sample twice:
  once linear for the colour test, once nearest for the alpha test).
- Render strips at sufficient density that the smear is sub-pixel.
  At current `resolution=3` this is usually fine.

#### 6. Cargo.toml / wgpu-features

No new deps. The existing `wgpu = "28"` (currently patched fork) is
sufficient.

### TypeScript — caches + Pixi composition

#### 7. Global body-band cache

New module `apps/electrobun/src/game/render/character-cache.ts`:

```ts
class CharacterCache {
  private bandCache = new Map<string, RefCounted<BodyBandStrip>>();
  private accCache  = new Map<string, RefCounted<AccessoryStrip>>();
  private mountCache = new Map<string, MountTransforms>();

  acquireBody(bundle, anim, dir, flipped, bandIndex): BodyBandStrip
  releaseBody(strip): void  // refcount-- and evict if hit cap

  acquireAccessory(accBundle, accExport, animType, dir, flipped): AccessoryStrip
  releaseAccessory(strip): void

  getMounts(bundle, anim, dir, flipped): MountTransforms  // CPU table

  // Optional LRU eviction at hard cap (default unbounded; refcount=0
  // entries get evicted when active set + retired-but-not-yet-evicted
  // crosses the threshold).
  setHardCapBytes(n: number): void
}
```

Refcount semantics: each PlayerStripRenderer slot that uses a strip
holds one ref. On anim swap, drop old ref, acquire new ref. When ref
count drops to 0, the strip is **eligible** for eviction but stays in
cache (likely the next bot wants it within ~ms).

LRU eviction: only entries with `refcount === 0` are eligible.
Eviction policy is "evict least-recently-released entries until under
cap." Default hard cap: 1.5 GB total (body + accessory). Configurable.

#### 8. PlayerStripRenderer refactor

Replace the current "ExternalSource per bot" model. Each bot's
container now has:

```
container (per player)
└── bands: BodyBand[]   // bodyBandCount Pixi Meshes
└── slots: AccessorySlot[]  // map<slotId, Sprite>
```

State:

```ts
interface SlotState_v2 {
  bandMeshes: Mesh[];          // pixi Meshes; 1 per band
  bodyStrip: BodyBandStrip;    // refcounted, shared across same-class bots
  accessories: Map<slot, AccessorySprite>;
  mounts: MountTransforms;     // CPU lookup table
  currentAnimKey: string;
  // ...
}
```

`applyAnimation` becomes:

1. Look up `(bundle, anim, dir, flipped)` → mounts (CPU, instant).
2. For each band index: `cache.acquireBody(...bandIndex)` — likely a
   cache hit; on miss, enqueue a body-band bake on `strip-bake-queue`.
3. For each accessory: `cache.acquireAccessory(...)` — same cache-hit
   pattern.
4. Old refs released (decrement → 0 = eligible for eviction).
5. Each band Mesh swaps texture to the new strip. Per-bot colour
   uniforms stay (they belong to the bot, not the strip).
6. Each accessory sprite swaps texture + jumps to its slot's mount
   transform.

Per-tick frame advance (`swapFrame`):

```ts
swapFrame(player) {
  const idx = player.frameIndex;
  for (const band of slot.bandMeshes) {
    band.geometry.uvs = bandStrip.frameUVs[idx];
  }
  const m = mounts[idx];
  for (const [slotId, accSprite] of slot.accessories) {
    accSprite.texture = accSprite.strip.frames[idx % 3];
    accSprite.setFromMatrix(m[slotId]);  // a, b, c, d, tx, ty
  }
}
```

All O(1) per bot. No Vello dispatch. The work that scales with bot
count is just texture swaps + matrix sets, both of which Pixi batches
efficiently.

#### 9. Custom Pixi shader for body zone recolour

WGSL fragment shader (sketch):

```wgsl
struct PlayerColors {
  zone1: vec3<f32>,
  zone2: vec3<f32>,
  zone3: vec3<f32>,
};

@group(0) @binding(0) var bodyTex: texture_2d<f32>;
@group(0) @binding(1) var bodySampler: sampler;     // linear
@group(0) @binding(2) var bodyNearest: sampler;    // nearest, alpha-channel test
@group(1) @binding(0) var<uniform> playerColors: PlayerColors;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let c = textureSample(bodyTex, bodySampler, uv);    // linear-filtered colour
  let aNearest = textureSample(bodyTex, bodyNearest, uv).a;
  let a_int = i32(aNearest * 255.0 + 0.5);

  if (a_int == 253) {
    return vec4<f32>(hsl_tint(c.rgb, playerColors.zone1), 1.0);
  } else if (a_int == 252) {
    return vec4<f32>(hsl_tint(c.rgb, playerColors.zone2), 1.0);
  } else if (a_int == 251) {
    return vec4<f32>(hsl_tint(c.rgb, playerColors.zone3), 1.0);
  }
  return c;
}
```

`hsl_tint(rgb, targetHsl)` is the canonical Dofus HSL recolour — the
function is straightforward (~20 lines of WGSL); we already have the
Rust implementation, port it to WGSL.

Pixi v8 hosts custom shaders via `Mesh` + `Geometry` + `Shader`. Each
bot's bands share one `Shader` instance with per-bot uniform groups
(`Shader.resources.playerColors`). Pixi's batcher merges draws across
bots when geometry + texture + shader-pipeline match — i.e. same body
band on same class, different colour uniforms is one draw call per
distinct strip with instanced uniforms. (If batch-with-different-
uniforms isn't trivial in Pixi v8, fall back to N draw calls; still
fine at 400 bots given how cheap each is.)

### Stress-test + observability

#### 10. Stress test integration

`stress-test.ts` keeps the existing pathfinding loop; the only thing
that changes is what `applyAnimation` does under the hood.

Add to the 5 s monitor:

- `bands cache size + bytes`
- `accessories cache size + bytes`
- `cache hit/miss/evict counts since last tick`

This gives us a clean signal during validation that the cache is
working as designed.

#### 11. Stress-test fairness

Currently bots have ~25 distinct gfxIds and bounded accessory pools.
For Path B validation, **deliberately widen** the accessory pool so
the test resembles a real Dofus crowd:

- Hat pool 30 items, weapon pool 25, cape pool 20, shield pool 15
- ~80 % of bots pick accessories from the pool with replacement
- 12 classes × 2 genders distributed evenly

Target on this load:
- Cache size < 1.5 GB
- Cache hit rate > 95 % after 30 s warmup
- 60 fps steady at 400 bots; 30+ fps at 1000 bots

## Migration sequence

Order matters — each step is independently testable and bisectable.

### Step 1 — slot-depth extraction (`~1 day`)
- Implement `extract_slot_depths` in `swf-spike`.
- Print to `console_log` on first load of each sprite-N bundle so we
  can manually verify the depths match what the SWF authored.
- No render changes yet.

### Step 2 — body-band rasteriser (`~1 day`)
- Add `renderSwfBodyBand` with depth-filtered display-list walk.
- New: `renderSwfBodyBandTest` JS helper that renders all bands of one
  character + draws them stacked at a debug canvas without any
  accessory sprites. Confirm the body looks correct (zones still
  inline-tinted at this point — sentinel alpha is step 6).

### Step 3 — accessory rasteriser (`~1 day`)
- Add `renderSwfAccessoryStrip`.
- Test: render one accessory at a time, visually confirm.

### Step 4 — mount-transform extraction (`~half-day`)
- Add `renderSwfMountTransforms`.
- Sanity-check by overlaying the mount points on the body band debug
  canvas — should land at known body-part attachment positions.

### Step 5 — per-band caches + refcounting (`~half-day`)
- Implement `CharacterCache`.
- No Pixi changes yet; just confirm cache populates + evicts on
  refcount drops.

### Step 6 — sentinel-alpha zone mode (`~half-day`)
- Add the alpha-sentinel branch in `swf-spike` zone-fill processing.
- Behind a flag for now (default off until step 8 wires the shader).

### Step 7 — Pixi mesh + shader for body bands (`~1 day`)
- Build the Mesh + Geometry + Shader pipeline. Initially with
  zone-substitution turned OFF (sentinel alpha = pass-through colour).
- Confirm Pixi renders the body bands at the same quality as the
  current ExternalSource path.

### Step 8 — wire sentinel + shader recolour (`~1 day`)
- Turn on Rust sentinel mode.
- Implement `hsl_tint` in WGSL.
- Compare side-by-side with the current path for several known-good
  test palettes. Pixel parity is the goal; sub-pixel deltas at zone
  edges acceptable.

### Step 9 — per-bot composition + accessory sprites (`~1.5 days`)
- Refactor `PlayerStripRenderer` to the band-mesh + accessory-sprite
  model.
- Switch the live battlefield render path over.
- Visual parity validation across all 12 classes × 5 directions × 3
  anim types × representative accessory combinations.

### Step 10 — stress-test validation (`~half-day`)
- Re-run 400 / 600 / 1000 bot scenarios.
- Confirm cache hit rate, RAM cap, steady-state fps.

### Step 11 — fork removal (`~half-day`)
- With Tier 3 in place, the bridge migration becomes a no-op
  measurement. Drop the patched-wgpu fork (delete `rust/wgpu/`,
  flip `vello-wasm/Cargo.toml` to upstream `wgpu = "28"`), delete
  `extract_gpu_*` functions and the shared-GPUDevice plumbing.

Total budget: **~8-10 days** focused work.

## Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Depth-band split mis-identifies a slot's actual SWF depth → wrong Z-order | Medium | Step 4 visual debug canvas; cross-reference with reference Flash player output on the same sprite |
| HSL tint in WGSL doesn't match Rust implementation byte-for-byte | High | Step 8 side-by-side; sub-pixel delta acceptable per pixel-regression suite convention (`feedback_swf_apply_color_zones`) |
| Pixi v8 batches with different uniform groups inefficiently → many draw calls | Low impact | Even 400 separate draws is fine on modern GPUs |
| Linear-filter alpha smear at zone edges with sentinels | Medium | Dual-sampler approach in shader (linear for colour, nearest for alpha test) |
| Cache hit rate lower than predicted with real player gear distributions | Low | Step 10 measures hit rate; if < 90 % we re-investigate accessory variant key |
| Accessory mount transforms differ subtly from current Rust path | Medium | Step 9 visual parity is the gate; if mismatch, debug at single-frame level using the step-4 visualizer |

## Acceptance criteria

Tier 3 ships when ALL hold:

1. Visual parity with current path across 12 classes × 5 directions ×
   3 anims × 5 representative accessory sets. Pixel delta within
   sub-AA noise per the existing pixel-regression methodology.
2. 400 bots stress test at full `resolution=3` runs at 60 fps steady
   state.
3. 1000 bots stress test at full resolution runs at 30+ fps steady
   state.
4. Cache size stays below 1.5 GB at 400 bots with diverse gear
   (verified by `bake.bytesCap` field added in monitor).
5. After 30 s warmup at 400 bots: cache hit rate > 95 %, steady-state
   bake rate < 5 / sec.
6. No regressions to the live battlefield game flow (vs current
   path).
7. Patched wgpu fork deleted, `rust/wgpu/` directory gone, upstream
   wgpu builds cleanly.

## What gets deleted after Tier 3 lands

- `rust/wgpu/` (the patched fork) — entire directory.
- `extract_gpu_device` / `extract_gpu_adapter` / `extract_gpu_texture`
  in `vello-wasm/src/lib.rs`.
- The `gpu` parameter in Pixi `Application.init({ gpu })` in
  `engine.ts`.
- `getVelloGpu()` and the shared-device plumbing in `vello-loader.ts`.
- The current single-strip composition in `swf-spike`
  (`render_symbol_with_ctx_tinted_accessorized_bfixed`) becomes dead
  code; the per-band + per-accessory entry points replace it.

## Reference — current session context

Tier 4 work that lands today (Path B sits on top of this):
- `apps/electrobun/src/game/render/strip-bake-queue.ts` — per-frame-budgeted bake queue
- `apps/electrobun/src/game/render/player-strip-renderer.ts` — uses queue + stale-skip
- `apps/electrobun/src/game/scene/battlefield/stress-test.ts` — defer-until-ready + monitor

Memory notes load-bearing for the design:
- `feedback_swf_apply_color_zones` — fixed AS2 byte pattern, ~150 LOC
- `feedback_swf_accessory_frame_labels` — `gotoAndStop(side)` frame-label lookup
- `feedback_battlefield_render_architecture` — strip render validated to 60 fps × 500
- `feedback_pixi_wgpu_texture_lifetime` — patched wgpu Drop is no-op
