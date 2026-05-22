# Instanced body-band rendering (Phase 5) — design + plan

## Status (2026-05-22)

This plan supersedes `RENDER_BAKE_PLAN.md` and `RENDER_SHARED_ATLAS_PLAN.md`
(both deleted). The bake-pipeline work and shared composition atlas
shipped in earlier sessions and stay in place; Phase 5 is the next
architectural step.

## Why

Today, each bot owns its own `compositionStage` containing 5
`BodyBandMesh` instances. Each Mesh is a Pixi node with its own
shader, geometry, and per-mesh uniforms (the zone colours UBO).
Pixi v8 cannot batch Mesh nodes across bots because each has a
unique bind group.

**At 200 bots × 5 bands = 1000 separate draw calls per compose
pass.** That's the linear-with-bot-count ceiling.

Dofus 1.29 maps can hold 200+ actors at once (busy zones, large
fights). The user has explicitly said this isn't an
exotic test case — it's normal gameplay. So the renderer must
scale to that count without degrading.

Phase 5 replaces the per-bot Mesh model with **GPU instancing**.
ONE Mesh per `(body-atlas, band-index)`, drawn N times in a single
draw call. Each instance carries its own atlas UV sub-rect, zone
colours, and slot transform as per-instance vertex attributes. The
shader pulls instance data from `@builtin(instance_index)`.

**Active batch count = (active atlases × 5 bands)**. At 200 bots
typically ~50 atlases active → ~250 batches. Compared to today's
~1000 Mesh draws, that's a 4× reduction in draw emissions and a
much larger reduction in per-Mesh CPU overhead (transform
maintenance, batch-state checks, etc.).

## The core idea

GPU instancing in Pixi v8 / WebGPU: a single `Geometry` carries
one unit quad (4 verts, 6 indices) and a separate buffer flagged
`step: "instance"`. Each `drawIndexed(6, N)` call renders N copies
of the quad, with each copy pulling its row from the instance
buffer.

Per-instance attribute layout (5 × vec4 = 80 bytes):

```
location 1: aAtlasUV    vec4    (u0, v0, u1, v1)        — body-atlas frame sub-rect
location 2: aZone1      vec4    (r, g, b, active)
location 3: aZone2      vec4    (r, g, b, active)
location 4: aZone3      vec4    (r, g, b, active)
location 5: aTransform  vec4    (slotX, slotY, scale, _) — atlas-pixel origin + fit-scale
```

## Shader

The vertex shader now consumes per-instance attributes instead of
the zones UBO:

```wgsl
@vertex
fn mainVertex(
  @location(0) aPosition: vec2<f32>,    // [0,0],[1,0],[1,1],[0,1] unit quad
  @location(1) aAtlasUV: vec4<f32>,     // PER-INSTANCE
  @location(2) aZone1: vec4<f32>,
  @location(3) aZone2: vec4<f32>,
  @location(4) aZone3: vec4<f32>,
  @location(5) aTransform: vec4<f32>,
) -> VSOut {
  // The bot's slot origin in atlas pixels + this corner of the quad,
  // scaled by the bot's fit-into-slot scale, gives the atlas-pixel
  // position. (frameWidth × scale) is the bot's atlas extent.
  let bodyPx = aTransform.xy + aPosition * aTransform.z * vec2<f32>(frameWidth, frameHeight);
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix;
  let world = mvp * vec3<f32>(bodyPx, 1.0);

  var out: VSOut;
  out.position = vec4<f32>(world.xy, 0.0, 1.0);
  // Sub-rect of the body atlas for this instance's current frame.
  out.vUv = vec2<f32>(
    mix(aAtlasUV.x, aAtlasUV.z, aPosition.x),
    mix(aAtlasUV.y, aAtlasUV.w, aPosition.y),
  );
  // Pass zones to FS as flat varyings (replaces the UBO bind).
  out.vZone1 = aZone1;
  out.vZone2 = aZone2;
  out.vZone3 = aZone3;
  return out;
}
```

The fragment shader is identical to today's body-band-shader's FS,
except it reads zone data from `vZone1/2/3` varyings instead of
the `ColourZones` UBO. ~10 lines of textual change in the FS.

Texture bindings (LINEAR + NEAREST sampler over the combined body
atlas) stay the same.

## BodyBandBatch class

One per `(atlasSource, bandIndex)` tuple. Created lazily on first
use; destroyed when the last instance leaves.

```typescript
class BodyBandBatch {
  readonly mesh: Mesh<Geometry, Shader>;          // batched mesh
  private instanceBuffer: Buffer;                  // GPU buffer
  private instanceData: Float32Array;              // CPU mirror, 20 floats per slot
  private capacity: number = 64;                   // grows 2× on overflow
  private freeSlots: number[] = [];                // LIFO
  private highWaterMark: number = 0;

  allocate(): number {
    const idx = this.freeSlots.pop() ?? this.highWaterMark++;
    if (idx >= this.capacity) this.grow();
    this.mesh.geometry.instanceCount =
      Math.max(this.mesh.geometry.instanceCount ?? 0, idx + 1);
    return idx;
  }

  release(idx: number): void {
    // Mark inactive (zeroed alpha + degenerate UV) so the GPU
    // still iterates but emits no visible fragments. Cheaper than
    // compacting the buffer.
    this.zeroInstance(idx);
    this.freeSlots.push(idx);
  }

  setUV(idx: number, u0: number, v0: number, u1: number, v1: number): void;
  setZones(idx: number, z1: number, z2: number, z3: number): void;
  setTransform(idx: number, slotX: number, slotY: number, scale: number): void;
}
```

Partial buffer updates: when a bot's frame changes, only its
16-byte UV slice is rewritten. Pixi v8's `Buffer.update(offset,
length)` supports this and dispatches a partial GPU upload.

Capacity growth: when a new instance index would exceed the
buffer's current size, the Float32Array + GPU Buffer are
reallocated at 2× capacity and the existing data is preserved.
Amortised O(1) per allocate.

## SharedCompositionAtlas as batch registry

The atlas (existing) gains a registry:

```typescript
type BatchKey = string;  // `${atlasSourceUid}|${bandIndex}`

class SharedCompositionAtlas {
  readonly batches: Map<BatchKey, BodyBandBatch>;

  getOrCreateBatch(
    atlas: BodyAtlas,
    band: BodyAtlasBand,
  ): BodyBandBatch {
    const key = `${atlas.combinedTexture.source.uid}|${band.bandIndex}`;
    let batch = this.batches.get(key);
    if (!batch) {
      batch = new BodyBandBatch(atlas, band);
      this.batches.set(key, batch);
      // Insertion order in globalCompositionRoot drives z-order;
      // see "Z-order" below.
      this.insertBatchAtBandLayer(batch);
    }
    return batch;
  }
}
```

## Z-order across the global root

Today: each bot's `compositionStage` is a child of
`globalCompositionRoot` with `sortableChildren=true`. Inside each
compositionStage, bands (zIndex even 0,2,4,…) and accessories
(zIndex odd 1,3,…) interleave correctly. Across bots, slots
don't overlap in the atlas so cross-bot z-order is moot.

Phase 5: bands move out of per-bot containers into shared
`BodyBandBatch` meshes. globalCompositionRoot's children become:

```
globalCompositionRoot
├─ band-0-layer Container
│   ├─ BodyBandBatch(atlas_iop_walkR, band=0)
│   ├─ BodyBandBatch(atlas_cra_walkR, band=0)
│   └─ … (one per active atlas at band 0)
├─ accessory-slot-0-layer Container
│   └─ (Pixi sprite batcher fuses cross-bot accessories sharing texture)
├─ band-1-layer Container
│   └─ …
├─ accessory-slot-1-layer Container
├─ band-2-layer Container
├─ accessory-slot-2-layer Container
├─ band-3-layer Container
├─ accessory-slot-3-layer Container
└─ band-4-layer Container
```

The layer containers' insertion order in globalCompositionRoot
preserves the canonical z-order (band 0 → accessory slot 0 → band
1 → …). Inside each layer, draws don't overlap across bots
because each bot's slot is a disjoint sub-rect of the atlas.

## Per-bot state changes

`SlotStateV2` changes from:

```typescript
bands: BandHook[];  // 5 BodyBandMesh wrappers per bot — REMOVED
```

To:

```typescript
bandInstances: Map<bandIndex, {
  batch: BodyBandBatch;
  slotIdx: number;
}>;
```

### On commitBody

```typescript
// For each band in nextAtlas:
for (const bandInfo of nextAtlas.bands) {
  const batch = atlas.getOrCreateBatch(nextAtlas, bandInfo);
  const slotIdx = batch.allocate();
  batch.setUV(slotIdx, /* atlas frame 0 UVs */);
  batch.setZones(slotIdx, z1, z2, z3);
  batch.setTransform(slotIdx, compositionSlot.x, compositionSlot.y, scale);
  st.bandInstances.set(bandInfo.bandIndex, { batch, slotIdx });
}
```

When the bot's atlas changes on a subsequent commit, each band
must MIGRATE from the old batch to the new batch:

```typescript
// Release from old:
for (const { batch, slotIdx } of st.bandInstances.values()) {
  batch.release(slotIdx);
}
// Allocate in new:
// ... same as commitBody above
```

### On setBandsFrame(frameIdx)

```typescript
for (const [bandIdx, { batch, slotIdx }] of st.bandInstances) {
  const [u0, v0, u1, v1] = computeAtlasUV(st.atlas, bandIdx, frameIdx);
  batch.setUV(slotIdx, u0, v0, u1, v1);
}
```

### On updateZones(z1, z2, z3)

```typescript
for (const { batch, slotIdx } of st.bandInstances.values()) {
  batch.setZones(slotIdx, z1, z2, z3);
}
```

### On applyCompositionTransform(bounds)

```typescript
const scale = this.slotScaleFor(bounds);
for (const { batch, slotIdx } of st.bandInstances.values()) {
  batch.setTransform(slotIdx, slot.x, slot.y, scale);
}
```

### On retireSlotState

```typescript
for (const { batch, slotIdx } of st.bandInstances.values()) {
  batch.release(slotIdx);
}
st.bandInstances.clear();
```

## Removal of BodyBandMesh

The `body-band-shader.ts` file's `BodyBandMesh` class is deleted.
The shader constants stay for reference but the per-mesh path is
gone. Both V1 (`PlayerStripRendererLegacy`) and V2
(`PlayerStripRendererV2`) referred to it; only V2 is active in
production so the V1 reference is also cleaned up.

`BodyBandColourZones` (the UBO wrapper) also goes — replaced by
per-instance zone attributes.

## Accessory sprites

Untouched. Accessory sprites still hang off per-slot accessory
containers and batch via Pixi's built-in sprite batcher when they
share a texture source. The accessory layer containers in
globalCompositionRoot replace per-bot compositionStage's
accessory children.

## Expected gain

| Bot count | Today compose (ms) | Phase 5 compose (ms estimated) |
|---|---|---|
| 16 | 0.3 | 0.1 |
| 50 | 0.9 | 0.3 |
| 200 | 3.5 | 1.0-1.5 |
| 500 | ~9 | 1.5-2.5 |
| 1000 | ~18 | 2.5-4 |

The sublinear scaling comes from per-instance attribute writes
being CPU-cheap (one Float32Array write + Buffer.update(offset,
16)) and GPU draw emissions being proportional to ACTIVE BATCHES,
not bot count.

At 200 bots the gain is moderate (~2 ms saved). At 500+ bots the
gain compounds because today's path scales linearly while Phase 5
plateaus.

## Risks

1. **Pixi v8 instancing path correctness.** Per-instance
   attributes need correct vertex format declaration. Validation
   path: build a minimal headless test that renders a known
   pattern with instanced data, compare pixel output to a
   non-instanced reference.

2. **Atlas-swap migration during anim transitions.** When a bot's
   anim changes, its bands move from one (atlas, band) batch to a
   different one. Release + allocate must be atomic per
   commitBody; partial migration produces visible glitches. Path
   B's atomic commit semantics give us the right transaction
   boundary.

3. **Active batch count grows unbounded.** If atlases live forever
   in the LRU, batches accumulate too. Need a batch eviction:
   when a `BodyBandBatch.highWaterMark === 0 &&
   freeSlots.length === capacity` (no instances active), the
   batch is empty and can be destroyed. Hook this into the body
   atlas LRU's retire path.

4. **Capacity-grow stall.** Reallocating a Buffer at 2× size
   copies all existing instance data. At max ~256 instances ×
   80 bytes = 20 KB → trivially fast. Not a real risk.

5. **Cross-bot z-order across atlases.** Inside band-0-layer,
   multiple `BodyBandBatch` meshes (one per active atlas) render
   in their insertion order in the layer container. Since each
   bot's pixels land in disjoint atlas slots, the cross-batch
   ordering inside a band layer doesn't matter visually.

## Phasing

| Phase | Scope | Validation |
|---|---|---|
| 5a | Shader + `BodyBandBatch` class + atlas registry. No renderer changes yet — old code still active. | Standalone unit-style: instantiate a batch, write a few instances, render to a test target, compare pixel output to a single-Mesh reference. |
| 5b | Migrate `PlayerStripRendererV2` to use batches. Delete `BodyBandMesh`. | Visual diff at 4-bot smoke test, then 200-bot stress. |
| 5c | Batch eviction hook on atlas LRU retire. | Long-running stress (10+ minutes) to verify no batch leak. |

5a is self-contained; even if 5b is interrupted, the codebase
still works (5a's shader+class are unused). 5b is the cutover —
must be a single commit or the renderer's broken mid-flight.

## Memory impact

Neutral or slightly lower process RSS. Today: ~1000 Mesh objects
+ 1000 Shader instances + 1000 Geometry instances. Phase 5: ~250
Mesh objects + 250 Shader instances + 250 Geometry instances +
250 × 20 KB instance buffers = ~5 MB total. Net win on Pixi-side
allocations.

GPU memory unchanged (atlas sizes/counts don't change).

## Long-term vision (beyond Phase 5)

For truly massive scenes (1000+ bots), the next architectural step
would be a **texture-array** approach: pack all class body atlases
into a single 2D texture array, use per-instance layer index to
select the class. That collapses the active-batch count from
~250 to ~5 (one per band, layer-indexed per instance). Requires
Rust-side bake restructuring to produce class-mega-atlases.

This is NOT in scope for Phase 5. Phase 5 hits the practical
target (200-500 bots smooth) without that complexity.
