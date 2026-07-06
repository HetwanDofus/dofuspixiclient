//! Depth-decomposed rendering for single-frame animated tile wrappers.
//! Ported from wc3's validated implementation
//! (`dofuswebclient3/rust/swf-spike/src/render/tile_parts.rs`).
//!
//! An animated tile whose root is a 1-frame wrapper with N looping
//! children has a combined cycle of `lcm(child frame counts)` — a
//! whole-scene cache then stores one texture per *combination* of
//! child frames (observed in wc3: 957 scenes / ~137 MB for one tile).
//! Splitting the wrapper's display list into parts — maximal runs of
//! non-dynamic placements plus one part per dynamic-child placement —
//! costs `runs + Σ child frame counts` bakes instead, and the consumer
//! reassembles paint order by stacking the part sprites.
//!
//! CANONICAL SEMANTICS: Flash renders the wrapper's display list in
//! depth order every frame; only the dynamic children's playheads move
//! (per-instance AVM1, see `tile_script::ChildScript`). Decomposing by
//! depth and re-baking only the moved parts is a pure optimization —
//! paint order and per-placement state (matrix/cxform/ratio/filters)
//! are identical to the whole-scene walk.

use std::collections::{HashMap, HashSet};

use vello::kurbo::{Affine, Rect};
use vello::Scene;

use crate::swf_doc::{OwnedSprite, SwfDoc, Symbol};

use super::bounds::{build_frame_state, symbol_bounds, symbol_bounds_pinned};
use super::cache::RenderCache;
use super::ctx::RenderCtx;
use super::{render_symbol_into, WgpuCtx};

/// One paint-ordered slice of a decomposed tile wrapper.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TilePartSpec {
    /// All placements at depths in `[depth_lo, depth_hi]` whose
    /// character is NOT a dynamic child. Content is frame-invariant
    /// (multi-frame members are pinned via overrides), so one cached
    /// bake serves every tick.
    StaticRun { depth_lo: u16, depth_hi: u16 },
    /// The single placement of `child_id` at `depth`. One bake per
    /// child frame.
    Dynamic { depth: u16, child_id: u16 },
}

/// Classify the wrapper's frame-0 display list into ordered parts.
///
/// Returns `None` when decomposition can't reproduce the whole-scene
/// render: a multi-frame root (its display list mutates per frame) or
/// any clip-mask placement (masks span depth ranges across part
/// boundaries — a Vello layer can't be split between cached scenes).
pub fn plan_tile_parts(sprite: &OwnedSprite, dynamic: &HashSet<u16>) -> Option<Vec<TilePartSpec>> {
    if sprite.num_frames > 1 {
        return None;
    }
    let state = build_frame_state(sprite, 0);
    let mut parts: Vec<TilePartSpec> = Vec::new();
    let mut run: Option<(u16, u16)> = None;
    for (depth, p) in &state {
        if p.clip_depth.is_some_and(|cd| cd > 0) {
            return None;
        }
        let is_dynamic = p.character_id.is_some_and(|id| dynamic.contains(&id));
        if is_dynamic {
            if let Some((lo, hi)) = run.take() {
                parts.push(TilePartSpec::StaticRun {
                    depth_lo: lo,
                    depth_hi: hi,
                });
            }
            parts.push(TilePartSpec::Dynamic {
                depth: *depth,
                // is_dynamic proved character_id is Some.
                child_id: p.character_id.unwrap_or_default(),
            });
        } else {
            run = Some(run.map_or((*depth, *depth), |(lo, _)| (lo, *depth)));
        }
    }
    if let Some((lo, hi)) = run {
        parts.push(TilePartSpec::StaticRun {
            depth_lo: lo,
            depth_hi: hi,
        });
    }
    Some(parts)
}

/// Render one part of the wrapper into `scene`. Mirrors the placement
/// handling of the sprite walker (transform/cxform/ratio/zone via
/// `ctx.child`, filtered placements via `filter::apply`) minus the
/// clip-mask stack — [`plan_tile_parts`] refuses masked wrappers — and
/// minus body-strip concerns (bFix, accessory mounts) that tile gfx
/// documents never carry. Rollover-highlight color transforms
/// (`InteractiveObject.as` `select(true)`) are a separate task and not
/// threaded here.
///
/// `overrides` must pin every multi-frame child this part renders:
/// the resolver's static pins for runs, plus `{child_id → frame}` for
/// a dynamic part.
#[allow(clippy::too_many_arguments)]
pub fn render_tile_part(
    wgpu: Option<WgpuCtx<'_>>,
    doc: &SwfDoc,
    sprite: &OwnedSprite,
    scene: &mut Scene,
    transform: Affine,
    overrides: &HashMap<u16, u16>,
    part: TilePartSpec,
    dynamic: &HashSet<u16>,
    cache: &RenderCache,
) {
    let mut ctx = RenderCtx::new(doc, scene, cache)
        .with_transform(transform)
        .with_frame(0)
        .with_child_frame_overrides(Some(overrides));
    if let Some(w) = wgpu {
        ctx = ctx.with_wgpu(w);
    }
    let state = build_frame_state(sprite, 0);
    for (depth, p) in &state {
        let Some(id) = p.character_id else {
            continue;
        };
        let included = match part {
            TilePartSpec::StaticRun { depth_lo, depth_hi } => {
                *depth >= depth_lo && *depth <= depth_hi && !dynamic.contains(&id)
            }
            TilePartSpec::Dynamic { depth: d, child_id } => *depth == d && id == child_id,
        };
        if !included {
            continue;
        }
        let Some(child_sym) = doc.lookup_id(id) else {
            continue;
        };
        let mut child = ctx.child(p, id);
        if p.filters.is_empty() {
            render_symbol_into(&mut child, child_sym);
        } else {
            super::filter::apply(&mut child, child_sym, &p.filters);
        }
    }
}

/// Whole-scene render of a wrapper with per-child frame pins — the
/// fallback for scripted tiles [`plan_tile_parts`] refuses (masked
/// wrappers) and the seeded-static bake (executed
/// `gotoAndStop(random(...))` variants, `tile_behavior::resolve` →
/// `Static{frame}` + `child_overrides`). Equivalent to the canonical
/// Flash paint of the wrapper at `frame` with every pinned child
/// showing its scripted playhead.
#[allow(clippy::too_many_arguments)]
pub fn render_tile_whole(
    wgpu: Option<WgpuCtx<'_>>,
    doc: &SwfDoc,
    sym: &Symbol,
    scene: &mut Scene,
    transform: Affine,
    frame: u16,
    overrides: &HashMap<u16, u16>,
    cache: &RenderCache,
) {
    let mut ctx = RenderCtx::new(doc, scene, cache)
        .with_transform(transform)
        .with_frame(frame)
        .with_child_frame_overrides(Some(overrides));
    if let Some(w) = wgpu {
        ctx = ctx.with_wgpu(w);
    }
    render_symbol_into(&mut ctx, sym);
}

/// Twip-space bounds of ONE part, in the wrapper's coordinate space
/// (relative to the SWF origin — so each part sprite can carry its own
/// anchor and stack pixel-perfectly at the shared cell position).
///
/// - `StaticRun`: union over included placements at their pinned (or
///   0) frame — content never changes, one measurement is exact.
/// - `Dynamic`: union over EVERY frame of the child's own timeline, so
///   a strip of per-frame cells shares one canvas/anchor and the
///   consumer can swap frames without re-anchoring.
pub fn tile_part_bounds(
    doc: &SwfDoc,
    sprite: &OwnedSprite,
    part: TilePartSpec,
    dynamic: &HashSet<u16>,
    overrides: &HashMap<u16, u16>,
) -> Rect {
    let state = build_frame_state(sprite, 0);
    let mut acc: Option<Rect> = None;
    let mut union = |r: Rect| {
        if r.width() <= 0.0 || r.height() <= 0.0 {
            return;
        }
        acc = Some(match acc {
            Some(a) => a.union(r),
            None => r,
        });
    };
    for (depth, p) in &state {
        let Some(id) = p.character_id else {
            continue;
        };
        let included = match part {
            TilePartSpec::StaticRun { depth_lo, depth_hi } => {
                *depth >= depth_lo && *depth <= depth_hi && !dynamic.contains(&id)
            }
            TilePartSpec::Dynamic { depth: d, child_id } => *depth == d && id == child_id,
        };
        if !included {
            continue;
        }
        let Some(child_sym) = doc.lookup_id(id) else {
            continue;
        };
        let xform = p.matrix.unwrap_or(Affine::IDENTITY);
        match part {
            TilePartSpec::StaticRun { .. } => {
                let frame = overrides.get(&id).copied().unwrap_or(0);
                let local = symbol_bounds_pinned(doc, child_sym, frame, Some(overrides));
                union(xform.transform_rect_bbox(local));
            }
            TilePartSpec::Dynamic { .. } => {
                let frames = match child_sym {
                    Symbol::Sprite(c) => c.num_frames.max(1),
                    _ => 1,
                };
                for f in 0..frames {
                    let local = symbol_bounds(doc, child_sym, f);
                    union(xform.transform_rect_bbox(local));
                }
            }
        }
    }
    acc.unwrap_or(Rect::ZERO)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::swf_doc::{OwnedOp, OwnedPlace};

    fn place(depth: u16, id: u16, clip: Option<u16>) -> OwnedOp {
        OwnedOp::Place(OwnedPlace {
            depth,
            character_id: Some(id),
            clip_depth: clip,
            ..OwnedPlace::default()
        })
    }

    fn wrapper(ops: Vec<OwnedOp>) -> OwnedSprite {
        OwnedSprite {
            num_frames: 1,
            ops,
            frame_labels: std::collections::HashMap::new(),
        }
    }

    #[test]
    fn runs_split_around_dynamic_children() {
        let sprite = wrapper(vec![
            place(1, 10, None),
            place(2, 20, None),
            place(3, 30, None),
            place(4, 40, None),
            OwnedOp::ShowFrame,
        ]);
        let dynamic: HashSet<u16> = [30].into_iter().collect();
        let parts = plan_tile_parts(&sprite, &dynamic).expect("plan");
        assert_eq!(
            parts,
            vec![
                TilePartSpec::StaticRun {
                    depth_lo: 1,
                    depth_hi: 2
                },
                TilePartSpec::Dynamic {
                    depth: 3,
                    child_id: 30
                },
                TilePartSpec::StaticRun {
                    depth_lo: 4,
                    depth_hi: 4
                },
            ]
        );
    }

    #[test]
    fn masked_wrapper_refuses_decomposition() {
        let sprite = wrapper(vec![
            place(1, 10, Some(5)),
            place(2, 20, None),
            OwnedOp::ShowFrame,
        ]);
        let dynamic: HashSet<u16> = [20].into_iter().collect();
        assert!(plan_tile_parts(&sprite, &dynamic).is_none());
    }

    #[test]
    fn multi_frame_root_refuses_decomposition() {
        let mut sprite = wrapper(vec![place(1, 10, None), OwnedOp::ShowFrame]);
        sprite.num_frames = 2;
        assert!(plan_tile_parts(&sprite, &HashSet::new()).is_none());
    }
}
