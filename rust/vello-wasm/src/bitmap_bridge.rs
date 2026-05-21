//! Vello → ImageBitmap bridge.
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
//!   2. `wgpu::util::TextureBlitter` copies that texture to a pooled
//!      OffscreenCanvas's surface texture in `Bgra8Unorm`.
//!   3. `surface.present()` then `canvas.transferToImageBitmap()`.
//!
//! Caller owns the returned `ImageBitmap` and must `.close()` it once
//! Pixi (or whoever consumed it) is done sampling.
//!
//! Canvas pooling: the bridge keeps one OffscreenCanvas + Surface per
//! VelloRenderer instance and resizes it on demand. Allocating a fresh
//! canvas + surface per call was the spike's biggest cost (200ms+ per
//! batch at stress-test scale); pooling drops that to a single ~5ms
//! configure call when the requested size differs from the cached one,
//! and zero overhead when sizes match.

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

/// Pooled OffscreenCanvas + wgpu Surface. Owns its lifetime alongside
/// the VelloRenderer. The surface holds a 'static reference to the
/// canvas because the canvas itself is a JS object that the wgpu side
/// just keeps a JsValue handle to.
pub struct BridgeCanvasPool {
    canvas: web_sys::OffscreenCanvas,
    surface: wgpu::Surface<'static>,
    /// Cached current configuration so we can skip `configure` if the
    /// requested size matches what's already set up.
    cur_width: u32,
    cur_height: u32,
    /// Surface alpha mode used at configure-time. `PreMultiplied` is
    /// the WebGPU default that Chromium accepts; the matching Pixi
    /// alphaMode is `"premultiplied-alpha"`.
    alpha_mode: wgpu::CompositeAlphaMode,
}

impl BridgeCanvasPool {
    /// Allocate a fresh pool with an initial canvas + surface sized to
    /// `width × height`. Subsequent calls to `render_texture_to_bitmap`
    /// resize the same canvas in-place when dims change.
    pub fn new(
        instance: &wgpu::Instance,
        device: &wgpu::Device,
        width: u32,
        height: u32,
    ) -> Result<Self, JsValue> {
        let canvas = web_sys::OffscreenCanvas::new(width.max(1), height.max(1))?;
        let surface = instance
            .create_surface(wgpu::SurfaceTarget::OffscreenCanvas(canvas.clone()))
            .map_err(|e| JsValue::from_str(&format!("create_surface: {e}")))?;
        let alpha_mode = wgpu::CompositeAlphaMode::PreMultiplied;
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format: wgpu::TextureFormat::Bgra8Unorm,
            width: width.max(1),
            height: height.max(1),
            present_mode: wgpu::PresentMode::AutoVsync,
            alpha_mode,
            view_formats: vec![],
            desired_maximum_frame_latency: 1,
        };
        surface.configure(device, &config);
        Ok(BridgeCanvasPool {
            canvas,
            surface,
            cur_width: width,
            cur_height: height,
            alpha_mode,
        })
    }

    /// Reconfigure the surface if `(width, height)` differs from the
    /// cached values. Zero-cost when sizes match.
    fn ensure_size(&mut self, device: &wgpu::Device, width: u32, height: u32) {
        let w = width.max(1);
        let h = height.max(1);
        if self.cur_width == w && self.cur_height == h {
            return;
        }
        self.canvas.set_width(w);
        self.canvas.set_height(h);
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format: wgpu::TextureFormat::Bgra8Unorm,
            width: w,
            height: h,
            present_mode: wgpu::PresentMode::AutoVsync,
            alpha_mode: self.alpha_mode,
            view_formats: vec![],
            desired_maximum_frame_latency: 1,
        };
        self.surface.configure(device, &config);
        self.cur_width = w;
        self.cur_height = h;
    }
}

/// Bridge call: take a Vello-output `Rgba8Unorm` texture, blit it onto
/// the pooled `Bgra8Unorm` canvas surface, present, and
/// `transferToImageBitmap` the canvas to produce a GPU-resident
/// ImageBitmap for the caller.
///
/// `width` / `height` must equal `src.size()`. Pool is resized in-place
/// when the requested dims differ from the cached configuration —
/// resize is a single Surface::configure call (~ms), vs a fresh
/// OffscreenCanvas + Surface alloc (~10ms+ on Chromium).
pub fn render_texture_to_bitmap(
    pool: &mut BridgeCanvasPool,
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    blit: &BlitPipeline,
    src: &wgpu::Texture,
    width: u32,
    height: u32,
) -> Result<web_sys::ImageBitmap, JsValue> {
    pool.ensure_size(device, width, height);
    let frame = pool
        .surface
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
    let bitmap = pool.canvas.transfer_to_image_bitmap()?;
    Ok(bitmap)
}
