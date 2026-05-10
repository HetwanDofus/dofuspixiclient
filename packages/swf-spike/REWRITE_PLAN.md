# swf-spike rewrite plan

Goal: take the working spike (commit `22bf1fd`) and rewrite it into a clean,
readable, performant SWF→Vello renderer that we can confidently use to
replace the entire dofasset pipeline. No behavioural regressions; the
rendered pixels at every checkpoint must match the spike on the test
fixtures (map 35, map 745, spell 802, player 10 staticR + tinted
palettes, tile 343 chimney smoke, ground tile 6 slope variants).

The rewrite stays on the same branch; the spike commit is the safety
net to diff against.

## Status (as of 582ba04)

| Phase | Status | Commit |
|-------|--------|--------|
| 1 — file split + RenderCtx scaffold | ✅ done | d900395 |
| 2 — RenderCtx adoption (sprite/symbol/shape/mask) | ✅ done | d900395 |
| 3 — memoization (shape, morph, frame_state caches) | ✅ done | d900395 |
| 4 — AVM1 → PlacedSnapshot + dedupe render path | ✅ done | dc7f570 |
| 5 — cleanup bins + dead code | ✅ done | aa308b8 |
| 6 — pixel regression suite | ✅ done | 582ba04 |

Pixel parity vs spike:
- tile 343 chimney smoke: bit-identical (sha256 unchanged).
- player 10 staticR untinted + tinted (4 palettes): bit-identical.
- spell 802 full sheet: 1 pixel of sub-AA jitter on 21,958,560
  (channel delta 1/255). Functionally equivalent.

What's left (deferred from the original phases):
- render_filtered + apply_filters_pre still take loose params (not
  ctxified). Phase 4 eliminated render_avm1's direct dependency on
  them (they're now called only from render::render_sprite_into and
  render::render_snapshot), so the threading through is cleaner now
  but the latent filter+zone / filter+morph composability bugs
  remain. No fixture currently trips them.

---

## Why we're rewriting

The spike grew bug-fix by bug-fix and it shows:

- `render_symbol_xformed_ctx_ratio` now takes **10 parameters** (ctx,
  doc, sym, scene, transform, frame, ratio, color_xform,
  player_colors, recolor_target). Every feature we added — filters,
  morph ratio, color zones — appended another arg. Adding accessory
  layering or mounts will append two more.
- `render.rs` is 1000+ lines mixing shape emission, sprite recursion,
  clip masks, filters, color transform, and zone recolor.
- `render.rs` and `render_avm1.rs` duplicate clip-mask / filter /
  color-compose logic.
- `build_frame_state` walks the full op list every render call;
  `flatten_shape` re-decodes geometry every fill. Map 35 is fast only
  because the bundle parse is amortized — per-frame steady-state is
  doing redundant work the player walk cycle and tile ticker pay for
  on every frame.
- ~30 debug bins (`dump_*`, `find_*`, `print_*`, `inspect_*`) that
  were exploration scaffolding, not part of the contract.
- Filter/morph/zone don't compose: a filtered placement drops the
  zone recolor, a clip-mask of a morph uses ratio=0, etc.

---

## Target architecture

```
packages/swf-spike/src/
├── lib.rs                  — re-exports
├── swf_doc.rs              — parser + cached indices (zones, frame rates,
│                             tile classification, sprite name maps)
├── shape.rs                — shape flattening (cached, immutable
│                             post-parse)
├── morph.rs                — morph interpolation
├── recolor.rs              — HSL-preserve-lightness (already clean)
├── render/
│   ├── mod.rs              — public API + `RenderCtx` + entry points
│   ├── ctx.rs              — `RenderCtx` struct + builder methods
│   ├── emit.rs             — low-level fill/stroke -> scene primitives
│   ├── sprite.rs           — timeline walk + child recursion
│   ├── clip.rs             — clip-mask push/pop layer logic
│   ├── filter.rs           — drop-shadow/glow/blur (wgpu compute)
│   └── zone.rs             — applyColor zone application
├── avm1/
│   ├── mod.rs              — engine + snapshot producer
│   ├── actions.rs          — opcode dispatch
│   ├── state.rs            — stack, registers, clip lifecycle
│   └── snapshot.rs         — `PlacedSnapshot` data type
├── wgpu_filters.rs         — kept (GPU compute pipelines)
├── headless.rs             — kept (test-only wgpu init)
└── bin/                    — trimmed: dump_export, render_tile,
                              classify_map_tiles, render_player_tinted
                              only. Everything else deleted.
```

Two key design rules:

1. **Renderer is pure.** Given a `RenderCtx` and a symbol, it produces
   scene operations. No timeline walk, no AVM1 dispatch, no global
   state. Frame state arrives pre-computed.
2. **AVM1 is a snapshot producer.** It runs the timeline + scripts and
   emits a `PlacedSnapshot` (= `BTreeMap<u16, ResolvedPlace>`). The
   renderer doesn't care whether the snapshot came from
   `build_frame_state` (cheap, no scripts) or the AVM1 engine
   (expensive, full emulation). Tests become trivial: snapshot in,
   pixels out.

---

## RenderCtx — the core abstraction

Replace the 10-parameter function chain with one value passed by `&mut`:

```rust
pub struct RenderCtx<'a> {
    // doc / scene / wgpu
    pub doc: &'a SwfDoc,
    pub scene: &'a mut vello::Scene,
    pub wgpu: Option<WgpuCtx<'a>>,

    // transform stack
    pub transform: Affine,
    pub frame: u16,
    pub ratio: u16,

    // color stack
    pub color_xform: OwnedColorTransform,
    pub recolor_target: Option<u32>,
    pub player_colors: PlayerColors,

    // caches (Arc<RefCell<…>> for cheap clone+share across recursion)
    pub cache: &'a RenderCache,
}

impl<'a> RenderCtx<'a> {
    /// Push a child placement: composes transforms, color xform,
    /// resolves any zone override, picks the right ratio.
    fn child(&mut self, place: &OwnedPlace, child_id: u16) -> RenderCtx<'_> { … }

    /// Push a fresh ratio (for morph children that propagate frame).
    fn with_ratio(&mut self, ratio: u16) -> RenderCtx<'_> { … }
}
```

The `child(place, id)` method is the single place that computes:

- new `transform = parent.transform * place.matrix`
- new `color_xform = parent.color_xform.compose(place.color_transform)`
- new `recolor_target = doc.sprite_color_zones.get(id) → player_colors.lookup(z) ?? parent.recolor_target`
- new `ratio = place.ratio.unwrap_or(0)` (only matters for MorphShape children; unused for sprites)
- new `frame = if child is multi-frame sprite { parent.frame } else { 0 }`

Every render function becomes `fn render_X(ctx: &mut RenderCtx<'_>, …)`.
The diff against the spike's last function: ~70% LOC reduction in
parameter plumbing.

---

## Memoization — `RenderCache`

```rust
pub struct RenderCache {
    /// `(sprite_id, frame)` → resolved placement snapshot.
    /// Walking the op list is O(N ops); we hit the same (sprite, frame)
    /// pair on every redraw of an animated tile or walk-cycle frame.
    frame_states: RefCell<HashMap<(u16, u16), Rc<BTreeMap<u16, OwnedPlace>>>>,

    /// `shape_id` → flattened draw commands. Shape geometry is
    /// immutable post-parse; flatten once, reuse forever.
    shape_cmds: RefCell<HashMap<u16, Rc<Vec<DrawCmd>>>>,

    /// `(morph_id, ratio)` → interpolated shape. Morphs are touched
    /// every animation tick; bucketing ratio to ≤256 unique values
    /// (high byte) keeps the cache bounded while looking identical.
    morph_frames: RefCell<HashMap<(u16, u8), Rc<swf::Shape>>>,
}
```

Three caches, each populated lazily on first access. All keys are
parser-immutable, so cache invalidation is "never" — drop cache when
the SwfDoc drops.

**Where each fires:**

- `frame_states`: every call into `render_sprite` for the player walk
  cycle (8 directions × ~10 frames × 60 fps = 4800 hits/s, currently
  re-walking ~50 ops each). After cache: 80 fills (one per unique
  (sprite,frame), then hash lookup).
- `shape_cmds`: every fill, every frame. The cache is the difference
  between "decode 200 paths per frame" and "decode 200 paths once
  ever" for any animation that revisits the same shapes.
- `morph_frames`: tile 343 smoke morph cycles ratio 0→65535 across
  60 frames; bucketing to 8-bit precision yields 60 unique entries
  the first cycle, zero cache misses thereafter.

Bucketing ratio to high-byte-only is a tunable; revisit if any morph
shows visible stepping (256 levels of interpolation is finer than
human eye on 60 fps animation).

---

## AVM1 → snapshot refactor (the big one)

Today `render_avm1.rs` carries its own copies of `tick_sprite`,
`render_sprite`, clip-mask handling, filter handling. This is the
duplication.

**New shape:**

```rust
// avm1/snapshot.rs
pub struct PlacedSnapshot {
    /// Resolved (depth → placement) at the current AVM1 tick.
    /// Includes everything an AVM1 script could have mutated:
    /// _x/_y/_rotation/_alpha/_visible, dynamically-loaded clips,
    /// frame seeking, etc.
    pub depths: BTreeMap<u16, ResolvedPlace>,
}

pub struct ResolvedPlace {
    pub character_id: u16,
    pub transform: Affine,
    pub color_xform: OwnedColorTransform,
    pub ratio: u16,
    pub clip_depth: Option<u16>,
    pub filters: Vec<OwnedFilter>,
    pub name: Option<String>,
    /// If this placement is itself an AVM1-driven sprite, the engine
    /// hands its own per-frame snapshot here; the renderer recurses
    /// without ever touching AVM1 state.
    pub child_snapshot: Option<Box<PlacedSnapshot>>,
}

// avm1/mod.rs
impl AvmEngine {
    pub fn tick(&mut self, doc: &SwfDoc, root_export: &str) -> PlacedSnapshot { … }
}
```

The renderer gains one new entry point that takes a snapshot instead
of a sprite + frame:

```rust
// render/mod.rs
pub fn render_snapshot(ctx: &mut RenderCtx<'_>, snap: &PlacedSnapshot) { … }
```

For non-AVM1 paths (tiles, basic spells, player) we keep the
`render_symbol(ctx, sym)` entry that walks the timeline statelessly
via `build_frame_state` (cached). For AVM1 paths (script-heavy
spells like 802) callers do `engine.tick() → render_snapshot()`.

**Why this beats sharing helper fns:** AVM1 state stays scoped to
`avm1::*`; the renderer never sees `clips`, `instance_map`,
`engine.script_object`. The snapshot is the only contract. Tests can
hand-craft snapshots; regressions in AVM1 don't break the renderer
and vice versa.

---

## Filter / Morph / Zone composability

Three latent bugs from the spike that should be fixed during the
rewrite:

### Filter wraps a zoned sprite

`render_filtered` renders the child to an intermediate texture without
threading `recolor_target`. A drop-shadow on a player skin sprite
would render with un-tinted skin. **Fix:** `render_filtered` takes
`&mut RenderCtx`, the intermediate-texture sub-render uses the same
ctx (just with a fresh scene). Trivial once `RenderCtx` exists.

### Clip-mask of a morph at ratio ≠ 0

`collect_mask_path` (render.rs:624) hardcodes `ratio=0` when the mask
character is a `MorphShape`. The mask is therefore the start shape,
which clips the wrong region for any non-zero ratio. **Fix:** thread
`ratio` from the parent placement into mask collection. Same pattern
as the morph-ratio fix already landed for visible rendering, applied
to the mask path.

### Filter wraps a morph at ratio ≠ 0

Currently dies the same way as the clip case: `apply_filters_pre` and
`render_filtered` pass `frame` not `ratio`. **Fix:** as above, plus
verify spell 108 (flame morph with glow filter) renders correctly.

All three become the same one-line fix once `RenderCtx` carries
`ratio`/`recolor_target`/`color_xform`.

---

## Phased execution

Each phase ends green: all existing fixture tests still produce the
same pixels (within ε for AA jitter) as the spike commit `22bf1fd`.

### Phase 1 — file split + `RenderCtx` scaffold (~1 day)

Goal: same code, restructured. Behaviour-preserving.

1. Move modules into the target tree (no logic changes).
2. Introduce `RenderCtx` struct, but every existing function keeps
   its current signature internally.
3. Add a thin shim that converts the loose params → `RenderCtx` at
   the public entry.
4. Verify all bins still build and produce identical pixels for:
   `tile-343-sheet`, `player10-tinted`, `spell-802` (small set —
   chosen for coverage of morph/zone/AVM1 each).

Exit criteria: `git diff --stat` shows lots of file moves, ~zero
logic changes. Pixel-diff vs spike under threshold.

### Phase 2 — RenderCtx adoption (~1 day)

Replace the 10-arg function chain with `&mut RenderCtx` everywhere.
Delete shims from phase 1.

1. `render_symbol_xformed_ctx_ratio` → `render::symbol(&mut ctx, sym)`.
2. `render_sprite_ctx` → `render::sprite::render(&mut ctx, sprite)`,
   uses `ctx.child(place, id)` for recursion.
3. `render_shape_recolor` → fold into `render::shape::render`, the
   recolor logic reads from `ctx.recolor_target`.
4. `collect_mask_path` becomes `render::clip::collect`, reads
   ratio/recolor from ctx (fixes morph-mask-at-ratio bug for free).
5. `render_filtered` / `apply_filters_pre` fold into
   `render::filter::apply`, reads everything from ctx (fixes filter
   composability bugs for free).

Exit: function bodies are short, signatures are uniform, the three
composability bugs disappear.

### Phase 3 — memoization (~half day)

Add `RenderCache` to `RenderCtx`. Wire the three caches.

Sanity benchmark: render player 10's full walk cycle (8 dirs × ~10
frames) at 60 fps for 5 seconds. Spike vs new should show ≥3× speedup
on the steady state.

Exit: bench numbers in the commit message.

### Phase 4 — AVM1 snapshot refactor (~1.5 days)

This is the riskiest phase because spell 802's AVM1 path is dense.

1. Define `PlacedSnapshot` + `ResolvedPlace`.
2. Refactor `render_avm1::AvmEngine` to expose `tick() ->
   PlacedSnapshot` and stop calling rendering functions directly.
3. Add `render::render_snapshot(ctx, snap)` that walks the snapshot
   tree (recursing on `ResolvedPlace.child_snapshot`).
4. Keep `render_avm1` binary entry points working by chaining
   `engine.tick()` → `render_snapshot()`.
5. Delete `render_avm1.rs`'s now-unused render fns.

Verify spell 802, 101, 909, 1001/1002 frame-by-frame against the
ruffle reference outputs in `output/ruffle-spell-*`.

Exit: `render_avm1.rs` is purely AVM1; rendering lives in
`render::*` only.

### Phase 5 — cleanup (~half day)

1. Delete debug bins. Keep:
   - `dump_export` — inspect a SWF export
   - `render_tile` — render one tile to PNG
   - `classify_map_tiles` — verify tile classification on a map
   - `render_player_tinted` — verify zone recolor end-to-end
   - `render_avm1_sheet` — spell regression sheet

   Delete: `check_anim_tile`, `check_tile_kind`,
   `debug_morph_render`, `dump_anim`, `dump_avm1`,
   `dump_color_zones`, `dump_fills`, `dump_interp_morph`,
   `dump_morph`, `dump_placements`, `dump_root`, `dump_sprite_id`,
   `dump_sprite_tree`, `dump_symbols`, `find_anim_children`,
   `find_animated`, `find_apply_color`, `find_high_frame`,
   `find_stop_in_children`, `inspect_tags`, `list_swf`,
   `print_bounds`, `render_cast_sheet`, `render_map`,
   `render_spell_with_player`, `render_tile_sheet`, `test_quad`.
2. Remove the dead `color_key`, `_silence_unused`, etc. flagged by
   the compiler warnings.
3. Re-export the public API (`SwfDoc`, `RenderCtx`, `render::*`,
   `recolor::*`, `morph::*`) cleanly from `lib.rs`.
4. Add module-level docs on the public API.

Exit: `cargo build --release` is warning-free; `lib.rs` has a
clear public surface.

### Phase 6 — regression suite (~half day)

The spike has *no* tests. Add a snapshot-pixel-diff suite that pins
the existing-correct outputs:

- `fixtures/`: tile_343_frame_0/30/60/90/120, player_10_static_R
  (untinted + 3 palettes), spell_802 frames 0/30/64/100,
  ground_tile_6 slopes 1..15, map_35 full.
- Test harness: `cargo test --release` runs each fixture, diffs
  against the committed PNG with a tight ε. Failure prints the
  output path so we can `open` the diff.

Exit: every refactor change going forward gets a "tests pass" or
"tests fail with X% diff on Y fixture" signal in seconds.

---

## Out of scope for this rewrite (do later, separate branches)

- Accessory layering (player + cape + shield).
- Mount / chevauchor SWF support.
- AVM1 dynamic features we don't yet need (`duplicateMovieClip`,
  full `_x`/`_y`/`_visible` property model).
- Frontend integration migration (`SwfSpike.tsx` → real game render
  paths) — that's the dofuswebclient2 branch the user described.

---

## Risks and mitigations

- **Pixel-perfect parity is fragile.** Antialiasing varies with
  scene order. Mitigation: per-fixture ε threshold; bisect on the
  first regression.
- **AVM1 phase has hidden bugs.** Spell 802 took weeks. Mitigation:
  the snapshot refactor isolates AVM1 changes from rendering — if
  a spell regresses we know the bug is in AVM1, not the renderer.
- **Cache memory bloat.** `frame_states` for a 210-frame morph
  parent could keep 210 BTreeMaps alive. Mitigation: hard cap (e.g.
  10k entries with LRU eviction); revisit if any tile evicts during
  steady-state.
- **Public API ripples.** `vello-wasm/src/lib.rs` calls into
  `swf_spike::render::render_symbol_with_ctx`. Mitigation: keep
  that exact name + signature stable; the rewrite happens behind
  it.

---

## Diff target

By the end of phase 5, `git diff 22bf1fd..HEAD --stat packages/swf-spike`
should show:

- `render.rs`: deleted (split into `render/*.rs`, each <300 lines).
- `render_avm1.rs`: deleted (split into `avm1/*.rs`, no rendering).
- `bin/`: 5 files instead of 30.
- New `render/`, `avm1/` directories.
- `swf_doc.rs`, `shape.rs`, `morph.rs`, `recolor.rs`,
  `wgpu_filters.rs`, `headless.rs`: minor edits only.

The `vello-wasm` integration (`renderSwfFrame`, `setSwfPlayerColors`,
`swfTileAnimKind`, `swfBundleFrameRate`, `swfAnimFrameCount`) keeps
identical behaviour and identical JS-side names. Frontend doesn't
change.
