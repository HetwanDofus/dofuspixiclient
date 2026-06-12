// Copyright 2022 the Vello Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

use crate::DrawBeginClip;

use super::{
    DrawBlurRoundedRect, DrawColor, DrawImage, DrawLinearGradient, DrawRadialGradient,
    DrawSweepGradient, DrawTag, Glyph, GlyphRun, NormalizedCoord, Patch, PathEncoder, PathTag,
    Style, Transform,
};

use std::borrow::Cow;
use std::sync::Arc;

use peniko::color::{DynamicColor, palette};
use peniko::kurbo::{Affine, Shape, Stroke};
use peniko::{
    BrushRef, ColorStop, Extend, Fill, GradientKind, ImageBrushRef, ImageSampler,
    LinearGradientPosition, RadialGradientPosition, SweepGradientPosition,
};

/// Encoded data streams for a scene.
///
/// # Invariants
///
/// * At least one transform and style must be encoded before any path data
///   or draw object.
#[derive(Clone, Default)]
pub struct Encoding {
    /// The path tag stream.
    pub path_tags: Vec<PathTag>,
    /// The path data stream.
    /// Stores all coordinates on paths.
    /// Stored as `u32` as all comparisons are performed bitwise.
    pub path_data: Vec<u32>,
    /// The draw tag stream.
    pub draw_tags: Vec<DrawTag>,
    /// The draw data stream.
    pub draw_data: Vec<u32>,
    /// The transform stream.
    pub transforms: Vec<Transform>,
    /// The style stream
    pub styles: Vec<Style>,
    /// Late bound resource data.
    pub resources: Resources,
    /// Number of encoded paths.
    pub n_paths: u32,
    /// Number of encoded path segments.
    pub n_path_segments: u32,
    /// Number of encoded clips/layers.
    pub n_clips: u32,
    /// Number of unclosed clips/layers.
    pub n_open_clips: u32,
    /// Flags that capture the current state of the encoding.
    pub flags: u32,
    /// DOFUS Tier 6: descriptors for instanced sub-encoding blocks. The k-th
    /// `PathTag::INSTANCED_BEGIN` in `path_tags` corresponds to
    /// `instance_blocks[k]` — each block carries the sub-encoding to
    /// instance, its instance count, and base offsets into
    /// `instance_transforms` / `instance_color_overlays`.
    pub instance_blocks: Vec<InstanceBlock>,
    /// DOFUS Tier 6: per-instance affine transforms. All instances across
    /// all blocks share this flat array; each block records its base offset.
    pub instance_transforms: Vec<Transform>,
    /// DOFUS Tier 6: per-instance premultiplied RGBA color overlays. Three
    /// `u32`s per instance (one per player-color zone), packed contiguously
    /// by block. A block with no overlay sets `overlays_base = u32::MAX` and
    /// contributes nothing to this array.
    pub instance_color_overlays: Vec<u32>,
    /// DOFUS Tier 7: descriptors for slabbed instance blocks. The k-th
    /// `PathTag::INSTANCED_SLAB_BEGIN` in `path_tags` corresponds to
    /// `instance_slab_blocks[k]`. Distinct from `instance_blocks`
    /// (marker-emit): slabbed blocks reserve a fixed slot table whose
    /// byte-size fingerprint stays constant across frames so vello's
    /// `reuse_fast` path fires from the second frame onward.
    pub instance_slab_blocks: Vec<crate::SlabbedInstanceBlock>,
}

/// DOFUS Tier 6: descriptor for one instanced sub-encoding block.
///
/// Sub-encoding bytes (path tags / data / transforms / styles / draw_tags /
/// draw_data / resources) are NOT stored inline in the parent — they live
/// behind `sub: Arc<Encoding>` to keep cross-frame slot rebinding cheap. The
/// parent's `path_tags` contains just one `PathTag::INSTANCED_BEGIN` marker;
/// the parent's `instance_blocks[k]` carries everything else for the k-th
/// block in tag order. The `splice_*` positions record where in each host
/// stream `sub` would be spliced when
/// [`expand_instanced_to_flat`](Encoding::expand_instanced_to_flat)
/// materialises the flat form for the GPU pipeline.
#[derive(Clone)]
pub struct InstanceBlock {
    /// Sub-encoding to instance. Shared across blocks so look-slot churn does
    /// not re-clone geometry bytes.
    pub sub: Arc<Encoding>,
    /// Number of instances in this block.
    pub count: u32,
    /// Base offset into the parent encoding's `instance_transforms`.
    pub transforms_base: u32,
    /// Base offset into the parent encoding's `instance_color_overlays`.
    /// `u32::MAX` sentinel marks a block whose draw_data colors are taken
    /// from `sub` literally (no per-instance overlay).
    pub overlays_base: u32,
    /// Splice position in the parent's `path_tags` (the marker is at
    /// `path_tags[splice_path_tags - 1]`, splice happens BEFORE the marker
    /// and replaces it with N copies of sub.path_tags).
    pub splice_path_tags: u32,
    pub splice_path_data: u32,
    pub splice_draw_tags: u32,
    pub splice_draw_data: u32,
    pub splice_transforms: u32,
    pub splice_styles: u32,
}

/// DOFUS Tier 6: per-instance parameters fed to `Encoding::append_instanced`.
///
/// `color_overlay` carries 3 premultiplied RGBA quads — one per player-color
/// zone. The sub-encoding's `Patch` list records the `draw_data` offsets to
/// overlay at fine-stage time. When `singleton_threshold_hint` is set AND
/// `instances.len() == 1`, the encoder emits the non-instanced path
/// (single `Encoding::append`) to avoid per-instance overhead on singleton
/// looks.
#[derive(Copy, Clone, Debug)]
pub struct InstanceParams {
    pub affine: Affine,
    pub color_overlay: Option<[[u8; 4]; 3]>,
    pub singleton_threshold_hint: bool,
}

impl Encoding {
    /// Forces encoding of the next transform even if it matches
    /// the current transform in the stream.
    pub const FORCE_NEXT_TRANSFORM: u32 = 1;

    /// Forces encoding of the next style even if it matches
    /// the current style in the stream.
    pub const FORCE_NEXT_STYLE: u32 = 2;

    /// Creates a new encoding.
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns `true` if the encoding is empty.
    pub fn is_empty(&self) -> bool {
        self.path_tags.is_empty()
    }

    #[doc(alias = "clear")]
    // This is not called "clear" because "clear" has other implications
    // in graphics contexts.
    /// Clears the encoding.
    pub fn reset(&mut self) {
        self.transforms.clear();
        self.path_tags.clear();
        self.path_data.clear();
        self.styles.clear();
        self.draw_data.clear();
        self.draw_tags.clear();
        self.n_paths = 0;
        self.n_path_segments = 0;
        self.n_clips = 0;
        self.n_open_clips = 0;
        self.flags = 0;
        self.resources.reset();
        self.instance_blocks.clear();
        self.instance_transforms.clear();
        self.instance_color_overlays.clear();
        crate::slabbed::reset_slab_blocks_clear(self);
        debug_assert!(self.instance_slab_blocks.is_empty());
    }

    /// Appends another encoding to this one with an optional transform.
    pub fn append(&mut self, other: &Self, transform: &Option<Transform>) {
        let glyph_runs_base = {
            let offsets = self.stream_offsets();
            let stops_base = self.resources.color_stops.len();
            let glyph_runs_base = self.resources.glyph_runs.len();
            let glyphs_base = self.resources.glyphs.len();
            let coords_base = self.resources.normalized_coords.len();
            self.resources
                .glyphs
                .extend_from_slice(&other.resources.glyphs);
            self.resources
                .normalized_coords
                .extend_from_slice(&other.resources.normalized_coords);
            self.resources
                .glyph_runs
                .extend(other.resources.glyph_runs.iter().cloned().map(|mut run| {
                    run.glyphs.start += glyphs_base;
                    run.glyphs.end += glyphs_base;
                    run.normalized_coords.start += coords_base;
                    run.normalized_coords.end += coords_base;
                    run.stream_offsets.path_tags += offsets.path_tags;
                    run.stream_offsets.path_data += offsets.path_data;
                    run.stream_offsets.draw_tags += offsets.draw_tags;
                    run.stream_offsets.draw_data += offsets.draw_data;
                    run.stream_offsets.transforms += offsets.transforms;
                    run.stream_offsets.styles += offsets.styles;
                    run
                }));
            self.resources
                .patches
                .extend(other.resources.patches.iter().map(|patch| match patch {
                    Patch::Ramp {
                        draw_data_offset: offset,
                        stops,
                        extend,
                    } => {
                        let stops = stops.start + stops_base..stops.end + stops_base;
                        Patch::Ramp {
                            draw_data_offset: offset + offsets.draw_data,
                            stops,
                            extend: *extend,
                        }
                    }
                    Patch::GlyphRun { index } => Patch::GlyphRun {
                        index: index + glyph_runs_base,
                    },
                    Patch::Image {
                        image,
                        draw_data_offset,
                    } => Patch::Image {
                        image: image.clone(),
                        draw_data_offset: *draw_data_offset + offsets.draw_data,
                    },
                }));
            self.resources
                .color_stops
                .extend_from_slice(&other.resources.color_stops);
            glyph_runs_base
        };
        self.path_tags.extend_from_slice(&other.path_tags);
        self.path_data.extend_from_slice(&other.path_data);
        self.draw_tags.extend_from_slice(&other.draw_tags);
        self.draw_data.extend_from_slice(&other.draw_data);
        self.n_paths += other.n_paths;
        self.n_path_segments += other.n_path_segments;
        self.n_clips += other.n_clips;
        self.n_open_clips += other.n_open_clips;
        self.flags = other.flags;
        if let Some(transform) = *transform {
            self.transforms
                .extend(other.transforms.iter().map(|x| transform * *x));
            for run in &mut self.resources.glyph_runs[glyph_runs_base..] {
                run.transform = transform * run.transform;
            }
        } else {
            self.transforms.extend_from_slice(&other.transforms);
        }
        self.styles.extend_from_slice(&other.styles);
        // DOFUS Tier 6: rebase the instance arrays of `other` onto this
        // encoding's tail. The transforms_base / overlays_base inside each
        // copied block must shift by the current array lengths. Per-instance
        // affines are composed with the caller's `transform` if any, so
        // `append_instanced` blocks nested inside an `append` call land in
        // the correct world frame.
        let instance_transforms_base = self.instance_transforms.len() as u32;
        let instance_overlays_base = self.instance_color_overlays.len() as u32;
        if let Some(transform) = *transform {
            self.instance_transforms
                .extend(other.instance_transforms.iter().map(|x| transform * *x));
        } else {
            self.instance_transforms
                .extend_from_slice(&other.instance_transforms);
        }
        self.instance_color_overlays
            .extend_from_slice(&other.instance_color_overlays);
        // Splice positions inside `other`'s blocks point into `other`'s
        // streams. Rebase them onto self's stream positions captured at
        // the start of this append (before the extend_from_slice's above
        // copied other's tags/data/etc onto self).
        let splice_base_path_tags = (self.path_tags.len() - other.path_tags.len()) as u32;
        let splice_base_path_data = (self.path_data.len() - other.path_data.len()) as u32;
        let splice_base_draw_tags = (self.draw_tags.len() - other.draw_tags.len()) as u32;
        let splice_base_draw_data = (self.draw_data.len() - other.draw_data.len()) as u32;
        let splice_base_transforms = (self.transforms.len() - other.transforms.len()) as u32;
        let splice_base_styles = (self.styles.len() - other.styles.len()) as u32;
        self.instance_blocks
            .extend(other.instance_blocks.iter().cloned().map(|mut b| {
                b.transforms_base += instance_transforms_base;
                if b.overlays_base != u32::MAX {
                    b.overlays_base += instance_overlays_base;
                }
                b.splice_path_tags += splice_base_path_tags;
                b.splice_path_data += splice_base_path_data;
                b.splice_draw_tags += splice_base_draw_tags;
                b.splice_draw_data += splice_base_draw_data;
                b.splice_transforms += splice_base_transforms;
                b.splice_styles += splice_base_styles;
                b
            }));
        crate::slabbed::append_rebase_slab_blocks(
            self,
            other,
            instance_transforms_base,
            instance_overlays_base,
            splice_base_path_tags,
        );
        debug_assert!(
            self.instance_slab_blocks
                .iter()
                .all(|b| b.descriptors.len() as u32 == b.slot_count
                    && b.aux_stream_lens.len() as u32 == b.slot_count)
        );
    }

    /// DOFUS Tier 6: appends `sub` once with N per-instance transforms.
    ///
    /// Marker-emit format: pushes one `PathTag::INSTANCED_BEGIN` into
    /// `path_tags`, records one `InstanceBlock` carrying the sub Arc and
    /// the splice positions of every host stream at marker time, and
    /// streams N affines into `instance_transforms`. Per-frame compose
    /// cost drops from `O(N * sub_bytes)` to `O(N * sizeof(Transform))`
    /// on the parallel band path.
    ///
    /// The GPU pipeline still expects a flat encoding; the resolver calls
    /// [`expand_instanced_to_flat`](Self::expand_instanced_to_flat)
    /// before packing to splice N copies of each block's sub into the host
    /// streams. The CPU expansion is byte-equivalent to N inline
    /// `append(sub, transform)` calls.
    ///
    /// `n_paths` / `n_path_segments` / `n_clips` reflect the
    /// POST-expansion totals so the resolver's layout sizing is correct.
    ///
    /// When `singleton_threshold_hint` is set AND `instances.len() == 1`,
    /// the encoder collapses to plain `Encoding::append` to skip even the
    /// parallel array bookkeeping on singleton looks.
    pub fn append_instanced(&mut self, sub: Arc<Self>, instances: &[InstanceParams]) {
        if instances.is_empty() {
            return;
        }
        if instances.len() == 1 && instances[0].singleton_threshold_hint {
            let t = Transform::from_kurbo(&instances[0].affine);
            self.append(&sub, &Some(t));
            return;
        }
        let transforms_base = self.instance_transforms.len() as u32;
        let any_overlay = instances.iter().any(|i| i.color_overlay.is_some());
        let overlays_base = if any_overlay {
            self.instance_color_overlays.len() as u32
        } else {
            u32::MAX
        };
        // The marker is the LAST byte pushed to path_tags. Splice position
        // is the path_tags length BEFORE the marker push so expand can copy
        // host content up to (but not including) the marker, splice sub
        // copies, then resume after the marker.
        self.path_tags.push(PathTag::INSTANCED_BEGIN);
        let splice_path_tags = (self.path_tags.len() - 1) as u32;
        let splice_path_data = self.path_data.len() as u32;
        let splice_draw_tags = self.draw_tags.len() as u32;
        let splice_draw_data = self.draw_data.len() as u32;
        let splice_transforms = self.transforms.len() as u32;
        let splice_styles = self.styles.len() as u32;
        self.instance_blocks.push(InstanceBlock {
            sub: Arc::clone(&sub),
            count: instances.len() as u32,
            transforms_base,
            overlays_base,
            splice_path_tags,
            splice_path_data,
            splice_draw_tags,
            splice_draw_data,
            splice_transforms,
            splice_styles,
        });
        for inst in instances {
            self.instance_transforms
                .push(Transform::from_kurbo(&inst.affine));
            if any_overlay {
                match inst.color_overlay {
                    Some(overlay) => {
                        for zone in overlay {
                            self.instance_color_overlays.push(u32::from_le_bytes(zone));
                        }
                    }
                    None => {
                        self.instance_color_overlays
                            .extend_from_slice(&[u32::MAX; 3]);
                    }
                }
            }
        }
        // DOFUS Tier 6 Phase 2: counters stay at host totals (NOT bumped
        // by sub counters). Reason: with CPU expansion removed in
        // `Resolver::resolve`, the path_tags stream only carries the
        // marker byte for this block — the sub's actual segments / paths
        // / clips never reach the GPU. The resolver allocates buffers
        // sized to the host counts; an over-allocated count would lead
        // to bbox_clear / tile_alloc dispatches walking off the end of
        // the actually-encoded scene. A future per-stage shader logic
        // pass that virtually expands the marker will need to either
        // (a) re-introduce the counter bump and gate the marker on
        // shader-side count multiplication, or (b) compute the
        // post-expand counts inside the relevant stages.
        self.flags = sub.flags;
    }

    /// DOFUS Tier 6: produces a flat `Encoding` with every
    /// `INSTANCED_BEGIN` marker replaced by N inline expansions of its
    /// block's sub-encoding. Output is byte-equivalent to N consecutive
    /// `append(sub, Some(t))` calls so the resolver and GPU pipeline see
    /// the same bytes they always have.
    ///
    /// Fast path: when `instance_blocks` is empty, returns
    /// `Cow::Borrowed(self)` and does zero work — every scene that never
    /// calls `append_instanced` pays nothing.
    pub fn expand_instanced_to_flat(&self) -> Cow<'_, Self> {
        if self.instance_blocks.is_empty() {
            return Cow::Borrowed(self);
        }
        let mut flat = Self::default();
        flat.resources = self.resources.clone();
        flat.flags = self.flags;
        flat.n_open_clips = self.n_open_clips;
        // Pre-reserve approximate output size.
        let mut total_inst = 0u32;
        for b in &self.instance_blocks {
            total_inst += b.count;
        }
        let mut cur_path_tags = 0usize;
        let mut cur_path_data = 0usize;
        let mut cur_draw_tags = 0usize;
        let mut cur_draw_data = 0usize;
        let mut cur_transforms = 0usize;
        let mut cur_styles = 0usize;
        for block in &self.instance_blocks {
            // Copy host content up to the splice point.
            flat.path_tags
                .extend_from_slice(&self.path_tags[cur_path_tags..block.splice_path_tags as usize]);
            flat.path_data
                .extend_from_slice(&self.path_data[cur_path_data..block.splice_path_data as usize]);
            flat.draw_tags
                .extend_from_slice(&self.draw_tags[cur_draw_tags..block.splice_draw_tags as usize]);
            flat.draw_data
                .extend_from_slice(&self.draw_data[cur_draw_data..block.splice_draw_data as usize]);
            flat.transforms.extend_from_slice(
                &self.transforms[cur_transforms..block.splice_transforms as usize],
            );
            flat.styles
                .extend_from_slice(&self.styles[cur_styles..block.splice_styles as usize]);
            // Skip the marker byte itself in path_tags. All other splice
            // positions point at the unchanged stream tail.
            cur_path_tags = block.splice_path_tags as usize + 1;
            cur_path_data = block.splice_path_data as usize;
            cur_draw_tags = block.splice_draw_tags as usize;
            cur_draw_data = block.splice_draw_data as usize;
            cur_transforms = block.splice_transforms as usize;
            cur_styles = block.splice_styles as usize;
            // Splice N copies of sub. Each copy: append sub bytes via
            // `append`, then if the block carries a per-instance color
            // overlay, write a SENTINEL into the first 3 COLOR draw_data
            // slots of this copy. The sentinel routes the color through
            // the shader-side `read_instance_color_overlay` lookup at
            // fine-stage time. Encoding: `(0xFA + zone) << 24 |
            // global_instance_idx` — high byte 0xFA/0xFB/0xFC marks the
            // zone (0/1/2) and breaks the premultiplied-RGBA invariant so
            // the shader can detect it; low 24 bits are the linearized
            // instance index `block.overlays_base/3 + inst_i`. The shader
            // reads `scene[config.instance_color_overlays_base +
            // instance_idx*3 + zone]` to get the actual RGBA.
            let block_has_overlays = block.overlays_base != u32::MAX;
            for inst_i in 0..block.count as usize {
                let draw_data_before = flat.draw_data.len();
                let transforms_before = flat.transforms.len();
                // Append sub WITHOUT composing the per-instance affine.
                // Sub's path_data stays in local coords; the shader resolves
                // the world transform via `instance_transforms[idx]` after
                // detecting the sentinel we install below.
                flat.append(&block.sub, &None);
                // Replace the appended transforms with a sentinel encoding
                // the global instance index into this encoding's
                // `instance_transforms` array. Sentinel layout:
                //   matrix[0] = canonical NaN (`0x7FC00000` bits)
                //   matrix[1] = bitcast<f32> of (transforms_base + inst_i)
                // The NaN check in `flatten.wgsl::read_transform` /
                // `draw_leaf.wgsl::read_transform` triggers the redirect.
                let global_inst_idx = block.transforms_base + inst_i as u32;
                let sentinel = Transform {
                    matrix: [
                        f32::from_bits(0x7FC00000),
                        f32::from_bits(global_inst_idx),
                        0.0,
                        0.0,
                    ],
                    translation: [0.0, 0.0],
                };
                for t in &mut flat.transforms[transforms_before..] {
                    *t = sentinel;
                }
                if block_has_overlays {
                    let zones_off = block.overlays_base as usize + inst_i * 3;
                    // `u32::MAX` in every zone slot means this specific
                    // instance opted out of the per-instance overlay
                    // (other instances in the same block did opt in).
                    // Leave its draw_data alone so it renders with the
                    // sub-encoding's literal colors.
                    let inst_has_overlay = self.instance_color_overlays[zones_off] != u32::MAX
                        || self.instance_color_overlays[zones_off + 1] != u32::MAX
                        || self.instance_color_overlays[zones_off + 2] != u32::MAX;
                    if !inst_has_overlay {
                        continue;
                    }
                    let global_instance_idx = (block.overlays_base / 3) + inst_i as u32;
                    let mut draw_off = draw_data_before;
                    let mut zone_idx = 0u32;
                    for tag in &block.sub.draw_tags {
                        let scene_words = ((tag.0 >> 2) & 0x07) as usize;
                        if *tag == DrawTag::COLOR && zone_idx < 3 {
                            if draw_off < flat.draw_data.len() {
                                let sentinel = ((0xFAu32 + zone_idx) << 24)
                                    | (global_instance_idx & 0x00FF_FFFF);
                                flat.draw_data[draw_off] = sentinel;
                            }
                            zone_idx += 1;
                        }
                        draw_off += scene_words;
                    }
                }
            }
        }
        // Tail of host streams after the last marker.
        flat.path_tags
            .extend_from_slice(&self.path_tags[cur_path_tags..]);
        flat.path_data
            .extend_from_slice(&self.path_data[cur_path_data..]);
        flat.draw_tags
            .extend_from_slice(&self.draw_tags[cur_draw_tags..]);
        flat.draw_data
            .extend_from_slice(&self.draw_data[cur_draw_data..]);
        flat.transforms
            .extend_from_slice(&self.transforms[cur_transforms..]);
        flat.styles.extend_from_slice(&self.styles[cur_styles..]);
        // Counters: `append` calls above already bumped flat.n_* by each
        // instance's sub contribution; add the host's own counters to
        // complete the post-expand totals.
        flat.n_paths += self.n_paths;
        flat.n_path_segments += self.n_path_segments;
        flat.n_clips += self.n_clips;
        flat.n_open_clips = self.n_open_clips;
        let _ = total_inst;
        Cow::Owned(flat)
    }

    /// Returns a snapshot of the current stream offsets.
    pub fn stream_offsets(&self) -> StreamOffsets {
        StreamOffsets {
            path_tags: self.path_tags.len(),
            path_data: self.path_data.len(),
            draw_tags: self.draw_tags.len(),
            draw_data: self.draw_data.len(),
            transforms: self.transforms.len(),
            styles: self.styles.len(),
        }
    }

    /// Encodes a fill style.
    pub fn encode_fill_style(&mut self, fill: Fill) {
        self.encode_style(Style::from_fill(fill));
    }

    /// Encodes a stroke style.
    ///
    /// Returns false if the stroke had zero width and so couldn't be encoded.
    #[must_use]
    pub fn encode_stroke_style(&mut self, stroke: &Stroke) -> bool {
        let style = Style::from_stroke(stroke);
        if let Some(style) = style {
            self.encode_style(style);
            true
        } else {
            false
        }
    }

    fn encode_style(&mut self, style: Style) {
        if self.flags & Self::FORCE_NEXT_STYLE != 0 || self.styles.last() != Some(&style) {
            self.path_tags.push(PathTag::STYLE);
            self.styles.push(style);
            self.flags &= !Self::FORCE_NEXT_STYLE;
        }
    }

    /// Encodes a transform.
    ///
    /// If the given transform is different from the current one, encodes it and
    /// returns true. Otherwise, encodes nothing and returns false.
    pub fn encode_transform(&mut self, transform: Transform) -> bool {
        if self.flags & Self::FORCE_NEXT_TRANSFORM != 0
            || self.transforms.last() != Some(&transform)
        {
            self.path_tags.push(PathTag::TRANSFORM);
            self.transforms.push(transform);
            self.flags &= !Self::FORCE_NEXT_TRANSFORM;
            true
        } else {
            false
        }
    }

    /// Returns an encoder for encoding a path. If `is_fill` is true, all subpaths will
    /// be automatically closed.
    pub fn encode_path(&mut self, is_fill: bool) -> PathEncoder<'_> {
        PathEncoder::new(
            &mut self.path_tags,
            &mut self.path_data,
            &mut self.n_path_segments,
            &mut self.n_paths,
            is_fill,
        )
    }

    /// Encodes a shape. If `is_fill` is true, all subpaths will be automatically closed.
    /// Returns `true` if a non-zero number of segments were encoded.
    pub fn encode_shape(&mut self, shape: &impl Shape, is_fill: bool) -> bool {
        let mut encoder = self.encode_path(is_fill);
        encoder.shape(shape);
        encoder.finish(true) != 0
    }

    /// Encode an empty path.
    ///
    /// This is useful for bookkeeping when a path is absolutely required (for example in
    /// pushing a clip layer). It is almost always the case, however, that an application
    /// can be optimized to not use this method.
    pub fn encode_empty_shape(&mut self) {
        let mut encoder = self.encode_path(true);
        encoder.empty_path();
        encoder.finish(true);
    }

    /// Encodes a path element iterator. If `is_fill` is true, all subpaths will be automatically
    /// closed. Returns `true` if a non-zero number of segments were encoded.
    pub fn encode_path_elements(
        &mut self,
        path: impl Iterator<Item = peniko::kurbo::PathEl>,
        is_fill: bool,
    ) -> bool {
        let mut encoder = self.encode_path(is_fill);
        encoder.path_elements(path);
        encoder.finish(true) != 0
    }

    /// Encodes a brush with an optional alpha modifier.
    #[expect(
        single_use_lifetimes,
        reason = "False positive: https://github.com/rust-lang/rust/issues/129255"
    )]
    pub fn encode_brush<'b>(&mut self, brush: impl Into<BrushRef<'b>>, alpha: f32) {
        use super::math::point_to_f32;
        match brush.into() {
            BrushRef::Solid(color) => {
                let color = if alpha != 1.0 {
                    color.multiply_alpha(alpha)
                } else {
                    color
                };
                self.encode_color(color);
            }
            BrushRef::Gradient(gradient) => match gradient.kind {
                GradientKind::Linear(LinearGradientPosition { start, end }) => {
                    self.encode_linear_gradient(
                        DrawLinearGradient {
                            index: 0,
                            p0: point_to_f32(start),
                            p1: point_to_f32(end),
                        },
                        gradient.stops.iter().copied(),
                        alpha,
                        gradient.extend,
                    );
                }
                GradientKind::Radial(RadialGradientPosition {
                    start_center,
                    start_radius,
                    end_center,
                    end_radius,
                }) => {
                    self.encode_radial_gradient(
                        DrawRadialGradient {
                            index: 0,
                            p0: point_to_f32(start_center),
                            p1: point_to_f32(end_center),
                            r0: start_radius,
                            r1: end_radius,
                        },
                        gradient.stops.iter().copied(),
                        alpha,
                        gradient.extend,
                    );
                }
                GradientKind::Sweep(SweepGradientPosition {
                    center,
                    start_angle,
                    end_angle,
                }) => {
                    use core::f32::consts::TAU;
                    self.encode_sweep_gradient(
                        DrawSweepGradient {
                            index: 0,
                            p0: point_to_f32(center),
                            t0: start_angle / TAU,
                            t1: end_angle / TAU,
                        },
                        gradient.stops.iter().copied(),
                        alpha,
                        gradient.extend,
                    );
                }
            },
            BrushRef::Image(image) => {
                self.encode_image(image, alpha);
            }
        }
    }

    /// Encodes a solid color brush.
    pub fn encode_color(&mut self, color: impl Into<DrawColor>) {
        let color = color.into();
        self.draw_tags.push(DrawTag::COLOR);
        let DrawColor { rgba } = color;
        self.draw_data.push(rgba);
    }

    /// Encodes a linear gradient brush.
    pub fn encode_linear_gradient(
        &mut self,
        gradient: DrawLinearGradient,
        color_stops: impl Iterator<Item = ColorStop>,
        alpha: f32,
        extend: Extend,
    ) {
        match self.add_ramp(color_stops, alpha, extend) {
            RampStops::Empty => self.encode_color(palette::css::TRANSPARENT),
            RampStops::One(color) => {
                self.encode_color(color);
            }
            RampStops::Many => {
                self.draw_tags.push(DrawTag::LINEAR_GRADIENT);
                self.draw_data
                    .extend_from_slice(bytemuck::cast_slice(bytemuck::bytes_of(&gradient)));
            }
        }
    }

    /// Encodes a radial gradient brush.
    pub fn encode_radial_gradient(
        &mut self,
        gradient: DrawRadialGradient,
        color_stops: impl Iterator<Item = ColorStop>,
        alpha: f32,
        extend: Extend,
    ) {
        // Match Skia's epsilon for radii comparison
        const SKIA_EPSILON: f32 = 1.0 / (1 << 12) as f32;
        if gradient.p0 == gradient.p1 && (gradient.r0 - gradient.r1).abs() < SKIA_EPSILON {
            self.encode_color(palette::css::TRANSPARENT);
            return;
        }
        match self.add_ramp(color_stops, alpha, extend) {
            RampStops::Empty => self.encode_color(palette::css::TRANSPARENT),
            RampStops::One(color) => self.encode_color(color),
            RampStops::Many => {
                self.draw_tags.push(DrawTag::RADIAL_GRADIENT);
                self.draw_data
                    .extend_from_slice(bytemuck::cast_slice(bytemuck::bytes_of(&gradient)));
            }
        }
    }

    /// Encodes a radial gradient brush.
    pub fn encode_sweep_gradient(
        &mut self,
        gradient: DrawSweepGradient,
        color_stops: impl Iterator<Item = ColorStop>,
        alpha: f32,
        extend: Extend,
    ) {
        const SKIA_DEGENERATE_THRESHOLD: f32 = 1.0 / (1 << 15) as f32;
        if (gradient.t0 - gradient.t1).abs() < SKIA_DEGENERATE_THRESHOLD {
            self.encode_color(palette::css::TRANSPARENT);
            return;
        }
        match self.add_ramp(color_stops, alpha, extend) {
            RampStops::Empty => self.encode_color(palette::css::TRANSPARENT),
            RampStops::One(color) => self.encode_color(color),
            RampStops::Many => {
                self.draw_tags.push(DrawTag::SWEEP_GRADIENT);
                self.draw_data
                    .extend_from_slice(bytemuck::cast_slice(bytemuck::bytes_of(&gradient)));
            }
        }
    }

    /// Encodes an image brush.
    pub fn encode_image<'b>(&mut self, brush: impl Into<ImageBrushRef<'b>>, alpha: f32) {
        let brush: ImageBrushRef<'b> = brush.into();
        let ImageSampler {
            x_extend,
            y_extend,
            quality,
            alpha: global_alpha,
        } = brush.sampler;
        let alpha = (global_alpha * alpha * 255.0).round() as u8;
        // TODO: feed the alpha multiplier through the full pipeline for consistency
        // with other brushes?
        // Tracked in https://github.com/linebender/vello/issues/692
        self.resources.patches.push(Patch::Image {
            image: brush.image.clone(),
            draw_data_offset: self.draw_data.len(),
        });
        self.draw_tags.push(DrawTag::IMAGE);
        self.draw_data
            .extend_from_slice(bytemuck::cast_slice(bytemuck::bytes_of(&DrawImage {
                xy: 0,
                width_height: (brush.image.width << 16) | (brush.image.height & 0xFFFF),
                sample_alpha: ((brush.image.format as u32) << 15
                    | (brush.image.alpha_type as u32) << 14
                    | (quality as u32) << 12
                    | ((x_extend as u32) << 10)
                    | ((y_extend as u32) << 8)
                    | alpha as u32),
            })));
    }

    // Encodes a blurred rounded rectangle brush.
    pub fn encode_blurred_rounded_rect(
        &mut self,
        color: impl Into<DrawColor>,
        width: f32,
        height: f32,
        radius: f32,
        std_dev: f32,
    ) {
        self.draw_tags.push(DrawTag::BLUR_RECT);
        self.draw_data
            .extend_from_slice(bytemuck::cast_slice(bytemuck::bytes_of(
                &DrawBlurRoundedRect {
                    color: color.into(),
                    width,
                    height,
                    radius,
                    std_dev,
                },
            )));
    }

    /// Encodes a begin clip command.
    pub fn encode_begin_clip(&mut self, parameters: DrawBeginClip) {
        self.draw_tags.push(DrawTag::BEGIN_CLIP);
        self.draw_data
            .extend_from_slice(bytemuck::cast_slice(bytemuck::bytes_of(&parameters)));
        self.n_clips += 1;
        self.n_open_clips += 1;
    }

    /// Encodes an end clip command.
    pub fn encode_end_clip(&mut self) {
        if self.n_open_clips > 0 {
            self.draw_tags.push(DrawTag::END_CLIP);
            // This is a dummy path, and will go away with the new clip impl.
            self.path_tags.push(PathTag::PATH);
            self.n_paths += 1;
            self.n_clips += 1;
            self.n_open_clips -= 1;
        }
    }

    /// Forces the next transform and style to be encoded even if they match
    /// the current state.
    pub fn force_next_transform_and_style(&mut self) {
        self.flags |= Self::FORCE_NEXT_TRANSFORM | Self::FORCE_NEXT_STYLE;
    }

    // Swap the last two tags in the path tag stream; used for transformed
    // gradients.
    pub fn swap_last_path_tags(&mut self) {
        let len = self.path_tags.len();
        self.path_tags.swap(len - 1, len - 2);
    }

    fn add_ramp(
        &mut self,
        color_stops: impl Iterator<Item = ColorStop>,
        alpha: f32,
        extend: Extend,
    ) -> RampStops {
        let offset = self.draw_data.len();
        let stops_start = self.resources.color_stops.len();
        if alpha != 1.0 {
            self.resources
                .color_stops
                .extend(color_stops.map(|stop| stop.multiply_alpha(alpha)));
        } else {
            self.resources.color_stops.extend(color_stops);
        }
        let stops_end = self.resources.color_stops.len();
        match stops_end - stops_start {
            0 => RampStops::Empty,
            1 => RampStops::One(self.resources.color_stops.pop().unwrap().color),
            _ => {
                self.resources.patches.push(Patch::Ramp {
                    draw_data_offset: offset,
                    stops: stops_start..stops_end,
                    extend,
                });
                RampStops::Many
            }
        }
    }
}

/// Result for adding a sequence of color stops.
enum RampStops {
    /// Color stop sequence was empty.
    Empty,
    /// Contained a single color stop.
    One(DynamicColor),
    /// More than one color stop.
    Many,
}

/// Encoded data for late bound resources.
#[derive(Clone, Default)]
pub struct Resources {
    /// Draw data patches for late bound resources.
    pub patches: Vec<Patch>,
    /// Color stop collection for gradients.
    pub color_stops: Vec<ColorStop>,
    /// Positioned glyph buffer.
    pub glyphs: Vec<Glyph>,
    /// Sequences of glyphs.
    pub glyph_runs: Vec<GlyphRun>,
    /// Normalized coordinate buffer for variable fonts.
    pub normalized_coords: Vec<NormalizedCoord>,
}

impl Resources {
    #[doc(alias = "clear")]
    // This is not called "clear" because "clear" has other implications
    // in graphics contexts.
    fn reset(&mut self) {
        self.patches.clear();
        self.color_stops.clear();
        self.glyphs.clear();
        self.glyph_runs.clear();
        self.normalized_coords.clear();
    }
}

/// Snapshot of offsets for encoded streams.
#[derive(Copy, Clone, Default, Debug)]
pub struct StreamOffsets {
    /// Current length of path tag stream.
    pub path_tags: usize,
    /// Current length of path data stream.
    pub path_data: usize,
    /// Current length of draw tag stream.
    pub draw_tags: usize,
    /// Current length of draw data stream.
    pub draw_data: usize,
    /// Current length of transform stream.
    pub transforms: usize,
    /// Current length of style stream.
    pub styles: usize,
}

impl StreamOffsets {
    pub(crate) fn add(&mut self, other: &Self) {
        self.path_tags += other.path_tags;
        self.path_data += other.path_data;
        self.draw_tags += other.draw_tags;
        self.draw_data += other.draw_data;
        self.transforms += other.transforms;
        self.styles += other.styles;
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use peniko::kurbo::{Affine, Rect, Shape};
    use peniko::{Extend, Fill, ImageQuality};

    use crate::{Encoding, InstanceParams, Transform};

    #[test]
    fn ensure_image_quality_values() {
        assert_eq!(ImageQuality::Low as u32, 0);
        assert_eq!(ImageQuality::Medium as u32, 1);
        assert_eq!(ImageQuality::High as u32, 2);
        // exhaustive match to catch new variants
        match ImageQuality::Low {
            ImageQuality::Low | ImageQuality::Medium | ImageQuality::High => {}
        }
    }

    #[test]
    fn ensure_extend_values() {
        assert_eq!(Extend::Pad as u32, 0);
        assert_eq!(Extend::Repeat as u32, 1);
        assert_eq!(Extend::Reflect as u32, 2);
        // exhaustive match to catch new variants
        match Extend::Pad {
            Extend::Pad | Extend::Repeat | Extend::Reflect => {}
        }
    }

    fn baked_sub() -> Encoding {
        // Minimal valid sub-encoding: one transform, one style, one filled
        // rectangle. Matches the structure of a prebaked body strip well
        // enough for round-trip testing without pulling in vello's higher
        // layers.
        let mut enc = Encoding::new();
        enc.encode_transform(Transform::IDENTITY);
        enc.encode_fill_style(Fill::NonZero);
        let rect = Rect::new(0.0, 0.0, 10.0, 10.0);
        assert!(enc.encode_path_elements(rect.path_elements(0.1), true));
        enc.encode_color(crate::DrawColor { rgba: 0xFFFFFFFF });
        enc
    }

    #[test]
    fn append_instanced_marker_emit_records_block() {
        let sub = Arc::new(baked_sub());
        let affines = [
            Affine::translate((0.0, 0.0)),
            Affine::translate((100.0, 0.0)),
            Affine::translate((0.0, 100.0)),
        ];

        let mut tested = Encoding::new();
        let instances: Vec<InstanceParams> = affines
            .iter()
            .map(|a| InstanceParams {
                affine: *a,
                color_overlay: None,
                singleton_threshold_hint: false,
            })
            .collect();
        tested.append_instanced(Arc::clone(&sub), &instances);

        // Marker-emit: exactly one INSTANCED_BEGIN byte in path_tags, no
        // host-side inline expansion.
        assert_eq!(tested.path_tags.len(), 1);
        assert!(tested.path_tags[0] == crate::PathTag::INSTANCED_BEGIN);
        assert!(tested.path_data.is_empty());
        assert!(tested.draw_tags.is_empty());
        assert!(tested.draw_data.is_empty());
        assert!(tested.transforms.is_empty());
        assert!(tested.styles.is_empty());
        // Parallel arrays carry the per-instance data.
        assert_eq!(tested.instance_blocks.len(), 1);
        assert_eq!(tested.instance_blocks[0].count, affines.len() as u32);
        assert_eq!(tested.instance_blocks[0].transforms_base, 0);
        assert_eq!(tested.instance_blocks[0].overlays_base, u32::MAX);
        assert_eq!(tested.instance_blocks[0].splice_path_tags, 0);
        assert_eq!(tested.instance_blocks[0].splice_path_data, 0);
        assert_eq!(tested.instance_transforms.len(), affines.len());
        assert!(tested.instance_color_overlays.is_empty());
        // Phase 2: counters stay at host totals (zero here). The flat
        // expansion path adds per-instance contributions via `append`.
        assert_eq!(tested.n_paths, 0);
        assert_eq!(tested.n_path_segments, 0);
    }

    #[test]
    fn expand_instanced_to_flat_matches_n_appends_modulo_transforms() {
        let sub = Arc::new(baked_sub());
        let affines = [
            Affine::translate((0.0, 0.0)),
            Affine::translate((100.0, 0.0)),
            Affine::translate((0.0, 100.0)),
        ];

        let mut reference = Encoding::new();
        for a in &affines {
            reference.append(&sub, &Some(Transform::from_kurbo(a)));
        }

        let mut marker_form = Encoding::new();
        let instances: Vec<InstanceParams> = affines
            .iter()
            .map(|a| InstanceParams {
                affine: *a,
                color_overlay: None,
                singleton_threshold_hint: false,
            })
            .collect();
        marker_form.append_instanced(Arc::clone(&sub), &instances);

        let expanded = marker_form.expand_instanced_to_flat();
        let flat = expanded.as_ref();

        // Path/draw/style bytes match the inline-N-appends reference —
        // the shader-side instance transform redirect doesn't change
        // any geometry / color bytes.
        assert!(reference.path_tags == flat.path_tags);
        assert_eq!(reference.path_data, flat.path_data);
        assert!(reference.draw_tags == flat.draw_tags);
        assert_eq!(reference.draw_data, flat.draw_data);
        assert!(reference.styles == flat.styles);
        assert_eq!(reference.n_paths, flat.n_paths);
        assert_eq!(reference.n_path_segments, flat.n_path_segments);
        assert_eq!(reference.n_clips, flat.n_clips);
        // Transforms region differs: each appended Transform is the
        // NaN sentinel encoding (transforms_base + inst_i).
        assert_eq!(flat.transforms.len(), reference.transforms.len());
        for (i, t) in flat.transforms.iter().enumerate() {
            let c0_bits = t.matrix[0].to_bits();
            assert_eq!(
                c0_bits & 0x7F800000,
                0x7F800000,
                "transform {i}: matrix[0] not a NaN sentinel"
            );
            assert!(
                c0_bits & 0x007FFFFF != 0,
                "transform {i}: matrix[0] is infinity, not NaN"
            );
            let encoded_idx = t.matrix[1].to_bits();
            assert_eq!(
                encoded_idx, i as u32,
                "transform {i} sentinel index mismatch"
            );
        }
        // `instance_transforms` in the flat encoding stays empty because
        // expand collapses the parallel arrays (the originals live on
        // `marker_form`).
        assert!(flat.instance_blocks.is_empty());
        assert!(flat.instance_transforms.is_empty());
        assert!(flat.instance_color_overlays.is_empty());
    }

    #[test]
    fn sentinel_transform_encoding_round_trip() {
        // Mirror the shader-side NaN-sentinel check exactly so the
        // encoder's invariant is locked in:
        //   `matrix[0]` bits have exponent == 0xFF AND non-zero mantissa
        //   `matrix[1]` bits == global instance index
        let sub = Arc::new(baked_sub());
        let mut marker = Encoding::new();
        // Build two consecutive blocks to test that global indices are
        // distinct across blocks (different transforms_base offsets).
        marker.append_instanced(
            Arc::clone(&sub),
            &[
                InstanceParams {
                    affine: Affine::translate((1.0, 0.0)),
                    color_overlay: None,
                    singleton_threshold_hint: false,
                },
                InstanceParams {
                    affine: Affine::translate((2.0, 0.0)),
                    color_overlay: None,
                    singleton_threshold_hint: false,
                },
            ],
        );
        marker.append_instanced(
            Arc::clone(&sub),
            &[
                InstanceParams {
                    affine: Affine::translate((10.0, 0.0)),
                    color_overlay: None,
                    singleton_threshold_hint: false,
                },
                InstanceParams {
                    affine: Affine::translate((20.0, 0.0)),
                    color_overlay: None,
                    singleton_threshold_hint: false,
                },
                InstanceParams {
                    affine: Affine::translate((30.0, 0.0)),
                    color_overlay: None,
                    singleton_threshold_hint: false,
                },
            ],
        );

        // 5 total instances across 2 blocks → 5 sentinel slots in the
        // flat transforms region, with global indices 0..5 (single
        // transforms_base counter across blocks).
        let expanded = marker.expand_instanced_to_flat();
        let flat = expanded.as_ref();
        assert_eq!(flat.transforms.len(), 5);
        for (expected_idx, t) in flat.transforms.iter().enumerate() {
            let c0_bits = t.matrix[0].to_bits();
            // Shader NaN check: exponent all-ones AND mantissa non-zero.
            assert_eq!(c0_bits & 0x7F800000, 0x7F800000);
            assert_ne!(c0_bits & 0x007FFFFF, 0);
            // Index decoded from matrix[1] matches the unique global slot.
            assert_eq!(t.matrix[1].to_bits(), expected_idx as u32);
        }

        // The `instance_transforms` array on the marker form carries the
        // real affines that the GPU dereferences via the sentinel idx.
        assert_eq!(marker.instance_transforms.len(), 5);
        assert_eq!(marker.instance_transforms[0].translation, [1.0, 0.0]);
        assert_eq!(marker.instance_transforms[4].translation, [30.0, 0.0]);
    }

    #[test]
    fn expand_instanced_no_op_when_no_blocks() {
        let mut enc = Encoding::new();
        enc.encode_transform(Transform::IDENTITY);
        enc.encode_fill_style(Fill::NonZero);
        let rect = Rect::new(0.0, 0.0, 5.0, 5.0);
        let _ = enc.encode_path_elements(rect.path_elements(0.1), true);
        enc.encode_color(crate::DrawColor { rgba: 0x12345678 });

        let expanded = enc.expand_instanced_to_flat();
        // Fast path returns Cow::Borrowed.
        assert!(matches!(expanded, std::borrow::Cow::Borrowed(_)));
    }

    #[test]
    fn expand_instanced_color_overlay_patches_draw_data() {
        // Build a sub with 3 distinct COLOR draw_tags so all 3 overlay
        // zones get exercised.
        let mut sub_enc = Encoding::new();
        sub_enc.encode_transform(Transform::IDENTITY);
        sub_enc.encode_fill_style(Fill::NonZero);
        let r = Rect::new(0.0, 0.0, 1.0, 1.0);
        let _ = sub_enc.encode_path_elements(r.path_elements(0.1), true);
        sub_enc.encode_color(crate::DrawColor { rgba: 0x11111111 });
        let _ = sub_enc.encode_path_elements(r.path_elements(0.1), true);
        sub_enc.encode_color(crate::DrawColor { rgba: 0x22222222 });
        let _ = sub_enc.encode_path_elements(r.path_elements(0.1), true);
        sub_enc.encode_color(crate::DrawColor { rgba: 0x33333333 });
        let sub = Arc::new(sub_enc);

        let overlay_inst0 = [
            [0xAA, 0xBB, 0xCC, 0xDD], // zone 0 → 0xDDCCBBAA
            [0x11, 0x22, 0x33, 0x44], // zone 1 → 0x44332211
            [0x55, 0x66, 0x77, 0x88], // zone 2 → 0x88776655
        ];

        let mut marker = Encoding::new();
        marker.append_instanced(
            Arc::clone(&sub),
            &[
                InstanceParams {
                    affine: Affine::IDENTITY,
                    color_overlay: Some(overlay_inst0),
                    singleton_threshold_hint: false,
                },
                InstanceParams {
                    affine: Affine::translate((10.0, 0.0)),
                    color_overlay: None, // sentinel-only: no patching
                    singleton_threshold_hint: false,
                },
            ],
        );

        let expanded = marker.expand_instanced_to_flat();
        let flat = expanded.as_ref();

        // Find the 6 COLOR draw_data slots (3 per instance, 2 instances).
        let mut colors: Vec<u32> = Vec::new();
        let mut off = 0usize;
        for tag in &flat.draw_tags {
            let scene_words = ((tag.0 >> 2) & 0x07) as usize;
            if *tag == crate::DrawTag::COLOR {
                colors.push(flat.draw_data[off]);
            }
            off += scene_words;
        }
        assert_eq!(colors.len(), 6);
        // Instance 0: sentinel encoding for shader-side lookup.
        // overlays_base = 0 in this single-block test → global_idx = 0,
        // and per-zone high byte = 0xFA + zone.
        assert_eq!(colors[0], 0xFA000000);
        assert_eq!(colors[1], 0xFB000000);
        assert_eq!(colors[2], 0xFC000000);
        // Instance 1 opted out of overlay (color_overlay: None) — its
        // draw_data slots keep the sub's literal colors.
        assert_eq!(colors[3], 0x11111111);
        assert_eq!(colors[4], 0x22222222);
        assert_eq!(colors[5], 0x33333333);
    }

    #[test]
    fn expand_instanced_handles_interleaved_host_and_marker() {
        // Reference: tile, sub × 2, tile, sub × 1 inline.
        let sub = Arc::new(baked_sub());
        let tile1 = {
            let mut e = Encoding::new();
            e.encode_transform(Transform::IDENTITY);
            e.encode_fill_style(Fill::NonZero);
            let r = Rect::new(0.0, 0.0, 1.0, 1.0);
            let _ = e.encode_path_elements(r.path_elements(0.1), true);
            e.encode_color(crate::DrawColor { rgba: 0xAA000011 });
            e
        };
        let tile2 = {
            let mut e = Encoding::new();
            e.encode_transform(Transform::IDENTITY);
            e.encode_fill_style(Fill::NonZero);
            let r = Rect::new(0.0, 0.0, 2.0, 2.0);
            let _ = e.encode_path_elements(r.path_elements(0.1), true);
            e.encode_color(crate::DrawColor { rgba: 0xBB000022 });
            e
        };
        let a1 = Affine::translate((10.0, 0.0));
        let a2 = Affine::translate((20.0, 0.0));
        let a3 = Affine::translate((30.0, 0.0));

        let mut reference = Encoding::new();
        reference.append(&tile1, &None);
        reference.append(&sub, &Some(Transform::from_kurbo(&a1)));
        reference.append(&sub, &Some(Transform::from_kurbo(&a2)));
        reference.append(&tile2, &None);
        reference.append(&sub, &Some(Transform::from_kurbo(&a3)));

        let mut marker = Encoding::new();
        marker.append(&tile1, &None);
        marker.append_instanced(
            Arc::clone(&sub),
            &[
                InstanceParams {
                    affine: a1,
                    color_overlay: None,
                    singleton_threshold_hint: false,
                },
                InstanceParams {
                    affine: a2,
                    color_overlay: None,
                    singleton_threshold_hint: false,
                },
            ],
        );
        marker.append(&tile2, &None);
        marker.append_instanced(
            Arc::clone(&sub),
            &[InstanceParams {
                affine: a3,
                color_overlay: None,
                singleton_threshold_hint: false,
            }],
        );

        let expanded = marker.expand_instanced_to_flat();
        let flat = expanded.as_ref();

        // Path/draw/style streams match the inline-append reference.
        // Transforms region differs: instanced copies use the NaN
        // sentinel layout (matrix[0] = NaN, matrix[1] = global instance
        // index) while host-side copies pass through unchanged.
        assert!(reference.path_tags == flat.path_tags);
        assert_eq!(reference.path_data, flat.path_data);
        assert!(reference.draw_tags == flat.draw_tags);
        assert_eq!(reference.draw_data, flat.draw_data);
        assert!(reference.styles == flat.styles);
        assert_eq!(reference.n_paths, flat.n_paths);
        assert_eq!(reference.transforms.len(), flat.transforms.len());
    }

    #[test]
    fn append_instanced_singleton_hint_collapses_to_append() {
        let sub = Arc::new(baked_sub());
        let a = Affine::translate((42.0, 7.0));

        let mut reference = Encoding::new();
        reference.append(&sub, &Some(Transform::from_kurbo(&a)));

        let mut tested = Encoding::new();
        tested.append_instanced(
            Arc::clone(&sub),
            &[InstanceParams {
                affine: a,
                color_overlay: None,
                singleton_threshold_hint: true,
            }],
        );

        assert!(reference.path_tags == tested.path_tags);
        assert_eq!(reference.transforms, tested.transforms);
        assert!(reference.styles == tested.styles);
        assert!(tested.instance_blocks.is_empty());
    }

    #[test]
    fn reset_clears_instance_arrays() {
        let mut enc = Encoding::new();
        enc.instance_blocks.push(super::InstanceBlock {
            sub: Arc::new(Encoding::new()),
            count: 0,
            transforms_base: 0,
            overlays_base: u32::MAX,
            splice_path_tags: 0,
            splice_path_data: 0,
            splice_draw_tags: 0,
            splice_draw_data: 0,
            splice_transforms: 0,
            splice_styles: 0,
        });
        enc.instance_transforms.push(Transform::IDENTITY);
        enc.instance_color_overlays.push(0);
        enc.reset();
        assert!(enc.instance_blocks.is_empty());
        assert!(enc.instance_transforms.is_empty());
        assert!(enc.instance_color_overlays.is_empty());
    }
}
