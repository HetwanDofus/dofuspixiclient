# Unified atlas architecture (user-approved 2026-07-06)

One render contract for the whole scene:

> **Vello (wc3-verbatim bake spine) rasterizes UNIQUE art into atlas
> cells — exactly once per unique (art, frame, resolution). PixiJS
> composes EVERYTHING as ordinary sprites: tiles, actors, grid, fight
> overlays.**

Rationale (user): multiple placements of the same tile share one bake;
per-actor sprites restore canonical per-actor occlusion/interleaving
with scenery; fights/grid/UI stay plain Pixi; "perfectly canonical"
composition with negligible perf cost (Pixi batches quads sharing a
texture into ~1 draw).

## What changes per subsystem

### Actors (the slab conversion)
Today: the slab compose renders the whole crowd at world positions into
ONE world-space GPUTexture → ONE Pixi sprite → no per-actor occlusion,
custom wasm picking, internal Y-sort, per-actor states unreachable.
Target: the SAME single slab dispatch renders each actor into its own
ATLAS CELL (cell-grid transforms already exist in the flipbook path);
each actor is a Pixi Sprite over a sub-rect of the atlas
(ExternalSource, shared GPUDevice). Pixi Y-sorts actors among scenery
(one sort domain, canonical), picking/hover/ghost/highlights become
Pixi-native. This CONVERGES the strip and slab paths: slab fills the
atlas (replacing the strip's texture-churning bake machinery → also
retires the Phase-4 strip residue), Pixi composes (as the strip always
did). Atlas: tight-packed by actor bbox (see RENDER_AUDIT tight-pack
findings); multiple pages at high zoom; cells re-fit on zoom/scale
change — ONE resolution lifecycle for all actors (fixes blurry-boot +
zoom-rerender QA bugs by construction).

### Tiles
Today: per-(bundle,export,frame,resolution) cached textures shared by
refcount (dedup exists), but each bake is its OWN GPU texture
(ExternalSource per tile) → many binds, fragmented VRAM, and the
map-revisit refcount bug lives in this lifecycle.
Target: tile bakes land in shared ATLAS PAGES (per resolution
generation); placements are Pixi sprites sampling cells. Animated tiles:
frame strips as cell ranges; scripted tiles (tile_script playheads)
re-bake their small dynamic-part cells in place. Replaces the buggy
cache lifecycle (fixes map-revisit QA bug by construction).

### Everything else (grid, fights, cell tints, overlays)
Already Pixi — unchanged. The contract legitimizes them as first-class
citizens of the same scene graph as actors/tiles.

## Bake spine = wc3 VERBATIM (user directive, feedback_adopt_wc3_verbatim)
- avm1 modular engine, tile_behavior/, tile_script.rs: verbatim copies,
  equivalence-diff harness proves parity with wc3 output (classification,
  frozen frames, cycles, per-child states) across all tile bundles.
- bake_body.rs (wgpu-free, content-hash dedup, worker-shardable) as the
  body bake; retire wc2 capture sinks (zone_patch.rs, hit_geometry.rs)
  per the kickoff equivalence map.
- swf_doc/, wgpu_filters, render/{deferred,entry,cmdlog,tile_parts}
  adopted as the merge proceeds; minimap.rs → React component.
- Canonical AS2 (assets/sources) stays the BEHAVIOR truth
  (feedback_canonical_source_truth); wc3 is the IMPLEMENTATION truth.

## Execution steps (strictly sequential — shared files, one browser rule)
1. Verbatim avm1 + tile_behavior/tile_script adoption + equivalence
   harness (in progress; WIP already in tree: wc2's duplicate
   avm1/exec.rs deleted, 20/20 tests green). Fixes QA-1 (random tiles).
2. Tile atlas consolidation + new lifecycle. Fixes QA-3 (map revisit).
3. Actor slab→atlas→per-actor-sprites conversion (+ bake_body spine).
   Fixes QA-4 (resolution lifecycle) + Phase-4 strip residue.
4. Reveal gating (map+actors appear together, canonical loading
   semantics). Fixes QA-2.
5. Remaining wc3 features: minimap, spell-FX via modular avm1,
   wgpu_filters parity.
6. Phase 3 creature mode (on the converged crowd path).
7. Phase 4 gates: 7 scenarios @ 60fps full-res, 30-min soak, honest
   measurement.
8. THEN the final reorganization/rewrite of both sides (lib.rs
   decomposition to wc3's module shape; JS-side cleanup) — the "final
   clean setup".

## Verification per step
Offline harnesses + compile/test gates per step; ONE supervised browser
session per step (single Chrome instance — never two agents on the
shared devtools MCP); wc3 is never opened in a browser (user rule) —
its code is the reference.
