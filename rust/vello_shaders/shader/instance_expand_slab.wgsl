// Copyright 2022 the Vello Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT OR Unlicense

// DOFUS Tier 7: GPU expander for slabbed instance blocks.
//
// Companion to `instance_expand.wgsl`'s marker-emit kernel — that one
// handles `Encoding::instance_blocks`; this one handles
// `Encoding::instance_slab_blocks` (descriptor-slab variant whose byte
// fingerprint is constant across frames). The resolver
// (`vello_encoding::resolve_slabbed`) reserves a zero-filled per-stream
// gap region at each `INSTANCED_SLAB_BEGIN` marker; this kernel writes
// the host streams of the sub each slot routes to into those gaps and
// patches the NaN sentinel transform that re-routes downstream
// `read_transform` sites to the per-instance affine.
//
// Dispatch: one workgroup per SLOT. The host packs
// `config.n_slab_total_slots = sum(slot_count over slab_blocks)` into
// the config; the kernel reverse-walks `workgroup_id.x` against the
// per-block slot prefix to recover `(block_idx, slot)`. Linear walk is
// acceptable while slab block counts stay small (target: ≤256 per
// band); a precomputed slot→block lookup table can replace it once
// block counts climb.

#import config

@group(0) @binding(0)
var<uniform> config: Config;

// Same single-binding policy as the marker-emit kernel: per-stream
// gaps and descriptor / aux / block tables all live in `scene`, the
// expander writes copies of sub bytes from `sub_library` into those
// gaps and patches the sentinel transform / overlay slots in place.
@group(0) @binding(1)
var<storage, read_write> scene: array<u32>;

// GPU-resident library of unique sub-encodings. Each sub is packed
// stream-major as `[path_tags | path_data | draw_tags | draw_data |
// transforms | styles]` with path_tags padded to a u32 boundary. The
// slot's `sub_offset` (word offset into this buffer) points at the
// first byte of that sub's path_tags.
@group(0) @binding(2)
var<storage, read> sub_library: array<u32>;

struct SlabBlockGpu {
    slot_count: u32,
    transforms_base: u32,
    overlays_base: u32,
    descriptor_slab_offset: u32,
    aux_slab_offset: u32,
    gap_path_tags_offset: u32,
    gap_path_data_offset: u32,
    gap_draw_tags_offset: u32,
    gap_draw_data_offset: u32,
    gap_transforms_offset: u32,
    gap_styles_offset: u32,
    gap_path_tags_stride: u32,
    gap_path_data_stride: u32,
    gap_draw_tags_stride: u32,
    gap_draw_data_stride: u32,
    gap_transforms_stride: u32,
    gap_styles_stride: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
}

struct SlabSlotDesc {
    sub_offset: u32,
    transform_idx: u32,
    color_overlay_idx: u32,
    // Full u32 (not 16-bit packed): complex tile subs exceed 65535 words.
    path_tags_words: u32,
    path_data_words: u32,
}

// SlabSlotAux on the host is 48 bytes / 12 u32: 6 stream-length counts
// (all full u32 now — the old 16-bit packing wrapped for >65535-word
// streams and corrupted the stream offsets) + 6 per-slot dst word offsets.
//
// Tier 7 tight-pack: each *_dst_words is the prefix-sum offset (in u32
// words) where this slot's bytes for that stream are placed inside the
// block's gap region. Cumulative offsets out of pathtag_scan are
// byte-tight across slots; stride-padded gap layout drifted from them
// and slot 1+ read zero-padding instead of their sub bytes. Tight
// packing aligns both views.
struct SlabSlotAux {
    draw_tags_words: u32,
    draw_data_words: u32,
    transforms_words: u32,
    styles_words: u32,
    zone_patches_offset: u32,
    zone_patches_count: u32,
    // per-slot dst word offsets within the block's gap regions.
    path_tags_dst_words: u32,
    path_data_dst_words: u32,
    draw_tags_dst_words: u32,
    draw_data_dst_words: u32,
    styles_dst_words: u32,
    transforms_dst_words: u32,
}

const SLAB_BLOCK_WORDS = 20u;
const SLAB_DESC_WORDS = 5u;
const SLAB_AUX_WORDS = 12u;

const WG_SIZE = 64u;

// Workgroup-broadcast slot decode. Thread 0 walks the per-block slot
// prefix and writes (block_idx, slot_in_block) into shared memory;
// every other thread waits at the barrier and reads the result back.
// Avoids 64 threads doing the same linear walk.
var<workgroup> shared_block_idx: u32;
var<workgroup> shared_slot_in_block: u32;

fn read_block(idx: u32) -> SlabBlockGpu {
    let base = config.slab_blocks_base + idx * SLAB_BLOCK_WORDS;
    var b: SlabBlockGpu;
    b.slot_count = scene[base + 0u];
    b.transforms_base = scene[base + 1u];
    b.overlays_base = scene[base + 2u];
    b.descriptor_slab_offset = scene[base + 3u];
    b.aux_slab_offset = scene[base + 4u];
    b.gap_path_tags_offset = scene[base + 5u];
    b.gap_path_data_offset = scene[base + 6u];
    b.gap_draw_tags_offset = scene[base + 7u];
    b.gap_draw_data_offset = scene[base + 8u];
    b.gap_transforms_offset = scene[base + 9u];
    b.gap_styles_offset = scene[base + 10u];
    b.gap_path_tags_stride = scene[base + 11u];
    b.gap_path_data_stride = scene[base + 12u];
    b.gap_draw_tags_stride = scene[base + 13u];
    b.gap_draw_data_stride = scene[base + 14u];
    b.gap_transforms_stride = scene[base + 15u];
    b.gap_styles_stride = scene[base + 16u];
    return b;
}

fn read_desc(block: SlabBlockGpu, slot: u32) -> SlabSlotDesc {
    // descriptor_slab_offset is a word offset relative to
    // `config.descriptor_slab_base` so the slab table can move without
    // re-walking per-block fields.
    let base = config.descriptor_slab_base + block.descriptor_slab_offset + slot * SLAB_DESC_WORDS;
    var d: SlabSlotDesc;
    d.sub_offset = scene[base + 0u];
    d.transform_idx = scene[base + 1u];
    d.color_overlay_idx = scene[base + 2u];
    d.path_tags_words = scene[base + 3u];
    d.path_data_words = scene[base + 4u];
    return d;
}

fn read_aux(block: SlabBlockGpu, slot: u32) -> SlabSlotAux {
    let base = config.aux_slab_base + block.aux_slab_offset + slot * SLAB_AUX_WORDS;
    var a: SlabSlotAux;
    a.draw_tags_words = scene[base + 0u];
    a.draw_data_words = scene[base + 1u];
    a.transforms_words = scene[base + 2u];
    a.styles_words = scene[base + 3u];
    a.zone_patches_offset = scene[base + 4u];
    a.zone_patches_count = scene[base + 5u];
    a.path_tags_dst_words = scene[base + 6u];
    a.path_data_dst_words = scene[base + 7u];
    a.draw_tags_dst_words = scene[base + 8u];
    a.draw_data_dst_words = scene[base + 9u];
    a.styles_dst_words = scene[base + 10u];
    a.transforms_dst_words = scene[base + 11u];
    return a;
}

@compute @workgroup_size(64)
fn main(
    @builtin(workgroup_id) wg: vec3<u32>,
    @builtin(num_workgroups) nwg: vec3<u32>,
    @builtin(local_invocation_id) lid: vec3<u32>,
) {
    // The host splits the slot dispatch into an X×Y grid to stay under
    // the 65535 per-dimension limit; recover the linear slot index.
    let global_slot = wg.x + wg.y * nwg.x;
    if global_slot >= config.n_slab_total_slots {
        return;
    }

    // Reverse-lookup (block, slot_in_block) via the host-precomputed LUT
    // (two u32 per slot). O(1) — replaces the per-workgroup O(n_slab_blocks)
    // linear walk over the block prefix, which serialized GPU time on
    // unique-look crowds (one block per unique item). One thread reads +
    // broadcasts to keep the access workgroup-uniform.
    if lid.x == 0u {
        let lut = config.slab_slot_lut_base + global_slot * 2u;
        shared_block_idx = scene[lut];
        shared_slot_in_block = scene[lut + 1u];
    }
    workgroupBarrier();

    let block_idx = shared_block_idx;
    if block_idx >= config.n_slab_blocks {
        return;
    }
    let slot = shared_slot_in_block;
    let block = read_block(block_idx);
    let desc = read_desc(block, slot);
    // Sentinel empty slot has sub_offset == 0 and a default aux (all word
    // counts zero). The per-stream memcpy and composition loops then do
    // zero iterations naturally — no early `return` is needed, which
    // keeps the workgroupBarrier() below in unconditional uniform
    // control flow (WGSL's validator rejects barriers reached only by a
    // subset of a workgroup's invocations).
    let aux = read_aux(block, slot);
    let pt_words = desc.path_tags_words;
    let pd_words = desc.path_data_words;
    let dt_words = aux.draw_tags_words;
    let dd_words = aux.draw_data_words;
    // transforms_words is the per-slot Transform RECORD count × 6 u32 (the
    // compose layer already keeps it in u32 word units).
    let xf_words = aux.transforms_words;
    let st_words = aux.styles_words;

    // Sub library layout: streams concatenated path_tags →
    // path_data → draw_tags → draw_data → transforms → styles, each
    // starting on a u32 boundary (path_tags padded). `sub_offset` is
    // the word offset of path_tags within sub_library.
    let pt_src = desc.sub_offset;
    let pd_src = pt_src + pt_words;
    let dt_src = pd_src + pd_words;
    let dd_src = dt_src + dt_words;
    let xf_src = dd_src + dd_words;
    let st_src = xf_src + xf_words;

    // Destination word offsets inside the scene's per-stream gap
    // region for this block.
    //
    // Tier 7 tight-pack: variable-length streams (path_tags, path_data,
    // draw_tags, draw_data, styles) are packed at the prefix-sum offset
    // the host computed in `*_dst_words`. Cumulative `pathseg_offset` /
    // `style_ix` / draw-data offsets out of `pathtag_scan` are byte-tight
    // — stride padding between slots drifted from the cumulative scan and
    // PATHs in slot 1+ read zero padding instead of their sub's bytes.
    //
    // Transforms stay stride-packed: intern-time padding gives every sub
    // exactly `SUB_TRANSFORM_STRIDE` records so the cumulative TRANSFORM
    // tag count equals `(K+1) * STRIDE` at the end of slot K's path_tags.
    // That matches `slot * stride * 6u` exactly, so no per-slot prefix
    // sum is needed for the transforms gap.
    let pt_dst = block.gap_path_tags_offset + aux.path_tags_dst_words;
    let pd_dst = block.gap_path_data_offset + aux.path_data_dst_words;
    let dt_dst = block.gap_draw_tags_offset + aux.draw_tags_dst_words;
    let dd_dst = block.gap_draw_data_offset + aux.draw_data_dst_words;
    let xf_dst = block.gap_transforms_offset + aux.transforms_dst_words;
    let st_dst = block.gap_styles_offset + aux.styles_dst_words;

    for (var i = lid.x; i < pt_words; i += WG_SIZE) {
        scene[pt_dst + i] = sub_library[pt_src + i];
    }
    for (var i = lid.x; i < pd_words; i += WG_SIZE) {
        scene[pd_dst + i] = sub_library[pd_src + i];
    }
    for (var i = lid.x; i < dt_words; i += WG_SIZE) {
        scene[dt_dst + i] = sub_library[dt_src + i];
    }
    for (var i = lid.x; i < dd_words; i += WG_SIZE) {
        scene[dd_dst + i] = sub_library[dd_src + i];
    }
    // NOTE: transforms are NOT memcpy'd in parallel — thread 0 reads
    // them straight out of `sub_library` and writes the composed
    // `world * local` result directly into the scene gap below. Doing
    // both in the same thread eliminates the cross-thread dependency
    // that would otherwise require a workgroupBarrier between memcpy
    // and composition (rejected by WGSL uniformity rules downstream of
    // the function's earlier early returns).
    for (var i = lid.x; i < st_words; i += WG_SIZE) {
        scene[st_dst + i] = sub_library[st_src + i];
    }

    // DOFUS Tier 7 unified: compose `world * local` for EVERY transform
    // record in the slot's gap. The legacy single-NaN-sentinel write
    // only routed the first transform through `instance_transforms[idx]`
    // and left the other locals untouched — incorrect for bodies whose
    // segment sub-encodings carry multiple per-sub-shape local
    // transforms (each fill op encodes its own positioning matrix). The
    // host writes the slot's world affine into
    // `instance_transforms[transform_idx]` before this dispatch; we read
    // it and multiply into every local in the gap.
    //
    // Driven single-threaded from lid.x == 0u — avoids the need for a
    // workgroupBarrier between the parallel memcpy of `xf_words` u32s
    // and the per-record read/multiply/write here. Per-slot transform
    // counts are tiny (1–6 records per body segment), so the cost of
    // running serially is negligible compared to the overall workgroup
    // dispatch overhead. WGSL's uniformity rules reject barriers that
    // sit downstream of the earlier-in-the-function early returns even
    // when the returns are runtime-uniform; serial execution sidesteps
    // the entire question.
    //
    // Matrix convention matches `vello_encoding::Transform::Mul`
    // (column-major `[m00, m10, m01, m11]`):
    //   result.matrix[0] = a.matrix[0]*b.matrix[0] + a.matrix[2]*b.matrix[1]
    //   result.matrix[1] = a.matrix[1]*b.matrix[0] + a.matrix[3]*b.matrix[1]
    //   result.matrix[2] = a.matrix[0]*b.matrix[2] + a.matrix[2]*b.matrix[3]
    //   result.matrix[3] = a.matrix[1]*b.matrix[2] + a.matrix[3]*b.matrix[3]
    //   result.translation = a.matrix * b.translation + a.translation
    // DOFUS Tier 7: compose `world * local` for EVERY transform record
    // in the slot's gap. Intern-time padding guarantees `sub_library`
    // holds exactly `SUB_TRANSFORM_STRIDE` records per sub (authored
    // records plus identity padding to fill the stride), so we
    // unconditionally process `xf_words / 6` records here. The first
    // N actual transforms get a real composed matrix (twip-space sub
    // coords → screen via world). The pad positions get `world *
    // identity == world` which is correct because no PATH tag in this
    // sub references those positions.
    //
    // Matrix convention matches `vello_encoding::Transform::Mul`
    // (column-major `[m00, m10, m01, m11]`):
    //   result.matrix[0] = a.matrix[0]*b.matrix[0] + a.matrix[2]*b.matrix[1]
    //   result.matrix[1] = a.matrix[1]*b.matrix[0] + a.matrix[3]*b.matrix[1]
    //   result.matrix[2] = a.matrix[0]*b.matrix[2] + a.matrix[2]*b.matrix[3]
    //   result.matrix[3] = a.matrix[1]*b.matrix[2] + a.matrix[3]*b.matrix[3]
    //   result.translation = a.matrix * b.translation + a.translation
    //
    // Single-threaded under lid.x == 0 so no workgroupBarrier is needed
    // between the parallel stream memcpys above and this loop —
    // WGSL's uniformity validator rejects barriers downstream of the
    // function's earlier early-returns even when they are runtime
    // uniform. Per-slot record count is small (32 by current STRIDE)
    // so the serial cost is negligible against the workgroup dispatch
    // overhead.
    if lid.x == 0u {
        let world_off = config.instance_transforms_base + desc.transform_idx * 6u;
        let world_m0 = bitcast<f32>(scene[world_off + 0u]);
        let world_m1 = bitcast<f32>(scene[world_off + 1u]);
        let world_m2 = bitcast<f32>(scene[world_off + 2u]);
        let world_m3 = bitcast<f32>(scene[world_off + 3u]);
        let world_t0 = bitcast<f32>(scene[world_off + 4u]);
        let world_t1 = bitcast<f32>(scene[world_off + 5u]);
        let n_xf = xf_words / 6u;
        for (var i: u32 = 0u; i < n_xf; i = i + 1u) {
            let local_off = xf_dst + i * 6u;
            let src_off = xf_src + i * 6u;
            let local_m0 = bitcast<f32>(sub_library[src_off + 0u]);
            let local_m1 = bitcast<f32>(sub_library[src_off + 1u]);
            let local_m2 = bitcast<f32>(sub_library[src_off + 2u]);
            let local_m3 = bitcast<f32>(sub_library[src_off + 3u]);
            let local_t0 = bitcast<f32>(sub_library[src_off + 4u]);
            let local_t1 = bitcast<f32>(sub_library[src_off + 5u]);
            let r_m0 = world_m0 * local_m0 + world_m2 * local_m1;
            let r_m1 = world_m1 * local_m0 + world_m3 * local_m1;
            let r_m2 = world_m0 * local_m2 + world_m2 * local_m3;
            let r_m3 = world_m1 * local_m2 + world_m3 * local_m3;
            let r_t0 = world_m0 * local_t0 + world_m2 * local_t1 + world_t0;
            let r_t1 = world_m1 * local_t0 + world_m3 * local_t1 + world_t1;
            scene[local_off + 0u] = bitcast<u32>(r_m0);
            scene[local_off + 1u] = bitcast<u32>(r_m1);
            scene[local_off + 2u] = bitcast<u32>(r_m2);
            scene[local_off + 3u] = bitcast<u32>(r_m3);
            scene[local_off + 4u] = bitcast<u32>(r_t0);
            scene[local_off + 5u] = bitcast<u32>(r_t1);
        }
    }

    // DOFUS: per-slot zone-patch application. Each ZonePatchGpu is a
    // packed u32 — low 16 bits = draw_data offset INSIDE the sub-
    // encoding's draw_data stream, bits 16..24 = zone (0..2), bits
    // 24..32 = authored alpha. The player's per-zone RGB lives at
    // `instance_color_overlays_base + slot*3 + zone` (host pre-seeded
    // before this kernel ran). Apply premultiplied alpha blend and
    // write the result into the slot's draw_data gap. Driven by
    // workgroup thread 0 — patch counts are tiny (≤ ~8 per body
    // segment) so the 64-way parallel walk would mostly idle.
    let zp_count = aux.zone_patches_count;
    if lid.x == 0u && zp_count > 0u {
        let overlay_base = config.instance_color_overlays_base
            + block.overlays_base + slot * 3u;
        for (var i: u32 = 0u; i < zp_count; i += 1u) {
            let zp = sub_library[aux.zone_patches_offset + i];
            let offset_in_sub = zp & 0xFFFFu;
            let zone = (zp >> 16u) & 0xFFu;
            let alpha = (zp >> 24u) & 0xFFu;
            // Player color packed as little-endian RGBA u32 by the host.
            // A=0 = zone unset (canonical colour == -1): skip the write so
            // the authored fill shows through.
            let player_color = scene[overlay_base + zone];
            if (player_color >> 24u) == 0u {
                continue;
            }
            let r_raw = player_color & 0xFFu;
            let g_raw = (player_color >> 8u) & 0xFFu;
            let b_raw = (player_color >> 16u) & 0xFFu;
            // Premultiplied blend: (c * a + 127) / 255 per channel.
            let r = (r_raw * alpha + 127u) / 255u;
            let g = (g_raw * alpha + 127u) / 255u;
            let b = (b_raw * alpha + 127u) / 255u;
            let rgba = r | (g << 8u) | (b << 16u) | (alpha << 24u);
            scene[dd_dst + offset_in_sub] = rgba;
        }
    }
}
