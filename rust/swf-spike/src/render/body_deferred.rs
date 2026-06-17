//! Ordered body-walk capture for the crowd compositor.
//!
//! The depth-band split (`slot_depths` + `band_filter`) approximates
//! the canonical accessory render order by cutting the body's
//! TOP-LEVEL display list at the depths where slots mount. That cannot
//! represent mounts declared inside NESTED body parts, so capes/hats
//! layered wrong against the body in some directions.
//!
//! This captures the body walk as an ORDERED list of leaf fills and
//! mount markers in true SWF walk order (mirroring
//! `dofuswebclient3/.../render/deferred.rs` +
//! `actor_batch/prebake.rs`): the compositor splits the body into one
//! segment per mount, interleaving each accessory at exactly the point
//! the canonical walk would — including nested mounts.

use std::cell::RefCell;

use vello::kurbo::Affine;

use crate::shape::DrawCmd;
use crate::swf_doc::OwnedColorTransform;

use super::{emit, hit_geometry, zone_patch};

/// One captured body leaf: authored draw commands plus the world
/// transform, colour transform, and recolor zone needed to re-emit
/// them into a segment scene (with zone-patch + hit capture) later.
#[derive(Clone)]
pub struct BodyFill {
    pub cmds: Vec<DrawCmd>,
    pub transform: Affine,
    pub color_xform: OwnedColorTransform,
    pub recolor_zone: Option<u8>,
}

/// An accessory mount point captured during the body walk. `transform`
/// is the body part's world transform at the mount (b_fix already
/// applied by the walk), in the SAME coordinate space as the body
/// fills — render the accessory there directly.
#[derive(Clone)]
pub struct BodyMount {
    pub slot: u8,
    pub side: Option<String>,
    pub transform: Affine,
}

#[derive(Clone)]
pub enum BodyItem {
    Fill(BodyFill),
    Mount(BodyMount),
}

thread_local! {
    static SINK: RefCell<Option<Vec<BodyItem>>> = const { RefCell::new(None) };
}

pub fn begin_capture() {
    SINK.with(|s| *s.borrow_mut() = Some(Vec::new()));
}

pub fn take_capture() -> Vec<BodyItem> {
    SINK.with(|s| s.borrow_mut().take().unwrap_or_default())
}

pub fn is_capturing() -> bool {
    SINK.with(|s| s.borrow().is_some())
}

pub(crate) fn push_fill(fill: BodyFill) {
    SINK.with(|s| {
        if let Some(v) = s.borrow_mut().as_mut() {
            v.push(BodyItem::Fill(fill));
        }
    });
}

pub(crate) fn push_mount(mount: BodyMount) {
    SINK.with(|s| {
        if let Some(v) = s.borrow_mut().as_mut() {
            v.push(BodyItem::Mount(mount));
        }
    });
}

/// A baked body segment: its scene + zone patches + hit geometry, plus
/// the mount that immediately FOLLOWS it (`None` for the tail segment).
pub struct BakedSegment {
    pub scene: vello::Scene,
    pub patches: Vec<zone_patch::PatchOffset>,
    pub hit: Vec<hit_geometry::HitGeom>,
    pub mount: Option<BodyMount>,
}

/// Re-emit one captured body leaf into `scene`, replicating
/// `render_shape_into`'s `recolor_target == None` capture+emit loop:
/// records zone-patch offsets (for the slab colour overlay) and hit
/// geometry, then emits with the authored brush. Kept byte-identical
/// to the immediate path so the slab's content-dedup keys still match
/// across actors sharing a body.
fn emit_fill_into(scene: &mut vello::Scene, fill: &BodyFill, capture_hit: bool) {
    let capture_patches = fill.recolor_zone.is_some() && zone_patch::is_capturing();
    for cmd in &fill.cmds {
        if capture_hit {
            hit_geometry::push(hit_geometry::HitGeom {
                path: cmd.path.clone(),
                xform: fill.transform,
                stroke_width: match &cmd.kind {
                    crate::shape::DrawKind::Stroke { width, .. } => Some(*width),
                    crate::shape::DrawKind::Fill { .. } => None,
                },
            });
        }
        if capture_patches {
            let solid_alpha = match &cmd.kind {
                crate::shape::DrawKind::Fill {
                    brush: vello::peniko::Brush::Solid(c),
                    ..
                }
                | crate::shape::DrawKind::Stroke {
                    brush: vello::peniko::Brush::Solid(c),
                    ..
                } => Some(c.to_rgba8().to_u8_array()[3]),
                _ => None,
            };
            if let Some(alpha) = solid_alpha {
                zone_patch::push(zone_patch::PatchOffset {
                    draw_data_idx: scene.encoding().draw_data.len(),
                    zone: fill.recolor_zone.unwrap(),
                    alpha,
                });
            }
        }
        emit::emit_cmd(scene, cmd, fill.transform, fill.color_xform);
    }
}

fn bake_one(fills: &[BodyFill], mount: Option<BodyMount>) -> BakedSegment {
    zone_patch::begin_capture();
    hit_geometry::begin_capture();
    let mut scene = vello::Scene::new();
    for f in fills {
        emit_fill_into(&mut scene, f, true);
    }
    let patches = zone_patch::take_capture();
    let hit = hit_geometry::take_capture();
    BakedSegment {
        scene,
        patches,
        hit,
        mount,
    }
}

/// Split the captured walk into segments at each mount and bake each
/// into its own scene. Invariant: one segment per mount, plus a tail
/// segment with `mount == None` — the tail may be empty (a body whose
/// last leaf precedes no further fills) but is always present so the
/// compositor's body/accessory interleave is uniform.
pub fn bake_segments(items: Vec<BodyItem>) -> Vec<BakedSegment> {
    let mut out = Vec::new();
    let mut cur: Vec<BodyFill> = Vec::new();
    for item in items {
        match item {
            BodyItem::Fill(f) => cur.push(f),
            BodyItem::Mount(m) => {
                out.push(bake_one(&cur, Some(m)));
                cur.clear();
            }
        }
    }
    out.push(bake_one(&cur, None));
    out
}
