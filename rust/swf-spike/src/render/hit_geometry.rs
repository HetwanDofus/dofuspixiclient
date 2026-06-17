//! Point-in-path hit-test geometry capture for the crowd renderer.
//!
//! wc3 hit-tests an actor by walking its baked body frame's draw ops and
//! testing the cursor against each op's vector path (`actor_batch/hit_test.rs`
//! `op_contains_point`: fill → `path.contains`, stroke → nearest-segment
//! distance). wc2's crowd bakes look-intrinsic subs in `emit_player_look_split`;
//! this sink records, per captured draw op, its colour-independent path + the
//! emit transform + (for strokes) the width, so the slab can replay the same
//! point-in-path test in crowd-texture pixel space. Mirrors `zone_patch`'s
//! thread-local pattern; inert unless a capture is active.

use std::cell::RefCell;

/// One captured draw op: its path and the emit transform (`ctx.transform`), so
/// the op's geometry in its sub's scene is `xform * path`. `stroke_width` is
/// `Some(width)` for a stroke (tested against the centerline) and `None` for a
/// fill (point-in-path). The path is `Arc`-backed so the clone is cheap.
pub struct HitGeom {
    pub path: vello::kurbo::BezPath,
    pub xform: vello::kurbo::Affine,
    pub stroke_width: Option<f64>,
}

thread_local! {
    static SINK: RefCell<Option<Vec<HitGeom>>> = const { RefCell::new(None) };
}

/// Begin capturing hit geometry on this thread. While active,
/// `render_shape_into` records each draw op it emits on the Colour path.
pub fn begin_capture() {
    SINK.with(|s| *s.borrow_mut() = Some(Vec::new()));
}

/// Stop capturing and return the geometry recorded since [`begin_capture`].
pub fn take_capture() -> Vec<HitGeom> {
    SINK.with(|s| s.borrow_mut().take().unwrap_or_default())
}

/// Whether a capture is active on this thread (read by `render_shape_into`).
pub fn is_capturing() -> bool {
    SINK.with(|s| s.borrow().is_some())
}

pub(crate) fn push(g: HitGeom) {
    SINK.with(|s| {
        if let Some(v) = s.borrow_mut().as_mut() {
            v.push(g);
        }
    });
}
