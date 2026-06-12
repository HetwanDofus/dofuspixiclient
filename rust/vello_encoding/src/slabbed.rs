//! DOFUS Tier 7: descriptor-slab instance blocks. Each band owns a
//! fixed-capacity slot table whose byte-size fingerprint is constant
//! across frames so vello's `reuse_fast` path fires every frame after
//! the first. `SlabSlotDesc` layout is locked to match the GPU
//! `instance_expand.wgsl` reader (16 bytes / slot).

use bytemuck::{Pod, Zeroable};

use crate::{Encoding, PathTag, Transform};

/// GPU-visible 20-byte (5 u32) per-slot descriptor. Field order and width
/// must match `instance_expand_slab.wgsl`'s `SlabSlotDesc` struct and
/// `SLAB_DESC_WORDS`.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct SlabSlotDesc {
    /// Offset (u32 words) into the sub-library buffer. `0` = sentinel
    /// empty slot — the GPU expander skips slots whose `sub_offset` is 0.
    pub sub_offset: u32,
    /// Global index into `Encoding::instance_transforms` for this slot.
    pub transform_idx: u32,
    /// Per-zone color overlay encoding: `(0xFA/0xFB/0xFC) << 24 | u24 idx`
    /// OR `u32::MAX` for "no overlay" (sub-encoding colors pass through).
    pub color_overlay_idx: u32,
    /// Sub `path_tags` / `path_data` word counts. Full u32 (not packed
    /// 16-bit) — complex tile subs exceed 65535 words and the old packing
    /// wrapped, corrupting the kernel's stream offsets.
    pub path_tags_words: u32,
    pub path_data_words: u32,
}

impl SlabSlotDesc {
    /// Sentinel "empty slot" — `sub_offset = 0` tells the GPU expander to
    /// skip this slot. `color_overlay_idx = u32::MAX` means "no overlay".
    pub const fn sentinel() -> Self {
        Self {
            sub_offset: 0,
            transform_idx: 0,
            color_overlay_idx: u32::MAX,
            path_tags_words: 0,
            path_data_words: 0,
        }
    }
}

/// Auxiliary 48-byte (12 u32) per-slot record carrying the four stream
/// lengths not in `SlabSlotDesc` (draw_tags/draw_data/transforms/styles),
/// the per-slot zone-patch range, and the six tight-pack dst offsets.
///
/// `zone_patches_offset` is a u32 word offset into the sub-library
/// buffer where the slot's `ZonePatchGpu` records live (one packed
/// 4-byte record per patch). `zone_patches_count` is the record count.
/// Both zero when the slot's sub has no zone patches (most tiles +
/// accessories).
#[repr(C)]
#[derive(Copy, Clone, Debug, Default, Pod, Zeroable)]
pub struct SlabSlotAux {
    // Full u32 (not 16-bit packed): complex tile subs exceed 65535
    // words/stream and the packing wrapped → corrupted gap offsets.
    pub draw_tags_words: u32,
    pub draw_data_words: u32,
    pub transforms_words: u32,
    pub styles_words: u32,
    pub zone_patches_offset: u32,
    pub zone_patches_count: u32,
    /// DOFUS Tier 7 tight-pack: per-slot dst byte/word position within
    /// the gap region for each variable-length stream. Cumulative
    /// `pathseg_offset` / `style_ix` / draw_data offsets coming out of
    /// `pathtag_scan` are byte-tight across slots — they advance only
    /// by each sub's actual stream bytes. A stride-padded gap layout
    /// would force PATHs in slot K to read at offset `K*stride` while
    /// the cumulative scan put them at `sum_prior_subs`. We instead
    /// tight-pack within the gap reservation and write each slot at
    /// the prefix-sum offset stored here; the cumulative offset and
    /// the gap layout now agree.
    pub path_tags_dst_words: u32,
    pub path_data_dst_words: u32,
    pub draw_tags_dst_words: u32,
    pub draw_data_dst_words: u32,
    pub styles_dst_words: u32,
    /// Prefix-sum word offset of this slot's transforms within the
    /// block's transforms gap (each `Transform` is 6 u32). Transforms are
    /// tight-packed like the other variable streams — no fixed per-sub
    /// stride, so subs with any number of transforms are exact. Word 9
    /// of the 10-u32 (40-byte) `SLAB_AUX_WORDS` record.
    pub transforms_dst_words: u32,
}

/// Slabbed instance block: one fixed-capacity slot table per band. The
/// layout fingerprint (`slot_count` and total slab byte size) stays
/// constant across frames so vello's `reuse_fast` path fires on the
/// second and later frames.
#[derive(Clone, Debug)]
pub struct SlabbedInstanceBlock {
    /// Fixed slot count for this band. Set at setup; never grows.
    pub slot_count: u32,
    /// Offset into `Encoding::instance_transforms` where this block's
    /// per-slot transforms begin. The k-th slot's affine lives at
    /// `instance_transforms[transforms_base + k]`.
    pub transforms_base: u32,
    /// Offset into `Encoding::instance_color_overlays` where this
    /// block's per-slot overlays begin. Each slot occupies 3 u32s
    /// (one per player-color zone).
    pub overlays_base: u32,
    /// Position in `Encoding::path_tags` of the
    /// `PathTag::INSTANCED_SLAB_BEGIN` marker pushed at compose time.
    pub splice_path_tags: u32,
    /// Per-slot descriptors, sized to `slot_count` at construction.
    /// Empty slots carry `SlabSlotDesc::sentinel()`.
    pub descriptors: Vec<SlabSlotDesc>,
    /// Parallel per-slot aux record carrying the four stream lengths
    /// that don't fit in the 16-byte descriptor.
    pub aux_stream_lens: Vec<SlabSlotAux>,
    /// DOFUS Tier 7 tight-pack: per-stream u32-word totals across this
    /// block's slots. The resolver reserves each stream's gap at exactly
    /// these word counts (no `× slot_count` over-reservation); the GPU
    /// expander writes each slot at its prefix-sum `*_dst_words` offset.
    ///
    /// When the compose layer pins these at a grow-only high-water mark
    /// (so the packed byte layout stays stable and `reuse_fast` fires),
    /// the gap may exceed the frame's actual content — `live_*` below
    /// carry the actual totals for the streams whose unused tail must
    /// be re-zeroed.
    pub stream_totals: SlabStreamTotals,
    /// Actual (this-frame) path-tag word total across slots. Host-only;
    /// never packed. The GPU expander overwrites `[0, live)` of the gap
    /// each frame, so when `live` shrinks the band render must zero
    /// `[live, prev_live)` — a stale PATH/TRANSFORM tag in the tail
    /// would mint phantom paths past `n_paths` and shift every cursor
    /// the pathtag scan derives. Only the two tag streams need this:
    /// path_data / draw_data / transforms / styles are reached solely
    /// through tag-derived cursors, which never extend past the live
    /// prefix once the tag tails are zero.
    pub live_path_tags_words: u32,
    /// Actual (this-frame) draw-tag word total across slots. See
    /// `live_path_tags_words` — a stale draw tag in the tail becomes a
    /// phantom draw object with garbage info/data offsets.
    pub live_draw_tags_words: u32,
}

/// DOFUS Tier 7 tight-pack: per-stream u32-word totals summed across
/// every slot in a slab block, used to size the resolver's gap
/// reservations. The GPU expander writes each slot's bytes at the
/// prefix-sum `SlabSlotAux::*_dst_words` offset, so the sum of the
/// per-slot actual sizes is exactly the gap each stream needs — both
/// necessary and sufficient. Replaces the old `slot_count × max-per-slot`
/// reservation, which over-reserved by the band's max/avg sub-size ratio
/// and inflated both VRAM and the derived pipeline dispatch counts (the
/// 65535-workgroup overflow that panicked the slab past ~500 actors).
/// Every field is a u32-word count (path tags are padded to u32).
#[derive(Copy, Clone, Debug, Default)]
pub struct SlabStreamTotals {
    pub path_tags_words: u32,
    pub path_data_words: u32,
    pub draw_tags_words: u32,
    pub draw_data_words: u32,
    /// Total transform words across all slots (each Transform = 6 u32).
    pub transforms_words: u32,
    pub styles_words: u32,
    /// Σ `DrawTag::info_size()` across every slot's draw tags. NOT a gap
    /// size — the GPU's draw-monoid scan derives per-tag info offsets
    /// from the expanded tag stream, and `resolve_slabbed` must start
    /// binning's allocations (`Layout::bin_data_start`) past the info
    /// those gap tags generate. Counting only host draw tags (empty for
    /// slab bands) lets binning element-index writes overwrite the draw
    /// info that `coarse` reads → frame-varying torn geometry.
    pub draw_info_words: u32,
}

/// Clears the slab-block bookkeeping on `Encoding::reset`.
pub fn reset_slab_blocks_clear(encoding: &mut Encoding) {
    encoding.instance_slab_blocks.clear();
}

/// Rebases slab blocks copied from `other` onto the host's array tails.
/// Called from `Encoding::append`. The caller has already extended
/// `instance_transforms` / `instance_color_overlays` / `path_tags` —
/// this function only needs the pre-extend bases and the prior length
/// of `other`'s host streams to fix up splice positions.
pub fn append_rebase_slab_blocks(
    encoding: &mut Encoding,
    other: &Encoding,
    instance_transforms_base: u32,
    instance_overlays_base: u32,
    splice_base_path_tags: u32,
) {
    encoding
        .instance_slab_blocks
        .extend(other.instance_slab_blocks.iter().cloned().map(|mut b| {
            b.transforms_base += instance_transforms_base;
            b.overlays_base += instance_overlays_base;
            b.splice_path_tags += splice_base_path_tags;
            b
        }));
}

/// Begins a slabbed instance block: pushes the
/// `PathTag::INSTANCED_SLAB_BEGIN` marker, reserves `slot_count`
/// identity transforms and `slot_count * 3` `u32::MAX` overlay slots so
/// the parallel arrays stay in lock-step with the descriptor array, and
/// records a fresh `SlabbedInstanceBlock` whose descriptors are all
/// sentinel-empty. Returns the block's index into `instance_slab_blocks`.
pub fn begin_slab_block(encoding: &mut Encoding, slot_count: u32) -> usize {
    debug_assert!(slot_count > 0, "slabbed block must have at least one slot");
    let block_idx = encoding.instance_slab_blocks.len();
    let transforms_base = encoding.instance_transforms.len() as u32;
    let overlays_base = encoding.instance_color_overlays.len() as u32;
    encoding.instance_transforms.resize(
        transforms_base as usize + slot_count as usize,
        Transform::IDENTITY,
    );
    encoding
        .instance_color_overlays
        .resize(overlays_base as usize + slot_count as usize * 3, u32::MAX);
    encoding.path_tags.push(PathTag::INSTANCED_SLAB_BEGIN);
    let splice_path_tags = (encoding.path_tags.len() - 1) as u32;
    encoding.instance_slab_blocks.push(SlabbedInstanceBlock {
        slot_count,
        transforms_base,
        overlays_base,
        splice_path_tags,
        descriptors: vec![SlabSlotDesc::sentinel(); slot_count as usize],
        aux_stream_lens: vec![SlabSlotAux::default(); slot_count as usize],
        stream_totals: SlabStreamTotals::default(),
        live_path_tags_words: 0,
        live_draw_tags_words: 0,
    });
    block_idx
}

/// Sets a slab block's tight per-stream word totals; the resolver sizes
/// each stream's gap from these. With tight-packing the packed scene's
/// byte size tracks the actual geometry: for a static (idle) scene it is
/// constant frame-to-frame so `reuse_fast` still fires, while an
/// animating slot whose sub changes size re-sizes the gap and forces a
/// full `reuse_full` re-resolve that frame. That is the intended trade —
/// the old constant-fingerprint layout over-reserved every slot at the
/// band max and overflowed the pipeline dispatch past ~500 actors.
pub fn slab_block_set_stream_totals(
    encoding: &mut Encoding,
    block_idx: usize,
    totals: SlabStreamTotals,
) {
    encoding.instance_slab_blocks[block_idx].stream_totals = totals;
}

/// Populates one slot of a previously-begun slab block. `slot` must be
/// in `0..slot_count`; out-of-range panics in debug, wraps in release.
/// Empty slots may be left untouched — they stay sentinel and the GPU
/// expander skips them.
pub fn slab_block_set_slot(
    encoding: &mut Encoding,
    block_idx: usize,
    slot: u32,
    desc: SlabSlotDesc,
    aux: SlabSlotAux,
    affine: Transform,
    color_overlay: Option<[[u8; 4]; 3]>,
) {
    let block = &mut encoding.instance_slab_blocks[block_idx];
    debug_assert!(slot < block.slot_count);
    debug_assert_eq!(block.descriptors.len() as u32, block.slot_count);
    debug_assert_eq!(block.aux_stream_lens.len() as u32, block.slot_count);
    let slot_us = slot as usize;
    block.descriptors[slot_us] = desc;
    block.aux_stream_lens[slot_us] = aux;
    let transforms_base = block.transforms_base as usize;
    let overlays_base = block.overlays_base as usize;
    // Drop the borrow on `block` before touching the parallel arrays.
    encoding.instance_transforms[transforms_base + slot_us] = affine;
    let zones_off = overlays_base + slot_us * 3;
    match color_overlay {
        Some(zones) => {
            for (i, zone) in zones.iter().enumerate() {
                encoding.instance_color_overlays[zones_off + i] = u32::from_le_bytes(*zone);
            }
        }
        None => {
            for i in 0..3 {
                encoding.instance_color_overlays[zones_off + i] = u32::MAX;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slab_slot_desc_is_20_bytes() {
        // 5 u32: sub_offset, transform_idx, color_overlay_idx,
        // path_tags_words, path_data_words. Must equal SLAB_DESC_WORDS=5.
        assert_eq!(std::mem::size_of::<SlabSlotDesc>(), 20);
    }

    #[test]
    fn slab_slot_aux_is_48_bytes() {
        // 12 u32: 6 stream-len counts + 6 per-slot dst offsets. Full-u32
        // (un-packed) so >65535-word streams don't wrap. = SLAB_AUX_WORDS=12.
        assert_eq!(std::mem::size_of::<SlabSlotAux>(), 48);
    }

    #[test]
    fn slab_slot_desc_sentinel_matches_layout() {
        let s = SlabSlotDesc::sentinel();
        assert_eq!(s.sub_offset, 0);
        assert_eq!(s.transform_idx, 0);
        assert_eq!(s.color_overlay_idx, u32::MAX);
        assert_eq!(s.path_tags_words, 0);
        assert_eq!(s.path_data_words, 0);
    }

    #[test]
    fn begin_slab_block_records_marker_and_reserves_arrays() {
        let mut enc = Encoding::default();
        // Seed the host streams so transforms_base / overlays_base are
        // non-zero — catches off-by-one base capture.
        enc.instance_transforms.push(Transform::IDENTITY);
        enc.instance_color_overlays
            .extend_from_slice(&[u32::MAX; 6]);
        let block_idx = begin_slab_block(&mut enc, 4);
        assert_eq!(block_idx, 0);
        assert_eq!(enc.instance_slab_blocks.len(), 1);
        let block = &enc.instance_slab_blocks[0];
        assert_eq!(block.slot_count, 4);
        assert_eq!(block.transforms_base, 1);
        assert_eq!(block.overlays_base, 6);
        assert_eq!(block.descriptors.len(), 4);
        assert_eq!(block.aux_stream_lens.len(), 4);
        for d in &block.descriptors {
            assert_eq!(d.sub_offset, 0);
            assert_eq!(d.color_overlay_idx, u32::MAX);
        }
        // Marker pushed at the tail of path_tags. `PathTag` doesn't
        // implement `Debug`, so compare via `PartialEq` directly rather
        // than going through `assert_eq!`.
        assert!(*enc.path_tags.last().unwrap() == PathTag::INSTANCED_SLAB_BEGIN);
        assert_eq!(block.splice_path_tags as usize, enc.path_tags.len() - 1);
        // Parallel arrays sized to slot_count.
        assert_eq!(enc.instance_transforms.len(), 1 + 4);
        assert_eq!(enc.instance_color_overlays.len(), 6 + 4 * 3);
    }

    #[test]
    fn slab_block_set_slot_writes_only_target_slot() {
        let mut enc = Encoding::default();
        let block_idx = begin_slab_block(&mut enc, 3);
        let aux = SlabSlotAux {
            draw_tags_words: 7,
            draw_data_words: 11,
            transforms_words: 13,
            styles_words: 17,
            zone_patches_offset: 0,
            zone_patches_count: 0,
            path_tags_dst_words: 0,
            path_data_dst_words: 0,
            draw_tags_dst_words: 0,
            draw_data_dst_words: 0,
            styles_dst_words: 0,
            transforms_dst_words: 0,
        };
        let desc = SlabSlotDesc {
            sub_offset: 0x1000,
            transform_idx: 1,
            color_overlay_idx: 0xFA00_0042,
            path_tags_words: 5,
            path_data_words: 9,
        };
        let affine = Transform {
            matrix: [2.0, 0.0, 0.0, 2.0],
            translation: [10.0, 20.0],
        };
        let overlay = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]];
        slab_block_set_slot(&mut enc, block_idx, 1, desc, aux, affine, Some(overlay));
        let block = &enc.instance_slab_blocks[block_idx];
        // Slot 1 was written.
        assert_eq!(block.descriptors[1].sub_offset, 0x1000);
        assert_eq!(block.descriptors[1].color_overlay_idx, 0xFA00_0042);
        assert_eq!(block.aux_stream_lens[1].draw_tags_words, 7);
        // Slots 0 and 2 untouched.
        assert_eq!(block.descriptors[0].sub_offset, 0);
        assert_eq!(block.descriptors[2].sub_offset, 0);
        assert_eq!(block.descriptors[0].color_overlay_idx, u32::MAX);
        assert_eq!(block.descriptors[2].color_overlay_idx, u32::MAX);
        // Parallel arrays: only the target slot's affine and overlay zones changed.
        let tb = block.transforms_base as usize;
        let ob = block.overlays_base as usize;
        assert_eq!(enc.instance_transforms[tb + 1], affine);
        assert_eq!(enc.instance_transforms[tb], Transform::IDENTITY);
        assert_eq!(enc.instance_transforms[tb + 2], Transform::IDENTITY);
        assert_eq!(
            enc.instance_color_overlays[ob + 3],
            u32::from_le_bytes([1, 2, 3, 4]),
        );
        assert_eq!(
            enc.instance_color_overlays[ob + 4],
            u32::from_le_bytes([5, 6, 7, 8]),
        );
        assert_eq!(
            enc.instance_color_overlays[ob + 5],
            u32::from_le_bytes([9, 10, 11, 12]),
        );
        // Neighbors still u32::MAX.
        assert_eq!(enc.instance_color_overlays[ob + 0], u32::MAX);
        assert_eq!(enc.instance_color_overlays[ob + 6], u32::MAX);
    }

    #[test]
    fn slab_block_set_slot_none_overlay_writes_max_sentinel() {
        let mut enc = Encoding::default();
        let block_idx = begin_slab_block(&mut enc, 2);
        slab_block_set_slot(
            &mut enc,
            block_idx,
            0,
            SlabSlotDesc::sentinel(),
            SlabSlotAux::default(),
            Transform::IDENTITY,
            None,
        );
        let block = &enc.instance_slab_blocks[block_idx];
        let ob = block.overlays_base as usize;
        for i in 0..3 {
            assert_eq!(enc.instance_color_overlays[ob + i], u32::MAX);
        }
    }

    #[test]
    fn append_rebase_slab_blocks_shifts_bases() {
        let mut other = Encoding::default();
        other.instance_transforms.push(Transform::IDENTITY);
        other
            .instance_color_overlays
            .extend_from_slice(&[u32::MAX; 3]);
        begin_slab_block(&mut other, 2);
        let mut host = Encoding::default();
        // Pretend the host already had 5 transforms and 9 overlay words,
        // and that other's host streams have been appended onto a host
        // that previously had 3 path_tags.
        let instance_transforms_base = 5u32;
        let instance_overlays_base = 9u32;
        let splice_base_path_tags = 3u32;
        append_rebase_slab_blocks(
            &mut host,
            &other,
            instance_transforms_base,
            instance_overlays_base,
            splice_base_path_tags,
        );
        assert_eq!(host.instance_slab_blocks.len(), 1);
        let b = &host.instance_slab_blocks[0];
        // other's block was begun with transforms_base=1 (one prior
        // transform), overlays_base=3, splice_path_tags=0.
        assert_eq!(b.transforms_base, 1 + instance_transforms_base);
        assert_eq!(b.overlays_base, 3 + instance_overlays_base);
        assert_eq!(b.splice_path_tags, 0 + splice_base_path_tags);
        assert_eq!(b.slot_count, 2);
    }
}
