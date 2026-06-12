//! DOFUS Tier 7: slabbed resolve path — packs the scene buffer with
//! per-stream gap reservations at each `INSTANCED_SLAB_BEGIN` marker so
//! vello's `reuse_fast` fingerprint stays constant frame-to-frame.

use bytemuck::{Pod, Zeroable};

use crate::resolve::{Layout, align_up, size_to_words};
use crate::{DrawTag, Encoding, PathTag};

/// GPU-side slabbed instance block descriptor.
///
/// 80 bytes / 20 u32 per record. Field order must match the
/// `SlabBlockGpu` struct read by `instance_expand.wgsl`'s slabbed
/// branch. Per-block: slot count + region bases + stride / offset pairs
/// for the six host streams the GPU expander writes into the reserved
/// gaps.
#[derive(Copy, Clone, Debug, Default, Zeroable, Pod)]
#[repr(C)]
pub struct SlabBlockGpu {
    pub slot_count: u32,
    pub transforms_base: u32,
    pub overlays_base: u32,
    pub descriptor_slab_offset: u32,
    pub aux_slab_offset: u32,
    pub gap_path_tags_offset: u32,
    pub gap_path_data_offset: u32,
    pub gap_draw_tags_offset: u32,
    pub gap_draw_data_offset: u32,
    pub gap_transforms_offset: u32,
    pub gap_styles_offset: u32,
    pub gap_path_tags_stride: u32,
    pub gap_path_data_stride: u32,
    pub gap_draw_tags_stride: u32,
    pub gap_draw_data_stride: u32,
    pub gap_transforms_stride: u32,
    pub gap_styles_stride: u32,
    pub _pad0: u32,
    pub _pad1: u32,
    pub _pad2: u32,
}

/// DOFUS Tier 7 tight-pack: each per-stream gap is reserved at exactly
/// the block's summed per-slot word total — the GPU expander writes each
/// slot at its prefix-sum `SlabSlotAux::*_dst_words` offset, so the sum
/// of the actual per-slot sizes is the precise gap the stream needs.
/// Every total is a u32-word count (path tags are padded to u32, each
/// `Transform` contributes 6 words), so all six are `words * 4` bytes.
fn gap_path_tags_bytes(b: &crate::SlabbedInstanceBlock) -> usize {
    b.stream_totals.path_tags_words as usize * size_of::<u32>()
}

fn gap_path_data_bytes(b: &crate::SlabbedInstanceBlock) -> usize {
    b.stream_totals.path_data_words as usize * size_of::<u32>()
}

fn gap_draw_tags_bytes(b: &crate::SlabbedInstanceBlock) -> usize {
    b.stream_totals.draw_tags_words as usize * size_of::<u32>()
}

fn gap_draw_data_bytes(b: &crate::SlabbedInstanceBlock) -> usize {
    b.stream_totals.draw_data_words as usize * size_of::<u32>()
}

fn gap_transforms_bytes(b: &crate::SlabbedInstanceBlock) -> usize {
    b.stream_totals.transforms_words as usize * size_of::<u32>()
}

fn gap_styles_bytes(b: &crate::SlabbedInstanceBlock) -> usize {
    b.stream_totals.styles_words as usize * size_of::<u32>()
}

/// Sums of every per-block gap byte size, used for buffer pre-sizing.
struct GapTotals {
    path_tags: usize,
    path_data: usize,
    draw_tags: usize,
    draw_data: usize,
    transforms: usize,
    styles: usize,
}

impl GapTotals {
    fn from(encoding: &Encoding) -> Self {
        let mut t = Self {
            path_tags: 0,
            path_data: 0,
            draw_tags: 0,
            draw_data: 0,
            transforms: 0,
            styles: 0,
        };
        for b in &encoding.instance_slab_blocks {
            t.path_tags += gap_path_tags_bytes(b);
            t.path_data += gap_path_data_bytes(b);
            t.draw_tags += gap_draw_tags_bytes(b);
            t.draw_data += gap_draw_data_bytes(b);
            t.transforms += gap_transforms_bytes(b);
            t.styles += gap_styles_bytes(b);
        }
        t
    }
}

/// Resolves an encoding whose `instance_slab_blocks` array is non-empty.
/// Walks every host stream once, splicing a zeroed gap region at each
/// slab marker. Records per-block byte offsets so the GPU expander can
/// fill the gaps in place. Returns a `Layout` whose new Tier 7 fields
/// (`descriptor_slab_*`, `aux_slab_*`, `slab_blocks_*`,
/// `instance_xform_*`, `instance_overlay_*`) are populated.
pub(crate) fn resolve_slabbed(encoding: &Encoding, packed: &mut Vec<u8>) -> Layout {
    assert!(
        encoding.resources.patches.is_empty(),
        "slabbed resolve doesn't support late bound resources",
    );
    assert!(
        encoding.instance_blocks.is_empty(),
        "slabbed resolve doesn't mix with marker-emit instance_blocks",
    );
    let data = packed;
    data.clear();
    let mut layout = Layout {
        n_paths: encoding.n_paths,
        n_clips: encoding.n_clips,
        ..Layout::default()
    };
    let gaps = GapTotals::from(encoding);

    // Path tag gap accounting feeds into `path_tag_padded` so the
    // PATH_REDUCE_WG alignment holds AFTER gap insertion. Without this
    // the padded length would be too short and `align_up` would shrink
    // back below the gap region.
    let host_pt = encoding.path_tags.len() + encoding.n_open_clips as usize;
    let path_tag_padded = align_up(host_pt + gaps.path_tags, 4 * crate::config::PATH_REDUCE_WG);

    // Block-local gap offsets are filled in as we walk the streams. The
    // descriptor table is finalised after the last region is packed.
    let mut blocks_gpu: Vec<SlabBlockGpu> = encoding
        .instance_slab_blocks
        .iter()
        // The `gap_*_stride` fields are vestigial under tight-packing:
        // the GPU expander addresses every slot through its prefix-sum
        // `SlabSlotAux::*_dst_words` offset, never a uniform per-slot
        // stride, so they stay zero (the struct keeps them only to hold
        // the GPU-side ABI word count stable).
        .map(|b| SlabBlockGpu {
            slot_count: b.slot_count,
            transforms_base: b.transforms_base,
            overlays_base: b.overlays_base,
            ..Default::default()
        })
        .collect();

    // Path tag stream: walk host bytes, at each slab marker reserve a
    // zeroed gap sized to slot_count * stride. The marker byte itself
    // is consumed by the gap (drop it like the marker-emit path drops
    // INSTANCED_BEGIN).
    layout.path_tag_base = size_to_words(data.len());
    {
        let mut cur = 0usize;
        for (i, b) in encoding.instance_slab_blocks.iter().enumerate() {
            let splice = b.splice_path_tags as usize;
            data.extend_from_slice(bytemuck::cast_slice(&encoding.path_tags[cur..splice]));
            blocks_gpu[i].gap_path_tags_offset = size_to_words(data.len());
            data.resize(data.len() + gap_path_tags_bytes(b), 0);
            cur = splice + 1;
        }
        data.extend_from_slice(bytemuck::cast_slice(&encoding.path_tags[cur..]));
        for _ in 0..encoding.n_open_clips {
            data.extend_from_slice(bytemuck::bytes_of(&PathTag::PATH));
        }
        data.resize(path_tag_padded, 0);
    }

    // The remaining five streams aren't currently spliced by
    // `begin_slab_block` (no splice_* fields beyond path_tags), so the
    // gap goes at the END of each stream block-by-block. Order: pack
    // host bytes, then for each slab block append a zeroed gap and
    // record its offset. This keeps the byte layout stable and gives
    // the GPU expander a contiguous per-block write region per stream.

    layout.path_data_base = size_to_words(data.len());
    data.extend_from_slice(bytemuck::cast_slice(&encoding.path_data));
    for (i, b) in encoding.instance_slab_blocks.iter().enumerate() {
        blocks_gpu[i].gap_path_data_offset = size_to_words(data.len());
        data.resize(data.len() + gap_path_data_bytes(b), 0);
    }

    layout.draw_tag_base = size_to_words(data.len());
    // `bin_data_start` partitions `info_bin_data` into the draw-info
    // section (written by draw_leaf) and binning's allocation region.
    // The GPU draw-monoid scan accumulates info offsets over the
    // EXPANDED tag stream — host tags plus every slab slot's sub tags —
    // so the slab blocks' summed per-sub info sizes must be included.
    // With host tags alone (empty for slab bands) binning's element
    // indices land on top of the draw info `coarse` reads, corrupting
    // fill flags / gradient transforms whenever that frame's bin
    // allocations reach a live info word.
    layout.bin_data_start = encoding
        .draw_tags
        .iter()
        .map(|tag| tag.info_size())
        .sum::<u32>()
        + encoding
            .instance_slab_blocks
            .iter()
            .map(|b| b.stream_totals.draw_info_words)
            .sum::<u32>();
    data.extend_from_slice(bytemuck::cast_slice(&encoding.draw_tags));
    for _ in 0..encoding.n_open_clips {
        data.extend_from_slice(bytemuck::bytes_of(&DrawTag::END_CLIP));
    }
    for (i, b) in encoding.instance_slab_blocks.iter().enumerate() {
        blocks_gpu[i].gap_draw_tags_offset = size_to_words(data.len());
        data.resize(data.len() + gap_draw_tags_bytes(b), 0);
    }

    layout.draw_data_base = size_to_words(data.len());
    data.extend_from_slice(bytemuck::cast_slice(&encoding.draw_data));
    for (i, b) in encoding.instance_slab_blocks.iter().enumerate() {
        blocks_gpu[i].gap_draw_data_offset = size_to_words(data.len());
        data.resize(data.len() + gap_draw_data_bytes(b), 0);
    }

    layout.transform_base = size_to_words(data.len());
    data.extend_from_slice(bytemuck::cast_slice(&encoding.transforms));
    for (i, b) in encoding.instance_slab_blocks.iter().enumerate() {
        blocks_gpu[i].gap_transforms_offset = size_to_words(data.len());
        data.resize(data.len() + gap_transforms_bytes(b), 0);
    }

    layout.style_base = size_to_words(data.len());
    data.extend_from_slice(bytemuck::cast_slice(&encoding.styles));
    for (i, b) in encoding.instance_slab_blocks.iter().enumerate() {
        blocks_gpu[i].gap_styles_offset = size_to_words(data.len());
        data.resize(data.len() + gap_styles_bytes(b), 0);
    }

    // Instance transforms: byte-base/size for narrow writes, plus the
    // existing word-base/count for shader reads.
    let xform_byte_base = data.len();
    layout.instance_xform_base = xform_byte_base as u32;
    layout.instance_transforms_base = size_to_words(data.len());
    layout.n_instance_transforms = encoding.instance_transforms.len() as u32;
    data.extend_from_slice(bytemuck::cast_slice(&encoding.instance_transforms));
    layout.instance_xform_size = (data.len() - xform_byte_base) as u32;

    let overlay_byte_base = data.len();
    layout.instance_overlay_base = overlay_byte_base as u32;
    layout.instance_color_overlays_base = size_to_words(data.len());
    layout.n_instance_color_overlays = encoding.instance_color_overlays.len() as u32;
    data.extend_from_slice(bytemuck::cast_slice(&encoding.instance_color_overlays));
    layout.instance_overlay_size = (data.len() - overlay_byte_base) as u32;

    // Descriptor slab: per-block concatenation of SlabSlotDesc. The
    // per-block `descriptor_slab_offset` is a word offset relative to
    // `layout.descriptor_slab_base` so the GPU expander can index it
    // independently of any later region's base.
    layout.descriptor_slab_base = size_to_words(data.len());
    for (i, b) in encoding.instance_slab_blocks.iter().enumerate() {
        blocks_gpu[i].descriptor_slab_offset =
            size_to_words(data.len()) - layout.descriptor_slab_base;
        debug_assert_eq!(b.descriptors.len(), b.slot_count as usize);
        data.extend_from_slice(bytemuck::cast_slice(&b.descriptors));
    }
    layout.descriptor_slab_size = size_to_words(data.len()) - layout.descriptor_slab_base;

    // Aux slab: parallel to descriptor slab. SlabSlotAux is 40 bytes
    // (16 bytes of stream lens + 20 bytes of tight-pack dst offsets +
    // 4 byte pad) so each aux record is already u32-aligned.
    layout.aux_slab_base = size_to_words(data.len());
    for (i, b) in encoding.instance_slab_blocks.iter().enumerate() {
        blocks_gpu[i].aux_slab_offset = size_to_words(data.len()) - layout.aux_slab_base;
        debug_assert_eq!(b.aux_stream_lens.len(), b.slot_count as usize);
        data.extend_from_slice(bytemuck::cast_slice(&b.aux_stream_lens));
    }
    layout.aux_slab_size = size_to_words(data.len()) - layout.aux_slab_base;

    layout.slab_blocks_base = size_to_words(data.len());
    layout.n_slab_blocks = blocks_gpu.len() as u32;
    data.extend_from_slice(bytemuck::cast_slice(&blocks_gpu));

    // Total slot count across every block: the GPU expander dispatches
    // one workgroup per slot, so this is the kernel's dispatch_x. Walks
    // `blocks_gpu` (already built) instead of the original encoding so
    // any future block-derived adjustment (e.g. sentinel padding) stays
    // in lock-step.
    layout.n_slab_total_slots = blocks_gpu.iter().map(|b| b.slot_count).sum();

    // Precomputed slot→(block, slot_in_block) lookup: two u32 per global
    // slot. `instance_expand_slab` reads this in O(1) instead of walking
    // every block per workgroup — the per-workgroup O(n_slab_blocks) walk
    // serialized GPU time on unique-look crowds (one block per unique item,
    // hundreds of blocks). Riding in the packed scene buffer keeps it under
    // the band's `reuse_fast` once the slot set is stable.
    layout.slab_slot_lut_base = size_to_words(data.len());
    let mut slot_lut: Vec<u32> = Vec::with_capacity(layout.n_slab_total_slots as usize * 2);
    for (bi, b) in blocks_gpu.iter().enumerate() {
        for s in 0..b.slot_count {
            slot_lut.push(bi as u32);
            slot_lut.push(s);
        }
    }
    data.extend_from_slice(bytemuck::cast_slice(&slot_lut));

    layout.n_draw_objects = layout.n_paths;
    layout
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Transform;
    use crate::slabbed::{
        SlabSlotAux, SlabSlotDesc, SlabStreamTotals, begin_slab_block, slab_block_set_slot,
        slab_block_set_stream_totals,
    };

    fn make_slabbed_encoding(slot_count: u32, totals: SlabStreamTotals) -> Encoding {
        let mut enc = Encoding::default();
        let block_idx = begin_slab_block(&mut enc, slot_count);
        slab_block_set_stream_totals(&mut enc, block_idx, totals);
        enc
    }

    #[test]
    fn slab_block_gpu_is_80_bytes() {
        assert_eq!(std::mem::size_of::<SlabBlockGpu>(), 80);
    }

    #[test]
    fn round_trip_layout_sizes() {
        let totals = SlabStreamTotals {
            path_tags_words: 3,
            path_data_words: 5,
            draw_tags_words: 2,
            draw_data_words: 4,
            transforms_words: 6,
            styles_words: 1,
            draw_info_words: 0,
        };
        let mut enc = make_slabbed_encoding(4, totals);
        // Populate two slots with non-sentinel descriptors so the
        // resolver walks both populated and empty slots — the byte
        // layout must be identical regardless.
        let desc = SlabSlotDesc {
            sub_offset: 0x100,
            transform_idx: 1,
            color_overlay_idx: u32::MAX,
            path_tags_words: 3,
            path_data_words: 5,
        };
        let aux = SlabSlotAux {
            draw_tags_words: 2,
            draw_data_words: 4,
            transforms_words: 1,
            styles_words: 1,
            zone_patches_offset: 0,
            zone_patches_count: 0,
            path_tags_dst_words: 0,
            path_data_dst_words: 0,
            draw_tags_dst_words: 0,
            draw_data_dst_words: 0,
            styles_dst_words: 0,
            transforms_dst_words: 0,
        };
        slab_block_set_slot(&mut enc, 0, 0, desc, aux, Transform::IDENTITY, None);
        slab_block_set_slot(&mut enc, 0, 2, desc, aux, Transform::IDENTITY, None);

        let mut packed = Vec::new();
        let layout = resolve_slabbed(&enc, &mut packed);

        // Descriptor slab: one block, 4 slots * 20 bytes = 80 bytes = 20 words
        // (SlabSlotDesc widened to 5 u32: path_tags/path_data counts un-packed).
        assert_eq!(layout.descriptor_slab_size, 20);
        // Aux slab: 4 slots * 48 bytes = 192 bytes = 48 words (SlabSlotAux 12
        // u32: all stream counts un-packed to full u32).
        assert_eq!(layout.aux_slab_size, 48);
        // One slab block in the descriptor table.
        assert_eq!(layout.n_slab_blocks, 1);

        // The descriptor slab contents must match the encoding's
        // per-slot SlabSlotDesc bytes.
        let dsb = layout.descriptor_slab_base as usize * size_of::<u32>();
        let dsl = layout.descriptor_slab_size as usize * size_of::<u32>();
        let read: &[SlabSlotDesc] = bytemuck::cast_slice(&packed[dsb..dsb + dsl]);
        assert_eq!(read[0].sub_offset, 0x100);
        assert_eq!(read[1].sub_offset, 0);
        assert_eq!(read[2].sub_offset, 0x100);
        assert_eq!(read[3].sub_offset, 0);

        // Narrow-write byte spans cover transforms + overlays.
        assert_eq!(
            layout.instance_xform_size as usize,
            4 * size_of::<Transform>(),
        );
        // 4 slots * 3 overlay words per slot * 4 bytes/word = 48 bytes.
        assert_eq!(layout.instance_overlay_size, 48);
    }

    #[test]
    fn path_tags_gap_is_exact_and_zeroed() {
        // Tight-pack: the gap is the per-block WORD TOTAL (7 words),
        // independent of slot_count — not `slot_count * per-slot`.
        let totals = SlabStreamTotals {
            path_tags_words: 7,
            ..SlabStreamTotals::default()
        };
        let enc = make_slabbed_encoding(4, totals);

        let mut packed = Vec::new();
        let layout = resolve_slabbed(&enc, &mut packed);

        // SlabBlockGpu table sits at layout.slab_blocks_base. Read the
        // first entry and verify its gap region in packed[] is exactly
        // 7 * 4 = 28 bytes of zero (the tight total, not 4 * 7).
        let sbb = layout.slab_blocks_base as usize * size_of::<u32>();
        // Bound to the SlabBlockGpu table only — the slot→block LUT follows
        // it in `packed`, so an unbounded cast would have trailing slop.
        let sbe = sbb + layout.n_slab_blocks as usize * size_of::<SlabBlockGpu>();
        let blocks: &[SlabBlockGpu] = bytemuck::cast_slice(&packed[sbb..sbe]);
        let gap_off = blocks[0].gap_path_tags_offset as usize * size_of::<u32>();
        let gap_bytes = 7 * size_of::<u32>();
        assert!(
            packed[gap_off..gap_off + gap_bytes].iter().all(|b| *b == 0),
            "path_tags gap region must be zero-initialised",
        );
        // Stride is vestigial under tight-packing (expander uses per-slot
        // prefix-sum dst offsets), so it stays zero.
        assert_eq!(blocks[0].gap_path_tags_stride, 0);
        assert_eq!(blocks[0].slot_count, 4);
    }

    #[test]
    fn pinned_totals_keep_layout_stable_across_live_content() {
        // High-water pinning: two frames with the same pinned
        // stream_totals + slot_count but different LIVE slot content
        // must resolve to byte-identical lengths and identical region
        // offsets — that is the whole basis of the band reuse_fast
        // path. Only the descriptor/aux/transform/overlay table
        // CONTENT may differ.
        let pinned = SlabStreamTotals {
            path_tags_words: 16,
            path_data_words: 64,
            draw_tags_words: 8,
            draw_data_words: 12,
            transforms_words: 24,
            styles_words: 4,
            draw_info_words: 8,
        };
        let desc = SlabSlotDesc {
            sub_offset: 0x40,
            transform_idx: 0,
            color_overlay_idx: u32::MAX,
            path_tags_words: 4,
            path_data_words: 16,
        };
        let mut frame_a = make_slabbed_encoding(4, pinned);
        slab_block_set_slot(
            &mut frame_a,
            0,
            0,
            desc,
            SlabSlotAux::default(),
            Transform::IDENTITY,
            None,
        );
        frame_a.instance_slab_blocks[0].live_path_tags_words = 4;
        frame_a.instance_slab_blocks[0].live_draw_tags_words = 2;

        // Frame B: different live content (two slots, live draw_info
        // differs) under the SAME pinned envelope.
        let mut live_b = pinned;
        live_b.draw_info_words = 5;
        let mut frame_b = make_slabbed_encoding(4, live_b);
        slab_block_set_slot(
            &mut frame_b,
            0,
            1,
            desc,
            SlabSlotAux::default(),
            Transform::IDENTITY,
            None,
        );
        slab_block_set_slot(
            &mut frame_b,
            0,
            3,
            desc,
            SlabSlotAux::default(),
            Transform::IDENTITY,
            None,
        );
        frame_b.instance_slab_blocks[0].live_path_tags_words = 8;
        frame_b.instance_slab_blocks[0].live_draw_tags_words = 4;

        let mut packed_a = Vec::new();
        let layout_a = resolve_slabbed(&frame_a, &mut packed_a);
        let mut packed_b = Vec::new();
        let layout_b = resolve_slabbed(&frame_b, &mut packed_b);

        assert_eq!(packed_a.len(), packed_b.len());
        // Every packed-byte offset must agree; bin_data_start differs
        // by design (live draw_info), so compare a normalized copy.
        let mut layout_b_norm = layout_b;
        layout_b_norm.bin_data_start = layout_a.bin_data_start;
        assert_eq!(
            bytemuck::bytes_of(&layout_a),
            bytemuck::bytes_of(&layout_b_norm),
        );
        assert_eq!(layout_a.bin_data_start, 8);
        assert_eq!(layout_b.bin_data_start, 5);
    }

    #[test]
    fn bin_data_start_covers_slab_draw_info() {
        // The GPU draw-monoid scan reserves info words for the GAP draw
        // tags the expander fills in, not just host tags. bin_data_start
        // must clear that whole section or binning's element-index
        // writes corrupt the draw info `coarse` reads (the slab
        // "flashing" bug — intermittent torn geometry as each frame's
        // bin allocation total shifts).
        let totals = SlabStreamTotals {
            draw_tags_words: 4,
            draw_info_words: 9,
            ..SlabStreamTotals::default()
        };
        let enc = make_slabbed_encoding(2, totals);
        assert!(enc.draw_tags.is_empty());

        let mut packed = Vec::new();
        let layout = resolve_slabbed(&enc, &mut packed);
        assert_eq!(layout.bin_data_start, 9);
    }
}
