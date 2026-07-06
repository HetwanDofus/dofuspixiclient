//! Replay a `vello::record::Recording` into a `vello_cpu::RenderContext`.
//!
//! The recorded ops carry the vello fork's peniko 0.6 types, which are the
//! SAME peniko types `vello_cpu` 0.0.9 consumes — solids, gradients, fill
//! rules, blend modes and affines transfer without conversion. Only image
//! brushes need repacking (peniko `ImageBrush` → `vello_common` `Image`).

use std::sync::Arc;

use vello::peniko::{Brush, ImageAlphaType, ImageBrush, ImageFormat, kurbo::Affine};
use vello::record::{DisplayOp, Recording};
use vello_cpu::color::PremulRgba8;
use vello_cpu::{Image, ImageSource, Pixmap, RenderContext};

/// Fidelity counters for one replay. `unsupported_images` means an image
/// brush had a pixel format the converter doesn't handle and was skipped.
#[derive(Debug, Default, Clone, Copy)]
pub struct ReplayStats {
    pub fills: u64,
    pub strokes: u64,
    pub layers: u64,
    pub gradients: u64,
    pub images: u64,
    pub unsupported_images: u64,
}

/// Issue every recorded op into `ctx`, prepending `base` to each recorded
/// transform (identity for a top-level replay; appended child recordings
/// compose their append transform the same way `Encoding::append` does).
pub fn replay(rec: &Recording, ctx: &mut RenderContext, base: Affine, stats: &mut ReplayStats) {
    for op in &rec.ops {
        match op {
            DisplayOp::Fill {
                style,
                transform,
                brush,
                brush_transform,
                path,
            } => {
                stats.fills += 1;
                ctx.set_transform(base * *transform);
                ctx.set_fill_rule(*style);
                set_paint(ctx, brush, *brush_transform, stats);
                ctx.fill_path(path);
            }
            DisplayOp::Stroke {
                style,
                transform,
                brush,
                brush_transform,
                path,
            } => {
                stats.strokes += 1;
                ctx.set_transform(base * *transform);
                ctx.set_stroke(style.clone());
                set_paint(ctx, brush, *brush_transform, stats);
                ctx.stroke_path(path);
            }
            DisplayOp::PushLayer {
                clip_style,
                blend,
                alpha,
                transform,
                clip,
            } => {
                stats.layers += 1;
                ctx.set_transform(base * *transform);
                ctx.set_fill_rule(*clip_style);
                ctx.push_layer(Some(clip), Some(*blend), Some(*alpha), None, None);
            }
            DisplayOp::PopLayer => {
                ctx.pop_layer();
            }
            DisplayOp::Append { rec: child, transform } => {
                let t = transform.unwrap_or(Affine::IDENTITY);
                replay(child, ctx, base * t, stats);
            }
        }
    }
}

fn set_paint(
    ctx: &mut RenderContext,
    brush: &Brush,
    brush_transform: Option<Affine>,
    stats: &mut ReplayStats,
) {
    match brush_transform {
        Some(bt) => ctx.set_paint_transform(bt),
        None => ctx.reset_paint_transform(),
    }

    match brush {
        Brush::Solid(c) => {
            ctx.set_paint(*c);
        }
        Brush::Gradient(g) => {
            stats.gradients += 1;
            ctx.set_paint(g.clone());
        }
        Brush::Image(img) => {
            stats.images += 1;

            match convert_image(img) {
                Some(cpu_img) => ctx.set_paint(cpu_img),
                None => {
                    stats.unsupported_images += 1;
                    ctx.set_paint(vello::peniko::Color::from_rgba8(255, 0, 255, 255));
                }
            }
        }
    }
}

/// Repack a peniko `ImageBrush` (RGBA8 blob) as a `vello_common` `Image`
/// backed by an owned premultiplied `Pixmap`.
fn convert_image(brush: &ImageBrush) -> Option<Image> {
    let data = &brush.image;

    if data.format != ImageFormat::Rgba8 {
        return None;
    }

    let bytes = data.data.as_ref();
    let n = (data.width as usize) * (data.height as usize);

    if bytes.len() < n * 4 {
        return None;
    }

    let premul = matches!(data.alpha_type, ImageAlphaType::AlphaPremultiplied);
    let mut px = Vec::with_capacity(n);

    for chunk in bytes[..n * 4].chunks_exact(4) {
        let (r, g, b, a) = (chunk[0], chunk[1], chunk[2], chunk[3]);

        let (r, g, b) = if premul {
            (r, g, b)
        } else {
            let mul = |c: u8| ((c as u16 * a as u16 + 127) / 255) as u8;

            (mul(r), mul(g), mul(b))
        };

        px.push(PremulRgba8 { r, g, b, a });
    }

    let pixmap = Pixmap::from_parts(px, data.width as u16, data.height as u16);

    Some(Image {
        image: ImageSource::Pixmap(Arc::new(pixmap)),
        sampler: brush.sampler,
    })
}
