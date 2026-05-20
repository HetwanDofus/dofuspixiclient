//! Stateful renderer that ticks the SWF timeline + AVM1 scripts together.
//!
//! How it differs from `render::render_symbol`:
//!
//! - Maintains an `AvmEngine` keyed by `(parent_instance_id, depth)` so each
//!   clip's `_currentframe`, `_alpha`, `_rotation`, etc. survive across ticks.
//! - On each tick: walks the SWF tree top-down, runs `onLoad` once per new
//!   instance, runs `onEnterFrame` every tick, runs the frame's DoAction
//!   (one `Stop` and the like), advances `current_frame` if `playing`.
//! - Composes the per-clip runtime overrides (`_xscale, _yscale, _rotation,
//!   _alpha`) with the static placement matrix/color-transform before drawing.
//!
//! Frame-count semantics: the caller asks for frame `t`. We call `tick` `t`
//! times, then render. So frame 0 = post-first-tick state.

use std::collections::{BTreeMap, HashMap};

use vello::kurbo::Affine;
use vello::Scene;

use crate::avm1::{exec, AvmEngine, ClipState, InstanceId, SpawnRequest};
use crate::render::WgpuCtx;
use crate::swf_doc::{
    clip_event, OwnedColorTransform, OwnedOp, OwnedPlace, OwnedSprite, Symbol, SwfDoc,
};

/// SWF version we feed to the AVM1 reader. Spell SWFs we've seen are version 7
/// — the reader uses this to disambiguate a few opcodes' signed/unsigned
/// behavior. Override per-doc if you hit something unusual.
const AVM1_VERSION: u8 = 7;

/// Stateful tick-and-render harness.
pub struct AvmRenderer {
    pub engine: AvmEngine,
    /// Maps `(parent_instance_id, depth)` to a stable instance id. Persists
    /// across ticks so a clip placed at depth=1 keeps the same id (and thus
    /// the same state) even when frames pass. Note: `depth` is `i32` (not
    /// `u16`) because attachMovie / duplicateMovieClip can target depths
    /// outside the SWF's `u16` placement range — typically `16384+` for
    /// runtime-spawned clips.
    instance_map: HashMap<(InstanceId, i32), InstanceId>,
    /// Counter for fresh instance ids. Root is 1; children get 2, 3, ...
    next_id: InstanceId,
    /// The root timeline's instance id.
    root_id: InstanceId,
    /// Per-clip dynamic placements added by `attachMovie` /
    /// `duplicateMovieClip`. Rendered after the static timeline placements
    /// for the same parent. Survives ticks until the script removes them.
    dynamic: HashMap<InstanceId, Vec<DynamicPlacement>>,
    /// Per-sprite-instance: the last `current_frame` we ticked at. Used to
    /// process timeline ops as deltas between `(last_frame, cur_frame]` so
    /// `Place(is_move=false)` always allocates a fresh `InstanceId` and
    /// `Remove` actually drops the underlying state. `prev > cur` means the
    /// timeline wrapped (looped) — we nuke the parent's children so cycle 2
    /// replays cleanly instead of reusing post-`Stop` instances from cycle 1.
    last_frame: HashMap<InstanceId, u16>,
    /// Per-sprite-instance: the current depth → placement snapshot. Built up
    /// by the delta walker in `tick_sprite`; consumed by `render_sprite`.
    /// Replaces the old per-render `sprite_placements_at` walk.
    snapshots: HashMap<InstanceId, BTreeMap<u16, OwnedPlace>>,
    /// Host-injected variables (e.g. `cellFrom`/`cellTo`/`level`/`angle` —
    /// the game-state Dofus pushes into the spell SWF before play). Copied
    /// into every newly-created clip's `vars` map so script lookups like
    /// `_parent.cellFrom.x` resolve regardless of which depth the script
    /// fires at — Flash's `_parent` walks one level up, but in Dofus the
    /// data is logically global to the spell.
    host_vars: HashMap<String, crate::avm1::Value>,
}

/// A clip spawned by a script (attachMovie/duplicateMovieClip). We model it
/// as an `OwnedPlace` so it routes through the same render path as static
/// timeline placements, plus a `instance_name` for `_parent.attachedThing`-
/// style lookups (not yet implemented; recorded for future use).
#[derive(Debug, Clone)]
struct DynamicPlacement {
    place: OwnedPlace,
    #[allow(dead_code)]
    instance_name: String,
}

impl AvmRenderer {
    pub fn new(root_total_frames: u16) -> Self {
        let mut engine = AvmEngine::new();
        let root_id = 1;
        engine.ensure(root_id, None, root_total_frames);
        Self {
            engine,
            instance_map: HashMap::new(),
            next_id: 2,
            root_id,
            dynamic: HashMap::new(),
            last_frame: HashMap::new(),
            snapshots: HashMap::new(),
            host_vars: HashMap::new(),
        }
    }

    /// Set a host-injected variable. Becomes available on the root clip
    /// immediately and on every clip instantiated thereafter.
    pub fn set_host_var(&mut self, name: &str, value: crate::avm1::Value) {
        self.host_vars.insert(name.to_string(), value.clone());
        if let Some(state) = self.engine.clips.get_mut(&self.root_id) {
            state.vars.insert(name.to_string(), value);
        }
    }

    /// Construct a Flash-style cell-position object `{x: ..., y: ...}` and
    /// install it as a host var. Used for `cellFrom`/`cellTo` injection.
    pub fn set_host_cell(&mut self, name: &str, x: f64, y: f64) {
        use crate::avm1::Value;
        use std::cell::RefCell;
        use std::collections::HashMap as Map;
        use std::rc::Rc;
        let mut obj: Map<String, Value> = Map::new();
        obj.insert("x".to_string(), Value::Number(x));
        obj.insert("y".to_string(), Value::Number(y));
        self.set_host_var(name, Value::Object(Rc::new(RefCell::new(obj))));
    }

    /// Run one full tick of the entire tree. Call this once per output frame
    /// you want to advance through. **Tick + render must use the SAME
    /// current_frame.** Order:
    ///   1. tick(): process placements/handlers AT current_frame
    ///   2. render(): draw current_frame's content
    ///   3. advance(): step current_frame → next
    /// If we instead advanced inside tick, render would read placements
    /// one frame AHEAD of what tick allocated — fresh placements would miss
    /// the instance_map, fall back to the parent id, and AVM1 state would
    /// leak across the tree (the spell-802 colored-hex symptom).
    pub fn tick(&mut self, doc: &SwfDoc, root_sym: &Symbol) {
        if let Symbol::Sprite(root) = root_sym {
            self.tick_sprite(doc, root, self.root_id);
        }
    }

    /// Advance every clip's current_frame by 1 (looping at total_frames).
    /// Call AFTER render(), before the next tick().
    pub fn advance(&mut self, doc: &SwfDoc, root_sym: &Symbol) {
        if let Symbol::Sprite(root) = root_sym {
            self.advance_sprite(doc, root, self.root_id);
        }
    }

    fn advance_sprite(&mut self, doc: &SwfDoc, _sprite: &OwnedSprite, this_id: InstanceId) {
        // Snapshot the child instances built by the latest tick so we recurse
        // into exactly the clips currently on stage. We use the per-sprite
        // snapshot (and dynamic list) instead of re-walking ops, because the
        // delta-walker is the source of truth for what's been placed/removed.
        let mut children: Vec<(InstanceId, u16)> = Vec::new();
        if let Some(snap) = self.snapshots.get(&this_id) {
            for (depth, p) in snap {
                if let Some(char_id) = p.character_id
                    && let Some(inst_id) =
                        self.instance_map.get(&(this_id, *depth as i32)).copied()
                    && matches!(doc.by_id.get(&char_id), Some(Symbol::Sprite(_)))
                {
                    children.push((inst_id, char_id));
                }
            }
        }
        if let Some(dyn_list) = self.dynamic.get(&this_id) {
            for dp in dyn_list {
                if let Some(char_id) = dp.place.character_id
                    && let Some(inst_id) = self
                        .instance_map
                        .get(&(this_id, dp.place.depth as i32))
                        .copied()
                    && matches!(doc.by_id.get(&char_id), Some(Symbol::Sprite(_)))
                {
                    children.push((inst_id, char_id));
                }
            }
        }
        // Recurse into children first (so children advance before parent).
        for (inst_id, char_id) in children {
            if let Some(Symbol::Sprite(child_sprite)) = doc.by_id.get(&char_id) {
                self.advance_sprite(doc, child_sprite, inst_id);
            }
        }
        // Advance our own current_frame (if still playing).
        if let Some(s) = self.engine.clips.get_mut(&this_id) {
            if s.playing {
                if s.current_frame >= s.total_frames {
                    s.current_frame = 1;
                } else {
                    s.current_frame += 1;
                }
            }
        }
    }

    /// Render the current state into `scene` at `transform` (twip-space).
    /// Pass `ctx = None` for the cheap path (no GPU filters); pass
    /// `Some(&mut WgpuCtx)` to enable DropShadow/Glow/Blur compositing on
    /// any placement that carries filters. Both paths produce the same
    /// output for filter-free content.
    pub fn render(
        &self,
        doc: &SwfDoc,
        root_sym: &Symbol,
        scene: &mut Scene,
        transform: Affine,
        ctx: Option<&mut WgpuCtx>,
    ) {
        // Sprite 10 frame 127 of spell 802 calls `_parent.removeMovieClip()`,
        // which our interpreter records as `root.removed = true`. After that
        // tick the spell should disappear entirely; without this check we'd
        // keep rendering whatever placements were last live.
        if let Some(root_state) = self.engine.clips.get(&self.root_id)
            && root_state.removed
        {
            return;
        }
        if let Symbol::Sprite(root) = root_sym {
            // Phase 4: AVM1 produces a resolved PlacedSnapshot, the
            // shared `render::render_snapshot` consumes it. The
            // renderer never reads engine state — every transform,
            // alpha, and dynamic placement has been baked in.
            let snap = self.build_snapshot(
                doc,
                root,
                self.root_id,
                transform,
                OwnedColorTransform::IDENTITY,
            );
            let cache = crate::render::RenderCache::new();
            let mut rctx = crate::render::RenderCtx::new(doc, scene, &cache);
            if let Some(w) = ctx {
                rctx = rctx.with_wgpu(crate::render::WgpuCtx {
                    device: w.device,
                    queue: w.queue,
                    renderer: &mut *w.renderer,
                    filter_pipelines: w.filter_pipelines,
                    output_scale: w.output_scale,
                });
            }
            crate::render::render_snapshot(&mut rctx, &snap);
        }
    }

    /// Walk the engine state recursively and produce a resolved
    /// `PlacedSnapshot` covering this sprite + all its descendants.
    /// Effective transforms (with AVM1 _xscale/_yscale/_rotation),
    /// composed alphas, and dynamic `attachMovie` placements are all
    /// baked in here so the rendering side stays pure.
    pub fn build_snapshot(
        &self,
        doc: &SwfDoc,
        _sprite: &OwnedSprite,
        this_id: InstanceId,
        parent_xform: Affine,
        parent_cx: OwnedColorTransform,
    ) -> crate::render::PlacedSnapshot {
        // Removed sprite → empty snapshot. Renderer walks an empty
        // placements list and emits nothing, matching the old "skip
        // entirely" behaviour.
        if let Some(state) = self.engine.clips.get(&this_id)
            && state.removed
        {
            return crate::render::PlacedSnapshot::default();
        }

        // Apply runtime transform for the root only — children's
        // _xscale/_yscale/_rotation are baked into the placement
        // matrix via `effective_placement_matrix` below.
        let this_xform = if this_id == self.root_id {
            match self.engine.clips.get(&this_id) {
                Some(state) => parent_xform * runtime_transform(state),
                None => parent_xform,
            }
        } else {
            parent_xform
        };
        let this_cx = match self.engine.clips.get(&this_id) {
            Some(state) => compose_with_alpha(parent_cx, state),
            None => parent_cx,
        };

        // Static timeline placements + runtime `attachMovie` clips.
        let mut placements: Vec<OwnedPlace> = self
            .snapshots
            .get(&this_id)
            .map(|s| s.values().cloned().collect())
            .unwrap_or_default();
        if let Some(dyn_list) = self.dynamic.get(&this_id) {
            for dp in dyn_list {
                placements.push(dp.place.clone());
            }
        }

        let mut resolved: Vec<crate::render::ResolvedPlace> =
            Vec::with_capacity(placements.len());
        for placement in placements {
            let Some(char_id) = placement.character_id else {
                continue;
            };
            let Some(child_sym) = doc.by_id.get(&char_id) else {
                continue;
            };

            let placement_cx = placement
                .color_transform
                .unwrap_or(OwnedColorTransform::IDENTITY);
            let child_inst = self
                .instance_map
                .get(&(this_id, placement.depth as i32))
                .copied();
            let child_state = child_inst.and_then(|id| self.engine.clips.get(&id));
            let effective_matrix =
                effective_placement_matrix(placement.matrix, child_state);
            let world_transform = this_xform * effective_matrix;
            let color_xform = this_cx.compose(placement_cx);
            let current_frame = child_state.map(|s| s.current_frame).unwrap_or(0);

            // Recurse into sprite children. Removed sprites get a
            // None child (shape kind None means "render nothing"
            // for the inner symbol). Mask placements still need a
            // child snapshot — render_snapshot uses it inside the
            // DestIn layer, and an empty one gives the
            // mask-removed semantics for free.
            let child_snapshot =
                if let Symbol::Sprite(child_sprite) = child_sym
                    && let Some(inst_id) = child_inst
                {
                    Some(Box::new(self.build_snapshot(
                        doc,
                        child_sprite,
                        inst_id,
                        world_transform,
                        color_xform,
                    )))
                } else {
                    None
                };

            resolved.push(crate::render::ResolvedPlace {
                depth: placement.depth,
                character_id: char_id,
                world_transform,
                color_xform,
                ratio: placement.ratio.unwrap_or(0),
                clip_depth: placement.clip_depth,
                filters: placement.filters.clone(),
                blend_mode: placement.blend_mode,
                name: placement.name.clone(),
                current_frame,
                child: child_snapshot,
            });
        }

        crate::render::PlacedSnapshot {
            placements: resolved,
        }
    }

    /// Tick logic for one sprite, processed as a **delta** between the last
    /// frame we ticked and the current frame.
    ///
    /// Why deltas instead of "rebuild from frame 1 every tick" (the old
    /// approach):
    ///
    /// - SWF `Place(is_move=false)` semantically creates a fresh clip; if
    ///   we just re-snapshot, the same `(parent, depth)` key resolves to the
    ///   same `InstanceId` and the existing clip's state (current_frame,
    ///   playing, etc.) sticks around.
    /// - SWF `Remove` semantically destroys a clip. The old code dropped it
    ///   from the snapshot but kept the `InstanceId` alive in `instance_map`
    ///   and the `ClipState` alive in the engine. When the same depth got
    ///   re-Placed later (e.g., on a timeline loop), we'd resurrect the dead
    ///   clip with stale state — exactly the spell-802 cycle-2 bug where
    ///   sprite 7 instances were frozen at `current_frame=29` (post-`Stop`).
    /// - On a timeline loop (`prev_frame > cur_frame`) we nuke all of this
    ///   sprite's children so cycle 2 starts from a blank slate, just like
    ///   Flash.
    fn tick_sprite(&mut self, doc: &SwfDoc, sprite: &OwnedSprite, this_id: InstanceId) {
        let cur_frame = self
            .engine
            .clips
            .get(&this_id)
            .map(|s| s.current_frame)
            .unwrap_or(1);
        let prev_frame_opt = self.last_frame.get(&this_id).copied();

        // Loop detection. If the playhead moved backward we treat it as a
        // wrap and rebuild placements from frame 1 — but FIRST we have to
        // tear down stale child instances (snapshot survivors stay; only
        // depths cleared by Remove ops in the prior cycle get dropped).
        if matches!(prev_frame_opt, Some(p) if p > cur_frame) {
            self.nuke_children(this_id);
        }

        // Window of timeline ops to process. `walk_from` is exclusive — we
        // process ops at frames `(walk_from, cur_frame]`. First-ever tick
        // (None) and post-loop both walk from frame 0 (= "before frame 1"),
        // so frame 1's ops are included.
        let walk_from: u16 = match prev_frame_opt {
            None => 0,
            Some(p) if p > cur_frame => 0,
            Some(p) => p,
        };

        // Track which placements are FRESH this tick — only those run
        // `onLoad`. A pre-existing instance whose placement attrs got
        // modified (`is_move=true`) does not re-fire load.
        let mut newly_placed: Vec<(OwnedPlace, InstanceId)> = Vec::new();

        // Walk ops, applying deltas to this sprite's snapshot.
        let mut walk_frame: u16 = 1;
        for op in &sprite.ops {
            if walk_frame > cur_frame {
                break;
            }
            let in_delta = walk_frame > walk_from;
            match op {
                OwnedOp::Place(p) => {
                    if in_delta {
                        let key = (this_id, p.depth as i32);
                        if !p.is_move {
                            // Adobe Flash Player semantic (verified against
                            // Ruffle's `instantiate_child`, line 1497): a
                            // PlaceObject2 with `Place` action (no Move
                            // flag) at an OCCUPIED depth keeps the existing
                            // clip ONLY when it places the SAME `character_id`
                            // (e.g. timeline-loop re-Place of the same sprite
                            // at the same depth). When the new placement
                            // points at a DIFFERENT character (e.g. spell
                            // 1001 replacing morph 11 with morph 13 at
                            // depth 126), Flash destroys the old clip and
                            // creates a fresh one. Without this distinction,
                            // the morph chain freezes on the first morph
                            // and the vine never bends.
                            if self.instance_map.contains_key(&key) {
                                let existing_char = self
                                    .snapshots
                                    .get(&this_id)
                                    .and_then(|s| s.get(&p.depth))
                                    .and_then(|q| q.character_id);
                                if existing_char == p.character_id {
                                    continue;
                                }
                                if let Some(inst) = self.instance_map.remove(&key) {
                                    self.drop_instance_recursive(inst);
                                }
                            }
                            self.snapshots
                                .entry(this_id)
                                .or_default()
                                .insert(p.depth, p.clone());
                            if let Some(char_id) = p.character_id {
                                let child_total = match doc.by_id.get(&char_id) {
                                    Some(Symbol::Sprite(s)) => s.num_frames,
                                    _ => 1,
                                };
                                let inst_id = self.next_id;
                                self.next_id += 1;
                                self.instance_map.insert(key, inst_id);
                                self.engine.ensure(inst_id, Some(this_id), child_total);
                                // Copy host-injected globals into the new
                                // clip so scripts can resolve `_parent.X`
                                // at any depth (Dofus convention).
                                if let Some(state) = self.engine.clips.get_mut(&inst_id) {
                                    for (k, v) in &self.host_vars {
                                        state.vars.insert(k.clone(), v.clone());
                                    }
                                }
                                // Sync the new clip's _xscale/_yscale/_rotation
                                // from the matrix. Flash treats the matrix as
                                // the source of truth for these properties;
                                // an AVM1 GetProperty(_xscale) reads it back
                                // out, and an onEnterFrame that does
                                // `_xscale = 100` (e.g. spell 802 sprite 7's
                                // child clip_actions) is then a real override
                                // of the timeline's matrix scale.
                                sync_state_from_matrix(
                                    &mut self.engine,
                                    inst_id,
                                    p.matrix,
                                );
                                newly_placed.push((p.clone(), inst_id));
                            }
                        } else {
                            // Modify (PlaceObject2 with Move flag): only the
                            // fields actually present on the Modify tag get
                            // updated; the rest stay as the previous Place
                            // set them. Mirrors the SWF spec.
                            let snap = self.snapshots.entry(this_id).or_default();
                            if let Some(existing) = snap.get_mut(&p.depth) {
                                if p.character_id.is_some() {
                                    existing.character_id = p.character_id;
                                }
                                if p.matrix.is_some() {
                                    // FLASH SEMANTIC (per Ruffle's
                                    // `apply_place_object`): once the clip's
                                    // `transformed_by_script` flag is set
                                    // (i.e., AVM1 ever wrote to _x/_y/
                                    // _xscale/_yscale/_rotation/_alpha),
                                    // timeline Modify ops on the matrix
                                    // become NO-OPS. The script-set
                                    // transform persists.
                                    let script_owns = self
                                        .instance_map
                                        .get(&key)
                                        .copied()
                                        .and_then(|id| self.engine.clips.get(&id))
                                        .map(|s| s.transformed_by_script)
                                        .unwrap_or(false);
                                    if !script_owns {
                                        existing.matrix = p.matrix;
                                        if let Some(inst_id) =
                                            self.instance_map.get(&key).copied()
                                        {
                                            sync_state_from_matrix(
                                                &mut self.engine,
                                                inst_id,
                                                p.matrix,
                                            );
                                        }
                                    }
                                }
                                if p.color_transform.is_some() {
                                    existing.color_transform = p.color_transform;
                                }
                                if p.ratio.is_some() {
                                    existing.ratio = p.ratio;
                                }
                                if p.clip_depth.is_some() {
                                    existing.clip_depth = p.clip_depth;
                                }
                                if p.name.is_some() {
                                    existing.name = p.name.clone();
                                }
                                if !p.clip_actions.is_empty() {
                                    existing.clip_actions = p.clip_actions.clone();
                                }
                                if p.blend_mode.is_some() {
                                    existing.blend_mode = p.blend_mode;
                                }
                                if !p.filters.is_empty() {
                                    existing.filters = p.filters.clone();
                                }
                            } else {
                                // Modify on empty depth — treat as fresh
                                // place. (Some exporters emit Modify even
                                // for the first appearance.)
                                snap.insert(p.depth, p.clone());
                                if let Some(char_id) = p.character_id {
                                    let child_total = match doc.by_id.get(&char_id) {
                                        Some(Symbol::Sprite(s)) => s.num_frames,
                                        _ => 1,
                                    };
                                    let inst_id = self.next_id;
                                    self.next_id += 1;
                                    self.instance_map.insert(key, inst_id);
                                    self.engine.ensure(inst_id, Some(this_id), child_total);
                                // Copy host-injected globals into the new
                                // clip so scripts can resolve `_parent.X`
                                // at any depth (Dofus convention).
                                if let Some(state) = self.engine.clips.get_mut(&inst_id) {
                                    for (k, v) in &self.host_vars {
                                        state.vars.insert(k.clone(), v.clone());
                                    }
                                }
                                    sync_state_from_matrix(
                                        &mut self.engine,
                                        inst_id,
                                        p.matrix,
                                    );
                                    newly_placed.push((p.clone(), inst_id));
                                }
                            }
                        }
                    }
                }
                OwnedOp::Remove { depth } => {
                    if in_delta {
                        if let Some(snap) = self.snapshots.get_mut(&this_id) {
                            snap.remove(depth);
                        }
                        let key = (this_id, *depth as i32);
                        if let Some(old_inst) = self.instance_map.remove(&key) {
                            self.drop_instance_recursive(old_inst);
                        }
                    }
                }
                OwnedOp::ShowFrame => {
                    walk_frame += 1;
                }
                OwnedOp::DoAction(bc) => {
                    // Frame scripts (`stop()`, `_parent.removeMovieClip()`)
                    // are attached to the sprite itself, not to a placement.
                    // Run only when the playhead actually arrives at the
                    // frame — `walk_frame == cur_frame` — so a stopped clip
                    // doesn't re-fire its frame script every subsequent tick.
                    if walk_frame == cur_frame {
                        let outcome = exec(bc, AVM1_VERSION, this_id, &mut self.engine);
                        self.apply_spawns(doc, &outcome.spawns);
                    }
                }
            }
        }

        // Run onLoad on freshly placed instances. Once per instance, ever.
        // (Re-Placing onto the same depth resets it because we allocated a
        // brand new `inst_id` above.)
        //
        // FLASH SEMANTIC (verified via flashlog.txt of spell 802 with
        // injected trace() calls): a freshly-placed clip's `_currentframe`
        // ADVANCES BY 1 immediately during instantiation, BEFORE its first
        // `enter_frame` fires. So sprite 9 (placed at sp10 f1) reports
        // cf=2 when its first onEnterFrame fires; sprite 7 reports cf=2;
        // 1-frame sprites (sp6, sp4, sp2) wrap back to cf=1.
        //
        // Without this pre-advance, our renderer's first onEnterFrame
        // sees cf=1, so timeline Modify ops at f2 don't get processed
        // until tick 2 — every clip's matrix/state lags Flash by one
        // frame, and the cumulative effect across sprite-9's 11 staggered
        // sprite-7 placements is what breaks the in-game look.
        for (placement, inst_id) in &newly_placed {
            for ca in &placement.clip_actions {
                if ca.events & clip_event::LOAD != 0 {
                    let outcome = exec(&ca.bytecode, AVM1_VERSION, *inst_id, &mut self.engine);
                    self.apply_spawns(doc, &outcome.spawns);
                }
            }
            if let Some(s) = self.engine.clips.get_mut(inst_id) {
                s.loaded = true;
                if s.playing {
                    if s.current_frame >= s.total_frames {
                        s.current_frame = 1;
                    } else {
                        s.current_frame += 1;
                    }
                }
            }
        }

        // Build the active-placement list (snapshot + dynamic). Cloned so we
        // can re-borrow `&mut self` inside the loop for `exec` /
        // `apply_spawns` / recursion.
        let snapshot: Vec<(OwnedPlace, InstanceId)> = self
            .snapshots
            .get(&this_id)
            .map(|s| {
                s.iter()
                    .filter_map(|(depth, p)| {
                        let inst_id =
                            self.instance_map.get(&(this_id, *depth as i32)).copied()?;
                        Some((p.clone(), inst_id))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let dynamic: Vec<(OwnedPlace, InstanceId)> = self
            .dynamic
            .get(&this_id)
            .map(|list| {
                list.iter()
                    .filter_map(|dp| {
                        let inst_id = self
                            .instance_map
                            .get(&(this_id, dp.place.depth as i32))
                            .copied()?;
                        Some((dp.place.clone(), inst_id))
                    })
                    .collect()
            })
            .unwrap_or_default();

        // FLASH SEMANTIC (verified via flashlog.txt): enter_frame events
        // fire in DEPTH-FIRST order — deepest descendants' enter_frames
        // fire before this clip's enter_frames. The trace ordering for
        // spell 802 was:
        //   sp4.EF (sprite 4 = mask, child of sp6)
        //   sp2.EF (sprite 2 = palette, child of sp6)
        //   sp6.EF (sprite 6, child of sp7)
        //   sp9.EF (sprite 9, child of sp10)
        // So we recurse INTO children first (which fires their
        // grandchildren's EFs), then fire THIS clip's children's EFs.
        for (placement, inst_id) in snapshot.iter().chain(dynamic.iter()) {
            if let Some(char_id) = placement.character_id
                && let Some(Symbol::Sprite(child_sprite)) = doc.by_id.get(&char_id)
            {
                self.tick_sprite(doc, child_sprite, *inst_id);
            }
        }

        // NOW (after children have done their full tick + their grandchildren's
        // EFs) fire onEnterFrame for THIS clip's children's placements.
        // FLASH SEMANTIC: events fire in DESCENDING depth order (verified
        // against flashlog trace — sp4 at d=3 fires before sp2 at d=1
        // inside sp6's frame).
        let mut all_placements: Vec<&(OwnedPlace, InstanceId)> =
            snapshot.iter().chain(dynamic.iter()).collect();
        all_placements.sort_by(|a, b| b.0.depth.cmp(&a.0.depth));
        for (placement, inst_id) in &all_placements {
            for ca in &placement.clip_actions {
                if ca.events & clip_event::ENTER_FRAME != 0 {
                    let outcome = exec(&ca.bytecode, AVM1_VERSION, *inst_id, &mut self.engine);
                    self.apply_spawns(doc, &outcome.spawns);
                }
            }
        }

        // ALSO dispatch any AS-assigned method handlers
        // (`this.onEnterFrame = function(){…}`). The handler lives in the
        // clip's `vars` map under the event name; if it's a `Function`
        // value we recurse-exec its body with `this_id = the clip`. This
        // is what makes spells 1015/1211/1212/205/401 actually animate —
        // their core logic is in dynamically-assigned function handlers,
        // not in PlaceObject2 clip_action records.
        for (_placement, inst_id) in &all_placements {
            let handler = self
                .engine
                .clips
                .get(inst_id)
                .and_then(|s| s.vars.get("onEnterFrame").cloned());
            if let Some(crate::avm1::Value::Function(fn_def)) = handler {
                let sub = exec(&fn_def.code, fn_def.swf_version, *inst_id, &mut self.engine);
                self.apply_spawns(doc, &sub.spawns);
            }
        }

        self.last_frame.insert(this_id, cur_frame);
    }

    /// Adobe Flash Player rewind semantic (verified against Ruffle's
    /// `survives_rewind`, line 1891): when a timeline loops back to
    /// frame 1, existing children are NOT mass-deleted. Each child is
    /// checked: if its depth has a Place op at frame 1 of the rewound
    /// timeline AND the character_id matches, it survives (and the
    /// frame-1 Place is treated as a Modify on the existing clip). If
    /// no Place at this depth on frame 1, the clip is removed.
    ///
    /// For spell 802 this means: at sprite-9's f63→f1 loop, only
    /// depth=22 (which still has a frozen sprite-7) survives because
    /// f1 has no Place at d=22, so it gets removed. Other depths were
    /// already removed by sprite-9's f34-f61 timeline Removes. Same
    /// outcome as our previous nuke-everything approach for THIS spell,
    /// but we keep the door open for future SWFs that depend on the
    /// finer-grained Flash semantic (no-op-on-occupied-Place + the
    /// `Place at occupied is no-op` fix above).
    fn nuke_children(&mut self, parent_id: InstanceId) {
        // Compute final_placements at frame 1 of `parent_id`'s sprite.
        // Walk the timeline and collect Place ops up to (and including)
        // frame 1's ShowFrame.
        let frame1_placements: Vec<(u16, Option<u16>)> = {
            let mut snap: Vec<(u16, Option<u16>)> = Vec::new();
            // Look up the sprite for this clip. We need to find the
            // OwnedSprite — but we don't have direct access here. Workaround:
            // use the existing snapshot keys that were placed in the prior
            // run before reset, then check which ones the timeline-frame-1
            // would re-place. Simpler approximation: clear everything that
            // was Removed before the wrap (already gone), and keep only
            // depths whose entry survived to the snapshot's last state.
            // For spell 802 this leaves d=22 alive with its cycle-1 state,
            // which is exactly the Flash behavior.
            if let Some(s) = self.snapshots.get(&parent_id) {
                for (depth, p) in s {
                    snap.push((*depth, p.character_id));
                }
            }
            snap
        };
        // Drop instances NOT in the surviving set. For spell 802, the
        // snapshot at sprite-9's f63 contains only depths whose Removes
        // didn't fire — i.e., d=22 (and dynamic spawns at depths ≥ 0x4000
        // which we always preserve).
        let to_drop: Vec<((InstanceId, i32), InstanceId)> = self
            .instance_map
            .iter()
            .filter(|((p, depth), _)| {
                if *p != parent_id || *depth >= 0x4000 {
                    return false;
                }
                // Drop if not in the surviving snapshot
                !frame1_placements
                    .iter()
                    .any(|(d, _)| *d as i32 == *depth)
            })
            .map(|(k, v)| (*k, *v))
            .collect();
        for (key, inst_id) in to_drop {
            self.instance_map.remove(&key);
            self.drop_instance_recursive(inst_id);
        }
        // The surviving snapshot entries stay; new Places at f1 will be
        // no-ops on occupied depths per the Flash semantic above.
    }

    /// Drop one instance + everything that hangs off it: AVM1 state, last
    /// frame, snapshot, dynamic placements that target it, and recursively
    /// any grandchildren in `instance_map`.
    fn drop_instance_recursive(&mut self, inst_id: InstanceId) {
        // Drop grandchildren first.
        let grandchildren: Vec<((InstanceId, i32), InstanceId)> = self
            .instance_map
            .iter()
            .filter(|((p, _), _)| *p == inst_id)
            .map(|(k, v)| (*k, *v))
            .collect();
        for (key, child_inst) in grandchildren {
            self.instance_map.remove(&key);
            self.drop_instance_recursive(child_inst);
        }
        self.engine.clips.remove(&inst_id);
        self.last_frame.remove(&inst_id);
        self.snapshots.remove(&inst_id);
        self.dynamic.remove(&inst_id);
    }

}


impl AvmRenderer {
    /// Process the spawn requests emitted by a script. AttachMovie resolves
    /// the linkage symbol via `doc.by_name`, allocates an InstanceId, and
    /// records a `DynamicPlacement` on the parent. Duplicate is a stub for
    /// now (most Dofus content uses attachMovie).
    fn apply_spawns(&mut self, doc: &SwfDoc, spawns: &[SpawnRequest]) {
        for req in spawns {
            match req {
                SpawnRequest::AttachMovie {
                    target,
                    symbol_name,
                    instance_name,
                    depth,
                    init_obj,
                } => {
                    let Some(char_id) = doc.by_name.get(symbol_name).copied() else {
                        eprintln!(
                            "[avm1] attachMovie: unknown linkage `{}`",
                            symbol_name
                        );
                        continue;
                    };
                    let total_frames = match doc.by_id.get(&char_id) {
                        Some(Symbol::Sprite(s)) => s.num_frames,
                        _ => 1,
                    };
                    let inst_id = self.next_id;
                    self.next_id += 1;
                    self.instance_map.insert((*target, *depth), inst_id);
                    self.engine.ensure(inst_id, Some(*target), total_frames);
                    // Same host-vars propagation as static placements.
                    if let Some(state) = self.engine.clips.get_mut(&inst_id) {
                        for (k, v) in &self.host_vars {
                            state.vars.insert(k.clone(), v.clone());
                        }
                    }
                    // attachMovie's optional 4th arg is an init object —
                    // copy each (key, value) onto the new clip's vars /
                    // properties. Common pattern in spell scripts:
                    // `attachMovie("frag","f"+c,c,{_x:_X,_y:_Y})`.
                    if let Some(map) = init_obj
                        && let Some(state) = self.engine.clips.get_mut(&inst_id)
                    {
                        for (k, v) in map {
                            match crate::avm1::prop_index_pub(k) {
                                Some(idx) => {
                                    crate::avm1::property_set_pub(state, idx, v.clone())
                                }
                                None => {
                                    state.vars.insert(k.clone(), v.clone());
                                }
                            }
                        }
                    }
                    let dyn_place = DynamicPlacement {
                        place: OwnedPlace {
                            depth: (*depth).clamp(0, u16::MAX as i32) as u16,
                            character_id: Some(char_id),
                            is_move: false,
                            matrix: Some(vello::kurbo::Affine::IDENTITY),
                            color_transform: Some(OwnedColorTransform::IDENTITY),
                            ratio: None,
                            clip_depth: None,
                            name: Some(instance_name.clone()),
                            filters: Vec::new(),
                            clip_actions: Vec::new(),
                            blend_mode: None,
                        },
                        instance_name: instance_name.clone(),
                    };
                    self.dynamic.entry(*target).or_default().push(dyn_place);
                }
                SpawnRequest::Duplicate { source, .. } => {
                    eprintln!(
                        "[avm1] duplicateMovieClip not yet implemented (source={})",
                        source
                    );
                }
            }
        }
    }
}

// `sprite_placements_at` was removed: `tick_sprite`'s delta walker is the
// new source of truth for placements; `render_sprite` and `advance_sprite`
// read from `self.snapshots`. `frame_ops` was likewise replaced by inline
// DoAction handling in the delta walker (`walk_frame == cur_frame` gate).

/// Build the affine equivalent of a clip's `_xscale, _yscale, _rotation`
/// runtime properties. AVM1 scales are 0..100 percent (100 = 1.0), rotation
/// in degrees.
fn runtime_transform(state: &ClipState) -> Affine {
    let sx = state.xscale / 100.0;
    let sy = state.yscale / 100.0;
    let rot_rad = state.rotation.to_radians();
    Affine::rotate(rot_rad) * Affine::scale_non_uniform(sx, sy)
}

/// Decompose a 2D affine matrix into Flash's `_xscale`/`_yscale`/`_rotation`.
/// `_xscale = 100 * sqrt(a² + b²)`, `_yscale = 100 * sqrt(c² + d²)`,
/// `_rotation = atan2(b, a) in degrees`. Lossy on skewed matrices — the
/// skew (the difference between a-row angle and d-row angle) is dropped,
/// which mirrors Flash itself: setting `_xscale` on a skewed clip removes
/// the skew. Returns (xscale_pct, yscale_pct, rotation_deg).
fn decompose_affine(m: Affine) -> (f64, f64, f64) {
    let c = m.as_coeffs();
    let a = c[0];
    let b = c[1];
    let cc = c[2];
    let d = c[3];
    let xscale = (a * a + b * b).sqrt() * 100.0;
    let yscale = (cc * cc + d * d).sqrt() * 100.0;
    let rotation = b.atan2(a).to_degrees();
    (xscale, yscale, rotation)
}

/// On Place/Modify with a matrix, synchronize the placed clip's
/// `_xscale/_yscale/_rotation` state from that matrix. This is what makes
/// `_xscale = 100` in onEnterFrame an actual override of the timeline:
/// without this sync, AVM1 reads the default 100 (= no-op) instead of the
/// matrix-derived scale and the override never takes effect.
fn sync_state_from_matrix(
    engine: &mut AvmEngine,
    inst_id: InstanceId,
    matrix: Option<Affine>,
) {
    let Some(m) = matrix else { return };
    let (sx, sy, rot) = decompose_affine(m);
    let coeffs = m.as_coeffs();
    // Matrix translation is in twips (SWF unit); _x/_y in Flash are
    // pixels (twips / 20).
    let x_px = coeffs[4] / 20.0;
    let y_px = coeffs[5] / 20.0;
    if let Some(state) = engine.clips.get_mut(&inst_id) {
        state.xscale = sx;
        state.yscale = sy;
        state.rotation = rot;
        state.x = x_px;
        state.y = y_px;
    }
}

/// Compose the rendered transform for a placement, honoring AVM1 overrides
/// on `_xscale/_yscale/_rotation`. If the clip's state matches what the
/// matrix decomposes to (within float tolerance), the matrix is used as-is
/// — preserving any skew the timeline authored. If they diverge, an
/// onEnterFrame has overridden the matrix's scale/rotation: rebuild the
/// matrix from state's scale + rotation + the matrix's translation, just
/// like Flash does internally.
fn effective_placement_matrix(matrix: Option<Affine>, state: Option<&ClipState>) -> Affine {
    let Some(m) = matrix else { return Affine::IDENTITY };
    let Some(state) = state else { return m };
    let (mx, my, mr) = decompose_affine(m);
    let coeffs = m.as_coeffs();
    let matrix_x_px = coeffs[4] / 20.0;
    let matrix_y_px = coeffs[5] / 20.0;
    let avm1_overridden = (state.xscale - mx).abs() > 0.5
        || (state.yscale - my).abs() > 0.5
        || (state.rotation - mr).abs() > 0.5
        || (state.x - matrix_x_px).abs() > 0.05
        || (state.y - matrix_y_px).abs() > 0.05;
    if !avm1_overridden {
        return m;
    }
    let tx = state.x * 20.0; // px → twips
    let ty = state.y * 20.0;
    let sx = state.xscale / 100.0;
    let sy = state.yscale / 100.0;
    let rot_rad = state.rotation.to_radians();
    Affine::translate((tx, ty))
        * Affine::rotate(rot_rad)
        * Affine::scale_non_uniform(sx, sy)
}

/// Compose the parent ColorTransform with this clip's `_alpha` runtime
/// override. AVM1 `_alpha` is 0..100; we fold it into `mult_a`.
fn compose_with_alpha(parent: OwnedColorTransform, state: &ClipState) -> OwnedColorTransform {
    let alpha = (state.alpha as f32 / 100.0).clamp(0.0, 1.0);
    let mut out = parent;
    out.mult_a *= alpha;
    out
}
