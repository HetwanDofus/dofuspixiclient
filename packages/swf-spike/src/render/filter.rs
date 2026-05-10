//! SWF filter rendering: drop shadow, glow, blur, color matrix.
//!
//! Two paths:
//! - `apply_compute` — wgpu compute shaders. Accurate gaussian blur,
//!   real recolor, real composite. Requires `ctx.wgpu = Some(_)`.
//! - `apply_halo` — multi-sample halo approximation. Used as
//!   fallback when no wgpu, or when the compute path bails.
//!
//! Both ctxified in this module: they read transform / frame / ratio
//! / color_xform / recolor_target / player_colors / scene / wgpu /
//! cache from `&mut RenderCtx`. This fixes the previously latent
//! filter+morph and filter+zone composability bugs — the sub-render
//! now inherits ratio and recolor from the parent placement.

use std::sync::Arc;

use vello::kurbo::{Affine, Rect, Vec2};
use vello::peniko::{Brush, Color, Fill, ImageAlphaType, ImageBrush, ImageData, ImageFormat};
use vello::wgpu;
use vello::{AaConfig, Scene};

use crate::swf_doc::{OwnedColorTransform, OwnedFilter, Symbol};

use super::bounds::{symbol_bounds, transform_rect};
use super::ctx::RenderCtx;

/// Render a filtered placement. Tries the GPU-compute path first;
/// falls back to multi-sample halo + body render. Returns true
/// always (caller treats as "filter handled this placement").
///
/// On `wasm32` the compute path is skipped: it ends in
/// `readback_filter_texture` which calls `device.poll(Wait)`, and
/// WebGPU cannot block the JS thread (the event loop must keep
/// running for GPU completion callbacks to fire — the wait would
/// deadlock the page). Halo fallback is CPU-only and works.
pub fn apply(ctx: &mut RenderCtx<'_>, sym: &Symbol, filters: &[OwnedFilter]) -> bool {
    #[cfg(not(target_arch = "wasm32"))]
    if ctx.wgpu.is_some() {
        if apply_compute(ctx, sym, filters) {
            return true;
        }
        // Compute path bailed (degenerate bounds, render error, etc.)
        // — fall through to halo fallback so the placement still
        // shows.
    }
    apply_halo(ctx, sym, filters);
    let saved_cx = ctx.color_xform;
    ctx.color_xform = compose_color_matrix(saved_cx, filters);
    super::render_symbol_into(ctx, sym);
    ctx.color_xform = saved_cx;
    true
}

// ---------------------------------------------------------------
// Halo fallback (CPU): draw the symbol multiple times at small
// offsets, tinted in the filter's color. Cheap; sub-pixel-accurate
// enough at the spike's render scale.
// ---------------------------------------------------------------

fn apply_halo(ctx: &mut RenderCtx<'_>, sym: &Symbol, filters: &[OwnedFilter]) {
    use std::sync::atomic::{AtomicBool, Ordering};
    static WARN_BEVEL: AtomicBool = AtomicBool::new(true);
    static WARN_GRAD_GLOW: AtomicBool = AtomicBool::new(true);
    static WARN_GRAD_BEVEL: AtomicBool = AtomicBool::new(true);
    static WARN_CONV: AtomicBool = AtomicBool::new(true);

    for f in filters {
        match f {
            OwnedFilter::DropShadow {
                color_rgba,
                blur_x,
                blur_y,
                angle,
                distance,
                strength,
                inner,
                ..
            } => {
                if *inner {
                    // Inner shadows would require knock-out clipping —
                    // skipped for now.
                    continue;
                }
                // SWF distance/blur are in PIXELS. Path coords are in twips.
                let dx_twips = f64::from(*distance) * angle.cos() as f64 * 20.0;
                let dy_twips = f64::from(*distance) * angle.sin() as f64 * 20.0;
                let halo_cx = color_replace_xform(*color_rgba, ctx.color_xform, *strength);
                for (ox, oy, weight) in halo_offsets(*blur_x, *blur_y) {
                    let weighted = scale_alpha(halo_cx, weight);
                    let xf = ctx.transform.then_translate(Vec2::new(
                        dx_twips + ox as f64 * 20.0,
                        dy_twips + oy as f64 * 20.0,
                    ));
                    render_with_overrides(ctx, sym, xf, weighted);
                }
            }
            OwnedFilter::Glow {
                color_rgba,
                blur_x,
                blur_y,
                strength,
                inner,
                ..
            } => {
                if *inner {
                    continue;
                }
                let halo_cx = color_replace_xform(*color_rgba, ctx.color_xform, *strength);
                for (ox, oy, weight) in halo_offsets(*blur_x, *blur_y) {
                    let weighted = scale_alpha(halo_cx, weight);
                    let xf = ctx.transform.then_translate(Vec2::new(
                        ox as f64 * 20.0,
                        oy as f64 * 20.0,
                    ));
                    render_with_overrides(ctx, sym, xf, weighted);
                }
            }
            OwnedFilter::Blur { blur_x, blur_y, passes } => {
                let intensity = (*passes as f32).clamp(1.0, 3.0);
                let bx = *blur_x * intensity;
                let by = *blur_y * intensity;
                for (ox, oy, weight) in halo_offsets(bx, by) {
                    let weighted = scale_alpha(ctx.color_xform, weight);
                    let xf = ctx.transform.then_translate(Vec2::new(
                        ox as f64 * 20.0,
                        oy as f64 * 20.0,
                    ));
                    render_with_overrides(ctx, sym, xf, weighted);
                }
            }
            OwnedFilter::ColorMatrix { .. } => {
                // Folded into the body's ColorTransform — see
                // compose_color_matrix.
            }
            OwnedFilter::Unsupported(name) => {
                let warn = match *name {
                    "Bevel" => &WARN_BEVEL,
                    "GradientGlow" => &WARN_GRAD_GLOW,
                    "GradientBevel" => &WARN_GRAD_BEVEL,
                    "Convolution" => &WARN_CONV,
                    _ => continue,
                };
                if warn.swap(false, Ordering::Relaxed) {
                    #[cfg(target_arch = "wasm32")]
                    {
                        let msg = format!("swf-spike: unsupported SWF filter: {name}");
                        web_sys::console::warn_1(&js_sys::JsString::from(msg.as_str()).into());
                    }
                    #[cfg(not(target_arch = "wasm32"))]
                    eprintln!("swf-spike: unsupported SWF filter: {name}");
                }
            }
        }
    }
}

/// Render `sym` into `ctx.scene` with overridden transform + color
/// xform, restoring the original ctx values on return. Ratio,
/// recolor_target, frame all inherit from ctx — that's what fixes
/// filter+morph and filter+zone composability.
fn render_with_overrides(
    ctx: &mut RenderCtx<'_>,
    sym: &Symbol,
    transform: Affine,
    color_xform: OwnedColorTransform,
) {
    let saved_xform = ctx.transform;
    let saved_cx = ctx.color_xform;
    ctx.transform = transform;
    ctx.color_xform = color_xform;
    super::render_symbol_into(ctx, sym);
    ctx.transform = saved_xform;
    ctx.color_xform = saved_cx;
}

/// 9-tap halo (centered + 8 cardinals/diagonals) with gaussian-ish
/// weights. Returns (offset_x_px, offset_y_px, weight) tuples that
/// sum to 1.
fn halo_offsets(blur_x: f32, blur_y: f32) -> Vec<(f32, f32, f32)> {
    let bx = blur_x.clamp(0.0, 8.0);
    let by = blur_y.clamp(0.0, 8.0);
    if bx < 0.5 && by < 0.5 {
        return vec![(0.0, 0.0, 1.0)];
    }
    let dx = (bx * 0.5).max(0.5);
    let dy = (by * 0.5).max(0.5);
    let c = 0.30;
    let s = 0.10;
    let d = 0.05;
    vec![
        (0.0, 0.0, c),
        (dx, 0.0, s),
        (-dx, 0.0, s),
        (0.0, dy, s),
        (0.0, -dy, s),
        (dx, dy, d),
        (-dx, dy, d),
        (dx, -dy, d),
        (-dx, -dy, d),
    ]
}

/// Build a ColorTransform that **replaces** the source color with
/// the filter color, scaled by alpha and strength. Used for
/// shadow/glow halos.
fn color_replace_xform(
    rgba: [u8; 4],
    parent: OwnedColorTransform,
    strength: f32,
) -> OwnedColorTransform {
    let s = strength.clamp(0.0, 8.0);
    let af = (f32::from(rgba[3]) / 255.0) * s;
    OwnedColorTransform {
        mult_r: 0.0,
        mult_g: 0.0,
        mult_b: 0.0,
        mult_a: parent.mult_a * af,
        add_r: f32::from(rgba[0]) / 255.0,
        add_g: f32::from(rgba[1]) / 255.0,
        add_b: f32::from(rgba[2]) / 255.0,
        add_a: parent.add_a,
    }
}

fn scale_alpha(mut cx: OwnedColorTransform, weight: f32) -> OwnedColorTransform {
    cx.mult_a *= weight;
    cx
}

/// Fold a ColorMatrix filter (4x5) into a ColorTransform when the
/// matrix has no cross-channel mixing — the common Dofus case.
/// Otherwise, applies just the diagonal+offset terms (cross-channel
/// mixing is dropped). This keeps the body's render path a single
/// transform.
fn compose_color_matrix(cx: OwnedColorTransform, filters: &[OwnedFilter]) -> OwnedColorTransform {
    let mut out = cx;
    for f in filters {
        if let OwnedFilter::ColorMatrix { matrix } = f {
            let cm = OwnedColorTransform {
                mult_r: matrix[0],
                mult_g: matrix[6],
                mult_b: matrix[12],
                mult_a: matrix[18],
                add_r: matrix[4] / 255.0,
                add_g: matrix[9] / 255.0,
                add_b: matrix[14] / 255.0,
                add_a: matrix[19] / 255.0,
            };
            out = out.compose(cm);
        }
    }
    out
}

// ---------------------------------------------------------------
// GPU-compute path: render the symbol to an intermediate texture,
// run gaussian-blur / color-matrix / recolor passes via wgpu compute,
// composite back into the main scene as an Image brush.
// ---------------------------------------------------------------

/// Returns true on success. Returns false when bounds collapse to
/// zero, the renderer fails, or the texture readback fails — caller
/// falls back to the halo approximation.
fn apply_compute(ctx: &mut RenderCtx<'_>, sym: &Symbol, filters: &[OwnedFilter]) -> bool {
    // 1. Twip-space bounds, expanded for filter blur extent.
    let local_bounds = symbol_bounds(ctx.doc, sym, ctx.frame);
    if local_bounds.width() <= 0.0 || local_bounds.height() <= 0.0 {
        return false;
    }
    let world_bounds = transform_rect(ctx.transform, local_bounds);
    let mut pad_px = 4.0_f32;
    for f in filters {
        match f {
            OwnedFilter::DropShadow {
                blur_x,
                blur_y,
                distance,
                ..
            } => {
                pad_px = pad_px.max(blur_x.max(*blur_y) * 3.0 + distance.abs());
            }
            OwnedFilter::Glow { blur_x, blur_y, .. } | OwnedFilter::Blur { blur_x, blur_y, .. } => {
                pad_px = pad_px.max(blur_x.max(*blur_y) * 3.0);
            }
            _ => {}
        }
    }
    let pad_twips = f64::from(pad_px) * 20.0;
    let bb_x = world_bounds.x0 - pad_twips;
    let bb_y = world_bounds.y0 - pad_twips;
    let bb_x1 = world_bounds.x1 + pad_twips;
    let bb_y1 = world_bounds.y1 + pad_twips;

    // 2. Output pixel size + sub-scene transform.
    let scale = ctx
        .wgpu
        .as_ref()
        .map(|w| w.output_scale)
        .expect("apply_compute requires wgpu");
    let bb_w = (((bb_x1 - bb_x) * scale).ceil() as u32).max(1);
    let bb_h = (((bb_y1 - bb_y) * scale).ceil() as u32).max(1);
    if bb_w == 0 || bb_h == 0 {
        return false;
    }
    let sub_world = Affine::scale(scale)
        .then_translate(Vec2::new(-bb_x * scale, -bb_y * scale))
        * ctx.transform;

    // 3. Render sym to a sub-scene at sub_world. Build a child
    //    RenderCtx so the sub-render inherits ratio + recolor +
    //    player_colors from the parent (closes filter+morph and
    //    filter+zone composability bugs). wgpu is None inside the
    //    sub-render — no recursive filter stacking.
    let mut sub_scene = vello::Scene::new();
    {
        let mut sub_ctx = RenderCtx {
            doc: ctx.doc,
            scene: &mut sub_scene,
            wgpu: None,
            transform: sub_world,
            frame: ctx.frame,
            ratio: ctx.ratio,
            color_xform: ctx.color_xform,
            recolor_target: ctx.recolor_target,
            player_colors: ctx.player_colors,
            cache: ctx.cache,
            accessories: ctx.accessories,
            apply_b_fix: ctx.apply_b_fix,
        };
        super::render_symbol_into(&mut sub_ctx, sym);
    }

    // 4. Render sub-scene to a fresh storage texture, then run the
    //    filter compute passes on it. Disjoint borrows of
    //    `ctx.wgpu` and `ctx.scene` are OK since they're separate
    //    fields of `*ctx`.
    let wgpu = ctx.wgpu.as_mut().expect("apply_compute requires wgpu");
    let tex = create_filter_texture(wgpu.device, bb_w, bb_h);
    let view = tex.create_view(&Default::default());
    let params = vello::RenderParams {
        base_color: Color::TRANSPARENT,
        width: bb_w,
        height: bb_h,
        antialiasing_method: AaConfig::Area,
    };
    if wgpu
        .renderer
        .render_to_texture(wgpu.device, wgpu.queue, &sub_scene, &view, &params)
        .is_err()
    {
        return false;
    }

    // 5. Apply each filter as a compute pass. DropShadow / Glow are
    //    additive halos applied BELOW the body.
    let mut halo_textures: Vec<(wgpu::Texture, [u8; 4], f32, f32)> = Vec::new();
    let mut body_tex = tex;
    for filter in filters {
        match filter {
            OwnedFilter::DropShadow {
                color_rgba,
                blur_x,
                blur_y,
                angle,
                distance,
                strength,
                inner: _,
                ..
            } => {
                let halo = recolor_texture(wgpu, &body_tex, bb_w, bb_h, *color_rgba, *strength);
                let halo = wgpu.filter_pipelines.apply_gaussian_blur(
                    wgpu.device,
                    wgpu.queue,
                    &halo,
                    bb_w,
                    bb_h,
                    *blur_x * 0.5,
                    *blur_y * 0.5,
                );
                let off_x = angle.cos() * *distance;
                let off_y = angle.sin() * *distance;
                halo_textures.push((halo, *color_rgba, off_x, off_y));
            }
            OwnedFilter::Glow {
                color_rgba,
                blur_x,
                blur_y,
                strength,
                ..
            } => {
                let halo = recolor_texture(wgpu, &body_tex, bb_w, bb_h, *color_rgba, *strength);
                let halo = wgpu.filter_pipelines.apply_gaussian_blur(
                    wgpu.device,
                    wgpu.queue,
                    &halo,
                    bb_w,
                    bb_h,
                    *blur_x * 0.5,
                    *blur_y * 0.5,
                );
                halo_textures.push((halo, *color_rgba, 0.0, 0.0));
            }
            OwnedFilter::Blur { blur_x, blur_y, passes } => {
                let mut tex = body_tex;
                for _ in 0..(*passes).max(1) {
                    tex = wgpu.filter_pipelines.apply_gaussian_blur(
                        wgpu.device,
                        wgpu.queue,
                        &tex,
                        bb_w,
                        bb_h,
                        *blur_x * 0.5,
                        *blur_y * 0.5,
                    );
                }
                body_tex = tex;
            }
            OwnedFilter::ColorMatrix { matrix } => {
                body_tex = wgpu.filter_pipelines.apply_color_matrix(
                    wgpu.device,
                    wgpu.queue,
                    &body_tex,
                    bb_w,
                    bb_h,
                    matrix,
                );
            }
            OwnedFilter::Unsupported(_) => {}
        }
    }

    // 6. Composite halos BELOW body, then body on top.
    for (halo_tex, _color, off_x, off_y) in halo_textures {
        let pixels = readback_filter_texture(wgpu.device, wgpu.queue, &halo_tex, bb_w, bb_h);
        composite_image(
            ctx.scene,
            pixels,
            bb_w,
            bb_h,
            bb_x + f64::from(off_x) * 20.0,
            bb_y + f64::from(off_y) * 20.0,
            scale,
        );
    }
    let body_pixels = readback_filter_texture(wgpu.device, wgpu.queue, &body_tex, bb_w, bb_h);
    composite_image(ctx.scene, body_pixels, bb_w, bb_h, bb_x, bb_y, scale);
    true
}

/// Color-replace pass: zero RGB, then add filter color * (alpha *
/// strength). Result texture has the same alpha shape as input but
/// the filter's RGB. Used to colorize halos before blurring.
fn recolor_texture(
    wgpu: &mut super::WgpuCtx<'_>,
    input: &wgpu::Texture,
    w: u32,
    h: u32,
    rgba: [u8; 4],
    strength: f32,
) -> wgpu::Texture {
    let r = f32::from(rgba[0]) / 255.0;
    let g = f32::from(rgba[1]) / 255.0;
    let b = f32::from(rgba[2]) / 255.0;
    let s = strength.clamp(0.0, 8.0);
    // SVG row-major 4×5: each row is [m_r, m_g, m_b, m_a, m_offset].
    let m = [
        0.0, 0.0, 0.0, r, 0.0,
        0.0, 0.0, 0.0, g, 0.0,
        0.0, 0.0, 0.0, b, 0.0,
        0.0, 0.0, 0.0, s, 0.0,
    ];
    wgpu.filter_pipelines
        .apply_color_matrix(wgpu.device, wgpu.queue, input, w, h, &m)
}

/// Composite an RGBA pixel buffer into the main scene via Image brush.
fn composite_image(
    scene: &mut Scene,
    pixels: Vec<u8>,
    w: u32,
    h: u32,
    bb_x_twips: f64,
    bb_y_twips: f64,
    scale: f64,
) {
    let data = ImageData {
        data: vello::peniko::Blob::new(Arc::new(pixels)),
        format: ImageFormat::Rgba8,
        // Vello's render_to_texture writes premultiplied RGBA. Marking it
        // as straight would have Vello premultiply again on sample,
        // halving visible alpha and darkening colors.
        alpha_type: ImageAlphaType::AlphaPremultiplied,
        width: w,
        height: h,
    };
    let brush = ImageBrush::from(data);
    let inv_scale = 1.0 / scale;
    let brush_transform =
        Affine::translate((bb_x_twips, bb_y_twips)) * Affine::scale(inv_scale);
    let path = Rect::new(
        bb_x_twips,
        bb_y_twips,
        bb_x_twips + f64::from(w) * inv_scale,
        bb_y_twips + f64::from(h) * inv_scale,
    );
    scene.fill(
        Fill::NonZero,
        Affine::IDENTITY,
        &Brush::Image(brush),
        Some(brush_transform),
        &path,
    );
}

fn create_filter_texture(device: &wgpu::Device, w: u32, h: u32) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("swf_spike_filter_input"),
        size: wgpu::Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::STORAGE_BINDING
            | wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_SRC
            | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    })
}

fn readback_filter_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    tex: &wgpu::Texture,
    w: u32,
    h: u32,
) -> Vec<u8> {
    let bpr = (w * 4 + 255) & !255;
    let buf = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("swf_spike_readback"),
        size: u64::from(bpr * h),
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut enc = device.create_command_encoder(&Default::default());
    enc.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture: tex,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &buf,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(bpr),
                rows_per_image: None,
            },
        },
        wgpu::Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: 1,
        },
    );
    queue.submit(Some(enc.finish()));

    let slice = buf.slice(..);
    let (tx, rx) = std::sync::mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |r| {
        tx.send(r).unwrap();
    });
    device
        .poll(wgpu::PollType::Wait {
            submission_index: None,
            timeout: None,
        })
        .ok();
    rx.recv().unwrap().ok();

    let data = slice.get_mapped_range();
    let mut out = vec![0u8; (w * h * 4) as usize];
    for row in 0..h {
        let src_start = (row * bpr) as usize;
        let dst_start = (row * w * 4) as usize;
        let row_bytes = (w * 4) as usize;
        out[dst_start..dst_start + row_bytes]
            .copy_from_slice(&data[src_start..src_start + row_bytes]);
    }
    drop(data);
    buf.unmap();
    out
}
