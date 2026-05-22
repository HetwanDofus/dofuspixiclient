# Shared composition atlas — design + implementation

## Status (2026-05-22)

Replaces the obsolete `RENDER_SCALING_PLAN.md` (the long-runtime-dip
investigation that's been superseded by Phase 1/1b/2 from
`RENDER_BAKE_PLAN.md`). This doc is the design for the per-bot RT
elimination — the architectural change required to break the 48-fps
ceiling on 200-bot stress and hit clean 60 fps for the long-term.

## The diagnosis (from snap 7 of the post-Phase-1b stress run)

| Bucket | ms/frame | Cause |
|---|---|---|
| `composeBot` (inside ticker) | 4.4 | 200 separate `renderer.render({target: perBotRT})` per anim cycle |
| Pixi main pass (rest of ticker) | 10.7 | **200 unique-texture composite sprites can't batch — Pixi issues ~200 draws** |
| Outside ticker | 7.0 | Browser compositor / GPU process / GC — irreducible from app code |
| `bakeDrain` | 1.5 | Already minimized |
| **Total** | **22-23** | |

The 7 ms outside-ticker is the floor. To hit 16.67 ms / 60 fps,
ticker must be ≤ 9-10 ms. The **10.7 ms Pixi main pass is the
ceiling-killer**, not composition itself. It exists because each
bot has a unique `compositeRT` `TextureSource`, defeating Pixi's
auto-batcher.

## The architectural insight

GPUs batch by state. Same shader + same texture binding + same
vertex format = one draw call. Pixi's auto-batcher exploits this —
sprites sharing a `TextureSource` collapse into a single batched
draw automatically.

Today every bot has its own `compositeRT` → its own `TextureSource`
→ batcher flush every sprite → 200 draws.

The fix is one change in viewpoint: **the composite isn't "per-bot
output," it's "this bot's sub-rect of a shared atlas."** Same pixels,
same anchor logic, same shader path — only the destination changes.
Pixi never knows the difference; it just sees 200 sprites sharing a
texture and batches them.

## Data flow today vs. after

```
TODAY (per anim-frame change, per bot, ~120×/main-frame):
  setBandsFrame() / setAccessoriesFrame()
  pixiRenderer.render({            ← ALLOC encoder, OPEN pass, SUBMIT
    container: bot.compositionStage,  (~27 µs CPU + GPU latency × 200)
    target: bot.compositeRT,
    clear: true })

TODAY (per main-frame):
  200 composite sprites × 200 unique sources
    → batcher flushes 200×                ← 10.7 ms

AFTER (per main-frame, once):
  for each dirty bot:
    setBandsFrame() / setAccessoriesFrame()
  pixiRenderer.render({            ← ONE encoder, ONE pass, ONE submit
    container: globalCompositionRoot,   (every bot's compositionStage
    target: sharedAtlas,                 positioned at its slot origin)
    clear: true })

AFTER (per main-frame):
  200 composite sprites × ONE shared source
    → batcher fuses to ~1 draw            ← ~1-2 ms
```

Composition collapses to one pass per tick (saves per-bot encoder
overhead). Main pass collapses to one draw call (eliminates the
unique-texture cliff). Together ≈ 9 ms saved → 13 ms frame time →
60 fps with headroom.

## Components

### SharedCompositionAtlas

```
atlasSize:  4096 × 4096 px            (64 MB GPU)
slotSize:   256 × 256 px              (covers RT_MAX_DIM-ish bbox)
slotGrid:   16 cols × 16 rows = 256 slots
slot.{x,y}: (col*256, row*256)
```

256 slots covers 200-bot stress with headroom. Real game (16-50
bots) sits at <50 slots used. If/when the >256-slot worst case
matters (500-bot HARD_CAP × mount slots), we add a second atlas
page — transparent to callers.

Bots exceeding 256-px bbox downscale via the existing
`rtSizeFor(bounds).scale` mechanism; cap becomes the slot size.

### CompositionSlotAllocator

LIFO freelist of slot indices. `acquire()` pops; `release()` pushes.
No LRU needed — slots only release on bot detach, which is rare
versus per-frame ops. LIFO means recently-freed slots reuse first,
keeping the atlas's hot region cache-friendly.

### Per-bot transform

Today: `compositionStage` lives in its own detached container,
positioned so SWF (0,0) lands at the bot's per-bot RT origin.

After: `compositionStage` is parented to
`atlas.globalCompositionRoot` and positioned so SWF (0,0) lands at
`slot.origin + (-bounds.min × scale)`. When the entire
`globalCompositionRoot` is rendered into the shared atlas, each
bot's content lands inside its own slot rect.

The composite sprite samples `{ source: atlas.source, frame: slot }`.
Its anchor is normalized to put SWF (0,0) at the bot's world
origin, identical to today's logic — just denominator changes from
RT dims to slot dims.

### Global compose pass

```ts
swapFrame(player) {
  // update bands + accessories
  // mark dirty; do NOT render
  this.compositionDirty = true;
}

composeAll() {
  if (!this.compositionDirty) return;
  pixiRenderer.render({
    container: atlas.globalCompositionRoot,
    target: atlas.renderTexture,
    clear: true,
  });
  this.compositionDirty = false;
}
```

`composeAll()` runs once per main frame via Ticker.shared at
priority `-10`, which lands AFTER per-actor `swapFrame` callbacks
(priority NORMAL = 0) but BEFORE Pixi's auto-render (priority
LOW = -25). The shared atlas is freshly composed before the main
pass samples it.

## What batches inside composeAll's single pass

- All bots of the same class share the same body atlas → band
  meshes batch (with the existing custom body-band-shader, since
  `BodyBandColourZones` is per-mesh, each band-of-class-X is still
  its own draw with that shader. To batch ACROSS bots we'd need to
  hoist zones to vertex attributes — that's the bigger Phase 5).
- Accessory sprites batch automatically via Pixi's sprite batcher.

`composeAll` cost ≈ `(class_count × band_count) +
(accessory_texture_count)` draws, **regardless of bot count**. For
12 classes × ~5 bands + ~80 unique accessory textures = ~140 draws
per pass. ~1-2 ms total.

In the main pass, all 200 composite sprites share the same
`atlas.source` → ~1 batched draw.

## Picking — unchanged

Picking reads from `hitSprite.texture` which still points at the
body's `combinedTexture` (the band atlas). The shared composition
atlas is a render target, not a hit-test source. `getSlotSprite()`
returns the same sprite as before; the picker doesn't care about
the composite path.

## Edge cases

**Slot exhaustion.** 256 slots. Real-game well under, stress at
200. If we exceed, `acquire()` returns null and `createSlot` logs +
refuses to attach. First-version safety net; multi-page atlas is a
later expansion.

**Bot bbox > slot.** Already handled by `slotSizeFor`: scale down
so bbox fits inside slot. Quality impact at default zoom: tiny.

**Compositions outside slot.** With `clear: true` every compose,
old pixels in the atlas are wiped. Detached bots' slot pixels are
cleared the next compose pass; new bots see a clean slot.

**Visible smudging if we skipped clear.** We don't skip — `clear:
true` every compose. Re-rendering all 200 bots is cheap because
batching collapses the work to ~140 draws.

**Whole-atlas clear instead of per-slot clear.** Pixi v8 doesn't
expose scissor-clear. The whole-atlas clear is a single
`clearColorAttachment` on the render pass; cheap. We just need to
re-render every bot, which we'd do anyway for any bot with a
frame change — and Pixi's batcher means re-rendering N bots
doesn't cost N× the work, it costs (band_count + accessory_count)
draws total.

## Trade-offs

**Pros:**
- 60 fps achievable at 200 bots
- One main-pass draw call for all composite sprites
- Bot count stops being a perf variable (cost driven by
  class + accessory variety)
- Plays well with the existing band-shader + per-class atlas system
- Scales sublinearly with bot count

**Cons:**
- 64 MB GPU atlas allocation (vs. ~14 MB scattered per-bot RTs
  today — modest net increase)
- Slot exhaustion at high bot counts requires multi-atlas page
  (first version supports 256 slots)
- Fixed slot size wastes pixels for smaller bots (alpha=0 so
  invisible; small fragment-shader overhead)
- Slightly more global state (atlas + allocator) — counterbalanced
  by removing per-bot RT lifecycle (retireRTQueue, ensureCompositeRT)

## Phasing

Phase A — atlas + slot allocator (new `composition-atlas.ts`).
Phase B — wire `compositionStage` parenting + composite sprite
sub-rect; remove per-bot RT lifecycle.
Phase C — global `composeAll()` triggered once per tick.
Phase D — multi-page atlas (deferred until needed).

Phases A-C land together because they're interdependent — partial
state breaks correctness. Phase D is a future expansion gated on
real workload pressure.

## Long-term fit

This is not a tactical patch. The pattern — sprite-atlas-with-slot-
allocator — is what every retained-mode 2D engine uses for many-
character scenes (Flash's bitmap-cache-as-bitmap; Godot's
MultiMeshInstance2D; Unity's Sprite Atlas + DrawMeshInstanced;
Phaser's RenderTexture batching). When we have 4-player coop,
50-bot town, or 500-mob fight, the same atlas serves them. Capacity
scales by adding atlas pages, not by rewriting the renderer.

It leaves Phase 5 (per-instance band batching for warm-state
ceiling lift) as a future refinement, not a prerequisite.
