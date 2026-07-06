//! Low-level scene emission. Takes a single `DrawCmd` and a target
//! transform/CXFORM and produces a `scene.fill` or `scene.stroke`
//! call. Includes the SWF ColorTransform tinting math and the
//! canonical flat-replace recolor for `applyColor` zones.

use std::sync::Arc;

use vello::kurbo::{Affine, Stroke};
use vello::peniko::{color::AlphaColor, Blob, Brush, Color, ImageData};
use vello::Scene;

use crate::recolor::recolor_to_zone;
use crate::shape::{DrawCmd, DrawKind};
use crate::swf_doc::OwnedColorTransform;

/// Replace each fill/stroke brush in the cmd with its zone-recolored
/// equivalent. Solid colours and gradient stops become the flat target
/// colour (canonical applyColor: multiplier 0 + offset = target, alpha
/// preserved); bitmap brushes are left as-is (no zone tinting on
/// bitmap fills).
pub(super) fn recolor_cmd_in_place(cmd: &mut DrawCmd, target: u32) {
    let recolor_brush = |b: &mut Brush| match b {
        Brush::Solid(c) => *c = recolor_to_zone(*c, target),
        Brush::Gradient(g) => {
            for stop in g.stops.iter_mut() {
                let alpha = stop.color.to_alpha_color::<vello::peniko::color::Srgb>();
                let recolored = recolor_to_zone(alpha, target);
                stop.color = recolored.into();
            }
        }
        Brush::Image(_) => {}
    };
    match &mut cmd.kind {
        DrawKind::Fill { brush, .. } => recolor_brush(brush),
        DrawKind::Stroke { brush, .. } => recolor_brush(brush),
    }
}

pub(super) fn emit_cmd(
    scene: &mut Scene,
    cmd: &DrawCmd,
    transform: Affine,
    cx: OwnedColorTransform,
) {
    match &cmd.kind {
        DrawKind::Fill {
            brush,
            brush_transform,
            rule,
        } => {
            let tinted = if cx.is_identity() {
                brush.clone()
            } else {
                tint_brush(brush, cx)
            };
            scene.fill(*rule, transform, &tinted, *brush_transform, &*cmd.path);
        }
        DrawKind::Stroke {
            brush,
            width,
            cap,
            join,
            miter_limit,
            non_scaling,
        } => {
            let tinted = if cx.is_identity() {
                brush.clone()
            } else {
                tint_brush(brush, cx)
            };
            // dofasset NonScaling port (scene_builder.rs:357-366): for SWF
            // widths < 1 px, take `max(natural_width, one_device_px)` in
            // path-local units. After Vello multiplies by world_scale this
            // yields `max(value_px × resolution, 1)` device pixels — exactly
            // the floor that gives us 1 device pixel for hairlines instead of
            // `1 logical pixel × resolution`. Normal widths pass through and
            // scale naturally with the world transform (Fixed mode).
            let final_width = if *non_scaling {
                let s = transform.determinant().abs().sqrt().max(f64::EPSILON);
                let one_device_px = 1.0 / s;
                (*width).max(one_device_px)
            } else {
                *width
            };
            let stroke = Stroke::new(final_width)
                .with_caps(*cap)
                .with_join(*join)
                .with_miter_limit(*miter_limit);
            scene.stroke(&stroke, transform, &tinted, None, &*cmd.path);
        }
    }
}

/// Apply a SWF ColorTransform to a Vello brush. Solid + gradient brushes are
/// straightforward channel multiplications; bitmap brushes get a fresh tinted
/// pixel buffer so per-channel scale + add lands in the texture itself.
pub(super) fn tint_brush(brush: &Brush, cx: OwnedColorTransform) -> Brush {
    match brush {
        Brush::Solid(c) => Brush::Solid(tint_color(*c, cx)),
        Brush::Gradient(g) => {
            let mut tinted = g.clone();
            for stop in tinted.stops.iter_mut() {
                stop.color = tint_dyn_color(&stop.color, cx).into();
            }
            Brush::Gradient(tinted)
        }
        Brush::Image(ib) => {
            let src = &ib.image;
            let mut bytes = src.data.as_ref().to_vec();
            tint_rgba_in_place(&mut bytes, cx);
            let new_data = ImageData {
                data: Blob::new(Arc::new(bytes)),
                format: src.format,
                alpha_type: src.alpha_type,
                width: src.width,
                height: src.height,
            };
            let mut tinted = vello::peniko::ImageBrush::from(new_data);
            tinted.sampler = ib.sampler;
            Brush::Image(tinted)
        }
    }
}

pub(super) fn tint_color(c: Color, cx: OwnedColorTransform) -> Color {
    let arr = c.to_rgba8().to_u8_array();
    let r = mult_add_u8(arr[0], cx.mult_r, cx.add_r);
    let g = mult_add_u8(arr[1], cx.mult_g, cx.add_g);
    let b = mult_add_u8(arr[2], cx.mult_b, cx.add_b);
    let a = mult_add_u8(arr[3], cx.mult_a, cx.add_a);
    AlphaColor::from_rgba8(r, g, b, a)
}

fn tint_dyn_color(c: &vello::peniko::color::DynamicColor, cx: OwnedColorTransform) -> Color {
    // peniko stores stop colors as DynamicColor; round-trip via rgba8 keeps it
    // simple at the cost of a clamp.
    let alpha = c.to_alpha_color::<vello::peniko::color::Srgb>();
    tint_color(alpha, cx)
}

pub(super) fn tint_rgba_in_place(rgba: &mut [u8], cx: OwnedColorTransform) {
    for chunk in rgba.chunks_exact_mut(4) {
        chunk[0] = mult_add_u8(chunk[0], cx.mult_r, cx.add_r);
        chunk[1] = mult_add_u8(chunk[1], cx.mult_g, cx.add_g);
        chunk[2] = mult_add_u8(chunk[2], cx.mult_b, cx.add_b);
        chunk[3] = mult_add_u8(chunk[3], cx.mult_a, cx.add_a);
    }
}

fn mult_add_u8(c: u8, mult: f32, add: f32) -> u8 {
    let v = (f32::from(c) / 255.0) * mult + add;
    (v.clamp(0.0, 1.0) * 255.0).round() as u8
}
