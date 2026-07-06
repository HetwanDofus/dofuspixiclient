# wc2 → wc3 visual-parity gap inventory (2026-07-06)

User directive: wc3 is the visual reference. Assess the whole render
architecture, fix per wc3, re-test side by side (wc3 on :5173, wc2 on
:5199, same Docker emulator, same map). Colors are already fixed
(canonical flat replace + getColorIndex permutation, commits
a4939d0926 + 83b777607c).

## A. Twip/transform chain (report 1 — COMPLETE)

Foundational: cell→pixel math is IDENTICAL in both clients (constants
53/27/26.5/13.5/20, fractional, no rounding — wc3 `grid/constants.rs:4`
+ `cell/mod.rs:162`; wc2 `packages/grid/src/{constants,cell}.ts`). The
divergence is entirely rasterization scale.

Ranked gaps:

1. **[HIGHEST] Raster/display scale mismatch.** wc3: one continuous
   `RenderResolution.scale = physical_window / DESIGN_WIDTH`
   (`resolution.rs:41-51`); every vector rasterizes at that scale and
   blits 1:1 (actor strips `output_scale = scale/20`,
   `world_compose_deferred.rs:979`; tiles re-keyed per
   `scale_milli`, `tile_cache.rs:70`). wc2: display zoom is continuous
   (`currentZoom = baseZoom × ZOOM_LEVELS[i]`, `engine.ts:139,344`) but
   bake densities are QUANTIZED and decoupled — tiles
   `clamp(ceil(zoom),4,8)` (`tile-sprite-renderer.ts:551`), map bg
   fixed 4 and never re-baked on zoom (`:71-93`), strips
   `max(2,ceil(zoom))` (`scene/player/renderer.ts:712`), crowd FIXED 3
   regardless of zoom (`crowd-renderer.ts:202`). Every raster displays
   at `currentZoom/bakeRes ≠ 1` through linear sampling → the
   "twips not respected" blur. FIX: make bake density track the
   continuous display zoom (wc3 model), re-baking on zoom-settle; or
   equivalently snap display zoom to bake density. Crowd must re-bake
   on zoom (its `setResolution` exists but is never called from the
   zoom path).
2. **[HIGH] `baseZoom` is an arbitrary continuous fit factor**
   (`min(containerW/VIEW_WIDTH, containerH/VIEW_HEIGHT)`) so the item-1
   ratio is structurally never crisp. Same fix as 1 (bake at
   currentZoom exactly).
3. **[MEDIUM] Oversize-map fit-scale stacks another fractional scale**
   (`datacenter/map.ts:65-96` + `handler.ts:490`) on already-baked
   rasters; wc3 letterboxes + re-rasterizes (`resolution.rs:117-150`).
   Only bites maps larger than 15×17.
4. **[MEDIUM] Per-actor gfx scale (server `^100x100`) missing in wc2.**
   wc3 applies `scale_x/100, scale_y/100` per actor at draw
   (`world_compose_deferred.rs:994-1001`); wc2 has NO scale field
   anywhere in the character path (CrowdPlayerSnapshot, strip,
   character-sprite). Non-100 NPCs/monsters render wrong-sized.
5. **[LOW] Quantization details:** wc2 `roundPixels: true` snaps
   inside fractionally-scaled containers (shimmer, `engine.ts:169`);
   zIndex rounds sub-cell offset (`renderer.ts:840`) vs wc3 continuous
   0.5-step depth bands.

## B. Anim timing / applyEnd / NPC poses (report 2 — pending)

Known already: wc2 `loadApplyEnd` is a NO-OP stub
(`character-sprite.ts` "would need a Rust-side bytecode walker") while
wc3 recovers the AS2 `GAC.applyEnd(this)` stop frame — NPC statics hold
the wrong frame.

## C. Tiles / animated scenery (report 3 — COMPLETE)

Root architectural divergence: **wc3 simulates Flash** (executes each
tile's AVM1: `tile_behavior/resolve.rs` classification by script
execution, per-child `ChildScript` state machines with per-cell
deterministic RNG seeds, per-frame `onClipEvent(enterFrame)` ticks);
**wc2 approximates** (static opcode scan + one linear global frame
counter fed uniformly to every dynamic depth; no script execution, no
per-instance playhead).

Ranked gaps:

1. **[HIGHEST] `Stop`-parked scenery free-runs.** Children authored to
   park at a frame (chimney elevator o1/343 child 1361, torches, doors)
   are flagged dynamic in wc2 merely because `num_frames>1`
   (`phased.rs:196-217`) and loop continuously via `DynamicAt(frame_idx)`
   (`lib.rs:10457-10477`). wc3 runs the frame-1 `Stop` → parks, and only
   `enterFrame` triggers advance it (`tile_script.rs:26-31,147-185`).
2. **[HIGH] Randomized triggers never fire** — wc2 never executes
   `onClipEvent(enterFrame)`; wc3 ticks it per instance with an
   advancing per-cell PRNG (`tile_behavior/seed.rs`).
3. **[HIGH] No per-instance phase** — wc2 cache keyed
   `bundle:export:resolution`, every sprite starts frame 0: all water
   ripples / chimneys / flames animate in lockstep. wc3 seeds phase per
   cell.
4. **[MEDIUM] All dynamic children share one counter** — wc2 feeds one
   `frame_idx` to every dynamic depth; wc3 gives each child its own
   playhead (lcm composition / tile_parts decomposition).
5. **[MEDIUM/LOW] Random-pick frozen frame** — wc2 heuristic
   `cellId % frameCount` vs wc3 executing the actual
   `gotoAndStop(random(...))` with the per-cell seed.
6. **[MEDIUM/LOW] Interactive-object rollover states** — wc3 bakes the
   `select(true)` color-xform variant + hover highlight
   (`tile_parts.rs:90-115`, `hover_highlight.rs`); wc2 has none.
7. **[PARITY] fps cadence + morph ratio are already correct** (per-
   bundle fps matches; morph ratio threads identically — the old
   "ratio fixed once" memory is stale for tiles).

Fix = port wc3's `tile_behavior/` + `tile_script.rs` +
`render/tile_parts.rs` (the Phase-2 swf-spike merge's tile leg), then
key wc2's tile ticker per-instance (cell seed) instead of per-export.

## Re-test protocol

Same emulator (Docker, :14444/:15555), account test/test, map 34.
wc3: `cd ../dofuswebclient3/apps/game && bun run dev` (:5173),
`?net=ws://127.0.0.1:15555&...`. wc2: vite :5199. Screenshot the same
scene in both at identical window size; compare NPC pose, actor size,
tile animation motion (video/successive frames), edge crispness at
matched zoom. Automatable via the chrome-devtools MCP.
