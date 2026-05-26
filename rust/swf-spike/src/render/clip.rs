//! Clip-mask path collection. Walks a mask character's fill geometry
//! and accumulates it into one BezPath for `Scene::push_layer`. The
//! mask path is silhouette-only (no DestIn alpha — that's the
//! snapshot-renderer's job, see `snapshot::apply_mask_pop`).

use vello::kurbo::{Affine, BezPath, PathEl};

use crate::shape::{flatten_shape, DrawKind};
use crate::swf_doc::{SwfDoc, Symbol};

use super::bounds::build_frame_state;

/// Recursively collect the fill geometry of a mask character into one
/// BezPath in world coordinates. `ratio` is the morph ratio of the
/// parent placement; only matters when the mask is itself a
/// MorphShape. Sprites recurse with each child placement's own
/// ratio so a sprite-of-morphs mask interpolates correctly.
pub fn collect_mask_path(
    doc: &SwfDoc,
    sym: &Symbol,
    transform: Affine,
    frame: u16,
    ratio: u16,
    out: &mut BezPath,
) {
    super::probe::mask_path_call();
    match sym {
        Symbol::Shape(shape) => {
            super::probe::mask_path_flatten();
            for cmd in flatten_shape(shape, doc) {
                if matches!(cmd.kind, DrawKind::Fill { .. }) {
                    append_path_transformed(out, &cmd.path, transform);
                }
            }
        }
        Symbol::Sprite(sprite) => {
            let state = build_frame_state(sprite, frame);
            for (_, p) in &state {
                let Some(id) = p.character_id else { continue };
                let Some(child) = doc.lookup_id(id) else { continue };
                let child_xform = transform * p.matrix.unwrap_or(Affine::IDENTITY);
                let child_frame = match child {
                    Symbol::Sprite(c) if c.num_frames > 1 => frame,
                    _ => 0,
                };
                collect_mask_path(
                    doc,
                    child,
                    child_xform,
                    child_frame,
                    p.ratio.unwrap_or(0),
                    out,
                );
            }
        }
        Symbol::Bitmap(_) => {}
        Symbol::MorphShape(ms) => {
            super::probe::mask_path_flatten();
            let interp = crate::morph::build_morph_frame(ms, ratio);
            for cmd in flatten_shape(&interp, doc) {
                if matches!(cmd.kind, DrawKind::Fill { .. }) {
                    append_path_transformed(out, &cmd.path, transform);
                }
            }
        }
    }
}

pub(super) fn append_path_transformed(out: &mut BezPath, path: &BezPath, m: Affine) {
    for el in path.elements() {
        let mapped = match *el {
            PathEl::MoveTo(p) => PathEl::MoveTo(m * p),
            PathEl::LineTo(p) => PathEl::LineTo(m * p),
            PathEl::QuadTo(c, p) => PathEl::QuadTo(m * c, m * p),
            PathEl::CurveTo(a, b, c) => PathEl::CurveTo(m * a, m * b, m * c),
            PathEl::ClosePath => PathEl::ClosePath,
        };
        out.push(mapped);
    }
}
