// Copyright 2022 the Vello Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

//! Load rendering shaders.

#[cfg(feature = "wgpu")]
use wgpu::Device;

use crate::ShaderId;

#[cfg(feature = "wgpu")]
use crate::{
    Error, RendererOptions,
    recording::{BindType, ImageFormat},
    wgpu_engine::WgpuEngine,
};

// Shaders for the full pipeline
pub struct FullShaders {
    pub pathtag_reduce: ShaderId,
    pub pathtag_reduce2: ShaderId,
    pub pathtag_scan1: ShaderId,
    pub pathtag_scan: ShaderId,
    pub pathtag_scan_large: ShaderId,
    pub bbox_clear: ShaderId,
    pub flatten: ShaderId,
    pub draw_reduce: ShaderId,
    pub draw_leaf: ShaderId,
    pub clip_reduce: ShaderId,
    pub clip_leaf: ShaderId,
    pub binning: ShaderId,
    pub tile_alloc: ShaderId,
    pub backdrop: ShaderId,
    pub path_count_setup: ShaderId,
    pub path_count: ShaderId,
    pub coarse: ShaderId,
    pub path_tiling_setup: ShaderId,
    pub path_tiling: ShaderId,
    pub fine_area: Option<ShaderId>,
    pub fine_msaa8: Option<ShaderId>,
    pub fine_msaa16: Option<ShaderId>,
    /// DOFUS Tier 6: GPU instance expansion pre-pass. Registered but
    /// not dispatched by default — the existing CPU
    /// `Encoding::expand_instanced_to_flat` shim still produces the flat
    /// scene the rest of the pipeline consumes. Dispatching this kernel
    /// from `render_encoding_coarse` requires (a) packing each unique
    /// sub-encoding's bytes into a sub-library region of the scene
    /// buffer with `sub_*_offset` populated in the descriptor table, and
    /// (b) switching the resolver to leave the per-instance splice
    /// regions zero-filled so the kernel can write into them. The
    /// shader source + bindings are in tree so that wiring is a
    /// pipeline change, not a from-scratch shader write.
    pub instance_expand: ShaderId,
    /// DOFUS Tier 7: slabbed GPU instance expansion pre-pass.
    /// Reads `Layout::slab_blocks_base` + `descriptor_slab_*` +
    /// `aux_slab_*` and fills the per-stream gaps the slabbed resolve
    /// path reserves. Bound to the SubLibrary buffer at run time via
    /// [`crate::Renderer::set_sub_library_buffer`]; the dispatch is
    /// gated on `layout.n_slab_blocks > 0` in `render.rs` and is
    /// silently skipped when the renderer has no sub-library bound.
    pub instance_expand_slab: ShaderId,
    // 2-level dispatch works for CPU pathtag scan even for large
    // inputs, 3-level is not yet implemented.
    pub pathtag_is_cpu: bool,
}

#[cfg(feature = "wgpu")]
pub(crate) fn full_shaders(
    device: &Device,
    engine: &mut WgpuEngine,
    options: &RendererOptions,
) -> Result<FullShaders, Error> {
    use crate::wgpu_engine::CpuShaderType;
    use BindType::*;

    let mut force_gpu = false;
    let force_gpu_from: Option<&str> = None;
    // Uncomment this to force use of GPU shaders from the specified shader and later even
    // if `engine.use_cpu` is specified.
    //let force_gpu_from = Some("binning");

    #[cfg(feature = "hot_reload")]
    let mut shaders = vello_shaders::compile::ShaderInfo::from_default()?;
    #[cfg(not(feature = "hot_reload"))]
    let shaders = vello_shaders::SHADERS;

    macro_rules! add_shader {
        ($name:ident, $label:expr, $bindings:expr, $cpu:expr) => {{
            if force_gpu_from == Some(stringify!($name)) {
                force_gpu = true;
            }
            #[cfg(feature = "hot_reload")]
            let source = shaders
                .remove(stringify!($name))
                .expect(stringify!($name))
                .source
                .into();
            #[cfg(not(feature = "hot_reload"))]
            let source = shaders.$name.wgsl.code;
            engine.add_compute_shader(
                device,
                concat!("vello.", $label),
                source,
                &$bindings,
                if force_gpu {
                    CpuShaderType::Missing
                } else {
                    $cpu
                },
            )
        }};
        ($name:ident, $bindings:expr, $cpu:expr) => {{ add_shader!($name, stringify!($name), $bindings, $cpu) }};
        ($name:ident, $bindings:expr) => {
            add_shader!(
                $name,
                $bindings,
                CpuShaderType::Present(vello_shaders::cpu::$name)
            )
        };
    }

    // DOFUS Tier 6: GPU instance expansion pre-pass. Registered ahead
    // of pathtag_reduce so a future dispatch lands at the right slot
    // (would run BEFORE the path-tag stream is consumed).
    let instance_expand = add_shader!(instance_expand, [Uniform, Buffer], CpuShaderType::Missing);
    // DOFUS Tier 7: slabbed companion. Same scene binding strategy as
    // `instance_expand` plus a read-only third binding for the GPU
    // sub-library buffer the slot descriptors `sub_offset` into.
    let instance_expand_slab = add_shader!(
        instance_expand_slab,
        [Uniform, Buffer, BufReadOnly],
        CpuShaderType::Missing
    );
    let pathtag_reduce = add_shader!(pathtag_reduce, [Uniform, BufReadOnly, Buffer]);
    let pathtag_reduce2 = add_shader!(
        pathtag_reduce2,
        [BufReadOnly, Buffer],
        CpuShaderType::Skipped
    );
    let pathtag_scan1 = add_shader!(
        pathtag_scan1,
        [BufReadOnly, BufReadOnly, Buffer],
        CpuShaderType::Skipped
    );
    let pathtag_scan = add_shader!(
        pathtag_scan_small,
        [Uniform, BufReadOnly, BufReadOnly, Buffer],
        CpuShaderType::Present(vello_shaders::cpu::pathtag_scan)
    );
    let pathtag_scan_large = add_shader!(
        pathtag_scan_large,
        [Uniform, BufReadOnly, BufReadOnly, Buffer],
        CpuShaderType::Skipped
    );
    let bbox_clear = add_shader!(bbox_clear, [Uniform, Buffer]);
    let flatten = add_shader!(
        flatten,
        [Uniform, BufReadOnly, BufReadOnly, Buffer, Buffer, Buffer]
    );
    let draw_reduce = add_shader!(draw_reduce, [Uniform, BufReadOnly, Buffer]);
    let draw_leaf = add_shader!(
        draw_leaf,
        [
            Uniform,
            BufReadOnly,
            BufReadOnly,
            BufReadOnly,
            Buffer,
            Buffer,
            Buffer,
        ]
    );
    let clip_reduce = add_shader!(clip_reduce, [BufReadOnly, BufReadOnly, Buffer, Buffer]);
    let clip_leaf = add_shader!(
        clip_leaf,
        [
            Uniform,
            BufReadOnly,
            BufReadOnly,
            BufReadOnly,
            BufReadOnly,
            Buffer,
            Buffer,
        ]
    );
    let binning = add_shader!(
        binning,
        [
            Uniform,
            BufReadOnly,
            BufReadOnly,
            BufReadOnly,
            Buffer,
            Buffer,
            Buffer,
            Buffer,
        ]
    );
    let tile_alloc = add_shader!(
        tile_alloc,
        [Uniform, BufReadOnly, BufReadOnly, Buffer, Buffer, Buffer]
    );
    let path_count_setup = add_shader!(path_count_setup, [Buffer, Buffer]);
    let path_count = add_shader!(
        path_count,
        [Uniform, Buffer, BufReadOnly, BufReadOnly, Buffer, Buffer]
    );
    let backdrop = add_shader!(
        backdrop_dyn,
        [Uniform, Buffer, BufReadOnly, Buffer],
        CpuShaderType::Present(vello_shaders::cpu::backdrop)
    );
    let coarse = add_shader!(
        coarse,
        [
            Uniform,
            BufReadOnly,
            BufReadOnly,
            BufReadOnly,
            BufReadOnly,
            BufReadOnly,
            Buffer,
            Buffer,
            Buffer,
        ]
    );
    let path_tiling_setup = add_shader!(path_tiling_setup, [Buffer, Buffer, Buffer]);
    let path_tiling = add_shader!(
        path_tiling,
        [
            Buffer,
            BufReadOnly,
            BufReadOnly,
            BufReadOnly,
            BufReadOnly,
            Buffer,
        ]
    );
    let fine_resources = [
        Uniform,
        BufReadOnly,
        BufReadOnly,
        BufReadOnly,
        Buffer,
        Image(ImageFormat::Rgba8),
        ImageRead(ImageFormat::Rgba8),
        ImageRead(ImageFormat::Rgba8),
        // Mask LUT buffer, used only when MSAA is enabled.
        BufReadOnly,
    ];

    let aa_support = &options.antialiasing_support;
    let fine_area = if aa_support.area {
        Some(add_shader!(
            fine_area,
            fine_resources[..fine_resources.len() - 1],
            CpuShaderType::Missing
        ))
    } else {
        None
    };
    let fine_msaa8 = if aa_support.msaa8 {
        Some(add_shader!(
            fine_msaa8,
            fine_resources,
            CpuShaderType::Missing
        ))
    } else {
        None
    };
    let fine_msaa16 = if aa_support.msaa16 {
        Some(add_shader!(
            fine_msaa16,
            fine_resources,
            CpuShaderType::Missing
        ))
    } else {
        None
    };

    Ok(FullShaders {
        pathtag_reduce,
        pathtag_reduce2,
        pathtag_scan,
        pathtag_scan1,
        pathtag_scan_large,
        bbox_clear,
        flatten,
        draw_reduce,
        draw_leaf,
        clip_reduce,
        clip_leaf,
        binning,
        tile_alloc,
        path_count_setup,
        path_count,
        backdrop,
        coarse,
        path_tiling_setup,
        path_tiling,
        fine_area,
        fine_msaa8,
        fine_msaa16,
        instance_expand,
        instance_expand_slab,
        pathtag_is_cpu: options.use_cpu,
    })
}
