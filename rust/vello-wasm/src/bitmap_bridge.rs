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

/// Custom blit pipeline that premultiplies alpha while copying from a
/// straight-alpha Vello texture to the PreMultiplied-alpha canvas surface.
///
/// Why premultiply here, not in `wgpu::util::TextureBlitter`'s built-in
/// shader (sample + write through):
///
/// Vello's `fine.wgsl` un-premultiplies its internal PMA values before
/// `textureStore`, so the Rust-side `wgpu::Texture` we hand to this
/// blit has **straight** alpha. The OffscreenCanvas we present into is
/// configured with `CompositeAlphaMode::PreMultiplied` (the only mode
/// reliably supported across Chromium/Safari + Mac/iOS for a WebGPU
/// canvas with non-opaque alpha). When `transferToImageBitmap` then
/// snapshots the canvas, the resulting `ImageBitmap` is tagged
/// `premultipliedAlpha = true` — but the pixel values are still
/// straight if we used a passthrough blit. That mismatch is what
/// caused the Round 3a/3b halos documented in STEP_11_BRIDGE_NOTES.md:
///
///   - `alphaMode = "no-premultiply-alpha"`: WebGPU's
///     `copyExternalImageToTexture` un-premultiplies on upload
///     (divides straight values by alpha), corrupting the data.
///   - `alphaMode = "premultiplied-alpha"`: upload skips conversion
///     so straight data lands in Pixi's GPU texture. Pixi's PMA
///     blend then over-brightens AA edges because it expects PMA
///     source.
///
/// Fix: actually premultiply in this shader. Then the bitmap data
/// matches its `premultipliedAlpha = true` tag, the upload preserves
/// it, and Pixi's PMA blend produces correct edges. Custom shaders
/// that need to recolor in straight-space (`body-band-shader`) sample
/// PMA, un-premultiply, recolor, re-premultiply on output.
pub struct BlitPipeline {
    pipeline: wgpu::RenderPipeline,
    bind_group_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
}

const PREMULT_BLIT_WGSL: &str = r#"
@group(0) @binding(0) var src_tex: texture_2d<f32>;
@group(0) @binding(1) var src_samp: sampler;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VSOut {
  // Fullscreen triangle: vertices at (-1,-1), (3,-1), (-1,3).
  // UVs at the corresponding texel positions, Y-flipped so the
  // canvas's top-left maps to the source texture's top-left.
  var out: VSOut;
  let uv = vec2<f32>(f32((idx << 1u) & 2u), f32(idx & 2u));
  out.position = vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2<f32>(uv.x, 1.0 - uv.y);
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let c = textureSample(src_tex, src_samp, in.uv);
  // Premultiply RGB by alpha so the canvas's PMA composition tag
  // describes the actual pixel data.
  return vec4<f32>(c.rgb * c.a, c.a);
}
"#;

impl BlitPipeline {
    pub fn new(device: &wgpu::Device, dst_format: wgpu::TextureFormat) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("bridge-premult-blit"),
            source: wgpu::ShaderSource::Wgsl(PREMULT_BLIT_WGSL.into()),
        });
        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("bridge-premult-blit-bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("bridge-premult-blit-pl"),
            bind_group_layouts: &[&bgl],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("bridge-premult-blit-pipeline"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: dst_format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("bridge-premult-blit-sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            ..Default::default()
        });
        BlitPipeline {
            pipeline,
            bind_group_layout: bgl,
            sampler,
        }
    }

    fn blit(
        &self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        src_view: &wgpu::TextureView,
        dst_view: &wgpu::TextureView,
    ) {
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("bridge-premult-blit-bg"),
            layout: &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(src_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("bridge-premult-blit-pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: dst_view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        pass.draw(0..3, 0..1);
    }
}

/// Straight-alpha "over" compositor. Blends a Vello batch texture
/// (Vello outputs STRAIGHT alpha) onto a target, used to combine
/// multiple batch renders — each kept under the single-scene shape
/// ceiling — into one final image with correct alpha + back-to-front
/// (Y-sorted) ordering. Same fullscreen-triangle + Y-flip as the blit
/// (so the copy is orientation-identity for a render-to-texture pass),
/// but outputs straight color and uses SrcAlpha/OneMinusSrcAlpha blend.
pub struct CompositePipeline {
    pipeline: wgpu::RenderPipeline,
    bind_group_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
}

const COMPOSITE_WGSL: &str = r#"
@group(0) @binding(0) var src_tex: texture_2d<f32>;
@group(0) @binding(1) var src_samp: sampler;
struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};
@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VSOut {
  var out: VSOut;
  let uv = vec2<f32>(f32((idx << 1u) & 2u), f32(idx & 2u));
  out.position = vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2<f32>(uv.x, 1.0 - uv.y);
  return out;
}
@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // Straight (un-premultiplied) — the blend's SrcAlpha factor applies it.
  return textureSample(src_tex, src_samp, in.uv);
}
"#;

impl CompositePipeline {
    pub fn new(device: &wgpu::Device, dst_format: wgpu::TextureFormat) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("crowd-composite"),
            source: wgpu::ShaderSource::Wgsl(COMPOSITE_WGSL.into()),
        });
        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("crowd-composite-bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("crowd-composite-pl"),
            bind_group_layouts: &[&bgl],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("crowd-composite-pipeline"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: dst_format,
                    blend: Some(wgpu::BlendState {
                        color: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::SrcAlpha,
                            dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                            operation: wgpu::BlendOperation::Add,
                        },
                        alpha: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::One,
                            dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                            operation: wgpu::BlendOperation::Add,
                        },
                    }),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("crowd-composite-sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            ..Default::default()
        });
        CompositePipeline {
            pipeline,
            bind_group_layout: bgl,
            sampler,
        }
    }

    /// Blend `src_view` onto `dst_view`. `clear=true` clears the target
    /// first (the back-most batch); subsequent batches load + blend over.
    pub fn composite(
        &self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        src_view: &wgpu::TextureView,
        dst_view: &wgpu::TextureView,
        clear: bool,
    ) {
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("crowd-composite-bg"),
            layout: &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(src_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });
        let load = if clear {
            wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT)
        } else {
            wgpu::LoadOp::Load
        };
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("crowd-composite-pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: dst_view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations { load, store: wgpu::StoreOp::Store },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        pass.draw(0..3, 0..1);
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

/// Body-atlas color + zone combiner.
///
/// Vello renders the body atlas in two passes — one for tinted body
/// color (`RenderMode::Colour`) and one for zone-id markers
/// (`RenderMode::ZoneId`, which writes `zone_id * 60` into the R
/// channel). At ~2.2 MB per atlas × 550 cached entries × 2 textures
/// (color + zone), the pre-combine working set was ~2.4 GB GPU on
/// the Pixi side alone — every Pixi GPUTexture mirrored by our LRU.
///
/// This pipeline runs ONE fullscreen render pass after the two Vello
/// renders complete. It reads both temp textures and writes a single
/// Rgba8Unorm output where:
///   - RGB = body color (unchanged from the colour pass)
///   - A   = `(body_alpha & 0xFC) | zone_id`
///           (zone_id ∈ {0,1,2,3} in the low 2 bits)
///
/// The body-band-shader then binds the single output texture twice
/// — LINEAR sampler for color+alpha, NEAREST sampler for the zone
/// — and decodes `zone_id = packed_byte & 0x3` from the NEAREST
/// sample. Body alpha precision drops from 8 bits → 6 bits (≤1.6%
/// quantisation), invisible at AA edges.
///
/// Net effect: each body atlas becomes ONE texture instead of two.
/// Single bridge crossing per bake instead of two. Single Pixi
/// `ImageSource` cached instead of a colour+zone pair. ~600 MB
/// saved on the Pixi GPU side at 200-bot stress.
pub struct CombineBodyPipeline {
    pipeline: wgpu::RenderPipeline,
    bind_group_layout: wgpu::BindGroupLayout,
}

const COMBINE_BODY_WGSL: &str = r#"
@group(0) @binding(0) var colour_tex: texture_2d<f32>;
@group(0) @binding(1) var zone_tex: texture_2d<f32>;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VSOut {
  var out: VSOut;
  let uv = vec2<f32>(f32((idx << 1u) & 2u), f32(idx & 2u));
  out.position = vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
  // No Y flip: source and destination are both top-left origin in
  // their respective coordinate spaces. textureLoad uses integer
  // pixel coordinates directly from the fragment position.
  out.uv = uv;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // textureLoad bypasses sampling: 1:1 pixel read from the input
  // textures. Both inputs are at the same dimensions as the output
  // (the body atlas dims) so the fragment-position pixel coord
  // maps directly to the input texel coord.
  let coord = vec2<i32>(in.position.xy);
  let colour = textureLoad(colour_tex, coord, 0);
  let zone = textureLoad(zone_tex, coord, 0);

  // Zone scene encodes zone_id * 60 in the R channel (60 → 1,
  // 120 → 2, 180 → 3, 0 → no zone). Recover zone_id by /60.
  let zone_id_f = (zone.r * 255.0) / 60.0;
  let zone_id = u32(zone_id_f + 0.5) & 0x3u;

  // Pack body alpha into the high 6 bits, zone_id into the low 2.
  let alpha_byte = u32(colour.a * 255.0 + 0.5);
  let packed = (alpha_byte & 0xFCu) | zone_id;
  return vec4<f32>(colour.rgb, f32(packed) / 255.0);
}
"#;

impl CombineBodyPipeline {
    pub fn new(device: &wgpu::Device) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("body-combine-colour-zone"),
            source: wgpu::ShaderSource::Wgsl(COMBINE_BODY_WGSL.into()),
        });
        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("body-combine-bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
            ],
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("body-combine-pl"),
            bind_group_layouts: &[&bgl],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("body-combine-pipeline"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        CombineBodyPipeline {
            pipeline,
            bind_group_layout: bgl,
        }
    }

    /// Run the combine pass. `colour_view` + `zone_view` are the two
    /// Vello-rendered temp textures; `dst_view` is the combined
    /// output (caller-allocated Rgba8Unorm with RENDER_ATTACHMENT).
    pub fn combine(
        &self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        colour_view: &wgpu::TextureView,
        zone_view: &wgpu::TextureView,
        dst_view: &wgpu::TextureView,
    ) {
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("body-combine-bg"),
            layout: &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(colour_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(zone_view),
                },
            ],
        });
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("body-combine-pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: dst_view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        pass.draw(0..3, 0..1);
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
    blit.blit(device, &mut encoder, &src_view, &dst_view);
    queue.submit(std::iter::once(encoder.finish()));
    frame.present();
    let bitmap = pool.canvas.transfer_to_image_bitmap()?;
    Ok(bitmap)
}
