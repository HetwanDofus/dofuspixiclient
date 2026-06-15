// Copyright 2022 the Vello Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

//! Vello is a 2d graphics rendering engine written in Rust, using [`wgpu`].
//! It efficiently draws large 2d scenes with interactive or near-interactive performance.
//!
//! ![image](https://github.com/linebender/vello/assets/8573618/cc2b742e-2135-4b70-8051-c49aeddb5d19)
//!
//!
//! ## Motivation
//!
//! Vello is meant to fill the same place in the graphics stack as other vector graphics renderers like [Skia](https://skia.org/), [Cairo](https://www.cairographics.org/), and its predecessor project [Piet](https://www.cairographics.org/).
//! On a basic level, that means it provides tools to render shapes, images, gradients, texts, etc, using a PostScript-inspired API, the same that powers SVG files and [the browser `<canvas>` element](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D).
//!
//! Vello's selling point is that it gets better performance than other renderers by better leveraging the GPU.
//! In traditional PostScript-style renderers, some steps of the render process like sorting and clipping either need to be handled in the CPU or done through the use of intermediary textures.
//! Vello avoids this by using prefix-scan algorithms to parallelize work that usually needs to happen in sequence, so that work can be offloaded to the GPU with minimal use of temporary buffers.
//!
//! This means that Vello needs a GPU with support for compute shaders to run.
//!
//!
//! ## Getting started
//!
//! Vello is meant to be integrated deep in UI render stacks.
//! While drawing in a Vello [`Scene`] is easy, actually rendering that scene to a surface setting up a wgpu context, which is a non-trivial task.
//!
//! To use Vello as the renderer for your PDF reader / GUI toolkit / etc, your code will have to look roughly like this:
//!
//! ```ignore
//! // Initialize wgpu and get handles
//! let (width, height) = ...;
//! let device: wgpu::Device = ...;
//! let queue: wgpu::Queue = ...;
//! let mut renderer = Renderer::new(
//!    &device,
//!    RendererOptions {
//!       use_cpu: false,
//!       antialiasing_support: vello::AaSupport::all(),
//!       num_init_threads: NonZeroUsize::new(1),
//!    },
//! ).expect("Failed to create renderer");
//!
//! // Create scene and draw stuff in it
//! let mut scene = vello::Scene::new();
//! scene.fill(
//!    vello::peniko::Fill::NonZero,
//!    vello::Affine::IDENTITY,
//!    vello::Color::from_rgb8(242, 140, 168),
//!    None,
//!    &vello::Circle::new((420.0, 200.0), 120.0),
//! );
//!
//! // Draw more stuff
//! scene.push_layer(...);
//! scene.fill(...);
//! scene.stroke(...);
//! scene.pop_layer(...);
//!
//! let texture = device.create_texture(&...);
//! // Render to a wgpu Texture
//! renderer
//!    .render_to_texture(
//!       &device,
//!       &queue,
//!       &scene,
//!       &texture,
//!       &vello::RenderParams {
//!          base_color: palette::css::BLACK, // Background color
//!          width,
//!          height,
//!          antialiasing_method: AaConfig::Msaa16,
//!       },
//!    )
//!    .expect("Failed to render to a texture");
//! // Do things with surface texture, such as blitting it to the Surface using
//! // wgpu::util::TextureBlitter.
//! ```
//!
//! See the [`examples/`](https://github.com/linebender/vello/tree/main/examples) folder to see how that code integrates with frameworks like winit.

// LINEBENDER LINT SET - lib.rs - v2
// See https://linebender.org/wiki/canonical-lints/
// These lints aren't included in Cargo.toml because they
// shouldn't apply to examples and tests
#![warn(unused_crate_dependencies)]
#![warn(clippy::print_stdout, clippy::print_stderr)]
// Targeting e.g. 32-bit means structs containing usize can give false positives for 64-bit.
#![cfg_attr(target_pointer_width = "64", warn(clippy::trivially_copy_pass_by_ref))]
// END LINEBENDER LINT SET
#![cfg_attr(docsrs, feature(doc_cfg))]
// The following lints are part of the Linebender standard set,
// but resolving them has been deferred for now.
// Feel free to send a PR that solves one or more of these.
// Need to allow instead of expect until Rust 1.83 https://github.com/rust-lang/rust/pull/130025
#![allow(missing_docs, reason = "We have many as-yet undocumented items.")]
#![expect(
    missing_debug_implementations,
    clippy::cast_possible_truncation,
    clippy::missing_assert_message,
    reason = "Deferred"
)]
#![allow(
    clippy::todo,
    unreachable_pub,
    unnameable_types,
    reason = "Deferred, only apply in some feature sets so not expect"
)]

mod debug;
mod recording;
mod render;
mod scene;
mod shaders;
#[cfg(feature = "wgpu")]
mod sub_library;

#[cfg(feature = "wgpu")]
pub mod util;
#[cfg(feature = "wgpu")]
mod wgpu_engine;

#[cfg(feature = "wgpu")]
pub use sub_library::{SubHandle, SubLibrary, ZonePatchGpu};

pub mod low_level {
    //! Utilities which can be used to create an alternative Vello renderer to [`Renderer`][crate::Renderer].
    //!
    //! These APIs have not been carefully designed, and might not be powerful enough for this use case.

    pub use crate::debug::DebugLayers;
    pub use crate::recording::{
        BindType, BufferProxy, Command, ImageFormat, ImageProxy, Recording, ResourceId,
        ResourceProxy, ShaderId,
    };
    pub use crate::render::Render;
    pub use crate::shaders::FullShaders;
    /// Temporary export, used in `with_winit` for stats
    pub use vello_encoding::BumpAllocators;
}
/// Styling and composition primitives.
pub use peniko;
/// 2D geometry, with a focus on curves.
pub use peniko::kurbo;

#[cfg(feature = "wgpu")]
use peniko::ImageData;
#[cfg(feature = "wgpu")]
pub use wgpu;

pub use scene::{DrawGlyphs, Scene};
pub use vello_encoding::{Glyph, NormalizedCoord};

use low_level::ShaderId;
#[cfg(feature = "wgpu")]
use low_level::{BumpAllocators, FullShaders, Recording, Render, ResourceProxy};
use thiserror::Error;

#[cfg(feature = "wgpu")]
use debug::DebugLayers;
#[cfg(feature = "wgpu")]
use vello_encoding::{Layout, Resolver};
#[cfg(feature = "wgpu")]
use wgpu_engine::{ExternalResource, WgpuEngine};

#[cfg(feature = "wgpu")]
use std::collections::HashMap;

#[cfg(feature = "wgpu")]
use std::{num::NonZeroUsize, sync::atomic::AtomicBool};
#[cfg(feature = "wgpu")]
use wgpu::{Device, Queue, TextureView};
#[cfg(all(feature = "wgpu", feature = "wgpu-profiler"))]
use wgpu_profiler::{GpuProfiler, GpuProfilerSettings};

/// Represents the anti-aliasing method to use during a render pass.
///
/// Can be configured for a render operation by setting [`RenderParams::antialiasing_method`].
/// Each value of this can only be used if the corresponding field on [`AaSupport`] was used.
///
/// This can be converted into an `AaSupport` using [`Iterator::collect`],
/// as `AaSupport` implements `FromIterator`.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum AaConfig {
    /// Area anti-aliasing, where the alpha value for a pixel is computed from integrating
    /// the winding number over its square area.
    ///
    /// This technique produces very accurate values when the shape has winding number of 0 or 1
    /// everywhere, but can result in conflation artifacts otherwise.
    /// It generally has better performance than the multi-sampling methods.
    ///
    /// Can only be used if [enabled][AaSupport::area] for the `Renderer`.
    Area,
    /// 8x Multisampling
    ///
    /// Can only be used if [enabled][AaSupport::msaa8] for the `Renderer`.
    Msaa8,
    /// 16x Multisampling
    ///
    /// Can only be used if [enabled][AaSupport::msaa16] for the `Renderer`.
    Msaa16,
}

/// Represents the set of anti-aliasing configurations to enable during pipeline creation.
///
/// This is configured at `Renderer` creation time ([`Renderer::new`]) by setting
/// [`RendererOptions::antialiasing_support`].
///
/// This can be created from a set of `AaConfig` using [`Iterator::collect`],
/// as `AaSupport` implements `FromIterator`.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub struct AaSupport {
    /// Support [`AaConfig::Area`].
    pub area: bool,
    /// Support [`AaConfig::Msaa8`].
    pub msaa8: bool,
    /// Support [`AaConfig::Msaa16`].
    pub msaa16: bool,
}

impl AaSupport {
    /// Support every anti-aliasing method.
    ///
    /// This might increase startup time, as more shader variations must be compiled.
    pub fn all() -> Self {
        Self {
            area: true,
            msaa8: true,
            msaa16: true,
        }
    }

    /// Support only [`AaConfig::Area`].
    ///
    /// This should be the default choice for most users.
    pub fn area_only() -> Self {
        Self {
            area: true,
            msaa8: false,
            msaa16: false,
        }
    }
}

impl FromIterator<AaConfig> for AaSupport {
    fn from_iter<T: IntoIterator<Item = AaConfig>>(iter: T) -> Self {
        let mut result = Self {
            area: false,
            msaa8: false,
            msaa16: false,
        };
        for config in iter {
            match config {
                AaConfig::Area => result.area = true,
                AaConfig::Msaa8 => result.msaa8 = true,
                AaConfig::Msaa16 => result.msaa16 = true,
            }
        }
        result
    }
}

/// Errors that can occur in Vello.
#[derive(Error, Debug)]
#[non_exhaustive]
pub enum Error {
    /// There is no available device with the features required by Vello.
    #[cfg(feature = "wgpu")]
    #[error("Couldn't find suitable device")]
    NoCompatibleDevice,
    /// Failed to create surface.
    /// See [`wgpu::CreateSurfaceError`] for more information.
    #[cfg(feature = "wgpu")]
    #[error("Couldn't create wgpu surface")]
    WgpuCreateSurfaceError(#[from] wgpu::CreateSurfaceError),
    /// Surface doesn't support the required texture formats.
    /// Make sure that you have a surface which provides one of
    /// [`TextureFormat::Rgba8Unorm`][wgpu::TextureFormat::Rgba8Unorm]
    /// or [`TextureFormat::Bgra8Unorm`][wgpu::TextureFormat::Bgra8Unorm] as texture formats.
    // TODO: Why does this restriction exist?
    #[cfg(feature = "wgpu")]
    #[error("Couldn't find `Rgba8Unorm` or `Bgra8Unorm` texture formats for surface")]
    UnsupportedSurfaceFormat,

    /// Used a buffer inside a recording while it was not available.
    /// Check if you have created it and not freed before its last usage.
    #[cfg(feature = "wgpu")]
    #[error("Buffer '{0}' is not available but used for {1}")]
    UnavailableBufferUsed(&'static str, &'static str),
    /// Failed to async map a buffer.
    /// See [`wgpu::BufferAsyncError`] for more information.
    #[cfg(feature = "wgpu")]
    #[error("Failed to async map a buffer")]
    BufferAsyncError(#[from] wgpu::BufferAsyncError),
    /// Failed to download an internal buffer for debug visualization.
    #[cfg(feature = "wgpu")]
    #[cfg(feature = "debug_layers")]
    #[error("Failed to download internal buffer '{0}' for visualization")]
    DownloadError(&'static str),

    #[cfg(feature = "wgpu")]
    #[error("wgpu Error from scope")]
    WgpuErrorFromScope(#[from] wgpu::Error),

    /// Failed to create [`GpuProfiler`].
    /// See [`wgpu_profiler::CreationError`] for more information.
    #[cfg(feature = "wgpu-profiler")]
    #[error("Couldn't create wgpu profiler")]
    #[doc(hidden)] // End-users of Vello should not have `wgpu-profiler` enabled.
    ProfilerCreationError(#[from] wgpu_profiler::CreationError),

    /// Failed to compile the shaders.
    #[cfg(feature = "hot_reload")]
    #[error("Failed to compile shaders:\n{0}")]
    #[doc(hidden)] // End-users of Vello should not have `hot_reload` enabled.
    ShaderCompilation(#[from] vello_shaders::compile::ErrorVec),
}

#[cfg_attr(
    not(feature = "wgpu"),
    expect(dead_code, reason = "this can be unused when wgpu feature is not used")
)]
pub(crate) type Result<T, E = Error> = std::result::Result<T, E>;

/// Renders a scene into a texture or surface.
///
/// Currently, each renderer only supports a single surface format, if it
/// supports drawing to surfaces at all.
/// This is an assumption which is known to be limiting, and is planned to change.
#[cfg(feature = "wgpu")]
pub struct Renderer {
    #[cfg_attr(
        not(feature = "hot_reload"),
        expect(
            dead_code,
            reason = "Options are only used to reinitialise on a hot reload"
        )
    )]
    options: RendererOptions,
    engine: WgpuEngine,
    resolver: Resolver,
    shaders: FullShaders,
    /// DOFUS retained path: caller-owned, GPU-resident packed scene buffers keyed by
    /// a [`ReuseToken`]. Lives on `Renderer` (not `WgpuEngine`) so a resident buffer
    /// can be borrowed immutably while `&mut self.engine.run_recording` runs (disjoint
    /// fields). See [`Renderer::run_reuse_full`] / [`run_reuse_transforms`].
    reused_scene_bufs: HashMap<u64, ReusedScene>,
    /// DOFUS Tier 7: GPU-resident sub-library, owned by the renderer.
    /// Bound at run time via [`ExternalResource::Buffer`] to the synthetic
    /// proxy minted by the slab-expand dispatch. `None` only on CPU /
    /// non-wgpu builds (init failures); on wgpu builds it is eagerly
    /// allocated in [`Renderer::new`] so callers can call
    /// [`Renderer::intern_sub`] immediately.
    sub_library: Option<SubLibrary>,
    /// DOFUS persistent image atlas: the proxy reused across renders so the
    /// atlas texture (and `WgpuEngine::image_residency`) survive between
    /// frames. `None` until the first render that has images; reallocated
    /// (new id) only when the atlas must grow. Shared by every render through
    /// this renderer; bands benefit because consecutive band re-renders keep
    /// the same tile bitmaps resident and skip re-upload.
    image_atlas: Option<recording::ImageProxy>,
    /// DOFUS slab: device handle for creating the persistent pinned
    /// textures lazily at intern time.
    device: Device,
    /// DOFUS slab pinned-image atlas: persistent texture mirroring the
    /// resolver `ImageCache`'s pinned slots. Written incrementally at
    /// intern time (`queue.write_texture` per new pin) and bound at
    /// replay via `ExternalResource::Image` — slab band recordings carry
    /// NO texture uploads (re-recording the full pinned atlas every
    /// frame halved the frame rate when tried).
    slab_atlas_tex: Option<(wgpu::Texture, wgpu::TextureView)>,
    /// DOFUS slab ramps: persistent 512-wide texture mirroring the
    /// `RampCache` rows. New rows append at intern time; the third field
    /// is the allocated row capacity.
    slab_ramps_tex: Option<(wgpu::Texture, wgpu::TextureView, u32)>,
    /// Rows already uploaded into `slab_ramps_tex`. Reset together with
    /// the ramp cache on `reset_slab_interns`.
    slab_ramps_rows_uploaded: u32,
    #[cfg(feature = "debug_layers")]
    debug: debug::DebugRenderer,
    #[cfg(feature = "wgpu-profiler")]
    #[doc(hidden)] // End-users of Vello should not have `wgpu-profiler` enabled.
    /// The profiler used with events for this renderer. This is *not* treated as public API.
    pub profiler: GpuProfiler,
    #[cfg(feature = "wgpu-profiler")]
    #[doc(hidden)] // End-users of Vello should not have `wgpu-profiler` enabled.
    /// The results from profiling. This is *not* treated as public API.
    pub profile_result: Option<Vec<wgpu_profiler::GpuTimerQueryResult>>,
}
// This is not `Send` (or `Sync`) on WebAssembly as the
// underlying wgpu types are not. This can be enabled with the
// `fragile-send-sync-non-atomic-wasm` feature in wgpu.
// See https://github.com/gfx-rs/wgpu/discussions/4127 for
// further discussion of this topic.
#[cfg(all(feature = "wgpu", not(target_arch = "wasm32")))]
static_assertions::assert_impl_all!(Renderer: Send);

// ── DOFUS retained-scene types ────────────────────────────────────────────────

/// Identifies a GPU-resident packed scene buffer across frames (e.g. a crowd batch
/// index). Passed to [`Renderer::run_reuse_full`] / [`run_reuse_transforms`] /
/// [`free_reused`].
#[cfg(feature = "wgpu")]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct ReuseToken(pub u64);

/// Output of [`Renderer::resolve_scene_reuse`]: a recording whose scene buffer is
/// *not* embedded (it is bound externally), plus everything needed to keep that
/// buffer GPU-resident and re-upload only its transform sub-range on later frames.
#[cfg(feature = "wgpu")]
pub struct ResolvedReuse {
    /// Replayable recording. The scene buffer is referenced by `scene_buf`'s id and
    /// supplied via `ExternalResource::Buffer` on every run.
    pub recording: Recording,
    /// The fine-stage output image proxy (bound to the render target each run).
    pub out_image: ResourceProxy,
    /// The scene buffer proxy whose id the resident buffer must be bound to.
    pub scene_buf: ResourceProxy,
    /// Packed-buffer layout — gives the transform byte-range to re-upload.
    pub layout: Layout,
    /// Full packed scene bytes (geometry + color + transforms). Sliced
    /// `[transform_base*4 .. style_base*4]` for the first full upload's transforms.
    pub packed: Vec<u8>,
    /// DOFUS Tier 7: synthetic proxy the slab-expand dispatch references.
    /// `Some` when the encoding emitted a slab dispatch; the
    /// `reuse_replay` family binds the renderer's sub-library buffer to
    /// this proxy id via `ExternalResource::Buffer`.
    pub sub_library_proxy: Option<low_level::BufferProxy>,
    /// Content hash over the geometry the narrow-write fast path does
    /// NOT rewrite. For slabbed encodings this is the host streams of
    /// the source encoding (typically just the slab marker — the gap
    /// bytes are GPU-derived from the narrow-written tables, and
    /// `resolve_slabbed` asserts no late-bound patches); hashing the
    /// packed buffer instead would walk megabytes of resolver-zeroed
    /// gap every frame. Non-slab encodings keep the packed-buffer hash,
    /// which also covers resolver patch substitutions (atlas xy / ramp
    /// ids written into the packed copy, not the encoding).
    pub geometry_hash: u64,
    /// DOFUS Tier 7: `(gradient, atlas)` proxies the replay must bind to
    /// the renderer's persistent pinned ramp/atlas textures via
    /// `ExternalResource::Image`. `Some` only for slabbed encodings.
    pub slab_image_proxies: Option<(low_level::ImageProxy, low_level::ImageProxy)>,
}

#[cfg(feature = "wgpu")]
impl ResolvedReuse {
    /// Byte offset of the transform stream within the packed scene buffer.
    pub fn transform_offset(&self) -> u64 {
        self.layout.transform_base as u64 * 4
    }
    /// Byte length of the transform stream within the packed scene buffer.
    pub fn transform_len(&self) -> u64 {
        (self.layout.style_base - self.layout.transform_base) as u64 * 4
    }
}

/// A GPU-resident packed scene buffer plus the bookkeeping needed for partial
/// (transform-only) re-uploads.
#[cfg(feature = "wgpu")]
struct ReusedScene {
    buffer: wgpu::Buffer,
    /// Byte offset of the transform region.
    transform_off: u64,
    /// Structure fingerprint
    /// `(transform_base, style_base, packed_len, geometry_hash)`.
    ///
    /// `geometry_hash` (see [`hash_geometry`]) covers path_tags, path_data,
    /// draw_tags, draw_data, transforms and styles — everything before the
    /// per-frame slab/instance regions. Without it, two frames with
    /// identical `(transform_base, style_base, packed_len)` but different
    /// geometry OR transform bytes (an animated/rotating tile) keep the
    /// fast path while the GPU holds the previous frame's geometry. The
    /// hash forces a `reuse_full` whenever those bytes shift, while staying
    /// constant for actor slab content (whose host streams are GPU-filled
    /// gaps), so actors keep the transform-only fast path.
    fingerprint: (u32, u32, usize, u64),
}

/// Resolve a sub's vello-level patches (`Patch::Ramp`, `Patch::Image`)
/// into a private clone of its encoding. Pinned ramp ids / atlas xys are
/// allocated against `resolver`'s caches so they survive `maintain()` /
/// `clear()`. Returns `None` if the sub contains an unsupported patch
/// (currently `Patch::GlyphRun`); callers should fall back to the empty
/// sentinel in that case.
#[cfg(feature = "wgpu")]
fn resolve_sub_patches(
    resolver: &mut Resolver,
    sub: &std::sync::Arc<vello_encoding::Encoding>,
) -> Option<(vello_encoding::Encoding, Vec<(peniko::ImageData, u32, u32)>)> {
    use vello_encoding::Patch;
    let mut resolved = vello_encoding::Encoding::clone(sub.as_ref());
    // Images pinned for the FIRST time by this sub — the caller uploads
    // their pixels into the persistent slab atlas texture right away.
    let mut new_pins: Vec<(peniko::ImageData, u32, u32)> = Vec::new();
    for patch in &sub.resources.patches {
        match patch {
            Patch::Ramp {
                draw_data_offset,
                stops,
                extend,
            } => {
                let stops_slice = &sub.resources.color_stops[stops.clone()];
                let ramp_id = resolver.ramp_cache_mut().add_pinned(stops_slice);
                let resolved_word = (ramp_id << 2) | (*extend as u32);
                if let Some(slot) = resolved.draw_data.get_mut(*draw_data_offset) {
                    *slot = resolved_word;
                }
            }
            Patch::Image {
                draw_data_offset,
                image,
            } => {
                let before = resolver.image_cache_mut().pinned_count();
                let Some((x, y)) = resolver.image_cache_mut().add_pinned_image(image) else {
                    // Atlas full; zero the slot so the GPU sees a no-op.
                    if let Some(slot) = resolved.draw_data.get_mut(*draw_data_offset) {
                        *slot = 0;
                    }
                    continue;
                };
                if resolver.image_cache_mut().pinned_count() > before {
                    new_pins.push((image.clone(), x, y));
                }
                let packed = (x << 16) | y;
                if let Some(slot) = resolved.draw_data.get_mut(*draw_data_offset) {
                    *slot = packed;
                }
            }
            Patch::GlyphRun { .. } => {
                return None;
            }
        }
    }
    resolved.resources.patches.clear();
    Some((resolved, new_pins))
}

/// Upload newly pinned images into the persistent slab atlas texture at
/// their pinned coordinates. Created lazily at the cache's atlas size on
/// first use; pinned coordinates never move, so each image uploads once.
#[cfg(feature = "wgpu")]
fn upload_slab_pins(
    device: &Device,
    queue: &Queue,
    atlas_tex: &mut Option<(wgpu::Texture, wgpu::TextureView)>,
    atlas_size: u32,
    new_pins: &[(peniko::ImageData, u32, u32)],
) {
    if new_pins.is_empty() {
        return;
    }
    let (texture, _) = atlas_tex.get_or_insert_with(|| {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("slab_pinned_atlas"),
            size: wgpu::Extent3d {
                width: atlas_size,
                height: atlas_size,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        (texture, view)
    });
    for (image, x, y) in new_pins {
        if image.data.is_empty() {
            log::warn!(
                "slab pin upload skipped: empty image data (id {})",
                image.data.id()
            );
            continue;
        }
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture,
                mip_level: 0,
                origin: wgpu::Origin3d { x: *x, y: *y, z: 0 },
                aspect: wgpu::TextureAspect::All,
            },
            image.data.data(),
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(image.width * 4),
                rows_per_image: None,
            },
            wgpu::Extent3d {
                width: image.width,
                height: image.height,
                depth_or_array_layers: 1,
            },
        );
    }
}

/// Append newly added ramp rows into the persistent slab ramps texture
/// (512 texels wide, one row per ramp, matching the per-render gradient
/// texture layout). Pinned rows are append-only, so the incremental
/// upload covers everything slab subs can reference; unpinned rows that
/// the cache later overwrites in place are never referenced by interned
/// subs and may go stale here harmlessly.
#[cfg(feature = "wgpu")]
fn refresh_slab_ramps(
    device: &Device,
    queue: &Queue,
    ramps_tex: &mut Option<(wgpu::Texture, wgpu::TextureView, u32)>,
    rows_uploaded: &mut u32,
    ramps: vello_encoding::Ramps<'_>,
) {
    let rows = ramps.height;
    if rows <= *rows_uploaded && ramps_tex.is_some() {
        return;
    }
    let needs_realloc = match ramps_tex.as_ref() {
        Some((_, _, capacity)) => rows > *capacity,
        None => true,
    };
    if needs_realloc {
        let capacity = rows.next_multiple_of(512).max(512);
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("slab_pinned_ramps"),
            size: wgpu::Extent3d {
                width: ramps.width.max(1),
                height: capacity,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        *ramps_tex = Some((texture, view, capacity));
        *rows_uploaded = 0;
    }
    let Some((texture, _, _)) = ramps_tex.as_ref() else {
        return;
    };
    if rows == 0 {
        return;
    }
    let start = *rows_uploaded;
    let data: &[u8] = bytemuck::cast_slice(ramps.data);
    let row_bytes = ramps.width as usize * 4;
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture,
            mip_level: 0,
            origin: wgpu::Origin3d {
                x: 0,
                y: start,
                z: 0,
            },
            aspect: wgpu::TextureAspect::All,
        },
        &data[start as usize * row_bytes..rows as usize * row_bytes],
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(ramps.width * 4),
            rows_per_image: None,
        },
        wgpu::Extent3d {
            width: ramps.width,
            height: rows - start,
            depth_or_array_layers: 1,
        },
    );
    *rows_uploaded = rows;
}

/// FNV-1a 64-bit hash over the geometry+transform+style streams of a
/// packed scene buffer — path_tags, path_data, draw_tags, draw_data,
/// transforms, styles, i.e. everything BEFORE the per-frame slab/instance
/// regions (which the narrow write owns and which must not feed the
/// fingerprint).
///
/// Used by `prepare_reuse` and `reuse_structure_matches`. For slab (actor)
/// content these streams are stable GPU-filled gaps, so the hash is
/// constant across frames and the transform-only fast path fires. For
/// appended content (animated tiles) ANY geometry or transform shift moves
/// the hash and forces a `reuse_full`, so the GPU never replays stale
/// geometry. The earlier path_data-only hash missed pure-rotation tiles
/// (same path_data, different transform) — they kept the fast path and
/// rendered as a ~20× twip-scale blob.
///
/// FNV-1a is inlined so vello pulls in no hash dependency; it runs at
/// ~1.5 GB/s and the gaps it walks are mostly zeros, so the per-band cost
/// stays within budget.
#[cfg(feature = "wgpu")]
/// Content hash over a slabbed encoding's HOST streams only. The packed
/// buffer's geometry regions are these bytes plus the per-block gap
/// reservations — and the gaps are written on-GPU each frame from the
/// narrow-written descriptor/aux tables, so they carry no host content
/// to fingerprint. A slab band's host streams are typically a single
/// marker byte, making this effectively free where [`hash_geometry`]
/// walked megabytes of resolver-zeroed gap. Only valid for encodings
/// without late-bound patches (`resolve_slabbed` asserts that).
fn hash_host_streams(encoding: &vello_encoding::Encoding) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    let mut fold = |bytes: &[u8]| {
        for &b in bytes {
            h ^= u64::from(b);
            h = h.wrapping_mul(0x100000001b3);
        }
    };
    fold(bytemuck::cast_slice(&encoding.path_tags));
    fold(bytemuck::cast_slice(&encoding.path_data));
    fold(bytemuck::cast_slice(&encoding.draw_tags));
    fold(bytemuck::cast_slice(&encoding.draw_data));
    fold(bytemuck::cast_slice(&encoding.transforms));
    fold(bytemuck::cast_slice(&encoding.styles));
    h
}

fn hash_geometry(layout: &Layout, packed: &[u8]) -> u64 {
    let start = layout.path_tag_base as usize * 4;
    // First byte of the per-frame-mutated slab/instance regions; the
    // narrow write rewrites everything from here on, so it must stay out
    // of the fingerprint (else actors that move would full-rebuild every
    // frame). Zero-valued bases mean "region absent".
    let mut end = packed.len();
    for base_words in [
        layout.instance_transforms_base,
        layout.instance_color_overlays_base,
        layout.instance_blocks_base,
        layout.descriptor_slab_base,
        layout.aux_slab_base,
        layout.slab_blocks_base,
    ] {
        let b = base_words as usize * 4;
        if b > start && b < end {
            end = b;
        }
    }
    let bytes = &packed[start..end.min(packed.len())];
    let mut h: u64 = 0xcbf29ce484222325;
    // Hash one u64 at a time for throughput; trailing tail handled byte-wise.
    let (chunks, tail) = bytes.as_chunks::<8>();
    for chunk in chunks {
        h ^= u64::from_le_bytes(*chunk);
        h = h.wrapping_mul(0x100000001b3);
    }
    for &b in tail {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

/// Parameters used in a single render that are configurable by the client.
///
/// These are used in [`Renderer::render_to_texture`].
pub struct RenderParams {
    /// The background color applied to the target. This value is only applicable to the full
    /// pipeline.
    pub base_color: peniko::Color,

    /// Dimensions of the rasterization target
    pub width: u32,
    pub height: u32,

    /// The anti-aliasing algorithm. The selected algorithm must have been initialized while
    /// constructing the `Renderer`.
    pub antialiasing_method: AaConfig,
}

#[cfg(feature = "wgpu")]
/// Options which are set at renderer creation time, used in [`Renderer::new`].
pub struct RendererOptions {
    /// If true, run all stages up to fine rasterization on the CPU.
    ///
    /// This is not a recommended configuration as it is expected to have poor performance,
    /// but it can be useful for debugging.
    // TODO: Consider evolving this so that the CPU stages can be configured dynamically via
    // `RenderParams`.
    pub use_cpu: bool,

    /// Represents the enabled set of AA configurations. This will be used to determine which
    /// pipeline permutations should be compiled at startup.
    ///
    /// By default this will be all modes, to support the widest range of.
    /// It is recommended that most users configure this.
    pub antialiasing_support: AaSupport,

    /// How many threads to use for initialisation of shaders.
    ///
    /// Use `Some(1)` to use a single thread. This is recommended when on macOS
    /// (see <https://github.com/bevyengine/bevy/pull/10812#discussion_r1496138004>)
    ///
    /// Set to `None` to use a heuristic which will use many but not all threads
    ///
    /// Has no effect on WebAssembly
    ///
    /// Will default to `None` on most platforms, `Some(1)` on macOS.
    pub num_init_threads: Option<NonZeroUsize>,

    /// The pipeline cache to use when creating the shaders.
    ///
    /// For much more discussion of expected usage patterns, see the documentation on that type.
    pub pipeline_cache: Option<wgpu::PipelineCache>,
}

#[cfg(feature = "wgpu")]
impl Default for RendererOptions {
    fn default() -> Self {
        Self {
            use_cpu: false,
            antialiasing_support: AaSupport::all(),
            #[cfg(target_os = "macos")]
            num_init_threads: NonZeroUsize::new(1),
            #[cfg(not(target_os = "macos"))]
            num_init_threads: None,
            pipeline_cache: None,
        }
    }
}

#[cfg(feature = "wgpu")]
struct RenderResult {
    bump: Option<BumpAllocators>,
    #[cfg(feature = "debug_layers")]
    captured: Option<render::CapturedBuffers>,
}

#[cfg(feature = "wgpu")]
impl Renderer {
    /// Creates a new renderer for the specified device.
    pub fn new(device: &Device, options: RendererOptions) -> Result<Self> {
        let mut engine = WgpuEngine::new(options.use_cpu, options.pipeline_cache.clone());
        // If we are running in parallel (i.e. the number of threads is not 1)
        if options.num_init_threads != NonZeroUsize::new(1) {
            #[cfg(not(target_arch = "wasm32"))]
            engine.use_parallel_initialisation();
        }
        let shaders = shaders::full_shaders(device, &mut engine, &options)?;
        #[cfg(not(target_arch = "wasm32"))]
        engine.build_shaders_if_needed(device, options.num_init_threads);
        #[cfg(feature = "debug_layers")]
        let debug = debug::DebugRenderer::new(device, wgpu::TextureFormat::Rgba8Unorm, &mut engine);

        let sub_library = Some(SubLibrary::new(device, 64 * 1024 * 1024));
        Ok(Self {
            options,
            engine,
            resolver: Resolver::new(),
            shaders,
            reused_scene_bufs: HashMap::new(),
            sub_library,
            image_atlas: None,
            device: device.clone(),
            slab_atlas_tex: None,
            slab_ramps_tex: None,
            slab_ramps_rows_uploaded: 0,
            #[cfg(feature = "debug_layers")]
            debug,
            #[cfg(feature = "wgpu-profiler")]
            profiler: GpuProfiler::new(device, GpuProfilerSettings::default())?,
            #[cfg(feature = "wgpu-profiler")]
            profile_result: None,
        })
    }

    /// DOFUS Tier 7: intern `sub` into the renderer-owned SubLibrary,
    /// resolving any vello-level patches (`Patch::Ramp`, `Patch::Image`)
    /// against the renderer's resolver caches. The resolved bytes are
    /// packed into the SubLibrary at first sight; subsequent calls with
    /// the same `Arc<Encoding>` identity + `zone_patches` hash return
    /// the cached handle.
    ///
    /// `Patch::GlyphRun` is not supported in slab subs; if encountered
    /// the function returns the empty-sub sentinel (offset 0). Caller
    /// can detect this via `SubHandle::offset == 0`.
    ///
    /// `zone_patches` are an optional inline array of per-zone
    /// recolor patches that get applied at GPU dispatch time (used by
    /// player-color body strips).
    pub fn intern_sub(
        &mut self,
        queue: &Queue,
        sub: &std::sync::Arc<vello_encoding::Encoding>,
        zone_patches: &[ZonePatchGpu],
    ) -> SubHandle {
        let Some(library) = self.sub_library.as_mut() else {
            return bytemuck::Zeroable::zeroed();
        };
        // Warm path: already interned under this identity + patch set.
        // Must come before patch resolution — resolving clones the full
        // encoding, and compose calls this for every emit every frame.
        // After this check `sublibrary.intern_count` counts misses only.
        if let Some(handle) = library.lookup(sub, zone_patches) {
            return handle;
        }
        // Fast path: no vello patches → pack the sub as-is.
        if sub.resources.patches.is_empty() {
            return library.intern_with_patches(queue, sub, zone_patches);
        }
        // Resolve vello patches into a private clone, then intern the
        // resolved bytes keyed on the original Arc's identity. The
        // resolver's ramp/image caches use pinned entries so the
        // resolved `ramp_id` / atlas xy stay valid across frames.
        let resolved = resolve_sub_patches(&mut self.resolver, sub);
        if let Some((resolved, new_pins)) = resolved {
            upload_slab_pins(
                &self.device,
                queue,
                &mut self.slab_atlas_tex,
                self.resolver.image_cache_mut().atlas_size(),
                &new_pins,
            );
            refresh_slab_ramps(
                &self.device,
                queue,
                &mut self.slab_ramps_tex,
                &mut self.slab_ramps_rows_uploaded,
                self.resolver.ramp_cache_mut().ramps(),
            );
            library.intern_with_resolved(queue, sub, &resolved, zone_patches)
        } else {
            // Resolution failed (e.g., GlyphRun present); return sentinel.
            library.sentinel()
        }
    }

    /// DOFUS: like [`Self::intern_sub`] but packs the bytes WITHOUT pinning
    /// an `Arc<Encoding>` in the library (no `by_ptr` entry). The crowd's
    /// compact path dedups looks by its own stable key and never
    /// re-interns or recycles, so the ABA guard `intern_sub` needs is dead
    /// weight there — pinning an `Arc` per unique look leaked tens of KB
    /// each and was the dominant heap cost at hundreds of distinct actors.
    /// Caller MUST guarantee it never interns the same look twice.
    pub fn intern_sub_transient(
        &mut self,
        queue: &Queue,
        enc: &vello_encoding::Encoding,
        zone_patches: &[ZonePatchGpu],
    ) -> SubHandle {
        let Some(library) = self.sub_library.as_mut() else {
            return bytemuck::Zeroable::zeroed();
        };
        if enc.resources.patches.is_empty() {
            return library.intern_transient(queue, enc, zone_patches);
        }
        // Patches present (gradient/image fills): resolve into a private
        // clone — the temp `Arc` is only for the resolver API and is
        // dropped here; nothing is pinned beyond the packed bytes.
        let tmp = std::sync::Arc::new(enc.clone());
        let resolved = resolve_sub_patches(&mut self.resolver, &tmp);
        if let Some((resolved, new_pins)) = resolved {
            upload_slab_pins(
                &self.device,
                queue,
                &mut self.slab_atlas_tex,
                self.resolver.image_cache_mut().atlas_size(),
                &new_pins,
            );
            refresh_slab_ramps(
                &self.device,
                queue,
                &mut self.slab_ramps_tex,
                &mut self.slab_ramps_rows_uploaded,
                self.resolver.ramp_cache_mut().ramps(),
            );
            library.intern_transient(queue, &resolved, zone_patches)
        } else {
            library.sentinel()
        }
    }

    /// Clone of the SubLibrary's GPU buffer handle. `wgpu::Buffer` is
    /// internally Arc'd so the clone is cheap; returning owned breaks
    /// the borrow chain with `&mut self.engine.run_recording` in the
    /// dispatch sites.
    pub fn sub_library_buffer(&self) -> Option<wgpu::Buffer> {
        self.sub_library.as_ref().map(|l| l.buffer().clone())
    }

    /// Per-frame counter reset on the SubLibrary. Call once per frame
    /// before compose interns begin.
    pub fn sub_library_frame_step(&mut self) {
        if let Some(library) = self.sub_library.as_mut() {
            library.frame_step();
        }
    }

    /// DOFUS: drop every slab intern plus the pinned ramp/image cache
    /// entries their packed bytes reference. Call on map change BEFORE
    /// composing the new map's first frame: pinned atlas slots and ramp
    /// rows are append-only within a map, so without this reset a long
    /// session fills the pinned atlas and new tile bitmaps fail to pin
    /// (they render blank). Subs re-intern on first sight afterwards.
    pub fn reset_slab_interns(&mut self) {
        if let Some(library) = self.sub_library.as_mut() {
            library.reset();
        }
        self.resolver.image_cache_mut().reset_pinned();
        self.resolver.ramp_cache_mut().reset();
        // Persistent textures stay allocated; fresh pins overwrite their
        // regions. Row bookkeeping restarts with the cleared ramp cache.
        self.slab_ramps_rows_uploaded = 0;
    }

    /// Read-only access to the SubLibrary for telemetry.
    pub fn sub_library_stats(&self) -> Option<&SubLibrary> {
        self.sub_library.as_ref()
    }

    /// DOFUS diagnostics: image-atlas working-set stats from the most
    /// recent `resolve` (images re-packed + GPU-re-uploaded this band
    /// render). `total_bytes` scales 4× with HiDPI-upscaled tile bitmaps.
    pub fn last_image_stats(&self) -> vello_encoding::ImageResolveStats {
        self.resolver.last_image_stats()
    }

    /// DOFUS measurement (`gpu-timing` feature): GPU time in ms of the most
    /// recent `instance_expand_slab` pre-pass dispatch, via pass-boundary
    /// timestamp queries. Lags ~1 frame; `None` until the first async
    /// readback lands or when no slab dispatch has run.
    #[cfg(feature = "gpu-timing")]
    pub fn last_slab_prepass_ms(&self) -> Option<f64> {
        self.engine.slab_timing_debug().and_then(|d| d.prepass_ms)
    }

    /// Per-pass GPU breakdown of the slab band recording:
    /// `(prepass_ms, total_ms, [(shader_label, ms)…], dispatches, readbacks)`.
    /// Labels keep their `vello.` prefix. Lags ~1 frame.
    #[cfg(feature = "gpu-timing")]
    #[allow(clippy::type_complexity)]
    pub fn slab_prepass_debug(
        &self,
    ) -> Option<(Option<f64>, f64, Vec<(&'static str, f64)>, u64, u64)> {
        self.engine.slab_timing_debug().map(|d| {
            (
                d.prepass_ms,
                d.total_ms,
                d.breakdown,
                d.dispatched,
                d.drained,
            )
        })
    }

    /// Renders a scene to the target texture.
    ///
    /// The texture is assumed to be of the specified dimensions and have been created with
    /// the [`wgpu::TextureFormat::Rgba8Unorm`] format and the [`wgpu::TextureUsages::STORAGE_BINDING`]
    /// flag set.
    ///
    /// If you want to render Vello content to a surface (such as in a UI toolkit), you have two options:
    /// 1) Render to an intermediate texture, which is the same size as the surface.
    ///    You would then use [`TextureBlitter`][wgpu::util::TextureBlitter] to blit the rendered result from
    ///    that texture to the surface.
    ///    This pattern is supported by the [`util`] module.
    /// 2) Call `render_to_texture` directly on the [`SurfaceTexture`][wgpu::SurfaceTexture]'s texture, if
    ///    it has the right usages. This should generally be avoided, as some GPUs assume that you will not
    ///    be rendering to the surface using a compute pipeline, and optimise accordingly.
    pub fn render_to_texture(
        &mut self,
        device: &Device,
        queue: &Queue,
        scene: &Scene,
        texture: &TextureView,
        params: &RenderParams,
    ) -> Result<()> {
        let (recording, target, sub_lib_proxy) = render::render_full(
            scene,
            &mut self.resolver,
            &self.shaders,
            params,
            &mut self.image_atlas,
        );
        // DOFUS Tier 7: when the recording contains a slab-expand dispatch
        // its synthetic sub-library proxy must be bound to the caller-
        // owned buffer. A `None` proxy means no slab dispatch was emitted
        // and the binding can be skipped entirely.
        let img_res = ExternalResource::Image(*target.as_image().unwrap(), texture);
        match (sub_lib_proxy, self.sub_library_buffer()) {
            (Some(proxy), Some(buf)) => {
                let externals = [img_res, ExternalResource::Buffer(proxy, &buf)];
                self.engine.run_recording(
                    device,
                    queue,
                    &recording,
                    &externals,
                    "render_to_texture",
                    #[cfg(feature = "wgpu-profiler")]
                    &mut self.profiler,
                )?;
            }
            (Some(_), None) => {
                log::error!(
                    "render_to_texture: scene encoded slab blocks but the renderer has no SubLibrary (CPU init?); slab dispatch skipped."
                );
                let externals = [img_res];
                self.engine.run_recording(
                    device,
                    queue,
                    &recording,
                    &externals,
                    "render_to_texture",
                    #[cfg(feature = "wgpu-profiler")]
                    &mut self.profiler,
                )?;
            }
            (None, _) => {
                let externals = [img_res];
                self.engine.run_recording(
                    device,
                    queue,
                    &recording,
                    &externals,
                    "render_to_texture",
                    #[cfg(feature = "wgpu-profiler")]
                    &mut self.profiler,
                )?;
            }
        }
        // N.B. This is horrible; this integration of wgpu-profiler really needs some work...
        #[cfg(feature = "wgpu-profiler")]
        {
            self.profiler.end_frame().unwrap();
            if let Some(result) = self
                .profiler
                .process_finished_frame(queue.get_timestamp_period())
            {
                self.profile_result = Some(result);
            }
        }

        Ok(())
    }

    // ── DOFUS: split of `render_to_texture` into a CPU resolve + a GPU run,
    // so the expensive resolve (Scene → Recording — pure Rust, never touches
    // the device) can run in parallel on worker threads, while only the GPU
    // submit stays on the main thread. ──────────────────────────────────────

    /// Resolve a scene to a GPU `Recording` using THIS renderer's resolver.
    /// Pure CPU; no GPU access. Pair with [`run_resolved`](Self::run_resolved).
    ///
    /// Returns `(recording, target, sub_library_proxy)`. `sub_library_proxy`
    /// is `Some` iff the encoding emitted a slab-expand dispatch; the caller
    /// must hand it to [`run_resolved`](Self::run_resolved) so the renderer
    /// can bind its sub-library buffer to the right proxy id.
    pub fn resolve_scene(
        &mut self,
        scene: &Scene,
        params: &RenderParams,
    ) -> (Recording, ResourceProxy, Option<low_level::BufferProxy>) {
        render::render_full(
            scene,
            &mut self.resolver,
            &self.shaders,
            params,
            &mut self.image_atlas,
        )
    }

    /// Like [`resolve_scene`](Self::resolve_scene) but with an EXTERNAL
    /// resolver, so N scenes can resolve concurrently (one `Resolver` per
    /// thread). `shaders` is read-only/`Sync` — use [`shaders`](Self::shaders).
    pub fn resolve_with(
        scene: &Scene,
        resolver: &mut Resolver,
        shaders: &FullShaders,
        params: &RenderParams,
    ) -> (Recording, ResourceProxy, Option<low_level::BufferProxy>) {
        // Concurrent path with an external resolver (not used by the dofus
        // band render). No persistent atlas here — a throwaway per call.
        render::render_full(scene, resolver, shaders, params, &mut None)
    }

    /// The renderer's shared shader handles (read-only; `Sync`). Pass to
    /// [`resolve_with`](Self::resolve_with) on worker threads.
    pub fn shaders(&self) -> &FullShaders {
        &self.shaders
    }

    /// GPU half of `render_to_texture`: run a previously-resolved `Recording`
    /// into `texture`. Must run on the device's (main) thread.
    ///
    /// `sub_lib_proxy` mirrors the third tuple element of
    /// [`resolve_scene`](Self::resolve_scene) — pass `None` when the scene
    /// produced no slab-expand dispatch.
    pub fn run_resolved(
        &mut self,
        device: &Device,
        queue: &Queue,
        recording: &Recording,
        target: ResourceProxy,
        texture: &TextureView,
        sub_lib_proxy: Option<low_level::BufferProxy>,
    ) -> Result<()> {
        let img_res = ExternalResource::Image(*target.as_image().unwrap(), texture);
        match (sub_lib_proxy, self.sub_library_buffer()) {
            (Some(proxy), Some(buf)) => {
                let externals = [img_res, ExternalResource::Buffer(proxy, &buf)];
                self.engine.run_recording(
                    device,
                    queue,
                    recording,
                    &externals,
                    "render_to_texture",
                    #[cfg(feature = "wgpu-profiler")]
                    &mut self.profiler,
                )?;
            }
            (Some(_), None) => {
                log::error!(
                    "run_resolved: recording references a sub-library proxy but no sub-library buffer is set"
                );
                let externals = [img_res];
                self.engine.run_recording(
                    device,
                    queue,
                    recording,
                    &externals,
                    "render_to_texture",
                    #[cfg(feature = "wgpu-profiler")]
                    &mut self.profiler,
                )?;
            }
            (None, _) => {
                let externals = [img_res];
                self.engine.run_recording(
                    device,
                    queue,
                    recording,
                    &externals,
                    "render_to_texture",
                    #[cfg(feature = "wgpu-profiler")]
                    &mut self.profiler,
                )?;
            }
        }
        Ok(())
    }

    // ── DOFUS retained scene: persist the packed scene buffer on the GPU and
    // re-upload only the transform byte-range per frame. 95.7% of per-frame
    // scene bytes are static geometry+color; only ~4.3% (transforms) change. ──

    /// CPU resolve for the retained path. Like [`resolve_scene`](Self::resolve_scene)
    /// but the packed scene buffer is NOT uploaded inside the recording — instead the
    /// returned [`ResolvedReuse`] carries the proxy + layout + packed bytes so the
    /// caller can keep the buffer GPU-resident and re-upload only transforms.
    pub fn resolve_scene_reuse(&mut self, scene: &Scene, params: &RenderParams) -> ResolvedReuse {
        let (
            recording,
            out_image,
            scene_buf,
            layout,
            packed,
            sub_library_proxy,
            slab_image_proxies,
        ) = render::render_full_reuse(
            scene,
            &mut self.resolver,
            &self.shaders,
            params,
            &mut self.image_atlas,
        );
        let geometry_hash = if layout.n_slab_blocks > 0 {
            hash_host_streams(scene.encoding())
        } else {
            hash_geometry(&layout, &packed)
        };
        ResolvedReuse {
            recording,
            out_image,
            scene_buf,
            layout,
            packed,
            sub_library_proxy,
            geometry_hash,
            slab_image_proxies,
        }
    }

    /// (Re)create the resident scene buffer for `token` and full-upload `resolved.packed`.
    /// Does NOT render — pair with [`reuse_write`](Self::reuse_write) +
    /// [`reuse_replay`](Self::reuse_replay). Call on first sight of a structure and
    /// whenever the structure fingerprint changes (spawn/despawn/anim/dir change).
    pub fn prepare_reuse(
        &mut self,
        device: &Device,
        queue: &Queue,
        token: ReuseToken,
        resolved: &ResolvedReuse,
    ) {
        let scene_proxy = *resolved.scene_buf.as_buf().unwrap();
        // Grow-only buffer retention. For a moving crowd this full-prepare
        // path runs EVERY frame (the reuse_fast fingerprint never matches),
        // so allocating a fresh GPU buffer + dropping last frame's here was
        // a per-band, per-frame `create_buffer`/destroy — pure churn, and on
        // WASM/WebGPU each is a JS object that feeds V8 GC (the same class of
        // pause already eliminated for texture views). Reuse the resident
        // buffer whenever it's large enough; only (re)create when absent or
        // too small. The buffer is bound via `as_entire_binding`, and the
        // shaders only read the layout's valid prefix, so a larger-than-
        // needed resident buffer is safe — the stale tail past `packed.len()`
        // is never read. Sizes oscillate per frame as actors cross bands, so
        // grow-only settles at the working-set peak after warmup, then every
        // frame reuses (zero allocation).
        let buffer = match self.reused_scene_bufs.remove(&token.0) {
            Some(prev) if prev.buffer.size() >= scene_proxy.size => prev.buffer,
            _ => {
                let usage = wgpu::BufferUsages::COPY_SRC
                    | wgpu::BufferUsages::COPY_DST
                    | wgpu::BufferUsages::STORAGE
                    | wgpu::BufferUsages::VERTEX;
                device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some(scene_proxy.name),
                    size: scene_proxy.size,
                    usage,
                    mapped_at_creation: false,
                })
            }
        };
        queue.write_buffer(&buffer, 0, &resolved.packed);
        self.reused_scene_bufs.insert(
            token.0,
            ReusedScene {
                buffer,
                transform_off: resolved.transform_offset(),
                fingerprint: (
                    resolved.layout.transform_base,
                    resolved.layout.style_base,
                    resolved.packed.len(),
                    resolved.geometry_hash,
                ),
            },
        );
    }

    /// Partial write of `bytes` at byte `dst_offset` into the resident scene buffer for
    /// `token`. Used per frame to overwrite each player's transform sub-range (always)
    /// and morph players' path_data sub-range (only when their geometry frame changed).
    /// No-op if the token is unknown or `bytes` is empty.
    pub fn reuse_write(&self, queue: &Queue, token: ReuseToken, dst_offset: u64, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }
        if let Some(r) = self.reused_scene_bufs.get(&token.0) {
            queue.write_buffer(&r.buffer, dst_offset, bytes);
        }
    }

    /// Byte offset of the transform region in the resident buffer for `token`
    /// (`transform_base*4`), so callers can target [`reuse_write`](Self::reuse_write).
    pub fn reuse_transform_offset(&self, token: ReuseToken) -> u64 {
        self.reused_scene_bufs
            .get(&token.0)
            .map_or(0, |r| r.transform_off)
    }

    /// Bind the resident scene buffer for `token` as the scene and REPLAY `recording`
    /// into `texture` (geometry stays resident; any [`reuse_write`](Self::reuse_write)s
    /// issued first this frame are visible). `recording`/`scene_buf`/`out_image` come
    /// from the [`ResolvedReuse`] that populated this token via
    /// [`prepare_reuse`](Self::prepare_reuse).
    #[allow(clippy::too_many_arguments)]
    pub fn reuse_replay(
        &mut self,
        device: &Device,
        queue: &Queue,
        token: ReuseToken,
        recording: &Recording,
        scene_buf: ResourceProxy,
        out_image: ResourceProxy,
        texture: &TextureView,
        sub_lib_proxy: Option<low_level::BufferProxy>,
        slab_image_proxies: Option<(low_level::ImageProxy, low_level::ImageProxy)>,
    ) -> Result<()> {
        let scene_proxy = *scene_buf.as_buf().unwrap();
        let resident = &self.reused_scene_bufs[&token.0].buffer;
        let sub_lib_buf = self.sub_library_buffer();
        let mut externals: Vec<ExternalResource> = Vec::with_capacity(5);
        externals.push(ExternalResource::Image(
            *out_image.as_image().unwrap(),
            texture,
        ));
        externals.push(ExternalResource::Buffer(scene_proxy, resident));
        // DOFUS Tier 7: bind the sub-library buffer alongside the
        // resident scene buffer when the recording references it.
        match (sub_lib_proxy, sub_lib_buf.as_ref()) {
            (Some(proxy), Some(buf)) => externals.push(ExternalResource::Buffer(proxy, buf)),
            (Some(_), None) => log::error!(
                "reuse_replay: recording references a sub-library proxy but no sub-library buffer is set"
            ),
            (None, _) => {}
        }
        // DOFUS Tier 7: bind the persistent pinned ramp/atlas textures.
        // When a texture doesn't exist yet (no pinned entries — e.g. a
        // map without gradients or bitmaps), leave the proxy unbound:
        // the engine materializes its declared 1×1 and nothing in the
        // sub-library references it.
        if let Some((gradient_proxy, atlas_proxy)) = slab_image_proxies {
            if let Some((_, view, _)) = self.slab_ramps_tex.as_ref() {
                externals.push(ExternalResource::Image(gradient_proxy, view));
            }
            if let Some((_, view)) = self.slab_atlas_tex.as_ref() {
                externals.push(ExternalResource::Image(atlas_proxy, view));
            }
        }
        self.engine.run_recording(
            device,
            queue,
            recording,
            &externals,
            "render_to_texture_reuse",
            #[cfg(feature = "wgpu-profiler")]
            &mut self.profiler,
        )?;
        Ok(())
    }

    /// Slow path convenience: [`prepare_reuse`](Self::prepare_reuse) then
    /// [`reuse_replay`](Self::reuse_replay) of `resolved`'s own recording.
    pub fn run_reuse_full(
        &mut self,
        device: &Device,
        queue: &Queue,
        token: ReuseToken,
        resolved: &ResolvedReuse,
        texture: &TextureView,
    ) -> Result<()> {
        self.prepare_reuse(device, queue, token, resolved);
        self.reuse_replay(
            device,
            queue,
            token,
            &resolved.recording,
            resolved.scene_buf,
            resolved.out_image,
            texture,
            resolved.sub_library_proxy,
            resolved.slab_image_proxies,
        )
    }

    /// Fast path convenience: write `transform_bytes` over the whole transform region,
    /// then replay (used by the frozen-crowd validation).
    pub fn run_reuse_transforms(
        &mut self,
        device: &Device,
        queue: &Queue,
        token: ReuseToken,
        recording: &Recording,
        scene_buf: ResourceProxy,
        out_image: ResourceProxy,
        texture: &TextureView,
        transform_bytes: &[u8],
        sub_lib_proxy: Option<low_level::BufferProxy>,
    ) -> Result<()> {
        let off = self.reuse_transform_offset(token);
        self.reuse_write(queue, token, off, transform_bytes);
        self.reuse_replay(
            device,
            queue,
            token,
            recording,
            scene_buf,
            out_image,
            texture,
            sub_lib_proxy,
            None,
        )
    }

    /// Whether a resident scene buffer exists for `token` whose structure fingerprint
    /// matches `resolved` (i.e. a transform-only fast path is valid).
    ///
    /// The fingerprint now includes a content hash over the resolved
    /// `path_data` sub-slice. This is the architectural fix for the
    /// disabled-retention bug recorded at
    /// `client/.../actor_batch/setup.rs:79-92`: two consecutive walk-cycle
    /// frames whose `(transform_base, style_base, packed_len)` triples are
    /// identical but whose `path_data` bytes differ now correctly miss the
    /// fast path and trigger a `reuse_full` upload.
    pub fn reuse_structure_matches(&self, token: ReuseToken, resolved: &ResolvedReuse) -> bool {
        self.reused_scene_bufs.get(&token.0).is_some_and(|r| {
            r.fingerprint.0 == resolved.layout.transform_base
                && r.fingerprint.1 == resolved.layout.style_base
                && r.fingerprint.2 == resolved.packed.len()
                && r.fingerprint.3 == resolved.geometry_hash
        })
    }

    /// Retire the resident scene buffer for `token`. No-op if the token is unknown.
    pub fn free_reused(&mut self, token: ReuseToken) {
        self.reused_scene_bufs.remove(&token.0);
    }

    /// Retire ALL resident scene buffers (e.g. on crowd teardown).
    pub fn free_all_reused(&mut self) {
        self.reused_scene_bufs.clear();
    }

    // ── DOFUS Tier 6 — instanced retained sub-scenes ─────────────────────
    //
    // Reserved API surface. Phase 1 lands the implementations of
    // `Scene::append_instanced` (host-side encoding extension with the
    // `expand_instanced_to_flat` shim) and Phase 3 lands
    // `Renderer::reuse_write_ranges` (atomic multi-range write into the
    // resident scene buffer). Kept commented out at Phase 0 so the API
    // intent is visible without changing behaviour.
    //
    // pub struct InstanceParams {
    //     pub affine: kurbo::Affine,
    //     /// 3 player-color zones, premultiplied RGBA. `None` means the
    //     /// underlying draw_data slot's literal color is used.
    //     pub color_overlay: Option<[[u8; 4]; 3]>,
    //     /// Caller's intent flag — when set AND `instances.len() == 1`,
    //     /// the encoder emits the non-instanced opcode (avoids per-
    //     /// instance overhead on singleton looks).
    //     pub singleton_threshold_hint: bool,
    // }
    //
    // impl Scene {
    //     pub fn append_instanced(&mut self, sub: &Scene, instances: &[InstanceParams]);
    // }
    //
    // impl Renderer {
    //     /// Atomic multi-range write into the resident scene buffer for
    //     /// `token`. Per-frame deltas split across transform / instance
    //     /// transform / instance overlay / per-slot byte ranges.
    //     pub fn reuse_write_ranges(
    //         &self,
    //         queue: &Queue,
    //         token: ReuseToken,
    //         ranges: &[(u64, &[u8])],
    //     );
    // }

    /// Overwrite `image` with `texture`.
    ///
    /// Most users should prefer [`register_texture`](Self::register_texture), which
    /// ergonomically encapulates these requirements.
    ///
    /// `texture` must have the [`wgpu::TextureFormat::Rgba8Unorm`] format and
    /// the [`wgpu::TextureUsages::COPY_SRC`] flag set. The `Rgba8UnormSrgb` format
    /// might also be supported, but this is not tested.
    ///
    /// The given `Texture`'s data will be copied into the slot in Vello's image
    /// atlas where the image would be placed each frame.
    /// This has the effect that wherever you request the image to be drawn (e.g.
    /// through [`Scene::draw_image`]), the data from the texture will be used instead.
    ///
    /// Correct behaviour is not guaranteed if the texture does not have the same
    /// dimensions as the image, nor if an image which uses the same [blob] but different
    /// dimensions would be rendered.
    ///
    /// [blob]: peniko::ImageData::data
    pub fn override_image(
        &mut self,
        image: &ImageData,
        texture: Option<wgpu::TexelCopyTextureInfoBase<wgpu::Texture>>,
    ) -> Option<wgpu::TexelCopyTextureInfoBase<wgpu::Texture>> {
        match texture {
            Some(texture) => self.engine.image_overrides.insert(image.data.id(), texture),
            None => self.engine.image_overrides.remove(&image.data.id()),
        }
    }

    /// Register a [`wgpu::Texture`] with Vello, to allow drawing GPU-resident data.
    ///
    /// The returned `Image` can be used in [`Scene`]s (only those rendered with this `Renderer`)
    /// Rendering Scenes which use this `Image` with other `Renderer`s will panic.
    ///  
    /// `texture` must have the [`wgpu::TextureFormat::Rgba8Unorm`] format and
    /// the [`wgpu::TextureUsages::COPY_SRC`] flag set. This is because the data will
    /// be copied into Vello's image atlas at the start of each frame.
    /// The `Rgba8UnormSrgb` format might also be supported, but this is not tested.
    /// The texture is assumed to have unpremultiplied alpha.
    ///
    /// This is a utility wrapper around [`override_image`](Self::override_image).
    /// For greater control, use that method.
    ///
    /// If the texture is no longer active then it should be unregistered using [`unregister_texture`](Self::unregister_texture)
    pub fn register_texture(&mut self, texture: wgpu::Texture) -> ImageData {
        // Create a fake, empty blob which will be used to back the returned image
        // This image data will never be read by Vello, due to being added to
        // image_overrides, below.
        let fake_blob = peniko::Blob::new(std::sync::Arc::new(&[]));

        let image = ImageData {
            data: fake_blob,
            format: peniko::ImageFormat::Rgba8,
            alpha_type: peniko::ImageAlphaType::Alpha,
            width: texture.width(),
            height: texture.height(),
        };

        // For this utility API, we take the full texture and use the base layer and mip level
        let texture_base = wgpu::TexelCopyTextureInfoBase {
            texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        };

        // We overwrite any attempt to use the fake blob, instead reading from the texture
        self.engine
            .image_overrides
            .insert(image.data.id(), texture_base);

        image
    }

    /// Unregister a [`wgpu::Texture`] that was registered with [`register_texture`](Self::register_texture).
    pub fn unregister_texture(&mut self, handle: ImageData) {
        self.engine.image_overrides.remove(&handle.data.id());
    }

    /// Reload the shaders. This should only be used during `vello` development
    #[cfg(feature = "hot_reload")]
    #[doc(hidden)] // End-users of Vello should not have `hot_reload` enabled.
    pub async fn reload_shaders(&mut self, device: &Device) -> Result<(), Error> {
        let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
        let mut engine = WgpuEngine::new(self.options.use_cpu, self.options.pipeline_cache.clone());
        // We choose not to initialise these shaders in parallel, to ensure the error scope works correctly
        let shaders = shaders::full_shaders(device, &mut engine, &self.options)?;
        #[cfg(feature = "debug_layers")]
        let debug = debug::DebugRenderer::new(device, wgpu::TextureFormat::Rgba8Unorm, &mut engine);
        let error = scope.pop().await;
        if let Some(error) = error {
            return Err(error.into());
        }
        self.engine = engine;
        self.shaders = shaders;
        #[cfg(feature = "debug_layers")]
        {
            self.debug = debug;
        }
        Ok(())
    }

    /// Renders a scene to the target texture using an async pipeline.
    ///
    /// Almost all consumers should prefer [`Self::render_to_texture`].
    ///
    /// The return value is the value of the `BumpAllocators` in this rendering, which is currently used
    /// for debug output.
    ///
    /// This return type is not stable, and will likely be changed when a more principled way to access
    /// relevant statistics is implemented
    #[cfg_attr(docsrs, doc(hidden))]
    #[deprecated(
        note = "render_to_texture should be preferred, as the _async version has no stability guarantees"
    )]
    pub async fn render_to_texture_async(
        &mut self,
        device: &Device,
        queue: &Queue,
        scene: &Scene,
        texture: &TextureView,
        params: &RenderParams,
        debug_layers: DebugLayers,
    ) -> Result<Option<BumpAllocators>> {
        if cfg!(not(feature = "debug_layers")) && !debug_layers.is_empty() {
            static HAS_WARNED: AtomicBool = AtomicBool::new(false);
            if !HAS_WARNED.swap(true, std::sync::atomic::Ordering::Release) {
                log::warn!(
                    "Requested debug layers {debug_layers:?} but `debug_layers` feature is not enabled"
                );
            }
        }

        let result = self
            .render_to_texture_async_internal(device, queue, scene, texture, params)
            .await?;

        #[cfg(feature = "debug_layers")]
        {
            let mut recording = Recording::default();
            let target_proxy = recording::ImageProxy::new(
                params.width,
                params.height,
                recording::ImageFormat::Rgba8,
            );
            if let Some(captured) = result.captured {
                let bump = result.bump.as_ref().unwrap();
                // TODO: We could avoid this download if `DebugLayers::VALIDATION` is unset.
                let downloads = DebugDownloads::map(&self.engine, &captured, bump).await?;
                self.debug.render(
                    &mut recording,
                    target_proxy,
                    &captured,
                    bump,
                    params,
                    &downloads,
                    debug_layers,
                );

                // TODO: this sucks. better to release everything in a helper
                // TODO: it would be much better to have a way to safely destroy a buffer.
                self.engine.free_download(captured.lines);
                captured.release_buffers(&mut recording);
            }
            let external_resources = [ExternalResource::Image(target_proxy, texture)];
            self.engine.run_recording(
                device,
                queue,
                &recording,
                &external_resources,
                "render_to_texture_async debug layers",
                #[cfg(feature = "wgpu-profiler")]
                &mut self.profiler,
            )?;
        }

        #[cfg(feature = "wgpu-profiler")]
        {
            self.profiler.end_frame().unwrap();
            if let Some(result) = self
                .profiler
                .process_finished_frame(queue.get_timestamp_period())
            {
                self.profile_result = Some(result);
            }
        }

        Ok(result.bump)
    }

    async fn render_to_texture_async_internal(
        &mut self,
        device: &Device,
        queue: &Queue,
        scene: &Scene,
        texture: &TextureView,
        params: &RenderParams,
    ) -> Result<RenderResult> {
        let mut render = Render::new();
        let encoding = scene.encoding();
        // TODO: turn this on; the download feature interacts with CPU dispatch.
        // Currently this is always enabled when the `debug_layers` setting is enabled as the bump
        // counts are used for debug visualiation.
        let robust = cfg!(feature = "debug_layers");
        let recording = render.render_encoding_coarse(
            encoding,
            &mut self.resolver,
            &self.shaders,
            params,
            robust,
            crate::render::SceneSource::Upload,
            &mut self.image_atlas,
        );
        let target = render.out_image();
        let bump_buf = render.bump_buf();
        let sub_lib_proxy = render.sub_library_proxy();
        #[cfg(feature = "debug_layers")]
        let captured = render.take_captured_buffers();
        // DOFUS Tier 7: the async coarse pass needs the sub-library
        // bound when the encoding emitted a slab dispatch — same
        // pattern as the sync `render_to_texture` path.
        match (sub_lib_proxy, self.sub_library_buffer()) {
            (Some(proxy), Some(buf)) => {
                let externals = [ExternalResource::Buffer(proxy, &buf)];
                self.engine.run_recording(
                    device,
                    queue,
                    &recording,
                    &externals,
                    "t_async_coarse",
                    #[cfg(feature = "wgpu-profiler")]
                    &mut self.profiler,
                )?;
            }
            (Some(_), None) => {
                log::error!(
                    "render_to_texture_async: scene encoded slab blocks but no sub-library buffer is set"
                );
                self.engine.run_recording(
                    device,
                    queue,
                    &recording,
                    &[],
                    "t_async_coarse",
                    #[cfg(feature = "wgpu-profiler")]
                    &mut self.profiler,
                )?;
            }
            (None, _) => {
                self.engine.run_recording(
                    device,
                    queue,
                    &recording,
                    &[],
                    "t_async_coarse",
                    #[cfg(feature = "wgpu-profiler")]
                    &mut self.profiler,
                )?;
            }
        }

        let mut bump: Option<BumpAllocators> = None;
        if let Some(bump_buf) = self.engine.get_download(bump_buf) {
            let buf_slice = bump_buf.slice(..);
            let (sender, receiver) = futures_intrusive::channel::shared::oneshot_channel();
            buf_slice.map_async(wgpu::MapMode::Read, move |v| sender.send(v).unwrap());
            receiver.receive().await.expect("channel was closed")?;
            let mapped = buf_slice.get_mapped_range();
            bump = Some(bytemuck::pod_read_unaligned(&mapped));
        }
        // TODO: apply logic to determine whether we need to rerun coarse, and also
        // allocate the blend stack as needed.
        self.engine.free_download(bump_buf);
        // Maybe clear to reuse allocation?
        let mut recording = Recording::default();
        render.record_fine(&self.shaders, &mut recording);
        let external_resources = [ExternalResource::Image(target, texture)];
        self.engine.run_recording(
            device,
            queue,
            &recording,
            &external_resources,
            "t_async_fine",
            #[cfg(feature = "wgpu-profiler")]
            &mut self.profiler,
        )?;
        Ok(RenderResult {
            bump,
            #[cfg(feature = "debug_layers")]
            captured,
        })
    }
}
#[cfg(all(feature = "debug_layers", feature = "wgpu"))]
pub(crate) struct DebugDownloads<'a> {
    pub lines: wgpu::BufferSlice<'a>,
}

#[cfg(all(feature = "debug_layers", feature = "wgpu"))]
impl<'a> DebugDownloads<'a> {
    pub async fn map(
        engine: &'a WgpuEngine,
        captured: &render::CapturedBuffers,
        bump: &BumpAllocators,
    ) -> Result<DebugDownloads<'a>> {
        use vello_encoding::LineSoup;

        let Some(lines_buf) = engine.get_download(captured.lines) else {
            return Err(Error::DownloadError("linesoup"));
        };

        let lines = lines_buf.slice(..bump.lines as u64 * size_of::<LineSoup>() as u64);
        let (sender, receiver) = futures_intrusive::channel::shared::oneshot_channel();
        lines.map_async(wgpu::MapMode::Read, move |v| sender.send(v).unwrap());
        receiver.receive().await.expect("channel was closed")?;
        Ok(Self { lines })
    }
}
