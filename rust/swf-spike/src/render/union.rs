//! RETAINED-VELLO union bake (v3 / union-hide).
//!
//! Appear/disappear animations shift the Vello encoding's byte layout frame to
//! frame (shapes added/removed → path_data + transform counts change), which
//! defeats the retained render path (it can only re-upload a stable-layout
//! buffer's transforms + morph path_data). This module converts such anims into
//! length-stable looks:
//!
//!  1. Capture every leaf draw per frame, keyed by a stable depth-path identity
//!     (`RenderCtx::depth_path`). See [`begin_capture`] / [`take_capture`].
//!  2. [`build_union`] takes the union of all leaves across the cycle.
//!  3. [`emit_union_frame`] re-emits ALL union leaves every frame in a stable
//!     (sorted depth-path) order — present leaves at their matrix, absent leaves
//!     at a scale-0 HIDE transform (structure preserved, zero coverage).
//!
//! The per-frame scene then has a CONSTANT draw set / byte layout, so the normal
//! retained bake (transforms always + morph path_data on change) applies.

use std::cell::RefCell;
use std::collections::BTreeMap;

use vello::Scene;
use vello::kurbo::Affine;

use crate::shape::DrawCmd;
use crate::swf_doc::OwnedColorTransform;

/// One captured leaf draw during a union-capture walk. `cmds` are already
/// zone-recolored (the capture replicates `render_shape_into`'s recolor).
#[derive(Clone)]
pub struct CapturedLeaf {
    pub depth_path: Vec<u16>,
    pub transform: Affine,
    pub color_xform: OwnedColorTransform,
    pub cmds: Vec<DrawCmd>,
}

thread_local! {
    static SINK: RefCell<Option<Vec<CapturedLeaf>>> = const { RefCell::new(None) };
}

/// Begin capturing leaves on this thread. While active, `render_shape_into`
/// records leaves and SKIPS emission (the scene it would draw into is unused).
pub fn begin_capture() {
    SINK.with(|s| *s.borrow_mut() = Some(Vec::new()));
}

/// Stop capturing and return the leaves recorded since [`begin_capture`].
pub fn take_capture() -> Vec<CapturedLeaf> {
    SINK.with(|s| s.borrow_mut().take().unwrap_or_default())
}

/// Whether a capture is active on this thread (read by `render_shape_into`).
pub fn is_capturing() -> bool {
    SINK.with(|s| s.borrow().is_some())
}

/// Record a captured leaf (called by `render_shape_into` under capture).
pub(crate) fn push(leaf: CapturedLeaf) {
    SINK.with(|s| {
        if let Some(v) = s.borrow_mut().as_mut() {
            v.push(leaf);
        }
    });
}

/// Scale-0 transform: collapses a path to zero coverage while keeping its draw
/// in the encoding (so the per-frame structure stays constant).
const HIDE: Affine = Affine::new([0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);

struct Slot {
    /// Geometry/color used on frames where this leaf is absent (emitted at HIDE).
    rep_cmds: Vec<DrawCmd>,
    rep_cx: OwnedColorTransform,
    /// Per-frame `(transform, cmds, color)`; `None` = absent at that frame.
    per_frame: Vec<Option<(Affine, Vec<DrawCmd>, OwnedColorTransform)>>,
}

/// The union of all leaves across an animation, ready for per-frame re-emit.
pub struct UnionPlan {
    /// Stable emit order (sorted depth-paths).
    order: Vec<Vec<u16>>,
    slots: BTreeMap<Vec<u16>, Slot>,
    frame_count: u16,
}

impl UnionPlan {
    pub fn frame_count(&self) -> u16 {
        self.frame_count
    }
    pub fn slot_count(&self) -> usize {
        self.order.len()
    }
}

/// Build the union from per-frame captured leaves (index = frame).
pub fn build_union(per_frame: &[Vec<CapturedLeaf>]) -> UnionPlan {
    let fc = per_frame.len().max(1);
    let mut slots: BTreeMap<Vec<u16>, Slot> = BTreeMap::new();
    for (f, leaves) in per_frame.iter().enumerate() {
        for leaf in leaves {
            let slot = slots.entry(leaf.depth_path.clone()).or_insert_with(|| Slot {
                rep_cmds: leaf.cmds.clone(),
                rep_cx: leaf.color_xform,
                per_frame: vec![None; fc],
            });
            slot.per_frame[f] = Some((leaf.transform, leaf.cmds.clone(), leaf.color_xform));
        }
    }
    let mut order: Vec<Vec<u16>> = slots.keys().cloned().collect();
    order.sort();
    UnionPlan { order, slots, frame_count: fc as u16 }
}

/// Emit the union at frame `f` into `out`: every slot in stable order, present
/// slots at their matrix, absent slots at [`HIDE`]. Produces a constant-structure
/// scene across all frames.
pub fn emit_union_frame(plan: &UnionPlan, f: u16, out: &mut Scene) {
    let fi = f as usize;
    for key in &plan.order {
        let slot = &plan.slots[key];
        let (transform, cmds, cx): (Affine, &[DrawCmd], OwnedColorTransform) =
            match slot.per_frame.get(fi).and_then(|o| o.as_ref()) {
                Some((t, c, x)) => (*t, c.as_slice(), *x),
                None => (HIDE, slot.rep_cmds.as_slice(), slot.rep_cx),
            };
        for cmd in cmds {
            super::emit::emit_cmd(out, cmd, transform, cx);
        }
    }
}
