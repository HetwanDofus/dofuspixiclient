//! Frame-state walking + symbol bounds. Pure data — no scene
//! emission, no GPU. Used by the renderer (cache key for
//! `frame_state`), the WASM bridge (sizing output textures), and
//! `render_filtered` (computing the intermediate-texture bounds).

use std::collections::BTreeMap;

use vello::kurbo::{Affine, Point, Rect};

use crate::swf_doc::{EncodedBitmap, OwnedOp, OwnedPlace, OwnedSprite, SwfDoc, Symbol};

/// Resolve a single timeline frame: walk ops, applying Place/Remove,
/// producing a snapshot of `depth → placement state` at that frame.
pub fn build_frame_state(sprite: &OwnedSprite, frame: u16) -> BTreeMap<u16, OwnedPlace> {
    let mut state: BTreeMap<u16, OwnedPlace> = BTreeMap::new();
    let mut cur_frame: u16 = 0;
    let target = frame.min(sprite.num_frames.saturating_sub(1));

    for op in &sprite.ops {
        if cur_frame > target {
            break;
        }
        match op {
            OwnedOp::Place(p) => {
                if p.is_move {
                    if let Some(prev) = state.get_mut(&p.depth) {
                        if p.character_id.is_some() {
                            prev.character_id = p.character_id;
                        }
                        if p.matrix.is_some() {
                            prev.matrix = p.matrix;
                        }
                        if p.color_transform.is_some() {
                            prev.color_transform = p.color_transform;
                        }
                        if p.ratio.is_some() {
                            prev.ratio = p.ratio;
                        }
                        if p.clip_depth.is_some() {
                            prev.clip_depth = p.clip_depth;
                        }
                        if p.name.is_some() {
                            prev.name = p.name.clone();
                        }
                    } else {
                        // Modify on empty depth — treat as fresh place.
                        state.insert(p.depth, p.clone());
                    }
                } else {
                    state.insert(p.depth, p.clone());
                }
            }
            OwnedOp::Remove { depth } => {
                state.remove(depth);
            }
            OwnedOp::ShowFrame => {
                cur_frame += 1;
            }
            // Stateless renderer ignores frame-level AVM1 — the AS-aware path
            // (`render_avm1`) is the one that consumes these. Skipping here
            // keeps the cheap "no AS" preview rendering working unchanged.
            OwnedOp::DoAction(_) => {}
        }
    }
    state
}

/// Twip-space bounds for the symbol at the requested frame. Recurses into
/// nested DefineSprites, applying placement matrices. Used by the WASM bridge
/// to size the output texture.
pub fn symbol_bounds(doc: &SwfDoc, sym: &Symbol, frame: u16) -> Rect {
    match sym {
        Symbol::Shape(shape) => Rect::new(
            f64::from(shape.shape_bounds.x_min.get()),
            f64::from(shape.shape_bounds.y_min.get()),
            f64::from(shape.shape_bounds.x_max.get()),
            f64::from(shape.shape_bounds.y_max.get()),
        ),
        Symbol::Sprite(sprite) => sprite_bounds(doc, sprite, frame, Affine::IDENTITY),
        Symbol::Bitmap(enc) => bitmap_dims(enc)
            .map(|(w, h)| Rect::new(0.0, 0.0, f64::from(w) * 20.0, f64::from(h) * 20.0))
            .unwrap_or(Rect::ZERO),
        Symbol::MorphShape(ms) => {
            // Use the union of start+end bounds — covers the worst-case
            // extent across all morph ratios so layout doesn't recompute.
            let r = crate::morph::morph_bounds_union(ms);
            Rect::new(
                f64::from(r.x_min.get()),
                f64::from(r.y_min.get()),
                f64::from(r.x_max.get()),
                f64::from(r.y_max.get()),
            )
        }
    }
}

/// Cheap dimension lookup for an encoded bitmap. Lossless tags carry w/h
/// explicitly; JPEGs would require decoding the header, so for the spike we
/// return None and let the caller treat the bitmap bounds as zero — bitmaps
/// are virtually never placed directly as sprite children, only via fill
/// styles that compute their own geometry from the parent shape's path.
fn bitmap_dims(enc: &EncodedBitmap) -> Option<(u32, u32)> {
    match enc {
        EncodedBitmap::Lossless { width, height, .. } => {
            Some((u32::from(*width), u32::from(*height)))
        }
        _ => None,
    }
}

fn sprite_bounds(doc: &SwfDoc, sprite: &OwnedSprite, frame: u16, parent: Affine) -> Rect {
    let state = build_frame_state(sprite, frame);
    let mut acc: Option<Rect> = None;
    for (_depth, p) in &state {
        let id = match p.character_id {
            Some(id) => id,
            None => continue,
        };
        let child = match doc.lookup_id(id) {
            Some(c) => c,
            None => continue,
        };
        let xform = parent * p.matrix.unwrap_or(Affine::IDENTITY);
        let local = match child {
            Symbol::Shape(s) => Rect::new(
                f64::from(s.shape_bounds.x_min.get()),
                f64::from(s.shape_bounds.y_min.get()),
                f64::from(s.shape_bounds.x_max.get()),
                f64::from(s.shape_bounds.y_max.get()),
            ),
            Symbol::Sprite(child_sprite) => {
                let child_frame = if child_sprite.num_frames > 1 { frame } else { 0 };
                sprite_bounds(doc, child_sprite, child_frame, Affine::IDENTITY)
            }
            Symbol::MorphShape(ms) => {
                let r = crate::morph::morph_bounds_union(ms);
                Rect::new(
                    f64::from(r.x_min.get()),
                    f64::from(r.y_min.get()),
                    f64::from(r.x_max.get()),
                    f64::from(r.y_max.get()),
                )
            }
            Symbol::Bitmap(enc) => bitmap_dims(enc)
                .map(|(w, h)| Rect::new(0.0, 0.0, f64::from(w) * 20.0, f64::from(h) * 20.0))
                .unwrap_or(Rect::ZERO),
        };
        let world = transform_rect(xform, local);
        acc = Some(match acc {
            Some(a) => a.union(world),
            None => world,
        });
    }
    acc.unwrap_or(Rect::ZERO)
}

pub(super) fn transform_rect(m: Affine, r: Rect) -> Rect {
    let pts = [
        m * Point::new(r.x0, r.y0),
        m * Point::new(r.x1, r.y0),
        m * Point::new(r.x0, r.y1),
        m * Point::new(r.x1, r.y1),
    ];
    let mut min_x = pts[0].x;
    let mut min_y = pts[0].y;
    let mut max_x = pts[0].x;
    let mut max_y = pts[0].y;
    for p in &pts[1..] {
        if p.x < min_x { min_x = p.x; }
        if p.x > max_x { max_x = p.x; }
        if p.y < min_y { min_y = p.y; }
        if p.y > max_y { max_y = p.y; }
    }
    Rect::new(min_x, min_y, max_x, max_y)
}
