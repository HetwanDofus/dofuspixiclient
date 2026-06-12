// Copyright 2022 the Vello Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

use bytemuck::{Pod, Zeroable};
use peniko::{Extend, ImageData};
use std::ops::Range;
use std::sync::Arc;

use super::{DrawTag, Encoding, PathTag, StreamOffsets, Style, Transform};

use crate::glyph_cache::GlyphCache;
use crate::image_cache::{ImageCache, Images};
use crate::ramp_cache::{RampCache, Ramps};

use crate::resolve_slabbed;
pub use crate::resolve_slabbed::SlabBlockGpu;

/// Layout of a packed encoding.
#[derive(Clone, Copy, Debug, Default, Zeroable, Pod)]
#[repr(C)]
pub struct Layout {
    /// Number of draw objects.
    pub n_draw_objects: u32,
    /// Number of paths.
    pub n_paths: u32,
    /// Number of clips.
    pub n_clips: u32,
    /// Start of binning data.
    pub bin_data_start: u32,
    /// Start of path tag stream.
    pub path_tag_base: u32,
    /// Start of path data stream.
    pub path_data_base: u32,
    /// Start of draw tag stream.
    pub draw_tag_base: u32,
    /// Start of draw data stream.
    pub draw_data_base: u32,
    /// Start of transform stream.
    pub transform_base: u32,
    /// Start of style stream.
    pub style_base: u32,
    /// DOFUS Tier 6: start of instance_transforms region in the packed
    /// scene buffer (in u32 units). Each entry is one `Transform` (6 f32s
    /// = 6 u32s). Zero when the encoding had no instanced blocks.
    pub instance_transforms_base: u32,
    /// Number of `Transform` entries in the instance_transforms region.
    pub n_instance_transforms: u32,
    /// Start of instance_color_overlays region (in u32 units). Each entry
    /// is one packed RGBA8 (1 u32); zones are stored 3 per instance,
    /// contiguous per block. Zero when no per-instance overlays.
    pub instance_color_overlays_base: u32,
    /// Number of u32 entries in the instance_color_overlays region (= 3
    /// per instance carrying an overlay).
    pub n_instance_color_overlays: u32,
    /// Start of the `instance_blocks` GPU descriptor table (in u32
    /// units). Used by the `instance_expand` GPU pre-pass to look up
    /// per-block metadata (count, sub byte offsets, splice positions).
    /// Zero when the encoding had no instanced blocks.
    pub instance_blocks_base: u32,
    /// Number of `InstanceBlockGpu` records starting at
    /// `instance_blocks_base`.
    pub n_instance_blocks: u32,
    /// DOFUS Tier 7: descriptor slab region (in u32 units). Holds the
    /// concatenated `SlabSlotDesc` arrays across every
    /// `SlabbedInstanceBlock`. `descriptor_slab_size` counts u32 words.
    /// Zero when the encoding has no slabbed blocks.
    pub descriptor_slab_base: u32,
    pub descriptor_slab_size: u32,
    /// DOFUS Tier 7: aux slab region (parallel to `descriptor_slab_*`).
    /// Holds concatenated `SlabSlotAux` arrays, one entry per slot per
    /// block.
    pub aux_slab_base: u32,
    pub aux_slab_size: u32,
    /// DOFUS Tier 7: per-slab-block GPU descriptor table. One
    /// `SlabBlockGpu` per slabbed block (mirror of the marker-emit
    /// path's `instance_blocks_base` table). Zero when no slabbed
    /// blocks.
    pub slab_blocks_base: u32,
    pub n_slab_blocks: u32,
    /// DOFUS Tier 7: narrow-write byte spans the client rewrites every
    /// frame on the slabbed path. `instance_xform_*` covers the
    /// transforms region; `instance_overlay_*` covers the overlay
    /// region. Sizes are in BYTES (not words) so the client can hand
    /// them straight to `Queue::write_buffer` without conversion. The
    /// existing word-offset fields above stay authoritative for shader
    /// reads.
    pub instance_xform_base: u32,
    pub instance_xform_size: u32,
    pub instance_overlay_base: u32,
    pub instance_overlay_size: u32,
    /// DOFUS Tier 7: total slot count summed across every slabbed
    /// block — the host dispatches this many workgroups (1 slot per
    /// workgroup) for `instance_expand_slab` so the kernel can map
    /// `workgroup_id.x` straight onto its (block, slot) target without
    /// re-walking the block table. Zero when no slabbed blocks.
    pub n_slab_total_slots: u32,
    /// DOFUS Tier 7: base (u32 words) of the precomputed slot→block LUT in
    /// the packed scene buffer — two u32 per slot, `[block_idx,
    /// slot_in_block]`. Lets `instance_expand_slab` map a workgroup's global
    /// slot to its `(block, slot)` in O(1) instead of the per-workgroup
    /// O(n_slab_blocks) linear walk that serialized GPU time on unique-look
    /// crowds (one block per unique item). Zero when no slabbed blocks.
    pub slab_slot_lut_base: u32,
}

impl Layout {
    /// Creates a zeroed layout.
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns the path tag stream.
    pub fn path_tags<'a>(&self, data: &'a [u8]) -> &'a [PathTag] {
        let start = self.path_tag_base as usize * 4;
        let end = self.path_data_base as usize * 4;
        bytemuck::cast_slice(&data[start..end])
    }

    pub fn path_tags_size(&self) -> u32 {
        let start = self.path_tag_base * 4;
        let end = self.path_data_base * 4;
        end - start
    }

    /// Returns the path tag stream in chunks of 4.
    pub fn path_tags_chunked<'a>(&self, data: &'a [u8]) -> &'a [u32] {
        let start = self.path_tag_base as usize * 4;
        let end = self.path_data_base as usize * 4;
        bytemuck::cast_slice(&data[start..end])
    }

    /// Returns the path data stream.
    pub fn path_data<'a>(&self, data: &'a [u8]) -> &'a [u8] {
        let start = self.path_data_base as usize * 4;
        let end = self.draw_tag_base as usize * 4;
        bytemuck::cast_slice(&data[start..end])
    }

    /// Returns the draw tag stream.
    pub fn draw_tags<'a>(&self, data: &'a [u8]) -> &'a [DrawTag] {
        let start = self.draw_tag_base as usize * 4;
        let end = self.draw_data_base as usize * 4;
        bytemuck::cast_slice(&data[start..end])
    }

    /// Returns the draw data stream.
    pub fn draw_data<'a>(&self, data: &'a [u8]) -> &'a [u32] {
        let start = self.draw_data_base as usize * 4;
        let end = self.transform_base as usize * 4;
        bytemuck::cast_slice(&data[start..end])
    }

    /// Returns the transform stream.
    pub fn transforms<'a>(&self, data: &'a [u8]) -> &'a [Transform] {
        let start = self.transform_base as usize * 4;
        let end = self.style_base as usize * 4;
        bytemuck::cast_slice(&data[start..end])
    }

    /// Returns the style stream.
    pub fn styles<'a>(&self, data: &'a [u8]) -> &'a [Style] {
        let start = self.style_base as usize * 4;
        bytemuck::cast_slice(&data[start..])
    }
}

/// Resolves and packs an encoding that contains only paths with solid color
/// fills.
///
/// Panics if the encoding contains any late bound resources (gradients, images
/// or glyph runs).
pub fn resolve_solid_paths_only(encoding: &Encoding, packed: &mut Vec<u8>) -> Layout {
    // DOFUS Tier 6: expand markers on CPU so the byte layout is stable
    // across frames (reuse_fast depends on `packed.len()` being constant
    // when only transforms shift). The `instance_transforms` /
    // `instance_color_overlays` regions are still packed at the end so a
    // future GPU pre-pass (instance_expand.wgsl) can consume them
    // directly and bypass this CPU expansion.
    let expanded = encoding.expand_instanced_to_flat();
    resolve_solid_paths_only_impl(expanded.as_ref(), encoding, packed)
}

fn resolve_solid_paths_only_impl(
    encoding: &Encoding,
    instances_from: &Encoding,
    packed: &mut Vec<u8>,
) -> Layout {
    assert!(
        encoding.resources.patches.is_empty(),
        "this resolve function doesn't support late bound resources"
    );
    let data = packed;
    data.clear();
    let mut layout = Layout {
        n_paths: encoding.n_paths,
        n_clips: encoding.n_clips,
        ..Layout::default()
    };
    let instance_byte_size = instance_regions_byte_size(instances_from);
    let SceneBufferSizes {
        buffer_size,
        path_tag_padded,
    } = SceneBufferSizes::new(encoding, &StreamOffsets::default(), instance_byte_size);
    data.reserve(buffer_size);
    // Path tag stream
    layout.path_tag_base = size_to_words(data.len());
    data.extend_from_slice(bytemuck::cast_slice(&encoding.path_tags));
    for _ in 0..encoding.n_open_clips {
        data.extend_from_slice(bytemuck::bytes_of(&PathTag::PATH));
    }
    data.resize(path_tag_padded, 0);
    // Path data stream
    layout.path_data_base = size_to_words(data.len());
    data.extend_from_slice(bytemuck::cast_slice(&encoding.path_data));
    // Draw tag stream
    layout.draw_tag_base = size_to_words(data.len());
    // Bin data follows draw info
    layout.bin_data_start = encoding.draw_tags.iter().map(|tag| tag.info_size()).sum();
    data.extend_from_slice(bytemuck::cast_slice(&encoding.draw_tags));
    for _ in 0..encoding.n_open_clips {
        data.extend_from_slice(bytemuck::bytes_of(&DrawTag::END_CLIP));
    }
    // Draw data stream
    layout.draw_data_base = size_to_words(data.len());
    data.extend_from_slice(bytemuck::cast_slice(&encoding.draw_data));
    // Transform stream
    layout.transform_base = size_to_words(data.len());
    data.extend_from_slice(bytemuck::cast_slice(&encoding.transforms));
    // Style stream
    layout.style_base = size_to_words(data.len());
    data.extend_from_slice(bytemuck::cast_slice(&encoding.styles));
    // DOFUS Tier 6: instance regions packed after styles. Shader-side
    // instance expansion (future) reads these via `config.instance_*_base`
    // offsets. Current pipeline ignores them — CPU expansion already
    // produced the flat path_tags/data/etc above.
    layout.instance_transforms_base = size_to_words(data.len());
    layout.n_instance_transforms = instances_from.instance_transforms.len() as u32;
    data.extend_from_slice(bytemuck::cast_slice(&instances_from.instance_transforms));
    layout.instance_color_overlays_base = size_to_words(data.len());
    layout.n_instance_color_overlays = instances_from.instance_color_overlays.len() as u32;
    data.extend_from_slice(bytemuck::cast_slice(
        &instances_from.instance_color_overlays,
    ));
    // Pack the deduplicated sub library BEFORE the descriptors so the
    // descriptors can reference it via the sub_*_offset fields.
    let sub_lib = pack_sub_library(instances_from, data);
    let descriptors = build_instance_block_descriptors(instances_from, &sub_lib);
    layout.instance_blocks_base = size_to_words(data.len());
    layout.n_instance_blocks = descriptors.len() as u32;
    data.extend_from_slice(bytemuck::cast_slice(&descriptors));
    layout.n_draw_objects = layout.n_paths;
    assert_eq!(buffer_size, data.len());
    layout
}

/// Resolver for late bound resources.
/// Per-resolve image-atlas working-set stats (DOFUS diagnostics). Every
/// `resolve` of a scene with image fills re-packs (and the GPU re-uploads)
/// these bytes into the atlas, so `total_bytes` is the per-band-render
/// upload volume — the cost that scales 4× with HiDPI-upscaled bitmaps.
#[derive(Default, Clone, Copy, Debug)]
pub struct ImageResolveStats {
    pub n_images: u32,
    pub total_bytes: u64,
    pub n_dropped: u32,
    pub max_image_px: u32,
    pub atlas_px: u32,
}

#[derive(Default)]
pub struct Resolver {
    glyph_cache: GlyphCache,
    glyphs: Vec<Arc<Encoding>>,
    ramp_cache: RampCache,
    image_cache: ImageCache,
    pending_images: Vec<PendingImage>,
    patches: Vec<ResolvedPatch>,
    last_image_stats: ImageResolveStats,
}

impl Resolver {
    /// Creates a new resource cache.
    pub fn new() -> Self {
        Self::default()
    }

    /// Mutable access to the ramp cache. Used by `vello::Renderer::intern_sub`
    /// to register pinned ramps for sub-encodings baked into the SubLibrary —
    /// the resolved `ramp_id` must stay valid across frames so the SubLibrary's
    /// stored bytes can embed it permanently.
    pub fn ramp_cache_mut(&mut self) -> &mut RampCache {
        &mut self.ramp_cache
    }

    /// Mutable access to the image cache; same lifetime contract as
    /// `ramp_cache_mut`.
    pub fn image_cache_mut(&mut self) -> &mut ImageCache {
        &mut self.image_cache
    }

    /// Resolves late bound resources and packs an encoding. Returns the packed
    /// layout and computed ramp data.
    pub fn resolve<'a>(
        &'a mut self,
        encoding: &Encoding,
        packed: &mut Vec<u8>,
    ) -> (Layout, Ramps<'a>, Images<'a>) {
        // DOFUS Tier 7: slabbed encodings take a dedicated path that
        // reserves per-stream gaps at each `INSTANCED_SLAB_BEGIN` marker
        // so the packed-buffer byte layout stays constant across frames
        // — vello's `reuse_fast` fires from the second frame onward.
        // Slabbed encodings carry no late-bound patches of their own
        // (asserted inside `resolve_slabbed`) — but the SubLibrary subs
        // the GPU expander materializes were resolved at intern time
        // against this resolver's PINNED ramp/image caches, so their
        // draw data references pinned atlas (x, y) and ramp rows. Those
        // pixels live in the renderer's PERSISTENT slab textures
        // (uploaded once at pin time and bound as external resources at
        // replay) — returning the caches here would put a full pinned
        // atlas + ramp re-upload in every slab band's recording, every
        // frame (~13 MB/band, halved the frame rate when tried).
        if !encoding.instance_slab_blocks.is_empty()
            && encoding.resources.patches.is_empty()
            && encoding.instance_blocks.is_empty()
        {
            let layout = resolve_slabbed::resolve_slabbed(encoding, packed);
            return (layout, Ramps::default(), Images::default());
        }
        // DOFUS Tier 6: keep a reference to the original encoding so the
        // instance arrays can be packed after styles. Then expand markers
        // into a flat encoding for the existing walks. The expansion is
        // `Cow::Borrowed` (zero-cost) when no instanced blocks present.
        // DOFUS Tier 6: CPU expand for byte-layout stability + still pack
        // instance arrays at the end so a future GPU pre-pass can consume
        // them. `original` keeps the instance arrays accessible after the
        // shadowing of `encoding` by the flat expansion.
        let original = encoding;
        let expanded = encoding.expand_instanced_to_flat();
        let encoding = expanded.as_ref();
        let resources = &encoding.resources;
        if resources.patches.is_empty() {
            let layout = resolve_solid_paths_only_impl(encoding, original, packed);
            return (layout, Ramps::default(), Images::default());
        }
        let patch_sizes = self.resolve_patches(encoding);
        self.resolve_pending_images();
        let data = packed;
        data.clear();
        let mut layout = Layout {
            n_paths: encoding.n_paths,
            n_clips: encoding.n_clips,
            ..Layout::default()
        };
        let instance_byte_size = instance_regions_byte_size(original);
        let SceneBufferSizes {
            buffer_size,
            path_tag_padded,
        } = SceneBufferSizes::new(encoding, &patch_sizes, instance_byte_size);
        data.reserve(buffer_size);
        // Path tag stream
        layout.path_tag_base = size_to_words(data.len());
        {
            let mut pos = 0;
            let stream = &encoding.path_tags;
            for patch in &self.patches {
                if let ResolvedPatch::GlyphRun { index, glyphs, .. } = patch {
                    layout.n_paths += 1;
                    let stream_offset = resources.glyph_runs[*index].stream_offsets.path_tags;
                    if pos < stream_offset {
                        data.extend_from_slice(bytemuck::cast_slice(&stream[pos..stream_offset]));
                        pos = stream_offset;
                    }
                    for glyph in &self.glyphs[glyphs.clone()] {
                        data.extend_from_slice(bytemuck::bytes_of(&PathTag::TRANSFORM));
                        data.extend_from_slice(bytemuck::cast_slice(&glyph.path_tags));
                    }
                    data.extend_from_slice(bytemuck::bytes_of(&PathTag::PATH));
                }
            }
            if pos < stream.len() {
                data.extend_from_slice(bytemuck::cast_slice(&stream[pos..]));
            }
            for _ in 0..encoding.n_open_clips {
                data.extend_from_slice(bytemuck::bytes_of(&PathTag::PATH));
            }
            data.resize(path_tag_padded, 0);
        }
        // Path data stream
        layout.path_data_base = size_to_words(data.len());
        {
            let mut pos = 0;
            let stream = &encoding.path_data;
            for patch in &self.patches {
                if let ResolvedPatch::GlyphRun { index, glyphs, .. } = patch {
                    let stream_offset = encoding.resources.glyph_runs[*index]
                        .stream_offsets
                        .path_data;
                    if pos < stream_offset {
                        data.extend_from_slice(bytemuck::cast_slice(&stream[pos..stream_offset]));
                        pos = stream_offset;
                    }
                    for glyph in &self.glyphs[glyphs.clone()] {
                        data.extend_from_slice(bytemuck::cast_slice(&glyph.path_data));
                    }
                }
            }
            if pos < stream.len() {
                data.extend_from_slice(bytemuck::cast_slice(&stream[pos..]));
            }
        }
        // Draw tag stream
        layout.draw_tag_base = size_to_words(data.len());
        // Bin data follows draw info
        layout.bin_data_start = encoding.draw_tags.iter().map(|tag| tag.info_size()).sum();
        {
            data.extend_from_slice(bytemuck::cast_slice(&encoding.draw_tags));
            for _ in 0..encoding.n_open_clips {
                data.extend_from_slice(bytemuck::bytes_of(&DrawTag::END_CLIP));
            }
        }
        // Draw data stream
        layout.draw_data_base = size_to_words(data.len());
        {
            let mut pos = 0;
            let stream = &encoding.draw_data;
            for patch in &self.patches {
                match patch {
                    ResolvedPatch::Ramp {
                        draw_data_offset,
                        ramp_id,
                        extend,
                    } => {
                        if pos < *draw_data_offset {
                            data.extend_from_slice(bytemuck::cast_slice(
                                &encoding.draw_data[pos..*draw_data_offset],
                            ));
                        }
                        let index_mode = (ramp_id << 2) | *extend as u32;
                        data.extend_from_slice(bytemuck::bytes_of(&index_mode));
                        pos = *draw_data_offset + 1;
                    }
                    ResolvedPatch::GlyphRun { .. } => {}
                    ResolvedPatch::Image {
                        index,
                        draw_data_offset,
                    } => {
                        if pos < *draw_data_offset {
                            data.extend_from_slice(bytemuck::cast_slice(
                                &encoding.draw_data[pos..*draw_data_offset],
                            ));
                        }
                        if let Some((x, y)) = self.pending_images[*index].xy {
                            let xy = (x << 16) | y;
                            data.extend_from_slice(bytemuck::bytes_of(&xy));
                            pos = *draw_data_offset + 1;
                        } else {
                            // If we get here, we failed to allocate a slot for this image in the atlas.
                            // In this case, let's zero out the dimensions so we don't attempt to render
                            // anything.
                            // TODO: a better strategy: texture array? downsample large images?
                            data.extend_from_slice(&[0_u8; 8]);
                            pos = *draw_data_offset + 2;
                        }
                    }
                }
            }
            if pos < stream.len() {
                data.extend_from_slice(bytemuck::cast_slice(&stream[pos..]));
            }
        }
        // Transform stream
        layout.transform_base = size_to_words(data.len());
        {
            let mut pos = 0;
            let stream = &encoding.transforms;
            for patch in &self.patches {
                if let ResolvedPatch::GlyphRun {
                    index,
                    glyphs: _,
                    transform,
                    scale,
                    hint,
                } = patch
                {
                    let run = &resources.glyph_runs[*index];
                    let stream_offset = run.stream_offsets.transforms;
                    if pos < stream_offset {
                        data.extend_from_slice(bytemuck::cast_slice(&stream[pos..stream_offset]));
                        pos = stream_offset;
                    }
                    if let Some(glyph_transform) = run.glyph_transform {
                        for glyph in &resources.glyphs[run.glyphs.clone()] {
                            let mut xform = *transform
                                * Transform {
                                    matrix: [1.0, 0.0, 0.0, -1.0],
                                    translation: [glyph.x * scale, glyph.y * scale],
                                }
                                * glyph_transform;
                            if *hint {
                                xform.translation[1] = xform.translation[1].round();
                            }
                            data.extend_from_slice(bytemuck::bytes_of(&xform));
                        }
                    } else {
                        for glyph in &resources.glyphs[run.glyphs.clone()] {
                            let mut xform = *transform
                                * Transform {
                                    matrix: [1.0, 0.0, 0.0, -1.0],
                                    translation: [glyph.x * scale, glyph.y * scale],
                                };
                            if *hint {
                                xform.translation[1] = xform.translation[1].round();
                            }
                            data.extend_from_slice(bytemuck::bytes_of(&xform));
                        }
                    }
                }
            }
            if pos < stream.len() {
                data.extend_from_slice(bytemuck::cast_slice(&stream[pos..]));
            }
        }
        // Style stream
        layout.style_base = size_to_words(data.len());
        {
            let mut pos = 0;
            let stream = &encoding.styles;
            for patch in &self.patches {
                if let ResolvedPatch::GlyphRun { index, glyphs, .. } = patch {
                    let stream_offset = resources.glyph_runs[*index].stream_offsets.styles;
                    if pos < stream_offset {
                        data.extend_from_slice(bytemuck::cast_slice(&stream[pos..stream_offset]));
                        pos = stream_offset;
                    }
                    for glyph in &self.glyphs[glyphs.clone()] {
                        data.extend_from_slice(bytemuck::cast_slice(&glyph.styles));
                    }
                }
            }
            if pos < stream.len() {
                data.extend_from_slice(bytemuck::cast_slice(&stream[pos..]));
            }
        }
        // DOFUS Tier 6: instance regions packed after styles.
        layout.instance_transforms_base = size_to_words(data.len());
        layout.n_instance_transforms = original.instance_transforms.len() as u32;
        data.extend_from_slice(bytemuck::cast_slice(&original.instance_transforms));
        layout.instance_color_overlays_base = size_to_words(data.len());
        layout.n_instance_color_overlays = original.instance_color_overlays.len() as u32;
        data.extend_from_slice(bytemuck::cast_slice(&original.instance_color_overlays));
        let sub_lib = pack_sub_library(original, data);
        let descriptors = build_instance_block_descriptors(original, &sub_lib);
        layout.instance_blocks_base = size_to_words(data.len());
        layout.n_instance_blocks = descriptors.len() as u32;
        data.extend_from_slice(bytemuck::cast_slice(&descriptors));
        self.glyphs.clear();
        layout.n_draw_objects = layout.n_paths;
        assert_eq!(buffer_size, data.len());
        (layout, self.ramp_cache.ramps(), self.image_cache.images())
    }

    fn resolve_patches(&mut self, encoding: &Encoding) -> StreamOffsets {
        self.ramp_cache.maintain();
        self.glyphs.clear();
        self.glyph_cache.maintain();
        self.image_cache.clear();
        self.pending_images.clear();
        self.patches.clear();
        let mut sizes = StreamOffsets::default();
        let resources = &encoding.resources;
        for patch in &resources.patches {
            match patch {
                Patch::Ramp {
                    draw_data_offset,
                    stops,
                    extend,
                } => {
                    let ramp_id = self.ramp_cache.add(&resources.color_stops[stops.clone()]);
                    self.patches.push(ResolvedPatch::Ramp {
                        draw_data_offset: *draw_data_offset + sizes.draw_data,
                        ramp_id,
                        extend: *extend,
                    });
                }
                Patch::GlyphRun { index } => {
                    let mut run_sizes = StreamOffsets::default();
                    let run = &resources.glyph_runs[*index];
                    let glyphs = &resources.glyphs[run.glyphs.clone()];
                    let coords = &resources.normalized_coords[run.normalized_coords.clone()];
                    let mut hint = run.hint;
                    let mut font_size = run.font_size;
                    let mut transform = run.transform;
                    let mut scale = 1.0;
                    if hint {
                        // If hinting was requested and our transform matrix is just a uniform
                        // scale, then adjust our font size and cancel out the matrix. Otherwise,
                        // disable hinting entirely.
                        if transform.matrix[0] == transform.matrix[3]
                            && transform.matrix[1] == 0.0
                            && transform.matrix[2] == 0.0
                        {
                            scale = transform.matrix[0];
                            font_size *= scale;
                            transform.matrix = [1.0, 0.0, 0.0, 1.0];
                        } else {
                            hint = false;
                        }
                    }
                    let Some(mut session) = self.glyph_cache.session(
                        &run.font,
                        bytemuck::cast_slice(coords),
                        font_size,
                        hint,
                        &run.style,
                    ) else {
                        continue;
                    };
                    let glyph_start = self.glyphs.len();
                    for glyph in glyphs {
                        let (encoding, stream_sizes) =
                            session.get_or_insert(glyph.id).unwrap_or_else(|| {
                                // HACK: We pretend that the encoding was empty.
                                // In theory, we should be able to skip this glyph, but there is also
                                // a corresponding entry in `resources`, which means that we would
                                // need to make the patching process skip this glyph.
                                (Arc::new(Encoding::new()), StreamOffsets::default())
                            });
                        run_sizes.add(&stream_sizes);
                        self.glyphs.push(encoding);
                    }
                    let glyph_end = self.glyphs.len();
                    run_sizes.path_tags += glyphs.len() + 1;
                    run_sizes.transforms += glyphs.len();
                    sizes.add(&run_sizes);
                    self.patches.push(ResolvedPatch::GlyphRun {
                        index: *index,
                        glyphs: glyph_start..glyph_end,
                        transform,
                        scale,
                        hint,
                    });
                }
                Patch::Image {
                    draw_data_offset,
                    image,
                } => {
                    let index = self.pending_images.len();
                    self.pending_images.push(PendingImage {
                        image: image.clone(),
                        xy: None,
                    });
                    self.patches.push(ResolvedPatch::Image {
                        index,
                        draw_data_offset: *draw_data_offset + sizes.draw_data,
                    });
                }
            }
        }
        sizes
    }

    fn resolve_pending_images(&mut self) {
        self.image_cache.clear();
        'outer: loop {
            // Loop over the images, attempting to allocate them all into the atlas.
            for pending_image in &mut self.pending_images {
                if let Some(xy) = self.image_cache.get_or_insert(&pending_image.image) {
                    pending_image.xy = Some(xy);
                } else {
                    // We failed to allocate. Try to bump the atlas size.
                    if self.image_cache.bump_size() {
                        // We were able to increase the atlas size. Restart the outer loop.
                        continue 'outer;
                    } else {
                        // If the atlas is already maximum size, there's nothing we can do. Set
                        // the xy field to None so this image isn't rendered and then carry on--
                        // other images might still fit.
                        pending_image.xy = None;
                    }
                }
            }
            // If we made it here, we've either successfully allocated all images or we reached
            // the maximum atlas size.
            break;
        }
        // DOFUS diagnostics: record the working set re-packed (and GPU
        // re-uploaded) this resolve.
        let mut total_bytes = 0u64;
        let mut n_dropped = 0u32;
        let mut max_image_px = 0u32;
        for p in &self.pending_images {
            let px = (p.image.width as u64) * (p.image.height as u64);
            total_bytes += px * 4;
            max_image_px = max_image_px.max((p.image.width).max(p.image.height));
            if p.xy.is_none() {
                n_dropped += 1;
            }
        }
        self.last_image_stats = ImageResolveStats {
            n_images: self.pending_images.len() as u32,
            total_bytes,
            n_dropped,
            max_image_px,
            atlas_px: self.image_cache.images().width,
        };
    }

    /// Image-atlas working-set stats from the most recent `resolve` (DOFUS
    /// diagnostics).
    pub fn last_image_stats(&self) -> ImageResolveStats {
        self.last_image_stats
    }
}

/// Patch for a late bound resource.
#[derive(Clone)]
pub enum Patch {
    /// Gradient ramp resource.
    Ramp {
        /// Byte offset to the ramp id in the draw data stream.
        draw_data_offset: usize,
        /// Range of the gradient stops in the resource set.
        stops: Range<usize>,
        /// Extend mode for the gradient.
        extend: Extend,
    },
    /// Glyph run resource.
    GlyphRun {
        /// Index in the glyph run buffer.
        index: usize,
    },
    /// Image resource.
    Image {
        /// Offset to the atlas coordinates in the draw data stream.
        draw_data_offset: usize,
        /// Underlying image data.
        image: ImageData,
    },
}

/// Image to be allocated in the atlas.
#[derive(Clone, Debug)]
struct PendingImage {
    image: ImageData,
    xy: Option<(u32, u32)>,
}

#[derive(Clone, Debug)]
enum ResolvedPatch {
    Ramp {
        /// Offset to the ramp id in draw data stream.
        draw_data_offset: usize,
        /// Resolved ramp index.
        ramp_id: u32,
        /// Extend mode for the gradient.
        extend: Extend,
    },
    GlyphRun {
        /// Index of the original glyph run in the encoding.
        index: usize,
        /// Range into the glyphs encoding range buffer.
        glyphs: Range<usize>,
        /// Global transform.
        transform: Transform,
        /// Additional scale factor to apply to translation.
        scale: f32,
        /// Whether the glyph was hinted.
        ///
        /// This determines whether the y-coordinate of the final position
        /// needs to be rounded.
        hint: bool,
    },
    Image {
        /// Index of pending image element.
        index: usize,
        /// Offset to the atlas location in the draw data stream.
        draw_data_offset: usize,
    },
}

struct SceneBufferSizes {
    /// Full size of the scene buffer in bytes.
    buffer_size: usize,
    /// Padded length of the path tag stream in bytes.
    path_tag_padded: usize,
}

impl SceneBufferSizes {
    /// Computes common scene buffer sizes for the given encoding and patch
    /// stream sizes. `instance_byte_size` accounts for the DOFUS Tier 6
    /// instance_transforms + instance_color_overlays regions packed at the
    /// end of the buffer (zero for non-instanced encodings).
    fn new(encoding: &Encoding, patch_sizes: &StreamOffsets, instance_byte_size: usize) -> Self {
        let n_path_tags =
            encoding.path_tags.len() + patch_sizes.path_tags + encoding.n_open_clips as usize;
        let path_tag_padded = align_up(n_path_tags, 4 * crate::config::PATH_REDUCE_WG);
        let buffer_size = path_tag_padded
            + slice_size_in_bytes(&encoding.path_data, patch_sizes.path_data)
            + slice_size_in_bytes(
                &encoding.draw_tags,
                patch_sizes.draw_tags + encoding.n_open_clips as usize,
            )
            + slice_size_in_bytes(&encoding.draw_data, patch_sizes.draw_data)
            + slice_size_in_bytes(&encoding.transforms, patch_sizes.transforms)
            + slice_size_in_bytes(&encoding.styles, patch_sizes.styles)
            + instance_byte_size;
        Self {
            buffer_size,
            path_tag_padded,
        }
    }
}

/// DOFUS Tier 6: byte size of the instance_transforms +
/// instance_color_overlays + instance_blocks regions for `encoding`.
/// Caller passes this to [`SceneBufferSizes::new`] so the packed scene
/// buffer is sized to fit all three regions appended after styles.
fn instance_regions_byte_size(encoding: &Encoding) -> usize {
    let t_words = encoding.instance_transforms.len() * (size_of::<Transform>() / size_of::<u32>());
    let o_words = encoding.instance_color_overlays.len();
    let b_words =
        encoding.instance_blocks.len() * (size_of::<InstanceBlockGpu>() / size_of::<u32>());
    let sub_lib_bytes = sub_library_byte_size(encoding);
    (t_words + o_words + b_words) * size_of::<u32>() + sub_lib_bytes
}

/// DOFUS Tier 6: GPU-side instance block descriptor.
///
/// Field layout MUST match the `InstanceBlockGpu` struct declared in
/// `vello_shaders/shader/instance_expand.wgsl`. 24 u32 / 96 bytes per
/// entry (21 fields + 3 padding for the alignment the shader assumes
/// via `INSTANCE_BLOCK_WORDS = 24u`).
///
/// The GPU pre-pass shader reads these descriptors to materialise the
/// flat scene representation that downstream stages (pathtag_reduce →
/// pathtag_scan → flatten → ...) consume. Until that pre-pass is wired
/// the descriptors are packed but unread; the existing CPU
/// `Encoding::expand_instanced_to_flat` shim still produces the flat
/// form the resolver hands to the GPU.
#[derive(Copy, Clone, Debug, Default, Zeroable, Pod)]
#[repr(C)]
pub struct InstanceBlockGpu {
    pub count: u32,
    pub transforms_base: u32,
    pub overlays_base: u32,
    pub sub_path_tags_offset: u32,
    pub sub_path_tags_count: u32,
    pub sub_path_data_offset: u32,
    pub sub_path_data_count: u32,
    pub sub_draw_tags_offset: u32,
    pub sub_draw_tags_count: u32,
    pub sub_draw_data_offset: u32,
    pub sub_draw_data_count: u32,
    pub sub_transforms_offset: u32,
    pub sub_transforms_count: u32,
    pub sub_styles_offset: u32,
    pub sub_styles_count: u32,
    pub splice_path_tags: u32,
    pub splice_path_data: u32,
    pub splice_draw_tags: u32,
    pub splice_draw_data: u32,
    pub splice_transforms: u32,
    pub splice_styles: u32,
    pub _pad0: u32,
    pub _pad1: u32,
    pub _pad2: u32,
}

/// DOFUS Tier 6: per-unique-sub offsets into the packed sub library.
///
/// Each unique `Arc<Encoding>` referenced by an instance block is packed
/// once into the scene buffer. These offsets (in u32 words) point at
/// the start of each of the sub's 6 streams within that library
/// region.
#[derive(Copy, Clone, Default)]
struct SubLibraryOffsets {
    path_tags_offset: u32,
    path_data_offset: u32,
    draw_tags_offset: u32,
    draw_data_offset: u32,
    transforms_offset: u32,
    styles_offset: u32,
}

/// DOFUS Tier 6: pack the sub library into `data` and return a map from
/// `Arc::as_ptr` identity (as `usize`) to the offsets where each sub's
/// streams were placed. Deduplicates: multiple instance blocks
/// referencing the same `Arc<Encoding>` get the same offsets.
///
/// The function appends to `data` in stream-major order (all subs'
/// path_tags first, then all path_data, etc.) so each cross-sub-stream
/// region is contiguous — which would let downstream stages bind a
/// single sub-stream range if useful. The shader pre-pass currently
/// reads one sub at a time so the interleaving doesn't matter, but
/// keeping streams grouped preserves the option.
fn pack_sub_library(
    encoding: &Encoding,
    data: &mut Vec<u8>,
) -> std::collections::HashMap<usize, SubLibraryOffsets> {
    use std::collections::HashMap;
    let mut unique: Vec<&Arc<Encoding>> = Vec::new();
    let mut seen: HashMap<usize, usize> = HashMap::new();
    for block in &encoding.instance_blocks {
        let key = Arc::as_ptr(&block.sub) as usize;
        if !seen.contains_key(&key) {
            seen.insert(key, unique.len());
            unique.push(&block.sub);
        }
    }
    let mut offsets: Vec<SubLibraryOffsets> = vec![SubLibraryOffsets::default(); unique.len()];
    // path_tags (byte stream, may need u32 padding)
    for (i, sub) in unique.iter().enumerate() {
        offsets[i].path_tags_offset = size_to_words(data.len());
        data.extend_from_slice(bytemuck::cast_slice(&sub.path_tags));
        let pad = (4 - (data.len() % 4)) % 4;
        for _ in 0..pad {
            data.push(0);
        }
    }
    // path_data (u32)
    for (i, sub) in unique.iter().enumerate() {
        offsets[i].path_data_offset = size_to_words(data.len());
        data.extend_from_slice(bytemuck::cast_slice(&sub.path_data));
    }
    // draw_tags (u32 DrawTag)
    for (i, sub) in unique.iter().enumerate() {
        offsets[i].draw_tags_offset = size_to_words(data.len());
        data.extend_from_slice(bytemuck::cast_slice(&sub.draw_tags));
    }
    // draw_data (u32)
    for (i, sub) in unique.iter().enumerate() {
        offsets[i].draw_data_offset = size_to_words(data.len());
        data.extend_from_slice(bytemuck::cast_slice(&sub.draw_data));
    }
    // transforms (6 u32 each)
    for (i, sub) in unique.iter().enumerate() {
        offsets[i].transforms_offset = size_to_words(data.len());
        data.extend_from_slice(bytemuck::cast_slice(&sub.transforms));
    }
    // styles
    for (i, sub) in unique.iter().enumerate() {
        offsets[i].styles_offset = size_to_words(data.len());
        data.extend_from_slice(bytemuck::cast_slice(&sub.styles));
    }
    seen.into_iter()
        .map(|(arc_ptr, unique_idx)| (arc_ptr, offsets[unique_idx]))
        .collect()
}

/// DOFUS Tier 6: byte size of the sub-library region for `encoding`.
fn sub_library_byte_size(encoding: &Encoding) -> usize {
    use std::collections::HashSet;
    let mut seen: HashSet<usize> = HashSet::new();
    let mut total = 0usize;
    for block in &encoding.instance_blocks {
        let key = Arc::as_ptr(&block.sub) as usize;
        if seen.insert(key) {
            let sub = &block.sub;
            // path_tags as bytes, padded to u32
            let pt_bytes = sub.path_tags.len();
            total += pt_bytes + ((4 - (pt_bytes % 4)) % 4);
            total += sub.path_data.len() * size_of::<u32>();
            total += sub.draw_tags.len() * size_of::<DrawTag>();
            total += sub.draw_data.len() * size_of::<u32>();
            total += sub.transforms.len() * size_of::<Transform>();
            total += sub.styles.len() * size_of::<crate::Style>();
        }
    }
    total
}

/// DOFUS Tier 6: build the GPU descriptor table for a marker-emit
/// `Encoding`, populating `sub_*_offset` from the sub library map
/// produced by [`pack_sub_library`].
fn build_instance_block_descriptors(
    encoding: &Encoding,
    sub_lib: &std::collections::HashMap<usize, SubLibraryOffsets>,
) -> Vec<InstanceBlockGpu> {
    encoding
        .instance_blocks
        .iter()
        .map(|b| {
            let key = Arc::as_ptr(&b.sub) as usize;
            let off = sub_lib.get(&key).copied().unwrap_or_default();
            InstanceBlockGpu {
                count: b.count,
                transforms_base: b.transforms_base,
                overlays_base: b.overlays_base,
                sub_path_tags_offset: off.path_tags_offset,
                sub_path_tags_count: b.sub.path_tags.len() as u32,
                sub_path_data_offset: off.path_data_offset,
                sub_path_data_count: b.sub.path_data.len() as u32,
                sub_draw_tags_offset: off.draw_tags_offset,
                sub_draw_tags_count: b.sub.draw_tags.len() as u32,
                sub_draw_data_offset: off.draw_data_offset,
                sub_draw_data_count: b.sub.draw_data.len() as u32,
                sub_transforms_offset: off.transforms_offset,
                sub_transforms_count: b.sub.transforms.len() as u32,
                sub_styles_offset: off.styles_offset,
                sub_styles_count: b.sub.styles.len() as u32,
                splice_path_tags: b.splice_path_tags,
                splice_path_data: b.splice_path_data,
                splice_draw_tags: b.splice_draw_tags,
                splice_draw_data: b.splice_draw_data,
                splice_transforms: b.splice_transforms,
                splice_styles: b.splice_styles,
                _pad0: 0,
                _pad1: 0,
                _pad2: 0,
            }
        })
        .collect()
}

fn slice_size_in_bytes<T: Sized>(slice: &[T], extra: usize) -> usize {
    (slice.len() + extra) * size_of::<T>()
}

pub(crate) fn size_to_words(byte_size: usize) -> u32 {
    (byte_size / size_of::<u32>()) as u32
}

pub(crate) fn align_up(len: usize, alignment: u32) -> usize {
    len + (len.wrapping_neg() & (alignment as usize - 1))
}
