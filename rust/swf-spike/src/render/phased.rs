//! Static/dynamic phased rendering for tile animations.
//!
//! Background: a heavy animated tile (e.g. map 35's tile 343 — wooden
//! building + 210-frame chimney smoke) is mostly static. The building,
//! windows, doors, etc. don't change frame-to-frame; only a couple of
//! sprites (the smoke wisps) animate. Re-encoding the entire tree
//! 210 times burns enormous CPU and pushes Vello's tile encoder over
//! its budget. Per the project's `feedback_swf_vello_scene_overflow`
//! memory note, the canonical workaround is to split static from
//! dynamic and composite.
//!
//! What this module does:
//!
//! 1. **Classify**. Walk the multi-frame sprite's timeline. For each
//!    depth, a placement is "static" iff every frame has the SAME
//!    placement data (matrix, character, color_xform, ratio,
//!    clip_depth, blend_mode, filters) AND the placed character has no
//!    multi-frame sub-tree at any nesting level.
//!
//! 2. **Render in phases**. Two passes through the same walker:
//!    - `Phase::StaticOnly` — render only static-classified depths,
//!      always at frame 0 (since they're constant). Result: one
//!      texture, painted ONCE per tile.
//!    - `Phase::DynamicAt(K)` — render only dynamic-classified depths,
//!      at the requested frame. Result: per-frame texture with just
//!      the moving parts.
//!
//! 3. **Compose at runtime**. The caller stacks both textures at the
//!    same anchor. Static under, animated above. Same canvas size for
//!    both (full-anim union bounds) so layering is pixel-perfect.
//!
//! Cost reduction for tile 343 (210 frames, ~50 shapes/frame, ~5
//! shapes truly dynamic):
//!     before: 210 × 50 = 10500 path encodings per cycle
//!     after:    1 × 50 + 210 × 5 = 1100 path encodings per cycle
//!
//! Roughly 10× less CPU work on the encoding path AND each scene now
//! contains far fewer paths — the encoder no longer overflows.

use std::collections::{BTreeSet, HashMap, HashSet};

use vello::kurbo::{Affine, BezPath};
use vello::peniko::{BlendMode, Fill};
use vello::Scene;

use crate::swf_doc::{
    OwnedColorTransform, OwnedFilter, OwnedOp, OwnedPlace, OwnedSprite, Symbol, SwfDoc,
};

use super::bounds::build_frame_state;
use super::clip::collect_mask_path;
use super::ctx::RenderCtx;
use super::filter;
use super::render_symbol_into;

/// Per-sprite classification: which depths animate vs which are
/// effectively static across the whole timeline.
#[derive(Debug, Clone, Default)]
pub struct DepthClassification {
    /// Depths whose placement data is identical every frame AND whose
    /// placed character is fully 1-frame deep. Render once at frame 0.
    pub static_depths: BTreeSet<u16>,
    /// Depths that vary somewhere — either the placement data
    /// (matrix/ratio/cxform/etc.) changes across frames, or the placed
    /// character has a multi-frame sub-tree.
    pub dynamic_depths: BTreeSet<u16>,
}

/// Phase passed through the recursion. `Full` is the legacy "render
/// everything at the requested frame" path; the other two opt into the
/// classify-and-filter behaviour for multi-frame sprites.
#[derive(Debug, Clone, Copy)]
pub enum RenderPhase {
    /// Render every depth at the requested frame. Equivalent to the
    /// pre-phase render path.
    Full,
    /// Render only static-classified depths at frame 0.
    StaticOnly,
    /// Render only dynamic-classified depths at the given frame.
    DynamicAt(u16),
}

impl RenderPhase {
    fn keep_static(self) -> bool {
        matches!(self, RenderPhase::Full | RenderPhase::StaticOnly)
    }
    fn keep_dynamic(self) -> bool {
        matches!(self, RenderPhase::Full | RenderPhase::DynamicAt(_))
    }
}

/// Classify each depth of `sprite` as static or dynamic. A depth is
/// static iff its placement is constant over every frame AND the
/// placed character has no multi-frame sub-tree. Anything else is
/// dynamic.
pub fn classify_depths(sprite: &OwnedSprite, doc: &SwfDoc) -> DepthClassification {
    // Walk the timeline once, recording per-depth placement state at
    // each ShowFrame.
    let mut history: HashMap<u16, Vec<OwnedPlace>> = HashMap::new();
    let mut current: HashMap<u16, OwnedPlace> = HashMap::new();
    let mut frames_seen: u16 = 0;
    let target_frames = sprite.num_frames.max(1);
    for op in &sprite.ops {
        if frames_seen >= target_frames {
            break;
        }
        match op {
            OwnedOp::Place(p) => {
                if p.is_move {
                    if let Some(existing) = current.get_mut(&p.depth) {
                        if p.character_id.is_some() {
                            existing.character_id = p.character_id;
                        }
                        if p.matrix.is_some() {
                            existing.matrix = p.matrix;
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
                        if !p.filters.is_empty() {
                            existing.filters = p.filters.clone();
                        }
                        if p.blend_mode.is_some() {
                            existing.blend_mode = p.blend_mode;
                        }
                    } else {
                        current.insert(p.depth, p.clone());
                    }
                } else {
                    current.insert(p.depth, p.clone());
                }
            }
            OwnedOp::Remove { depth } => {
                current.remove(depth);
            }
            OwnedOp::ShowFrame => {
                for (depth, place) in &current {
                    history.entry(*depth).or_default().push(place.clone());
                }
                frames_seen += 1;
            }
            OwnedOp::DoAction(_) => {}
        }
    }

    let frame_count_usize = usize::from(target_frames);
    let mut result = DepthClassification::default();
    let mut character_dynamic_cache: HashMap<u16, bool> = HashMap::new();

    for (depth, frames) in &history {
        // A depth that doesn't appear in EVERY frame is dynamic
        // (placements come and go).
        let placement_constant = frames.len() == frame_count_usize
            && frames.iter().all(|p| placement_data_eq(p, &frames[0]));
        let character_static = match frames[0].character_id {
            Some(cid) => {
                !character_has_dynamics(cid, doc, &mut character_dynamic_cache, &mut HashSet::new())
            }
            None => true,
        };
        if placement_constant && character_static {
            result.static_depths.insert(*depth);
        } else {
            result.dynamic_depths.insert(*depth);
        }
    }
    result
}

/// Recursively check whether a character has any multi-frame timeline
/// in its sub-tree. Memoised in `cache` so deep trees don't re-walk.
fn character_has_dynamics(
    char_id: u16,
    doc: &SwfDoc,
    cache: &mut HashMap<u16, bool>,
    in_progress: &mut HashSet<u16>,
) -> bool {
    if let Some(&v) = cache.get(&char_id) {
        return v;
    }
    if in_progress.contains(&char_id) {
        // Cycle — treat conservatively as static; if it really were
        // dynamic, some other branch will discover it.
        return false;
    }
    in_progress.insert(char_id);
    let dynamic = match doc.lookup_id(char_id) {
        Some(Symbol::Sprite(sp)) => {
            if sp.num_frames > 1 {
                true
            } else {
                let mut found = false;
                for op in &sp.ops {
                    if let OwnedOp::Place(p) = op
                        && let Some(child_id) = p.character_id
                    {
                        if character_has_dynamics(child_id, doc, cache, in_progress) {
                            found = true;
                            break;
                        }
                    }
                }
                found
            }
        }
        Some(Symbol::MorphShape(_)) => true, // morph shapes interpolate per ratio
        _ => false,
    };
    in_progress.remove(&char_id);
    cache.insert(char_id, dynamic);
    dynamic
}

/// True iff two placements would render identically (modulo per-frame
/// timing). We compare every field that affects the rendered output.
fn placement_data_eq(a: &OwnedPlace, b: &OwnedPlace) -> bool {
    a.character_id == b.character_id
        && affine_eq(a.matrix, b.matrix)
        && color_xform_eq(a.color_transform, b.color_transform)
        && a.ratio == b.ratio
        && a.clip_depth == b.clip_depth
        && a.blend_mode == b.blend_mode
        && filters_eq(&a.filters, &b.filters)
}

fn affine_eq(a: Option<Affine>, b: Option<Affine>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(x), Some(y)) => x.as_coeffs() == y.as_coeffs(),
        _ => false,
    }
}

fn color_xform_eq(a: Option<OwnedColorTransform>, b: Option<OwnedColorTransform>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(x), Some(y)) => {
            (x.mult_r, x.mult_g, x.mult_b, x.mult_a, x.add_r, x.add_g, x.add_b, x.add_a)
                == (y.mult_r, y.mult_g, y.mult_b, y.mult_a, y.add_r, y.add_g, y.add_b, y.add_a)
        }
        _ => false,
    }
}

fn filters_eq(a: &[OwnedFilter], b: &[OwnedFilter]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    // Filter equality is a proxy via Debug formatting — these structs
    // don't implement PartialEq and the variant set is small enough
    // that Debug-string compare is correct for our purpose (we only
    // need to know if "every frame's filter list is identical").
    a.iter()
        .zip(b.iter())
        .all(|(x, y)| format!("{:?}", x) == format!("{:?}", y))
}

/// Phase-aware sprite walker. Mirrors `render::sprite::render_sprite_into`
/// but consults the classification before recursing into each depth.
/// The single-frame sprite case bypasses classification entirely (every
/// depth is trivially static).
pub fn render_sprite_phased(
    ctx: &mut RenderCtx<'_>,
    sprite: &OwnedSprite,
    phase: RenderPhase,
    classification_cache: &mut HashMap<*const OwnedSprite, DepthClassification>,
) {
    let multi_frame = sprite.num_frames > 1;
    let target_frame = match phase {
        RenderPhase::Full => ctx.frame,
        RenderPhase::StaticOnly => 0,
        RenderPhase::DynamicAt(f) => f,
    };

    // For multi-frame sprites, classify (with cache) and filter. For
    // 1-frame sprites, every depth is "static" by construction.
    let classification = if multi_frame {
        let key = sprite as *const OwnedSprite;
        if !classification_cache.contains_key(&key) {
            classification_cache.insert(key, classify_depths(sprite, ctx.doc));
        }
        classification_cache.get(&key).cloned()
    } else {
        None
    };

    let state = build_frame_state(sprite, target_frame);

    let mut clip_stack: Vec<u16> = Vec::new();
    for (depth, p) in &state {
        while clip_stack.last().map(|&end| *depth > end).unwrap_or(false) {
            clip_stack.pop();
            ctx.scene.pop_layer();
        }

        // Phase filter: only multi-frame sprites have classification;
        // 1-frame ones always render through both phases (their
        // contribution is "static" by definition, so DynamicAt skips
        // them entirely — see check below).
        let keep = match (&classification, phase) {
            (Some(cls), RenderPhase::StaticOnly) => cls.static_depths.contains(depth),
            (Some(cls), RenderPhase::DynamicAt(_)) => cls.dynamic_depths.contains(depth),
            (Some(_), RenderPhase::Full) => true,
            // 1-frame sprite + StaticOnly: render (it's part of the
            // static base for the parent's purposes).
            (None, RenderPhase::StaticOnly) => true,
            // 1-frame sprite + DynamicAt: only render if a parent's
            // dynamic-depth filter routed us here. Returning true is
            // safe — the recursion entry is gated by the parent's
            // classification, so we only get here for already-dynamic
            // contexts.
            (None, RenderPhase::DynamicAt(_)) => true,
            (None, RenderPhase::Full) => true,
        };
        if !keep {
            continue;
        }

        let id = match p.character_id {
            Some(id) => id,
            None => continue,
        };
        let child_sym = match ctx.doc.lookup_id(id) {
            Some(s) => s,
            None => continue,
        };

        // Clip-mask layer: same handling as the legacy walker.
        if let Some(clip_depth) = p.clip_depth
            && clip_depth > 0
            && clip_depth > *depth
        {
            let local_xform = p.matrix.unwrap_or(Affine::IDENTITY);
            let mask_frame = match child_sym {
                Symbol::Sprite(c) if c.num_frames > 1 => target_frame,
                _ => 0,
            };
            let mut mask_path = BezPath::new();
            collect_mask_path(
                ctx.doc,
                child_sym,
                local_xform,
                mask_frame,
                p.ratio.unwrap_or(0),
                &mut mask_path,
            );
            if mask_path.elements().len() >= 4 {
                ctx.scene.push_layer(
                    Fill::NonZero,
                    BlendMode::default(),
                    1.0,
                    ctx.transform,
                    &mask_path,
                );
                clip_stack.push(clip_depth);
            }
            continue;
        }

        let mut child = ctx.child(p, id);
        // The child ctx propagates target_frame into its own
        // recursion via its `frame` field — but `child()` derives
        // frame from `self.frame` and the child's num_frames. Force
        // the requested frame so DynamicAt(K) propagates correctly
        // through nested multi-frame sprites.
        match phase {
            RenderPhase::Full => {}
            RenderPhase::StaticOnly => child.frame = 0,
            RenderPhase::DynamicAt(f) => child.frame = f,
        }
        if !p.filters.is_empty() {
            // For filter-bearing placements, fall back to the legacy
            // full-render path inside the filter — phased filtering
            // doesn't compose cleanly with halo expansion, and tile
            // 343 et al don't put filters on dynamic depths.
            filter::apply(&mut child, child_sym, &p.filters);
        } else {
            // Recurse with the same phase. Children's classification
            // is computed independently when they're multi-frame.
            match child_sym {
                Symbol::Sprite(child_sprite) => {
                    render_sprite_phased(
                        &mut child,
                        child_sprite,
                        phase,
                        classification_cache,
                    );
                }
                _ => {
                    // Shape / Bitmap / MorphShape — render normally.
                    // (MorphShape ratio comes from `child.ratio`,
                    // which `ctx.child()` already populated.)
                    render_symbol_into(&mut child, child_sym);
                }
            }
        }
    }

    while !clip_stack.is_empty() {
        clip_stack.pop();
        ctx.scene.pop_layer();
    }
}

/// Public entry point. Caches classification per (sprite reference)
/// so repeat phased renders don't re-walk the timeline.
pub fn render_symbol_phased(
    doc: &SwfDoc,
    sym: &Symbol,
    scene: &mut Scene,
    transform: Affine,
    phase: RenderPhase,
    color_xform: OwnedColorTransform,
    cache: &super::cache::RenderCache,
    classification_cache: &mut HashMap<*const OwnedSprite, DepthClassification>,
) {
    let initial_frame = match phase {
        RenderPhase::Full => 0,
        RenderPhase::StaticOnly => 0,
        RenderPhase::DynamicAt(f) => f,
    };
    let mut ctx = RenderCtx::new(doc, scene, cache)
        .with_transform(transform)
        .with_frame(initial_frame)
        .with_color_xform(color_xform);
    match sym {
        Symbol::Sprite(sprite) => {
            render_sprite_phased(&mut ctx, sprite, phase, classification_cache);
        }
        _ => {
            // Shape/Morph/Bitmap leaves don't have phases — render
            // them through the legacy path.
            if matches!(phase, RenderPhase::DynamicAt(_)) {
                // Leaves are static by definition, so skip in the
                // dynamic phase.
                return;
            }
            render_symbol_into(&mut ctx, sym);
        }
    }
}
