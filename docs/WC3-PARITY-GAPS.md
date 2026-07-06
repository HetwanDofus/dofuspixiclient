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
5. **[HIGHEST — found live] Hairline strokes collapse in encode-once
   caches.** Canonical Flash renders sub-1px strokes at minimum 1
   DEVICE pixel (the dofasset NonScaling port in emit.rs:75-85
   implements this) — but `shape_frags` pre-encodes every shape at
   `Affine::IDENTITY` (cache.rs:119), so the clamp resolves to 1 TWIP;
   appended at `resolution/20` every outline renders ~6× thinner than
   canonical ("twip lines missing"). Applies to ALL twip-identity
   scene caches (shape_frags, body_subscene_cache, tile_subscenes,
   acc_subscenes) = tiles + atlases + crowd. FIX (Wave 1.3): key those
   caches by `scale_milli` and thread the downstream bake scale into
   the non-scaling clamp. ALSO canonical layout fix landed
   (d5552775b6): VIEW block = 742×556 (Kernel.as:146), canvas centred
   — baseZoom was previously computed against the phantom 1.95-aspect
   band frame and left-anchored.
6. **[LOW] Quantization details:** wc2 `roundPixels: true` snaps
   inside fractionally-scaled containers (shimmer, `engine.ts:169`);
   zIndex rounds sub-cell offset (`renderer.ts:840`) vs wc3 continuous
   0.5-step depth bands.

## B. Anim timing / applyEnd / NPC poses (report 2 — COMPLETE)

Root cause of "wrong NPC poses": **wc2 has no AVM1 playhead simulation
to recover the settled idle pose.** It clamps `static*` to frame 0;
players' static IS 1 real frame (fine), but NPCs/monsters ship
multi-frame settle-in idles → wc2 shows the transitional frame-0 setup
pose. wc3 runs a real AVM1 interpreter at bake time
(`bake_body.rs:163-181 settled_static_overrides` +
`tile_script.rs:66-216 ChildScript` + `tile_behavior/resolve.rs`),
ticks each child to its `stop()`, and pins that frame
(`render_body_to_deferred_with_overrides`).

Ranked gaps:

1. **[HIGHEST] Settled-static recovery missing** (above). wc2's
   `loadApplyEnd` stub: `character-sprite.ts:171-181`; child frames
   render `0 % N = 0` (`ctx.rs:374-380`). Fix: port wc3's
   `settled_static_overrides` + the AVM1 playhead into the wc2 body
   bake path — NOTE it reuses the SAME wc3 modules as the tile fix
   (tile_script/tile_behavior/avm1), one port serves both.
2. **[HIGH] Cast action-point missing** — spells fire at frame 1
   instead of the authored mid-swing `applyEnd` frame. wc3
   `anim_name.rs:228-263 action_point_frame`; wc2 `getApplyEndFrame`
   stub → `renderer.ts:476-488` defaults launchFrame=1.
3. **[PARITY — ruled out]** direction/flip tables byte-identical;
   accessory frame selection (name-label + fallback) identical; host
   60fps clock equivalent (wc3 catch-up ≤240 vs wc2 ≤1 frame/tick —
   cosmetic); movement speed tables identical canonical.

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

## Proposed fix waves (order of execution)

**Wave 1 — scale correctness (wc2-native, no port):**
1. Bake density == display density everywhere (the wc3 invariant).
   `currentZoom` is discrete per window size (baseZoom × [1..5]), so
   bake EXACTLY at the float `currentZoom` (not `ceil`-quantized):
   tiles (`tile-sprite-renderer.ts:551`), map bg (re-bake on
   zoom-settle instead of pinned 4), strips
   (`scene/player/renderer.ts:712`), crowd (wire
   `setResolution(currentZoom)` into the zoom path — currently never
   called). Respect the 8192 texture clamps; re-bake on zoom-settle
   (debounced), transient sprite scaling only during the gesture.
   Result: every raster displays at exactly 1:1 → twip-crisp.
2. Per-actor `scaleX/scaleY` (`^100x100`): already parsed in
   dofus1-net GM rows — thread through look/snapshot and apply at
   strip root scale and crowd emit transform (wc3
   `world_compose_deferred.rs:994`).
3. Re-evaluate `roundPixels: true` after (1) — snapping is harmless
   once containers are 1:1, may still shimmer actors; test.
4. Oversize-map fit-scale: fold into bake density or letterbox
   (defer — only affects maps > 15×17).

**Wave 2 — the AVM1 playhead port (one port, three fixes):** wc3's
`avm1` engine + `tile_behavior/` + `tile_script.rs` are the shared
machinery behind BOTH the animated-scenery model AND the NPC settled
pose. Port them into wc2's swf-spike (the heart of the Phase-2 merge),
then wire three consumers:
  2a. `settled_static_overrides` in the body bake → NPC/monster idle
      poses (B.1).
  2b. Tile classification-by-execution + per-child `ChildScript`
      playheads + per-cell seeds → parked/random/phased scenery
      (C.1-C.5); `render/tile_parts.rs` for heavy tiles.
  2c. `action_point_frame` → implement `getApplyEndFrame` → spell
      cast timing (B.2).

Each wave ends with the side-by-side re-test below before the next
starts.

## Re-test protocol

Same emulator (Docker, :14444/:15555), account test/test, map 34.
wc3: `cd ../dofuswebclient3/apps/game && bun run dev` (:5173),
`?net=ws://127.0.0.1:15555&...`. wc2: vite :5199. Screenshot the same
scene in both at identical window size; compare NPC pose, actor size,
tile animation motion (video/successive frames), edge crispness at
matched zoom. Automatable via the chrome-devtools MCP.

## Live QA round 1 (user side-by-side, 2026-07-06 evening)

1. **Tile misclassification** — some tiles ANIMATE in wc2 that are
   random-frozen in wc3. Suspects: AvmEngine missing an opcode in the
   frame-1 sim → classification falls through to loop; placements.ts
   legacy fallback engaging silently; top-level multi-frame wrapper
   with random+stop not resolved like wc3 resolve.rs:73-77. Regression
   oracle: every export the LEGACY scan called `random` must not
   animate under the new router.
2. **Actors pop in after map reveal** — wc3 shows map+actors together.
   wc2 reveals terrain, then GI→GM→async bakes trickle actors in. Fix:
   gate the reveal on the initial roster's first committed renders
   (bounded), canonical loading-screen semantics.
3. **Map A→B→A: some layer elements missing** until zoom forces
   re-acquire — tile cache/refcount lifecycle bug in the placements
   rebuild (retire/race with new sig-keyed caches?).
4. **Player strip resolution wrong** — blurry at boot (initial bake at
   default res, not currentZoom) and zoom/dezoom doesn't re-render at
   the right density (early-out compare or an int-quantized key inside
   character-cache/class-atlas path defeating the float densities).
