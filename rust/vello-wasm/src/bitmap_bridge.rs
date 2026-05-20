//! Vello → ImageBitmap bridge (spike).
//!
//! Vello writes via STORAGE_BINDING, which WebGPU only permits on
//! `Rgba8Unorm`. Canvases — and especially the OffscreenCanvas we want
//! to `transferToImageBitmap` from — prefer `Bgra8Unorm` on every Mac.
//! Configuring the canvas surface as `Rgba8Unorm` triggers Chromium's
//! "preferred format" perf warning + a per-call driver-level format
//! conversion (see `hud-vello-atlas.ts` for the history note that
//! drove the team away from that path).
//!
//! Path here:
//!   1. Vello renders into a private `Rgba8Unorm` `wgpu::Texture`.
//!   2. `wgpu::util::TextureBlitter` copies that texture to a fresh
//!      OffscreenCanvas's surface texture in `Bgra8Unorm`.
//!   3. `surface.present()` then `canvas.transferToImageBitmap()`.
//!
//! Caller owns the returned `ImageBitmap` and must `.close()` it once
//! Pixi (or whoever consumed it) is done sampling.
//!
//! Spike caveat: this module does NOT pool canvases yet — every call
//! creates a fresh OffscreenCanvas + Surface. That's the worst-case
//! perf budget. If the spike numbers are good at this rate, pooling
//! can only improve them.

use wasm_bindgen::prelude::*;

/// Lazy-created blitter for a single destination format. Wraps
/// `wgpu::util::TextureBlitter` so the spike path doesn't have to
/// maintain its own pipeline + shader.
pub struct BlitPipeline {
    inner: wgpu::util::TextureBlitter,
}

impl BlitPipeline {
    pub fn new(device: &wgpu::Device, dst_format: wgpu::TextureFormat) -> Self {
        BlitPipeline {
            inner: wgpu::util::TextureBlitter::new(device, dst_format),
        }
    }
}

/// One-shot bridge: take a Vello-output `Rgba8Unorm` texture, blit it
/// into a fresh `Bgra8Unorm` OffscreenCanvas surface, present, and
/// `transferToImageBitmap` the canvas to produce a GPU-resident
/// ImageBitmap for the caller.
///
/// `width` / `height` must equal `src.size()`.
pub fn render_texture_to_bitmap(
    instance: &wgpu::Instance,
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    blit: &BlitPipeline,
    src: &wgpu::Texture,
    width: u32,
    height: u32,
) -> Result<web_sys::ImageBitmap, JsValue> {
    let canvas = web_sys::OffscreenCanvas::new(width, height)?;
    let surface = instance
        .create_surface(wgpu::SurfaceTarget::OffscreenCanvas(canvas.clone()))
        .map_err(|e| JsValue::from_str(&format!("create_surface: {e}")))?;
    let config = wgpu::SurfaceConfiguration {
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        format: wgpu::TextureFormat::Bgra8Unorm,
        width,
        height,
        present_mode: wgpu::PresentMode::AutoVsync,
        alpha_mode: wgpu::CompositeAlphaMode::PreMultiplied,
        view_formats: vec![],
        desired_maximum_frame_latency: 1,
    };
    surface.configure(device, &config);
    let frame = surface
        .get_current_texture()
        .map_err(|e| JsValue::from_str(&format!("get_current_texture: {e}")))?;
    let src_view = src.create_view(&Default::default());
    let dst_view = frame.texture.create_view(&Default::default());
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("bitmap-bridge-encoder"),
    });
    blit.inner.copy(device, &mut encoder, &src_view, &dst_view);
    queue.submit(std::iter::once(encoder.finish()));
    frame.present();
    let bitmap = canvas.transfer_to_image_bitmap()?;
    Ok(bitmap)
}
