// Copyright 2022 the Vello Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT OR Unlicense

// This must be kept in sync with `ConfigUniform` in `vello_encoding/src/config.rs`
struct Config {
    width_in_tiles: u32,
    height_in_tiles: u32,

    target_width: u32,
    target_height: u32,

    // The initial color applied to the pixels in a tile during the fine stage.
    // The format is packed RGBA8 in MSB order.
    base_color: u32,

    n_drawobj: u32,
    n_path: u32,
    n_clip: u32,

    // To reduce the number of bindings, info and bin data are combined
    // into one buffer.
    bin_data_start: u32,

    // offsets within scene buffer (in u32 units)
    pathtag_base: u32,
    pathdata_base: u32,

    drawtag_base: u32,
    drawdata_base: u32,

    transform_base: u32,
    style_base: u32,

    // DOFUS Tier 6: instance arrays packed at the end of the scene buffer
    // (after `style_base`). `n_instance_transforms` is the count of 6-u32
    // Transform records starting at `instance_transforms_base`. Zero when
    // the encoding had no instanced blocks. Future shader-side instance
    // expansion (pathtag_reduce → flatten → fine) reads
    // `instance_transforms[base + i]` and `instance_color_overlays[base + i*3 + zone]`.
    instance_transforms_base: u32,
    n_instance_transforms: u32,
    instance_color_overlays_base: u32,
    n_instance_color_overlays: u32,
    // DOFUS Tier 6: GPU instance block descriptor table. Each entry is
    // `InstanceBlockGpu` (24 u32 — see `instance_expand.wgsl`) carrying
    // the per-block count + sub byte offsets + splice positions the
    // pre-pass needs to expand marker-emit encodings on the GPU.
    instance_blocks_base: u32,
    n_instance_blocks: u32,

    // DOFUS Tier 7: slabbed instance descriptor regions. `descriptor_slab`
    // is the concatenated `SlabSlotDesc` array across every slabbed
    // block (16 bytes / slot); `aux_slab` is the parallel `SlabSlotAux`
    // array (12 bytes / slot). `slab_blocks` is a per-block GPU
    // descriptor table (`SlabBlockGpu`, 80 bytes each — slot count,
    // region bases, and per-stream gap offset/stride pairs) the
    // expander walks. `instance_xform_*` / `instance_overlay_*` are
    // BYTE offsets / sizes the client uses for narrow `Queue::write_buffer`
    // updates each frame; the existing word-offset / count fields
    // above stay authoritative for shader reads.
    descriptor_slab_base: u32,
    descriptor_slab_size: u32,
    aux_slab_base: u32,
    aux_slab_size: u32,
    slab_blocks_base: u32,
    n_slab_blocks: u32,
    instance_xform_base: u32,
    instance_xform_size: u32,
    instance_overlay_base: u32,
    instance_overlay_size: u32,
    // DOFUS Tier 7: sum(slot_count) across every slabbed block — used
    // as `instance_expand_slab`'s dispatch_x so each workgroup lands
    // straight on a (block, slot) pair via a precomputed prefix walk.
    n_slab_total_slots: u32,
    // DOFUS Tier 7: base of the precomputed slot→(block, slot_in_block)
    // LUT (2 u32 per slot) — O(1) replacement for the per-workgroup block
    // walk in `instance_expand_slab`.
    slab_slot_lut_base: u32,

    // Sizes of bump allocated buffers (in element size units)
    lines_size: u32,
    binning_size: u32,
    tiles_size: u32,
    seg_counts_size: u32,
    segments_size: u32,
    blend_size: u32,
    ptcl_size: u32,
}

// Geometry of tiles and bins

const TILE_WIDTH = 16u;
const TILE_HEIGHT = 16u;
// Number of tiles per bin
const N_TILE_X = 16u;
const N_TILE_Y = 16u;
const N_TILE = N_TILE_X * N_TILE_Y;

// Not currently supporting non-square tiles
const TILE_SCALE = 0.0625;

// The "split" point between using local memory in fine for the blend stack and spilling to the blend_spill buffer.
// A higher value will increase vgpr ("register") pressure in fine, but decrease required dynamic memory allocation.
// If changing, also change in vello_shaders/src/cpu/coarse.rs.
const BLEND_STACK_SPLIT = 4u;

// The following are computed in draw_leaf from the generic gradient parameters
// encoded in the scene, and stored in the gradient's info struct, for
// consumption during fine rasterization.

// Radial gradient kinds
const RAD_GRAD_KIND_CIRCULAR = 1u;
const RAD_GRAD_KIND_STRIP = 2u;
const RAD_GRAD_KIND_FOCAL_ON_CIRCLE = 3u;
const RAD_GRAD_KIND_CONE = 4u;

// Radial gradient flags
const RAD_GRAD_SWAPPED = 1u;
