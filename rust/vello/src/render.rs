// Copyright 2022 the Vello Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

//! Take an encoded scene and create a graph to render it

use crate::recording::{BufferProxy, ImageFormat, ImageProxy, Recording, ResourceProxy};
use crate::shaders::FullShaders;
use crate::{AaConfig, RenderParams};

#[cfg(feature = "wgpu")]
use crate::Scene;

use vello_encoding::{Encoding, Layout, Resolver, WorkgroupSize, make_mask_lut, make_mask_lut_16};

/// DOFUS: how `render_encoding_coarse` should materialize the packed scene buffer.
///
/// `Upload` is upstream behaviour: emit a `Command::Upload("vello.scene", ..)` into
/// the recording (re-uploaded in full every run) and free it at the end of coarse.
/// `External` skips both the upload and the free — the caller supplies the scene
/// buffer as an `ExternalResource::Buffer` keyed by the returned `scene_buf` proxy id,
/// keeping geometry GPU-resident across frames so only the transform byte-range is
/// re-uploaded.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SceneSource {
    Upload,
    External,
}

/// DOFUS Tier 7 Step 0 diagnostic: `true` when `DOFUS_WG_DIAG` is set in
/// the environment (read once and cached). Gates the per-kernel dispatch
/// count report in `render_encoding_coarse`.
fn wg_diag_enabled() -> bool {
    use std::sync::OnceLock;
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| std::env::var_os("DOFUS_WG_DIAG").is_some())
}

/// Returns `true` for the first 16 calls, then `false` — caps the diag
/// print to a handful of frames so it doesn't flood the bench output.
fn wg_diag_take() -> bool {
    use std::sync::atomic::{AtomicU32, Ordering};
    static REMAINING: AtomicU32 = AtomicU32::new(16);
    REMAINING
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| n.checked_sub(1))
        .is_ok()
}

/// State for a render in progress.
pub struct Render {
    fine_wg_count: Option<WorkgroupSize>,
    fine_resources: Option<FineResources>,
    mask_buf: Option<ResourceProxy>,

    /// DOFUS: set by `render_encoding_coarse` in [`SceneSource::External`] mode —
    /// `(layout, scene_buf proxy, packed bytes)` handed back to the caller so it
    /// can size the resident buffer and write only the transform sub-range.
    reuse_out: Option<(Layout, ResourceProxy, Vec<u8>)>,

    /// DOFUS Tier 7: when the encoding carried slabbed instance blocks
    /// the coarse pass dispatches `instance_expand_slab` and references
    /// the GPU sub-library buffer via a synthetic proxy. The
    /// `Renderer` binds the real buffer to this proxy through
    /// [`ExternalResource::Buffer`] before running the recording.
    /// `None` when the encoding has no slabbed blocks.
    sub_library_proxy: Option<BufferProxy>,

    /// DOFUS Tier 7: `(gradient, atlas)` proxies for slabbed encodings.
    /// Slab subs reference PINNED ramp rows / atlas coordinates whose
    /// pixels live in the renderer's persistent textures (uploaded at
    /// intern time) — the recording records NO texture writes, and the
    /// caller binds the persistent views to these proxies via
    /// [`ExternalResource::Image`]. `None` for non-slab encodings,
    /// which keep the per-render upload path.
    slab_image_proxies: Option<(ImageProxy, ImageProxy)>,

    #[cfg(feature = "debug_layers")]
    captured_buffers: Option<CapturedBuffers>,
}

#[cfg(feature = "debug_layers")]
impl Drop for Render {
    fn drop(&mut self) {
        if self.captured_buffers.is_some() {
            unreachable!("Render captured buffers without freeing them");
        }
    }
}

/// Resources produced by pipeline, needed for fine rasterization.
struct FineResources {
    aa_config: AaConfig,

    config_buf: ResourceProxy,
    bump_buf: ResourceProxy,
    tile_buf: ResourceProxy,
    segments_buf: ResourceProxy,
    ptcl_buf: ResourceProxy,
    gradient_image: ResourceProxy,
    info_bin_data_buf: ResourceProxy,
    image_atlas: ResourceProxy,
    blend_spill_buf: ResourceProxy,

    out_image: ImageProxy,
}

/// A collection of internal buffers that are used for debug visualization when the
/// `debug_layers` feature is enabled. The contents of these buffers remain GPU resident
/// and must be freed directly by the caller.
///
/// Some of these buffers are also scheduled for a download to allow their contents to be
/// processed for CPU-side validation. These buffers are documented as such.
#[cfg(feature = "debug_layers")]
pub struct CapturedBuffers {
    pub sizes: vello_encoding::BufferSizes,

    /// Buffers that remain GPU-only
    pub path_bboxes: BufferProxy,

    /// Buffers scheduled for download
    pub lines: BufferProxy,
}

#[cfg(feature = "debug_layers")]
impl CapturedBuffers {
    pub fn release_buffers(self, recording: &mut Recording) {
        recording.free_buffer(self.path_bboxes);
        recording.free_buffer(self.lines);
    }
}

#[cfg(feature = "wgpu")]
pub(crate) fn render_full(
    scene: &Scene,
    resolver: &mut Resolver,
    shaders: &FullShaders,
    params: &RenderParams,
    atlas: &mut Option<ImageProxy>,
) -> (Recording, ResourceProxy, Option<BufferProxy>) {
    render_encoding_full(scene.encoding(), resolver, shaders, params, atlas)
}

/// DOFUS: like [`render_full`], but in [`SceneSource::External`] mode — the packed
/// scene buffer is NOT uploaded into the recording. Returns the recording plus the
/// pieces the caller needs to keep the scene buffer GPU-resident and re-upload only
/// transforms: the output image proxy, the `scene_buf` proxy (its id must be bound to
/// the resident buffer via `ExternalResource::Buffer`), the packed [`Layout`], and the
/// full packed bytes (slice `[transform_base*4 .. style_base*4]` for the transform run).
#[cfg(feature = "wgpu")]
pub(crate) fn render_full_reuse(
    scene: &Scene,
    resolver: &mut Resolver,
    shaders: &FullShaders,
    params: &RenderParams,
    atlas: &mut Option<ImageProxy>,
) -> (
    Recording,
    ResourceProxy,
    ResourceProxy,
    Layout,
    Vec<u8>,
    Option<BufferProxy>,
    Option<(ImageProxy, ImageProxy)>,
) {
    let mut render = Render::new();
    let mut recording = render.render_encoding_coarse(
        scene.encoding(),
        resolver,
        shaders,
        params,
        false,
        SceneSource::External,
        atlas,
    );
    let out_image = render.out_image();
    render.record_fine(shaders, &mut recording);
    let sub_library_proxy = render.sub_library_proxy();
    let slab_image_proxies = render.slab_image_proxies();
    let (layout, scene_buf, packed) = render
        .reuse_out
        .take()
        .expect("SceneSource::External must populate reuse_out");
    (
        recording,
        out_image.into(),
        scene_buf,
        layout,
        packed,
        sub_library_proxy,
        slab_image_proxies,
    )
}

#[cfg(feature = "wgpu")]
/// Create a single recording with both coarse and fine render stages.
///
/// This function is not recommended when the scene can be complex, as it does not
/// implement robust dynamic memory.
pub(crate) fn render_encoding_full(
    encoding: &Encoding,
    resolver: &mut Resolver,
    shaders: &FullShaders,
    params: &RenderParams,
    atlas: &mut Option<ImageProxy>,
) -> (Recording, ResourceProxy, Option<BufferProxy>) {
    let mut render = Render::new();
    let mut recording = render.render_encoding_coarse(
        encoding,
        resolver,
        shaders,
        params,
        false,
        SceneSource::Upload,
        atlas,
    );
    let out_image = render.out_image();
    render.record_fine(shaders, &mut recording);
    let sub_library_proxy = render.sub_library_proxy();
    (recording, out_image.into(), sub_library_proxy)
}

impl Default for Render {
    fn default() -> Self {
        Self::new()
    }
}

impl Render {
    pub fn new() -> Self {
        Self {
            fine_wg_count: None,
            fine_resources: None,
            mask_buf: None,
            reuse_out: None,
            sub_library_proxy: None,
            slab_image_proxies: None,
            #[cfg(feature = "debug_layers")]
            captured_buffers: None,
        }
    }

    /// DOFUS Tier 7: synthetic proxy referenced by the slab-expand
    /// dispatch. The caller must bind the real sub-library buffer to
    /// this proxy via [`ExternalResource::Buffer`] before running the
    /// recording — bound to the renderer's owned SubLibrary buffer.
    /// `None` when the encoding had no slabbed blocks.
    pub fn sub_library_proxy(&self) -> Option<BufferProxy> {
        self.sub_library_proxy
    }

    /// DOFUS Tier 7: `(gradient, atlas)` proxies to bind the renderer's
    /// persistent pinned textures to, via [`ExternalResource::Image`].
    /// `None` when the encoding had no slabbed blocks.
    pub fn slab_image_proxies(&self) -> Option<(ImageProxy, ImageProxy)> {
        self.slab_image_proxies
    }

    /// Prepare a recording for the coarse rasterization phase.
    ///
    /// The `robust` parameter controls whether we're preparing for readback
    /// of the atomic bump buffer, for robust dynamic memory.
    pub fn render_encoding_coarse(
        &mut self,
        encoding: &Encoding,
        resolver: &mut Resolver,
        shaders: &FullShaders,
        params: &RenderParams,
        robust: bool,
        scene_source: SceneSource,
        atlas: &mut Option<ImageProxy>,
    ) -> Recording {
        use vello_encoding::RenderConfig;
        let mut recording = Recording::default();
        let mut packed = vec![];

        let slabbed = !encoding.instance_slab_blocks.is_empty()
            && encoding.resources.patches.is_empty()
            && encoding.instance_blocks.is_empty();
        let (layout, ramps, images) = resolver.resolve(encoding, &mut packed);
        // DOFUS Tier 7: slabbed encodings sample the renderer's
        // PERSISTENT pinned textures (uploaded at intern time) — the
        // recording carries no texture writes; the caller binds the
        // persistent views to these proxies via `ExternalResource::Image`.
        // Recording the pinned atlas + ramps into every slab band
        // recording re-uploaded ~13 MB per band per frame.
        let (gradient_image, image_atlas) = if slabbed {
            let gradient = ImageProxy::new(1, 1, ImageFormat::Rgba8);
            let atlas_proxy = ImageProxy::new(1, 1, ImageFormat::Rgba8);
            self.slab_image_proxies = Some((gradient, atlas_proxy));
            (ResourceProxy::Image(gradient), atlas_proxy)
        } else {
            let gradient_image = if ramps.height == 0 {
                ResourceProxy::new_image(1, 1, ImageFormat::Rgba8)
            } else {
                let data: &[u8] = bytemuck::cast_slice(ramps.data);
                ResourceProxy::Image(recording.upload_image(
                    ramps.width,
                    ramps.height,
                    ImageFormat::Rgba8,
                    data,
                ))
            };
            // Per-render image atlas: created fresh here and freed in
            // `record_fine`. The persistent-shared-atlas optimisation was
            // reverted — it corrupted the band reuse path (a retained band
            // sampled atlas slots another band's resolve had overwritten →
            // tile repetition / wrong bitmaps / distortion). With right-sized
            // assets the atlas is small (≤1024², a few MB) so per-render
            // create+free is cheap.
            let image_atlas = if images.images.is_empty() {
                ImageProxy::new(1, 1, ImageFormat::Rgba8)
            } else {
                ImageProxy::new(images.width, images.height, ImageFormat::Rgba8)
            };
            *atlas = Some(image_atlas);
            for image in images.images {
                recording.write_image(image_atlas, image.1, image.2, image.0.clone());
            }
            (gradient_image, image_atlas)
        };
        let cpu_config =
            RenderConfig::new(&layout, params.width, params.height, &params.base_color);
        // HACK: The coarse workgroup counts is the number of active bins.
        if (cpu_config.workgroup_counts.coarse.0
            * cpu_config.workgroup_counts.coarse.1
            * cpu_config.workgroup_counts.coarse.2)
            > 256
        {
            log::warn!(
                "Trying to paint too large image. {}x{}.\n\
                See https://github.com/linebender/vello/issues/680 for details",
                params.width,
                params.height
            );
        }
        let buffer_sizes = &cpu_config.buffer_sizes;
        let wg_counts = &cpu_config.workgroup_counts;

        // DOFUS Tier 7 slab diagnostic (Step 0): when `DOFUS_WG_DIAG` is
        // set, report the per-kernel 1-D dispatch counts whenever any
        // standard kernel approaches the 65535 per-dimension limit, so we
        // can confirm tight-packing dropped them and identify any kernel
        // still needing the X×Y split. Print-capped to avoid per-frame
        // spam. Inert (no env read past the once-cached flag) otherwise.
        if wg_diag_enabled() {
            let counts = [
                ("path_reduce", wg_counts.path_reduce.0),
                ("path_scan", wg_counts.path_scan.0),
                ("flatten", wg_counts.flatten.0),
                ("bbox_clear", wg_counts.bbox_clear.0),
                ("draw_reduce", wg_counts.draw_reduce.0),
                ("binning", wg_counts.binning.0),
                ("tile_alloc", wg_counts.tile_alloc.0),
                ("backdrop", wg_counts.backdrop.0),
            ];
            let peak = counts.iter().map(|(_, c)| *c).max().unwrap_or(0);
            if peak > 60_000 && wg_diag_take() {
                let over: Vec<_> = counts.iter().filter(|(_, c)| *c > 60_000).collect();
                eprintln!(
                    "[DOFUS_WG_DIAG] path_tags_size={} n_paths={} n_slab_slots={} OVER60k={:?}",
                    layout.path_tags_size(),
                    layout.n_paths,
                    layout.n_slab_total_slots,
                    over,
                );
            }
        }

        if packed.is_empty() {
            // HACK: wgpu doesn't allow empty buffers, so we make sure that the scene buffer we upload
            // can contain at least one array item.
            // The values passed here should never be read, because the scene size in config
            // is zero.
            packed.resize(size_of::<u32>(), u8::MAX);
        }
        let scene_buf = match scene_source {
            SceneSource::Upload => ResourceProxy::Buffer(recording.upload("vello.scene", packed)),
            SceneSource::External => {
                // DOFUS retained path: do NOT upload the scene into the recording.
                // Mint a bare proxy (the caller binds the resident buffer to its id via
                // `ExternalResource::Buffer`) and hand `(layout, proxy, packed)` back.
                let proxy =
                    ResourceProxy::Buffer(BufferProxy::new(packed.len() as u64, "vello.scene"));
                self.reuse_out = Some((layout, proxy, std::mem::take(&mut packed)));
                proxy
            }
        };
        let config_buf = ResourceProxy::Buffer(
            recording.upload_uniform("vello.config", bytemuck::bytes_of(&cpu_config.gpu)),
        );
        let info_bin_data_buf = ResourceProxy::new_buf(
            buffer_sizes.bin_data.size_in_bytes() as u64,
            "vello.info_bin_data_buf",
        );
        let tile_buf =
            ResourceProxy::new_buf(buffer_sizes.tiles.size_in_bytes().into(), "vello.tile_buf");
        let segments_buf = ResourceProxy::new_buf(
            buffer_sizes.segments.size_in_bytes().into(),
            "vello.segments_buf",
        );
        let ptcl_buf =
            ResourceProxy::new_buf(buffer_sizes.ptcl.size_in_bytes().into(), "vello.ptcl_buf");
        let reduced_buf = ResourceProxy::new_buf(
            buffer_sizes.path_reduced.size_in_bytes().into(),
            "vello.reduced_buf",
        );
        // DOFUS Tier 6: GPU instance expansion pre-pass.
        // **DISABLED**: with the CPU `expand_instanced_to_flat` shim
        // active in the resolver, the descriptor `splice_*` positions
        // are in the original marker-emit coordinate space — but the
        // scene buffer the GPU sees is the CPU-expanded form with a
        // different layout. Dispatching the kernel writes sub bytes
        // into wrong offsets and corrupts the path_data region. To re-
        // enable, the resolver must EITHER skip CPU expansion OR
        // re-translate the descriptor splice positions to post-expand
        // offsets before packing. Until that's wired the kernel stays
        // registered (the source + bindings are in tree) but never
        // fires.
        let _ = shaders.instance_expand;
        let _ = wg_counts.instance_expand;

        // DOFUS Tier 7: slabbed instance expansion pre-pass.
        // The slabbed resolver reserves zero-filled per-stream gaps in
        // the scene buffer; this kernel populates them by copying sub
        // bytes from the GPU sub-library. Must run BEFORE pathtag_reduce
        // so the downstream pipeline sees a fully-materialised stream.
        // The sub-library is bound at run time via the external-resource
        // pattern — bound to the renderer's owned SubLibrary buffer.
        // Size 1 sentinel: the real wgpu buffer is supplied via
        // `ExternalResource::Buffer`; only its proxy id matters here.
        if layout.n_slab_blocks > 0 && wg_counts.instance_expand_slab.0 > 0 {
            let proxy = BufferProxy::new(1, "vello.sub_library");
            self.sub_library_proxy = Some(proxy);
            recording.dispatch(
                shaders.instance_expand_slab,
                wg_counts.instance_expand_slab,
                [config_buf, scene_buf, ResourceProxy::Buffer(proxy)],
            );
        }

        // TODO: really only need pathtag_wgs - 1
        recording.dispatch(
            shaders.pathtag_reduce,
            wg_counts.path_reduce,
            [config_buf, scene_buf, reduced_buf],
        );
        let mut pathtag_parent = reduced_buf;
        let mut large_pathtag_bufs = None;
        let use_large_path_scan = wg_counts.use_large_path_scan && !shaders.pathtag_is_cpu;
        if use_large_path_scan {
            let reduced2_buf = ResourceProxy::new_buf(
                buffer_sizes.path_reduced2.size_in_bytes().into(),
                "vello.reduced2_buf",
            );
            recording.dispatch(
                shaders.pathtag_reduce2,
                wg_counts.path_reduce2,
                [reduced_buf, reduced2_buf],
            );
            let reduced_scan_buf = ResourceProxy::new_buf(
                buffer_sizes.path_reduced_scan.size_in_bytes().into(),
                "reduced_scan_buf",
            );
            recording.dispatch(
                shaders.pathtag_scan1,
                wg_counts.path_scan1,
                [reduced_buf, reduced2_buf, reduced_scan_buf],
            );
            pathtag_parent = reduced_scan_buf;
            large_pathtag_bufs = Some((reduced2_buf, reduced_scan_buf));
        }

        let tagmonoid_buf = ResourceProxy::new_buf(
            buffer_sizes.path_monoids.size_in_bytes().into(),
            "vello.tagmonoid_buf",
        );
        let pathtag_scan = if use_large_path_scan {
            shaders.pathtag_scan_large
        } else {
            shaders.pathtag_scan
        };
        recording.dispatch(
            pathtag_scan,
            wg_counts.path_scan,
            [config_buf, scene_buf, pathtag_parent, tagmonoid_buf],
        );
        recording.free_resource(reduced_buf);
        if let Some((reduced2, reduced_scan)) = large_pathtag_bufs {
            recording.free_resource(reduced2);
            recording.free_resource(reduced_scan);
        }
        let path_bbox_buf = ResourceProxy::new_buf(
            buffer_sizes.path_bboxes.size_in_bytes().into(),
            "vello.path_bbox_buf",
        );
        recording.dispatch(
            shaders.bbox_clear,
            wg_counts.bbox_clear,
            [config_buf, path_bbox_buf],
        );
        let bump_buf = BufferProxy::new(
            buffer_sizes.bump_alloc.size_in_bytes().into(),
            "vello.bump_buf",
        );
        recording.clear_all(bump_buf);
        let bump_buf = ResourceProxy::Buffer(bump_buf);
        let lines_buf =
            ResourceProxy::new_buf(buffer_sizes.lines.size_in_bytes().into(), "vello.lines_buf");
        recording.dispatch(
            shaders.flatten,
            wg_counts.flatten,
            [
                config_buf,
                scene_buf,
                tagmonoid_buf,
                path_bbox_buf,
                bump_buf,
                lines_buf,
            ],
        );
        let draw_reduced_buf = ResourceProxy::new_buf(
            buffer_sizes.draw_reduced.size_in_bytes().into(),
            "vello.draw_reduced_buf",
        );
        recording.dispatch(
            shaders.draw_reduce,
            wg_counts.draw_reduce,
            [config_buf, scene_buf, draw_reduced_buf],
        );
        let draw_monoid_buf = ResourceProxy::new_buf(
            buffer_sizes.draw_monoids.size_in_bytes().into(),
            "vello.draw_monoid_buf",
        );
        let clip_inp_buf = ResourceProxy::new_buf(
            buffer_sizes.clip_inps.size_in_bytes().into(),
            "vello.clip_inp_buf",
        );
        recording.dispatch(
            shaders.draw_leaf,
            wg_counts.draw_leaf,
            [
                config_buf,
                scene_buf,
                draw_reduced_buf,
                path_bbox_buf,
                draw_monoid_buf,
                info_bin_data_buf,
                clip_inp_buf,
            ],
        );
        recording.free_resource(draw_reduced_buf);
        let clip_el_buf = ResourceProxy::new_buf(
            buffer_sizes.clip_els.size_in_bytes().into(),
            "vello.clip_el_buf",
        );
        let clip_bic_buf = ResourceProxy::new_buf(
            buffer_sizes.clip_bics.size_in_bytes().into(),
            "vello.clip_bic_buf",
        );
        if wg_counts.clip_reduce.0 > 0 {
            recording.dispatch(
                shaders.clip_reduce,
                wg_counts.clip_reduce,
                [clip_inp_buf, path_bbox_buf, clip_bic_buf, clip_el_buf],
            );
        }
        let clip_bbox_buf = ResourceProxy::new_buf(
            buffer_sizes.clip_bboxes.size_in_bytes().into(),
            "vello.clip_bbox_buf",
        );
        if wg_counts.clip_leaf.0 > 0 {
            recording.dispatch(
                shaders.clip_leaf,
                wg_counts.clip_leaf,
                [
                    config_buf,
                    clip_inp_buf,
                    path_bbox_buf,
                    clip_bic_buf,
                    clip_el_buf,
                    draw_monoid_buf,
                    clip_bbox_buf,
                ],
            );
        }
        recording.free_resource(clip_inp_buf);
        recording.free_resource(clip_bic_buf);
        recording.free_resource(clip_el_buf);
        let draw_bbox_buf = ResourceProxy::new_buf(
            buffer_sizes.draw_bboxes.size_in_bytes().into(),
            "vello.draw_bbox_buf",
        );
        let bin_header_buf = ResourceProxy::new_buf(
            buffer_sizes.bin_headers.size_in_bytes().into(),
            "vello.bin_header_buf",
        );
        recording.dispatch(
            shaders.binning,
            wg_counts.binning,
            [
                config_buf,
                draw_monoid_buf,
                path_bbox_buf,
                clip_bbox_buf,
                draw_bbox_buf,
                bump_buf,
                info_bin_data_buf,
                bin_header_buf,
            ],
        );
        recording.free_resource(draw_monoid_buf);
        recording.free_resource(clip_bbox_buf);
        // Note: this only needs to be rounded up because of the workaround to store the tile_offset
        // in storage rather than workgroup memory.
        let path_buf =
            ResourceProxy::new_buf(buffer_sizes.paths.size_in_bytes().into(), "vello.path_buf");
        recording.dispatch(
            shaders.tile_alloc,
            wg_counts.tile_alloc,
            [
                config_buf,
                scene_buf,
                draw_bbox_buf,
                bump_buf,
                path_buf,
                tile_buf,
            ],
        );
        recording.free_resource(draw_bbox_buf);
        recording.free_resource(tagmonoid_buf);
        let indirect_count_buf = BufferProxy::new(
            buffer_sizes.indirect_count.size_in_bytes().into(),
            "vello.indirect_count",
        );
        recording.dispatch(
            shaders.path_count_setup,
            wg_counts.path_count_setup,
            [bump_buf, indirect_count_buf.into()],
        );
        let seg_counts_buf = ResourceProxy::new_buf(
            buffer_sizes.seg_counts.size_in_bytes().into(),
            "vello.seg_counts_buf",
        );
        recording.dispatch_indirect(
            shaders.path_count,
            indirect_count_buf,
            0,
            [
                config_buf,
                bump_buf,
                lines_buf,
                path_buf,
                tile_buf,
                seg_counts_buf,
            ],
        );
        recording.dispatch(
            shaders.backdrop,
            wg_counts.backdrop,
            [config_buf, bump_buf, path_buf, tile_buf],
        );
        recording.dispatch(
            shaders.coarse,
            wg_counts.coarse,
            [
                config_buf,
                scene_buf,
                draw_monoid_buf,
                bin_header_buf,
                info_bin_data_buf,
                path_buf,
                tile_buf,
                bump_buf,
                ptcl_buf,
            ],
        );
        recording.dispatch(
            shaders.path_tiling_setup,
            wg_counts.path_tiling_setup,
            [bump_buf, indirect_count_buf.into(), ptcl_buf],
        );
        recording.dispatch_indirect(
            shaders.path_tiling,
            indirect_count_buf,
            0,
            [
                bump_buf,
                seg_counts_buf,
                lines_buf,
                path_buf,
                tile_buf,
                segments_buf,
            ],
        );
        recording.free_buffer(indirect_count_buf);
        recording.free_resource(seg_counts_buf);
        // DOFUS: in External mode the scene buffer is caller-owned and reused across
        // frames — must NOT be freed (it never entered the pool/bind_map either).
        if scene_source == SceneSource::Upload {
            recording.free_resource(scene_buf);
        }
        recording.free_resource(draw_monoid_buf);
        recording.free_resource(bin_header_buf);
        recording.free_resource(path_buf);
        let out_image = ImageProxy::new(params.width, params.height, ImageFormat::Rgba8);
        let blend_spill_buf = BufferProxy::new(
            buffer_sizes.blend_spill.size_in_bytes().into(),
            "vello.blend_spill",
        );
        self.fine_wg_count = Some(wg_counts.fine);
        self.fine_resources = Some(FineResources {
            aa_config: params.antialiasing_method,
            config_buf,
            bump_buf,
            tile_buf,
            segments_buf,
            ptcl_buf,
            gradient_image,
            info_bin_data_buf,
            blend_spill_buf: ResourceProxy::Buffer(blend_spill_buf),
            image_atlas: ResourceProxy::Image(image_atlas),
            out_image,
        });
        if robust {
            recording.download(*bump_buf.as_buf().unwrap());
        }
        recording.free_resource(bump_buf);

        #[cfg(feature = "debug_layers")]
        {
            if robust {
                let path_bboxes = *path_bbox_buf.as_buf().unwrap();
                let lines = *lines_buf.as_buf().unwrap();
                recording.download(lines);

                self.captured_buffers = Some(CapturedBuffers {
                    sizes: cpu_config.buffer_sizes,
                    path_bboxes,
                    lines,
                });
            } else {
                recording.free_resource(path_bbox_buf);
                recording.free_resource(lines_buf);
            }
        }
        #[cfg(not(feature = "debug_layers"))]
        {
            recording.free_resource(path_bbox_buf);
            recording.free_resource(lines_buf);
        }

        recording
    }

    /// Run fine rasterization assuming the coarse phase succeeded.
    pub fn record_fine(&mut self, shaders: &FullShaders, recording: &mut Recording) {
        let fine_wg_count = self.fine_wg_count.take().unwrap();
        let fine = self.fine_resources.take().unwrap();
        match fine.aa_config {
            AaConfig::Area => {
                recording.dispatch(
                    shaders
                        .fine_area
                        .expect("shaders not configured to support AA mode: area"),
                    fine_wg_count,
                    [
                        fine.config_buf,
                        fine.segments_buf,
                        fine.ptcl_buf,
                        fine.info_bin_data_buf,
                        fine.blend_spill_buf,
                        ResourceProxy::Image(fine.out_image),
                        fine.gradient_image,
                        fine.image_atlas,
                    ],
                );
            }
            _ => {
                if self.mask_buf.is_none() {
                    let mask_lut = match fine.aa_config {
                        AaConfig::Msaa16 => make_mask_lut_16(),
                        AaConfig::Msaa8 => make_mask_lut(),
                        _ => unreachable!(),
                    };
                    let buf = recording.upload("vello.mask_lut", mask_lut);
                    self.mask_buf = Some(buf.into());
                }
                let fine_shader = match fine.aa_config {
                    AaConfig::Msaa16 => shaders
                        .fine_msaa16
                        .expect("shaders not configured to support AA mode: msaa16"),
                    AaConfig::Msaa8 => shaders
                        .fine_msaa8
                        .expect("shaders not configured to support AA mode: msaa8"),
                    _ => unreachable!(),
                };
                recording.dispatch(
                    fine_shader,
                    fine_wg_count,
                    [
                        fine.config_buf,
                        fine.segments_buf,
                        fine.ptcl_buf,
                        fine.info_bin_data_buf,
                        fine.blend_spill_buf,
                        ResourceProxy::Image(fine.out_image),
                        fine.gradient_image,
                        fine.image_atlas,
                        self.mask_buf.unwrap(),
                    ],
                );
            }
        }
        recording.free_resource(fine.config_buf);
        recording.free_resource(fine.tile_buf);
        recording.free_resource(fine.segments_buf);
        recording.free_resource(fine.ptcl_buf);
        recording.free_resource(fine.gradient_image);
        recording.free_resource(fine.image_atlas);
        recording.free_resource(fine.info_bin_data_buf);
        recording.free_resource(fine.blend_spill_buf);
        // TODO: make mask buf persistent
        if let Some(mask_buf) = self.mask_buf.take() {
            recording.free_resource(mask_buf);
        }
    }

    /// Get the output image.
    ///
    /// This is going away, as the caller will add the output image to the bind
    /// map.
    pub fn out_image(&self) -> ImageProxy {
        self.fine_resources.as_ref().unwrap().out_image
    }

    pub fn bump_buf(&self) -> BufferProxy {
        *self
            .fine_resources
            .as_ref()
            .unwrap()
            .bump_buf
            .as_buf()
            .unwrap()
    }

    #[cfg(feature = "debug_layers")]
    pub fn take_captured_buffers(&mut self) -> Option<CapturedBuffers> {
        self.captured_buffers.take()
    }
}
