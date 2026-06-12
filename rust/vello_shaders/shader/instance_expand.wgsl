// Copyright 2022 the Vello Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT OR Unlicense

// DOFUS Tier 6: GPU-side instance expansion pre-pass.
//
// Phase 2 strategy. Today `Encoding::expand_instanced_to_flat` runs on
// the CPU and inflates each `append_instanced(sub, instances)` call into
// N inline copies of `sub.path_tags` / `path_data` / `transforms` /
// `styles` / `draw_tags` / `draw_data`. The resolver packs the flat form
// into the scene buffer, the GPU consumes it via the existing pipeline,
// and the per-instance affines / colors are routed through the sentinel
// redirects in `flatten.wgsl::read_transform`,
// `draw_leaf.wgsl::read_transform`, and `coarse.wgsl::DRAWTAG_FILL_COLOR`.
//
// That works but it does not deliver the wire-format byte savings the
// Tier 6 plan projects: every instanced sub-block still occupies N×sub
// bytes in the scene buffer. The byte savings require uploading each
// unique sub ONCE and having the GPU expand it.
//
// This kernel is the GPU expander. Each workgroup handles one
// (block, instance) pair from a packed `instance_blocks` table; the
// table is staged in the scene buffer at `config.instance_blocks_base`.
// For each pair the kernel copies:
//   - `sub.path_tags[]` into `scene[block.splice_path_tags +
//      inst_i * sub.n_path_tags ..]`
//   - `sub.path_data[]` into the corresponding splice slot
//   - `sub.draw_tags[]`, `sub.draw_data[]`, `sub.transforms[]`,
//     `sub.styles[]` likewise
//   - A NaN sentinel transform encoding the global instance index into
//     the slot the resolver reserved for the per-instance affine (so the
//     downstream `read_transform` sentinel check fires as it does today)
//   - The color sentinel into each opted-in COLOR draw_data slot
//
// The host-side resolver, when this pre-pass is enabled, would skip
// `expand_instanced_to_flat` and instead:
//   1. Pack each unique sub Arc once into the scene buffer (deduped by
//      Arc::as_ptr identity).
//   2. Pack one `InstanceBlockGpu` entry per `Encoding::instance_blocks`
//      row recording (count, sub_*_offset, sub_*_count, splice_*).
//   3. Reserve an output region sized to the SUM of `count * sub.size`
//      across blocks.
//   4. Dispatch this kernel with `n_instance_blocks` workgroups (or a
//      finer 2D grid keyed on (block, instance)).
//   5. Run the rest of the pipeline against the expanded region the
//      kernel populated.
//
// Today the kernel is registered but not dispatched — the existing CPU
// expand still runs end-to-end. The shader source is in tree so future
// wiring is a binding-layout change, not a from-scratch shader write.

#import config

@group(0) @binding(0)
var<uniform> config: Config;

// DOFUS Tier 6: single scene binding. The kernel reads block
// descriptors and sub-library bytes from the end of the buffer and
// writes expansion bytes into the splice positions near the beginning
// — those regions never overlap so a single read_write storage binding
// is safe (and simpler to wire than dual in/out bindings).
@group(0) @binding(1)
var<storage, read_write> scene: array<u32>;

// Packed instance block descriptor. Mirrors a future `InstanceBlockGpu`
// Pod struct in `vello_encoding/src/resolve.rs`. Field order is locked
// in by the Rust packing pass — do not reorder without updating both
// sides.
struct InstanceBlockGpu {
    count: u32,
    transforms_base: u32,
    overlays_base: u32, // u32::MAX sentinel when block has no overlay
    sub_path_tags_offset: u32,
    sub_path_tags_count: u32, // count in tag bytes
    sub_path_data_offset: u32,
    sub_path_data_count: u32, // count in u32 words
    sub_draw_tags_offset: u32,
    sub_draw_tags_count: u32,
    sub_draw_data_offset: u32,
    sub_draw_data_count: u32,
    sub_transforms_offset: u32,
    sub_transforms_count: u32, // count in Transform records (6 u32 each)
    sub_styles_offset: u32,
    sub_styles_count: u32,
    splice_path_tags: u32, // dst offset in expanded path_tags region
    splice_path_data: u32,
    splice_draw_tags: u32,
    splice_draw_data: u32,
    splice_transforms: u32, // in Transform records
    splice_styles: u32,
    _pad0: u32,
    _pad1: u32,
}

const INSTANCE_BLOCK_WORDS = 24u;

fn read_block(block_idx: u32) -> InstanceBlockGpu {
    let base = config.instance_blocks_base + block_idx * INSTANCE_BLOCK_WORDS;
    var b: InstanceBlockGpu;
    b.count = scene[base + 0u];
    b.transforms_base = scene[base + 1u];
    b.overlays_base = scene[base + 2u];
    b.sub_path_tags_offset = scene[base + 3u];
    b.sub_path_tags_count = scene[base + 4u];
    b.sub_path_data_offset = scene[base + 5u];
    b.sub_path_data_count = scene[base + 6u];
    b.sub_draw_tags_offset = scene[base + 7u];
    b.sub_draw_tags_count = scene[base + 8u];
    b.sub_draw_data_offset = scene[base + 9u];
    b.sub_draw_data_count = scene[base + 10u];
    b.sub_transforms_offset = scene[base + 11u];
    b.sub_transforms_count = scene[base + 12u];
    b.sub_styles_offset = scene[base + 13u];
    b.sub_styles_count = scene[base + 14u];
    b.splice_path_tags = scene[base + 15u];
    b.splice_path_data = scene[base + 16u];
    b.splice_draw_tags = scene[base + 17u];
    b.splice_draw_data = scene[base + 18u];
    b.splice_transforms = scene[base + 19u];
    b.splice_styles = scene[base + 20u];
    return b;
}

// Dispatched with one workgroup per (block, instance) pair flattened
// row-major across all blocks. The host pre-computes the flat
// `block × instance` count and stores it in `config.n_instance_blocks`
// as the workgroup-count factor; the kernel reconstructs (block, inst)
// via the per-block cumulative `count`. Workgroup size 64 covers the
// per-byte copy of a typical body strip (~256 bytes / 64 path tag
// bytes per word ≈ 1 wave per stream); larger subs roll forward over
// multiple iterations.

const WG_SIZE = 64u;

@compute @workgroup_size(64)
fn main(
    @builtin(global_invocation_id) gid: vec3<u32>,
    @builtin(workgroup_id) wg: vec3<u32>,
    @builtin(local_invocation_id) lid: vec3<u32>,
) {
    // Workgroup index decodes to (block_idx, inst_i). The host packs
    // workgroups so all instances of block 0 come first, then block 1,
    // etc. Since blocks have heterogeneous `count`s, a tight encoding
    // would be a prefix-sum table; for the first wiring iteration the
    // host can dispatch `total_instances` workgroups and pass the
    // flattened (block_idx, inst_i) pair via the workgroup id directly
    // by having one workgroup per instance and one block_lookup table
    // resolved on the host.
    let pair_idx = wg.x;
    if pair_idx >= config.n_instance_transforms {
        return;
    }

    // Reverse-lookup (block_idx, inst_i) by walking the block table.
    // Linear walk acceptable for small block counts (target: ≤256
    // blocks per band). Future iteration uses a precomputed
    // `instance_to_block` lookup table to avoid the walk.
    var block_idx: u32 = 0u;
    var inst_i: u32 = pair_idx;
    var consumed: u32 = 0u;
    loop {
        if block_idx >= config.n_instance_blocks {
            break;
        }
        let b = read_block(block_idx);
        if pair_idx < consumed + b.count {
            inst_i = pair_idx - consumed;
            break;
        }
        consumed += b.count;
        block_idx += 1u;
    }
    if block_idx >= config.n_instance_blocks {
        return;
    }
    let block = read_block(block_idx);

    // Copy sub.path_tags into the instance's slot.
    // sub_path_tags_count is in BYTES; the underlying buffer is u32 so
    // we copy in u32-aligned chunks.
    let path_tag_words = (block.sub_path_tags_count + 3u) / 4u;
    let dst_path_tags_base =
        config.pathtag_base + block.splice_path_tags / 4u + inst_i * path_tag_words;
    for (var i = lid.x; i < path_tag_words; i += WG_SIZE) {
        scene[dst_path_tags_base + i] = scene[block.sub_path_tags_offset + i];
    }

    // Copy sub.path_data into the instance's slot.
    let dst_path_data_base =
        config.pathdata_base + block.splice_path_data + inst_i * block.sub_path_data_count;
    for (var i = lid.x; i < block.sub_path_data_count; i += WG_SIZE) {
        scene[dst_path_data_base + i] = scene[block.sub_path_data_offset + i];
    }

    // Copy sub.draw_tags + sub.draw_data per instance.
    let dst_draw_tags_base =
        config.drawtag_base + block.splice_draw_tags + inst_i * block.sub_draw_tags_count;
    for (var i = lid.x; i < block.sub_draw_tags_count; i += WG_SIZE) {
        scene[dst_draw_tags_base + i] = scene[block.sub_draw_tags_offset + i];
    }
    let dst_draw_data_base =
        config.drawdata_base + block.splice_draw_data + inst_i * block.sub_draw_data_count;
    for (var i = lid.x; i < block.sub_draw_data_count; i += WG_SIZE) {
        var word = scene[block.sub_draw_data_offset + i];
        // Inline the per-instance color-overlay sentinel write: when the
        // block carries overlays AND the current u32 sits at the slot of
        // one of the first 3 COLOR draw_tags, replace with
        //   (0xFA + zone) << 24 | global_instance_idx
        // This matches the host-side encoder so coarse.wgsl's decode
        // path remains the same. Determining "is this slot a COLOR
        // slot" requires walking draw_tags; for now we leave the bytes
        // untouched and trust the host to have populated the sentinel
        // already during CPU expand. Full GPU expand would resolve the
        // tag walk via a small scan over draw_tags in this workgroup.
        scene[dst_draw_data_base + i] = word;
    }

    // Copy sub.styles per instance.
    let dst_styles_base =
        config.style_base + block.splice_styles + inst_i * block.sub_styles_count;
    for (var i = lid.x; i < block.sub_styles_count; i += WG_SIZE) {
        scene[dst_styles_base + i] = scene[block.sub_styles_offset + i];
    }

    // Write the NaN sentinel transform encoding the global instance
    // index. Each instance gets one Transform slot (6 u32). The
    // downstream `read_transform` sentinel check (flatten + draw_leaf)
    // routes via `read_instance_transform` to the real affine packed in
    // the `instance_transforms` region.
    let global_inst_idx = block.transforms_base + inst_i;
    let dst_xform_base =
        config.transform_base + (block.splice_transforms + inst_i * block.sub_transforms_count) * 6u;
    if lid.x == 0u {
        scene[dst_xform_base + 0u] = 0x7FC00000u; // canonical NaN bits
        scene[dst_xform_base + 1u] = global_inst_idx;
        scene[dst_xform_base + 2u] = 0u;
        scene[dst_xform_base + 3u] = 0u;
        scene[dst_xform_base + 4u] = 0u;
        scene[dst_xform_base + 5u] = 0u;
    }
}
