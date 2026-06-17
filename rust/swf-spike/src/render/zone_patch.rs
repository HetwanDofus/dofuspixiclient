//! Zone-recolor patch capture for the colour-agnostic body bake.
//!
//! wc3's deferred prebake (client `actor_batch/prebake.rs`
//! `SegmentBuilder::emit_fill` / `PatchOffset`) bakes a body ONCE per
//! `(gfx, anim, dir, frame)` with zone fills left as placeholders, recording
//! where each zone colour lands in `draw_data`. Every actor — whatever their
//! palette — shares that one cached encoding; the GPU slab expander patches
//! the per-zone player colour in at compose via `ZonePatchGpu`.
//!
//! wc2 reaches the same end on its immediate render path: bake the body with
//! `PlayerColors::default()` (so `recolor_target` is `None` and zone fills
//! emit as-authored placeholders) while this sink records, for each solid
//! zone fill, its `draw_data` offset + zone + authored alpha. The crowd bake
//! converts these to `vello::ZonePatchGpu` and interns them alongside the
//! colour-agnostic body sub.

use std::cell::RefCell;

/// Where a zone placeholder colour landed in the captured scene's `draw_data`
/// vec, plus the 1-indexed recolor zone and the op's authored alpha. The GPU
/// expander writes `draw_data[sub_base + draw_data_idx] = (player_rgb, alpha)`
/// for the actor's `PlayerColors[zone]`.
#[derive(Debug, Clone, Copy)]
pub struct PatchOffset {
    pub draw_data_idx: usize,
    pub zone: u8,
    pub alpha: u8,
}

thread_local! {
    static SINK: RefCell<Option<Vec<PatchOffset>>> = const { RefCell::new(None) };
}

/// Begin capturing zone-patch offsets on this thread. While active,
/// `render_shape_into` records each solid zone fill it emits.
pub fn begin_capture() {
    SINK.with(|s| *s.borrow_mut() = Some(Vec::new()));
}

/// Stop capturing and return the offsets recorded since [`begin_capture`].
pub fn take_capture() -> Vec<PatchOffset> {
    SINK.with(|s| s.borrow_mut().take().unwrap_or_default())
}

/// Whether a capture is active on this thread (read by `render_shape_into`).
pub fn is_capturing() -> bool {
    SINK.with(|s| s.borrow().is_some())
}

pub(crate) fn push(p: PatchOffset) {
    SINK.with(|s| {
        if let Some(v) = s.borrow_mut().as_mut() {
            v.push(p);
        }
    });
}
