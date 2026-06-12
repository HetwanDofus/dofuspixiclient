//! Binary serialization for any twip-identity sub-scene cache.
//!
//! Three resolution-independent sub-scene caches share this wire
//! format:
//!   - **Body** — character sub-scenes per `(bundle, export,
//!     apply_b_fix, hat_equipped, mode, frame, band)`. Composes
//!     full-character scenes when scaled and translated to the
//!     per-cell origin.
//!   - **Tile** — world-map / battlefield tile sub-scenes per
//!     `(bundle, export, frame)`. Composes the tile background when
//!     scaled to the per-cell origin.
//!   - **Accessory** — accessory sub-scenes per `(bundle, export,
//!     slot, anim_type, side, cycle)`. Composes the 3-cycle strip
//!     when scaled and translated to each cycle's column.
//!
//! All three caches store `vello::Scene` values at **twip identity**
//! (no scale baked in) — every entry is reusable across every render
//! resolution. The runtime applies `Affine::scale(...)` at composition
//! time via `scene.append(sub, Some(xform))`, so the only per-frame
//! cost on a cache hit is the cheap GPU rasterization step (no AS2
//! walking, no scene build).
//!
//! Wire format `VSC2` (little-endian throughout):
//! ```text
//!  [magic: "VSC2"]          4 B
//!  [format_version: u16]    2 B    — bump on any incompatible change
//!  [cache_id: u8]           1 B    — 0 = Body, 1 = Tile, 2 = Accessory
//!  [reserved: u8]           1 B
//!  [entry_count: u32]       4 B
//!  For each entry:
//!    Key bytes (cache_id-specific; see `write_key_*` functions)
//!    Value:
//!      [scene_len: u32]     4 B
//!      [scene_bytes]        N B  (see `encode_scene`)
//! ```
//!
//! The `cache_id` lets the JS-side IDB layer co-locate all sub-scene
//! blobs in one object store and dispatch the right decoder at load
//! time — versus carrying three parallel paths for "did this row come
//! from body, tile, or accessory cache?".
//!
//! Scene byte layout: see `encode_scene` / `decode_scene` — all
//! primitive Pod vectors are bytemuck-cast for direct slicing; only
//! `Resources` (color stops + patches) and primitive scalars need
//! explicit framing.
//!
//! Unsupported variants that we DO NOT expect in any SWF bake:
//!   - `GlyphRun` patches / glyph buffer entries — there's no text
//!     in character / tile / accessory animations. Asserted empty on
//!     serialize; error on deserialize if non-zero count appears.
//!   - `Image` patches — tile backgrounds DO contain raster bitmap
//!     fills (`DefineBitsLossless`-backed shape fills). These appear
//!     as `Patch::Image` in the encoded scene and we deliberately do
//!     NOT serialize them — the image bytes live inside the SWF
//!     bundle and the encoded reference is unstable across runs. The
//!     practical effect: tile sub-scenes that contain image fills
//!     SKIP the persistent cache and fall back to fresh bakes (still
//!     resolution-independent in-memory). The serialize call returns
//!     `UnsupportedPatchVariant("Image")` for those entries; the
//!     caller skips them and persists only the pure-vector tiles.
//!   - `NormalizedCoord` (variable-font axes) — text-only.

use vello::peniko::color::{DynamicColor, Flags as ColorFlags};
use vello::peniko::{ColorStop, Extend, color::ColorSpaceTag};
use vello_encoding::{DrawTag, Encoding, Patch, PathTag, Resources, Style, Transform};

const MAGIC: &[u8; 4] = b"VSC2";
const FORMAT_VERSION: u16 = 1;

/// Cache type discriminator. Stable u8 values: rows persisted under
/// one variant must not decode as another even if we re-order this
/// enum. Add new variants at the end with fresh numbers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum CacheId {
    Body = 0,
    Tile = 1,
    Accessory = 2,
    /// Composed per-variant body atlas scenes (`body_scene_cache`) —
    /// the cache the per-variant SPAWN path (`render_swf_body_atlas`)
    /// actually reads. Distinct from `Body` (the per-frame/band
    /// `body_subscene_cache`, which the spawn path does NOT read).
    ComposedBody = 3,
}

impl CacheId {
    fn from_u8(b: u8) -> Option<Self> {
        match b {
            0 => Some(Self::Body),
            1 => Some(Self::Tile),
            2 => Some(Self::Accessory),
            3 => Some(Self::ComposedBody),
            _ => None,
        }
    }
}

/// Body sub-scene key — mirror of the Rust-side `BodySubsceneKey`
/// (which is private to `lib.rs`). Accepted at the cache API
/// boundary as a transparent struct so `lib.rs` can map its private
/// key in/out without exposing it.
#[derive(Clone, Debug)]
pub struct BodySubsceneKey {
    pub bundle: String,
    pub export: String,
    pub apply_b_fix: bool,
    pub hat_equipped: bool,
    pub mode: u8,
    pub frame_idx: u16,
    pub band_lo: Option<u16>,
    pub band_hi: Option<u16>,
}

/// Tile sub-scene key — flat triple matching `tile_subscenes`'s
/// `(String, String, u32)` shape. `Hash + Eq` so it can serve as an
/// in-memory HashMap key without a parallel internal type.
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct TileSubsceneKey {
    pub bundle: String,
    pub export: String,
    pub frame: u32,
}

/// Accessory sub-scene key — drives the per-cycle xform composition
/// in `render_swf_accessory_strip`. `side` is the canonical
/// `applyAccessory` side string ("R"/"L"/"F"/"B"/"S"); `cycle` ∈
/// {0,1,2} indexes into the 3-frame strip.
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct AccessorySubsceneKey {
    pub bundle: String,
    pub export: String,
    pub slot: u8,
    pub anim_type: u8,
    pub side: String,
    pub cycle: u8,
}

/// Composed per-variant body atlas key — mirror of `lib.rs`'s private
/// `BodySceneCacheKey`. This is the cache the SPAWN path reads
/// (`render_swf_body_atlas` → `body_scene_cache`); persisting it (vs.
/// the per-frame `BodySubsceneKey`) is what actually warms a cold
/// 250-actor map entry. `scale_q` is part of the key — these scenes
/// have `scale` baked into every cell xform, so persistence is
/// per-resolution.
#[derive(Clone, Debug)]
pub struct ComposedBodyKey {
    pub bundle: String,
    pub export: String,
    pub start: u32,
    pub count: u32,
    pub scale_q: u32,
    pub apply_b_fix: bool,
    pub hat_equipped: bool,
    pub mode: u8,
}

// Backwards-compat alias for the existing call site in `lib.rs`
// (`scene_cache::SubsceneKey`). Will be removed once that file's
// callers migrate to `BodySubsceneKey`.
pub use BodySubsceneKey as SubsceneKey;

#[derive(Debug)]
pub enum SceneCacheError {
    BadMagic,
    UnsupportedVersion(u16),
    UnknownCacheId(u8),
    CacheIdMismatch { expected: u8, found: u8 },
    Truncated(&'static str),
    UnsupportedPatchVariant(&'static str),
    GlyphsPresent,
    UnknownColorSpaceTag(u8),
}

impl std::fmt::Display for SceneCacheError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadMagic => write!(f, "scene cache: magic mismatch (not VSC2)"),
            Self::UnsupportedVersion(v) => write!(f, "scene cache: unsupported version {v}"),
            Self::UnknownCacheId(b) => write!(f, "scene cache: unknown cache id {b}"),
            Self::CacheIdMismatch { expected, found } => write!(
                f,
                "scene cache: cache id mismatch (expected {expected}, found {found})"
            ),
            Self::Truncated(field) => write!(f, "scene cache: truncated at field '{field}'"),
            Self::UnsupportedPatchVariant(v) => {
                write!(f, "scene cache: unsupported patch variant '{v}'")
            }
            Self::GlyphsPresent => {
                write!(f, "scene cache: glyphs/glyph_runs present (unsupported)")
            }
            Self::UnknownColorSpaceTag(t) => {
                write!(f, "scene cache: unknown ColorSpaceTag discriminant {t}")
            }
        }
    }
}

impl std::error::Error for SceneCacheError {}

// ── byte writers ──────────────────────────────────────────────────────

struct Writer {
    buf: Vec<u8>,
}

impl Writer {
    fn with_capacity(n: usize) -> Self {
        Self {
            buf: Vec::with_capacity(n),
        }
    }
    fn finish(self) -> Vec<u8> {
        self.buf
    }
    fn write_u8(&mut self, v: u8) {
        self.buf.push(v);
    }
    fn write_u16(&mut self, v: u16) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }
    fn write_u32(&mut self, v: u32) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }
    fn write_f32(&mut self, v: f32) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }
    fn write_bytes(&mut self, b: &[u8]) {
        self.buf.extend_from_slice(b);
    }
    fn write_str(&mut self, s: &str) {
        let b = s.as_bytes();
        self.write_u32(b.len() as u32);
        self.write_bytes(b);
    }
    fn write_opt_u16(&mut self, v: Option<u16>) {
        match v {
            Some(x) => {
                self.write_u8(1);
                self.write_u16(x);
            }
            None => {
                self.write_u8(0);
                self.write_u16(0);
            }
        }
    }
    fn reserve_u32(&mut self) -> usize {
        let off = self.buf.len();
        self.buf.extend_from_slice(&[0u8; 4]);
        off
    }
    fn patch_u32(&mut self, off: usize, value: u32) {
        self.buf[off..off + 4].copy_from_slice(&value.to_le_bytes());
    }
}

// ── byte reader ──────────────────────────────────────────────────────

struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, pos: 0 }
    }
    fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.pos)
    }
    fn read_n(&mut self, n: usize, field: &'static str) -> Result<&'a [u8], SceneCacheError> {
        if self.remaining() < n {
            return Err(SceneCacheError::Truncated(field));
        }
        let out = &self.bytes[self.pos..self.pos + n];
        self.pos += n;
        Ok(out)
    }
    fn read_u8(&mut self, field: &'static str) -> Result<u8, SceneCacheError> {
        Ok(self.read_n(1, field)?[0])
    }
    fn read_u16(&mut self, field: &'static str) -> Result<u16, SceneCacheError> {
        let b = self.read_n(2, field)?;
        Ok(u16::from_le_bytes([b[0], b[1]]))
    }
    fn read_u32(&mut self, field: &'static str) -> Result<u32, SceneCacheError> {
        let b = self.read_n(4, field)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }
    fn read_f32(&mut self, field: &'static str) -> Result<f32, SceneCacheError> {
        let b = self.read_n(4, field)?;
        Ok(f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }
    fn read_string(&mut self, field: &'static str) -> Result<String, SceneCacheError> {
        let n = self.read_u32(field)? as usize;
        let b = self.read_n(n, field)?;
        Ok(String::from_utf8_lossy(b).into_owned())
    }
    fn read_opt_u16(&mut self, field: &'static str) -> Result<Option<u16>, SceneCacheError> {
        let present = self.read_u8(field)?;
        let value = self.read_u16(field)?;
        Ok(if present == 0 { None } else { Some(value) })
    }
}

// ── DynamicColor / ColorStop ──────────────────────────────────────────

fn write_dynamic_color(w: &mut Writer, c: &DynamicColor) {
    w.write_u8(c.cs as u8);
    for v in c.components {
        w.write_f32(v);
    }
}

fn read_dynamic_color(r: &mut Reader) -> Result<DynamicColor, SceneCacheError> {
    let tag = r.read_u8("dyncolor.cs")?;
    let cs = color_space_tag_from_u8(tag)?;
    let mut components = [0.0_f32; 4];
    for slot in &mut components {
        *slot = r.read_f32("dyncolor.component")?;
    }
    Ok(DynamicColor {
        cs,
        flags: ColorFlags::default(),
        components,
    })
}

fn color_space_tag_from_u8(t: u8) -> Result<ColorSpaceTag, SceneCacheError> {
    Ok(match t {
        0 => ColorSpaceTag::Srgb,
        1 => ColorSpaceTag::LinearSrgb,
        2 => ColorSpaceTag::Lab,
        3 => ColorSpaceTag::Lch,
        4 => ColorSpaceTag::Hsl,
        5 => ColorSpaceTag::Hwb,
        6 => ColorSpaceTag::Oklab,
        7 => ColorSpaceTag::Oklch,
        8 => ColorSpaceTag::DisplayP3,
        9 => ColorSpaceTag::A98Rgb,
        10 => ColorSpaceTag::ProphotoRgb,
        11 => ColorSpaceTag::Rec2020,
        12 => ColorSpaceTag::AcesCg,
        13 => ColorSpaceTag::XyzD50,
        14 => ColorSpaceTag::XyzD65,
        15 => ColorSpaceTag::Aces2065_1,
        x => return Err(SceneCacheError::UnknownColorSpaceTag(x)),
    })
}

fn write_extend(w: &mut Writer, e: Extend) {
    let b = match e {
        Extend::Pad => 0u8,
        Extend::Repeat => 1,
        Extend::Reflect => 2,
    };
    w.write_u8(b);
}

fn read_extend(r: &mut Reader) -> Result<Extend, SceneCacheError> {
    Ok(match r.read_u8("extend")? {
        0 => Extend::Pad,
        1 => Extend::Repeat,
        2 => Extend::Reflect,
        _ => Extend::Pad,
    })
}

fn write_color_stop(w: &mut Writer, cs: &ColorStop) {
    w.write_f32(cs.offset);
    write_dynamic_color(w, &cs.color);
}

fn read_color_stop(r: &mut Reader) -> Result<ColorStop, SceneCacheError> {
    let offset = r.read_f32("colorstop.offset")?;
    let color = read_dynamic_color(r)?;
    Ok(ColorStop { offset, color })
}

// ── Patch ─────────────────────────────────────────────────────────────

fn write_patch(w: &mut Writer, p: &Patch) -> Result<(), SceneCacheError> {
    match p {
        Patch::Ramp {
            draw_data_offset,
            stops,
            extend,
        } => {
            w.write_u8(0);
            w.write_u32(*draw_data_offset as u32);
            w.write_u32(stops.start as u32);
            w.write_u32(stops.end as u32);
            write_extend(w, *extend);
            Ok(())
        }
        Patch::GlyphRun { .. } => Err(SceneCacheError::UnsupportedPatchVariant("GlyphRun")),
        Patch::Image { .. } => Err(SceneCacheError::UnsupportedPatchVariant("Image")),
    }
}

fn read_patch(r: &mut Reader) -> Result<Patch, SceneCacheError> {
    let tag = r.read_u8("patch.tag")?;
    match tag {
        0 => {
            let draw_data_offset = r.read_u32("patch.ramp.offset")? as usize;
            let lo = r.read_u32("patch.ramp.stops.start")? as usize;
            let hi = r.read_u32("patch.ramp.stops.end")? as usize;
            let extend = read_extend(r)?;
            Ok(Patch::Ramp {
                draw_data_offset,
                stops: lo..hi,
                extend,
            })
        }
        1 => Err(SceneCacheError::UnsupportedPatchVariant("GlyphRun")),
        2 => Err(SceneCacheError::UnsupportedPatchVariant("Image")),
        _ => Err(SceneCacheError::UnsupportedPatchVariant("Unknown")),
    }
}

// ── Scene encoding (shared by every cache type) ───────────────────────

fn encode_scene(w: &mut Writer, scene: &vello::Scene) -> Result<(), SceneCacheError> {
    let enc: &Encoding = scene.encoding();
    w.write_u32(enc.n_paths);
    w.write_u32(enc.n_path_segments);
    w.write_u32(enc.n_clips);
    w.write_u32(enc.n_open_clips);
    w.write_u32(enc.flags);

    let path_tag_bytes: &[u8] = bytemuck::cast_slice::<PathTag, u8>(enc.path_tags.as_slice());
    w.write_u32(path_tag_bytes.len() as u32);
    w.write_bytes(path_tag_bytes);

    let path_data_bytes: &[u8] = bytemuck::cast_slice::<u32, u8>(enc.path_data.as_slice());
    w.write_u32(path_data_bytes.len() as u32);
    w.write_bytes(path_data_bytes);

    let draw_tag_bytes: &[u8] = bytemuck::cast_slice::<DrawTag, u8>(enc.draw_tags.as_slice());
    w.write_u32(draw_tag_bytes.len() as u32);
    w.write_bytes(draw_tag_bytes);

    let draw_data_bytes: &[u8] = bytemuck::cast_slice::<u32, u8>(enc.draw_data.as_slice());
    w.write_u32(draw_data_bytes.len() as u32);
    w.write_bytes(draw_data_bytes);

    let tr_bytes: &[u8] = bytemuck::cast_slice::<Transform, u8>(enc.transforms.as_slice());
    w.write_u32(tr_bytes.len() as u32);
    w.write_bytes(tr_bytes);

    let style_bytes: &[u8] = bytemuck::cast_slice::<Style, u8>(enc.styles.as_slice());
    w.write_u32(style_bytes.len() as u32);
    w.write_bytes(style_bytes);

    let res: &Resources = &enc.resources;
    w.write_u32(res.color_stops.len() as u32);
    for cs in &res.color_stops {
        write_color_stop(w, cs);
    }
    w.write_u32(res.patches.len() as u32);
    for p in &res.patches {
        write_patch(w, p)?;
    }
    if !res.glyphs.is_empty() || !res.glyph_runs.is_empty() || !res.normalized_coords.is_empty() {
        return Err(SceneCacheError::GlyphsPresent);
    }
    w.write_u32(0);
    w.write_u32(0);
    w.write_u32(0);

    Ok(())
}

/// Cast a raw byte slice into a `Vec<T>` without alignment
/// requirements on the source. `bytemuck::cast_slice::<u8, T>` panics
/// when the source pointer isn't aligned to `align_of::<T>()`, which
/// is exactly what happens with the VSC wire format: the byte
/// payloads sit at arbitrary offsets inside the Vec<u8> blob (after
/// variable-length key strings), so `&blob[offset..end]` has
/// only-u8 (= 1) alignment. The Vello encoding then tries to
/// reinterpret those bytes as `[u32]` / `[Transform]` / `[Style]`,
/// boom: `cast_slice>TargetAlignmentGreaterAndInputNotAligned`.
///
/// We sidestep alignment by allocating an aligned `Vec<T>` of the
/// right capacity (the `Vec` allocator always returns a pointer
/// aligned to `align_of::<T>()`) and then `memcpy`ing the unaligned
/// bytes into it. `T: bytemuck::Pod` guarantees every bit pattern is
/// valid for `T`, so the copy is sound regardless of how the bytes
/// were originally laid out.
fn unaligned_cast<T: bytemuck::Pod>(bytes: &[u8]) -> Result<Vec<T>, SceneCacheError> {
    let elem_size = std::mem::size_of::<T>();
    if elem_size == 0 {
        // ZSTs would loop forever in capacity math; reject defensively.
        return Err(SceneCacheError::Truncated(
            "unaligned_cast: ZST not supported",
        ));
    }
    if bytes.len() % elem_size != 0 {
        return Err(SceneCacheError::Truncated(
            "unaligned_cast: byte length not a multiple of element size",
        ));
    }
    let count = bytes.len() / elem_size;
    let mut out: Vec<T> = Vec::with_capacity(count);
    // SAFETY:
    //   - `Vec::with_capacity(count)` returns a buffer of exactly
    //     `count × elem_size` bytes, pointer aligned to `align_of::<T>()`.
    //   - `set_len(count)` claims the bytes as initialised; this is safe
    //     once we fill them via `copy_from_slice` immediately below.
    //   - The mutable byte view we build over the buffer is non-aliasing
    //     (we just allocated it) and has the exact length we'll copy.
    //   - `T: Pod` means any bit pattern is valid for `T`, so the bytes
    //     can be interpreted as `T` values without further validation.
    unsafe {
        out.set_len(count);
        let dst: &mut [u8] =
            std::slice::from_raw_parts_mut(out.as_mut_ptr().cast::<u8>(), bytes.len());
        dst.copy_from_slice(bytes);
    }
    Ok(out)
}

fn decode_scene(r: &mut Reader) -> Result<vello::Scene, SceneCacheError> {
    let n_paths = r.read_u32("enc.n_paths")?;
    let n_path_segments = r.read_u32("enc.n_path_segments")?;
    let n_clips = r.read_u32("enc.n_clips")?;
    let n_open_clips = r.read_u32("enc.n_open_clips")?;
    let flags = r.read_u32("enc.flags")?;

    let path_tag_len = r.read_u32("enc.path_tags.len")? as usize;
    let path_tag_bytes = r.read_n(path_tag_len, "enc.path_tags")?;
    let path_tags: Vec<PathTag> = unaligned_cast(path_tag_bytes)?;

    let path_data_len = r.read_u32("enc.path_data.len")? as usize;
    let path_data_bytes = r.read_n(path_data_len, "enc.path_data")?;
    let path_data: Vec<u32> = unaligned_cast(path_data_bytes)?;

    let draw_tag_len = r.read_u32("enc.draw_tags.len")? as usize;
    let draw_tag_bytes = r.read_n(draw_tag_len, "enc.draw_tags")?;
    let draw_tags: Vec<DrawTag> = unaligned_cast(draw_tag_bytes)?;

    let draw_data_len = r.read_u32("enc.draw_data.len")? as usize;
    let draw_data_bytes = r.read_n(draw_data_len, "enc.draw_data")?;
    let draw_data: Vec<u32> = unaligned_cast(draw_data_bytes)?;

    let tr_len = r.read_u32("enc.transforms.len")? as usize;
    let tr_bytes = r.read_n(tr_len, "enc.transforms")?;
    let transforms: Vec<Transform> = unaligned_cast(tr_bytes)?;

    let style_len = r.read_u32("enc.styles.len")? as usize;
    let style_bytes = r.read_n(style_len, "enc.styles")?;
    let styles: Vec<Style> = unaligned_cast(style_bytes)?;

    let color_stop_count = r.read_u32("enc.color_stops.len")? as usize;
    let mut color_stops = Vec::with_capacity(color_stop_count);
    for _ in 0..color_stop_count {
        color_stops.push(read_color_stop(r)?);
    }

    let patch_count = r.read_u32("enc.patches.len")? as usize;
    let mut patches = Vec::with_capacity(patch_count);
    for _ in 0..patch_count {
        patches.push(read_patch(r)?);
    }

    let glyph_count = r.read_u32("enc.glyphs.len")?;
    let glyph_run_count = r.read_u32("enc.glyph_runs.len")?;
    let normalized_count = r.read_u32("enc.normalized_coords.len")?;
    if glyph_count != 0 || glyph_run_count != 0 || normalized_count != 0 {
        return Err(SceneCacheError::GlyphsPresent);
    }

    let mut scene = vello::Scene::new();
    {
        let enc = scene.encoding_mut();
        enc.n_paths = n_paths;
        enc.n_path_segments = n_path_segments;
        enc.n_clips = n_clips;
        enc.n_open_clips = n_open_clips;
        enc.flags = flags;
        enc.path_tags = path_tags;
        enc.path_data = path_data;
        enc.draw_tags = draw_tags;
        enc.draw_data = draw_data;
        enc.transforms = transforms;
        enc.styles = styles;
        enc.resources.color_stops = color_stops;
        enc.resources.patches = patches;
    }
    Ok(scene)
}

// ── Per-cache key encoders ────────────────────────────────────────────

fn write_body_key(w: &mut Writer, key: &BodySubsceneKey) {
    w.write_str(&key.bundle);
    w.write_str(&key.export);
    w.write_u8(if key.apply_b_fix { 1 } else { 0 });
    w.write_u8(if key.hat_equipped { 1 } else { 0 });
    w.write_u8(key.mode);
    w.write_u16(key.frame_idx);
    w.write_opt_u16(key.band_lo);
    w.write_opt_u16(key.band_hi);
}

fn read_body_key(r: &mut Reader) -> Result<BodySubsceneKey, SceneCacheError> {
    Ok(BodySubsceneKey {
        bundle: r.read_string("body.bundle")?,
        export: r.read_string("body.export")?,
        apply_b_fix: r.read_u8("body.apply_b_fix")? != 0,
        hat_equipped: r.read_u8("body.hat_equipped")? != 0,
        mode: r.read_u8("body.mode")?,
        frame_idx: r.read_u16("body.frame_idx")?,
        band_lo: r.read_opt_u16("body.band_lo")?,
        band_hi: r.read_opt_u16("body.band_hi")?,
    })
}

fn write_tile_key(w: &mut Writer, key: &TileSubsceneKey) {
    w.write_str(&key.bundle);
    w.write_str(&key.export);
    w.write_u32(key.frame);
}

fn read_tile_key(r: &mut Reader) -> Result<TileSubsceneKey, SceneCacheError> {
    Ok(TileSubsceneKey {
        bundle: r.read_string("tile.bundle")?,
        export: r.read_string("tile.export")?,
        frame: r.read_u32("tile.frame")?,
    })
}

fn write_accessory_key(w: &mut Writer, key: &AccessorySubsceneKey) {
    w.write_str(&key.bundle);
    w.write_str(&key.export);
    w.write_u8(key.slot);
    w.write_u8(key.anim_type);
    w.write_str(&key.side);
    w.write_u8(key.cycle);
}

fn read_accessory_key(r: &mut Reader) -> Result<AccessorySubsceneKey, SceneCacheError> {
    Ok(AccessorySubsceneKey {
        bundle: r.read_string("acc.bundle")?,
        export: r.read_string("acc.export")?,
        slot: r.read_u8("acc.slot")?,
        anim_type: r.read_u8("acc.anim_type")?,
        side: r.read_string("acc.side")?,
        cycle: r.read_u8("acc.cycle")?,
    })
}

// ── Header helpers ────────────────────────────────────────────────────

fn write_header(w: &mut Writer, cache_id: CacheId) -> usize {
    w.write_bytes(MAGIC);
    w.write_u16(FORMAT_VERSION);
    w.write_u8(cache_id as u8);
    w.write_u8(0); // reserved
    w.reserve_u32() // entry_count slot, returned for patching
}

fn read_header(r: &mut Reader, expected: CacheId) -> Result<u32, SceneCacheError> {
    let magic = r.read_n(4, "magic")?;
    if magic != MAGIC {
        return Err(SceneCacheError::BadMagic);
    }
    let version = r.read_u16("version")?;
    if version != FORMAT_VERSION {
        return Err(SceneCacheError::UnsupportedVersion(version));
    }
    let cache_byte = r.read_u8("cache_id")?;
    let _reserved = r.read_u8("reserved")?;
    let cache_id =
        CacheId::from_u8(cache_byte).ok_or(SceneCacheError::UnknownCacheId(cache_byte))?;
    if cache_id != expected {
        return Err(SceneCacheError::CacheIdMismatch {
            expected: expected as u8,
            found: cache_byte,
        });
    }
    r.read_u32("entry_count")
}

// ── Body cache public API ─────────────────────────────────────────────

/// Encode the body sub-scene stream, **skipping** entries whose scene
/// contains unsupported content. Returns `(bytes, skipped)` so the
/// caller can surface how many entries were dropped.
///
/// Why skip-on-error (mirror of `encode_tile_stream`): character
/// bundles (`sprite-*`) contain some shapes with raster bitmap fills
/// (e.g. icons, decals) that surface as `Patch::Image` in the encoded
/// sub-scene. The image bytes live inside the SWF bundle and Vello's
/// encoded reference isn't portable across renderer instances. Failing
/// the whole blob on the first such entry — the prior behavior —
/// caused **zero** character bundles to persist to IDB (verified by
/// the 2026-05-25 measurement sweep, which logged
/// `serializeBodySubsceneCache failed: unsupported patch variant
/// 'Image'` for every `sprite-*`). Per-entry skip preserves the bulk
/// of the cache; the dropped entries simply re-bake on cold session
/// (the on-miss `render_body_band` call is cheap because
/// `swf_render_caches` memoises the shape flatten step).
pub fn encode_body_stream<I>(entries: I) -> (Vec<u8>, u32)
where
    I: IntoIterator<Item = (BodySubsceneKey, vello::Scene)>,
{
    let mut w = Writer::with_capacity(1024 * 1024);
    let count_off = write_header(&mut w, CacheId::Body);
    let mut count = 0u32;
    let mut skipped = 0u32;
    for (key, scene) in entries {
        // Encode into a scratch buffer first so we can discard
        // entries with unsupported patches without leaving partial
        // bytes in the main blob.
        let mut scratch = Writer::with_capacity(4 * 1024);
        match encode_scene(&mut scratch, &scene) {
            Ok(()) => {
                write_body_key(&mut w, &key);
                let scene_bytes = scratch.finish();
                w.write_u32(scene_bytes.len() as u32);
                w.write_bytes(&scene_bytes);
                count += 1;
            }
            Err(_) => {
                skipped += 1;
            }
        }
    }
    w.patch_u32(count_off, count);
    (w.finish(), skipped)
}

pub fn decode_body_stream(
    bytes: &[u8],
) -> Result<Vec<(BodySubsceneKey, vello::Scene)>, SceneCacheError> {
    let mut r = Reader::new(bytes);
    let count = read_header(&mut r, CacheId::Body)? as usize;
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        let key = read_body_key(&mut r)?;
        let scene_len = r.read_u32("scene.len")? as usize;
        let scene_bytes = r.read_n(scene_len, "scene.bytes")?;
        let mut sub = Reader::new(scene_bytes);
        let scene = decode_scene(&mut sub)?;
        out.push((key, scene));
    }
    Ok(out)
}

// ── Composed body (body_scene_cache) public API ──────────────────────

fn write_composed_body_key(w: &mut Writer, key: &ComposedBodyKey) {
    w.write_str(&key.bundle);
    w.write_str(&key.export);
    w.write_u32(key.start);
    w.write_u32(key.count);
    w.write_u32(key.scale_q);
    w.write_u8(if key.apply_b_fix { 1 } else { 0 });
    w.write_u8(if key.hat_equipped { 1 } else { 0 });
    w.write_u8(key.mode);
}

fn read_composed_body_key(r: &mut Reader) -> Result<ComposedBodyKey, SceneCacheError> {
    Ok(ComposedBodyKey {
        bundle: r.read_string("composed.bundle")?,
        export: r.read_string("composed.export")?,
        start: r.read_u32("composed.start")?,
        count: r.read_u32("composed.count")?,
        scale_q: r.read_u32("composed.scale_q")?,
        apply_b_fix: r.read_u8("composed.apply_b_fix")? != 0,
        hat_equipped: r.read_u8("composed.hat_equipped")? != 0,
        mode: r.read_u8("composed.mode")?,
    })
}

/// Encode `body_scene_cache` entries, skipping any whose scene
/// contains unsupported patches (same skip-on-error rationale as
/// `encode_body_stream`). Returns `(bytes, skipped)`.
pub fn encode_composed_body_stream<I>(entries: I) -> (Vec<u8>, u32)
where
    I: IntoIterator<Item = (ComposedBodyKey, vello::Scene)>,
{
    let mut w = Writer::with_capacity(1024 * 1024);
    let count_off = write_header(&mut w, CacheId::ComposedBody);
    let mut count = 0u32;
    let mut skipped = 0u32;
    for (key, scene) in entries {
        let mut scratch = Writer::with_capacity(4 * 1024);
        match encode_scene(&mut scratch, &scene) {
            Ok(()) => {
                write_composed_body_key(&mut w, &key);
                let scene_bytes = scratch.finish();
                w.write_u32(scene_bytes.len() as u32);
                w.write_bytes(&scene_bytes);
                count += 1;
            }
            Err(_) => {
                skipped += 1;
            }
        }
    }
    w.patch_u32(count_off, count);
    (w.finish(), skipped)
}

pub fn decode_composed_body_stream(
    bytes: &[u8],
) -> Result<Vec<(ComposedBodyKey, vello::Scene)>, SceneCacheError> {
    let mut r = Reader::new(bytes);
    let count = read_header(&mut r, CacheId::ComposedBody)? as usize;
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        let key = read_composed_body_key(&mut r)?;
        let scene_len = r.read_u32("scene.len")? as usize;
        let scene_bytes = r.read_n(scene_len, "scene.bytes")?;
        let mut sub = Reader::new(scene_bytes);
        let scene = decode_scene(&mut sub)?;
        out.push((key, scene));
    }
    Ok(out)
}

// ── Tile cache public API ─────────────────────────────────────────────

/// Encode the tile stream, **skipping** entries whose scene contains
/// unsupported content (currently: `Patch::Image` from bitmap fills,
/// `Patch::GlyphRun` from text). Returns `(bytes, skipped)` so the
/// caller can surface how many tiles were dropped.
///
/// Tiles commonly contain raster bitmap fills (`DefineBitsLossless`
/// shape fills) — the image bytes live in the SWF and the encoded
/// reference isn't portable across sessions. Failing the whole blob
/// for a single bitmap tile would drop the cache for every other
/// tile in the same bundle. Per-entry skip preserves the rest.
pub fn encode_tile_stream<I>(entries: I) -> (Vec<u8>, u32)
where
    I: IntoIterator<Item = (TileSubsceneKey, vello::Scene)>,
{
    let mut w = Writer::with_capacity(1024 * 1024);
    let count_off = write_header(&mut w, CacheId::Tile);
    let mut count = 0u32;
    let mut skipped = 0u32;
    for (key, scene) in entries {
        // Encode into a scratch buffer first so we can discard
        // entries whose scene contains unsupported patches without
        // leaving partial bytes in the main blob.
        let mut scratch = Writer::with_capacity(4 * 1024);
        match encode_scene(&mut scratch, &scene) {
            Ok(()) => {
                write_tile_key(&mut w, &key);
                let scene_bytes = scratch.finish();
                w.write_u32(scene_bytes.len() as u32);
                w.write_bytes(&scene_bytes);
                count += 1;
            }
            Err(_) => {
                skipped += 1;
            }
        }
    }
    w.patch_u32(count_off, count);
    (w.finish(), skipped)
}

pub fn decode_tile_stream(
    bytes: &[u8],
) -> Result<Vec<(TileSubsceneKey, vello::Scene)>, SceneCacheError> {
    let mut r = Reader::new(bytes);
    let count = read_header(&mut r, CacheId::Tile)? as usize;
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        let key = read_tile_key(&mut r)?;
        let scene_len = r.read_u32("scene.len")? as usize;
        let scene_bytes = r.read_n(scene_len, "scene.bytes")?;
        let mut sub = Reader::new(scene_bytes);
        let scene = decode_scene(&mut sub)?;
        out.push((key, scene));
    }
    Ok(out)
}

// ── Accessory cache public API ────────────────────────────────────────

/// Encode the accessory sub-scene stream, **skipping** entries with
/// unsupported content. Same rationale as `encode_body_stream` —
/// accessory bundles can carry bitmap-backed shapes; per-entry skip
/// preserves the rest of the cache.
pub fn encode_accessory_stream<I>(entries: I) -> (Vec<u8>, u32)
where
    I: IntoIterator<Item = (AccessorySubsceneKey, vello::Scene)>,
{
    let mut w = Writer::with_capacity(1024 * 1024);
    let count_off = write_header(&mut w, CacheId::Accessory);
    let mut count = 0u32;
    let mut skipped = 0u32;
    for (key, scene) in entries {
        let mut scratch = Writer::with_capacity(4 * 1024);
        match encode_scene(&mut scratch, &scene) {
            Ok(()) => {
                write_accessory_key(&mut w, &key);
                let scene_bytes = scratch.finish();
                w.write_u32(scene_bytes.len() as u32);
                w.write_bytes(&scene_bytes);
                count += 1;
            }
            Err(_) => {
                skipped += 1;
            }
        }
    }
    w.patch_u32(count_off, count);
    (w.finish(), skipped)
}

pub fn decode_accessory_stream(
    bytes: &[u8],
) -> Result<Vec<(AccessorySubsceneKey, vello::Scene)>, SceneCacheError> {
    let mut r = Reader::new(bytes);
    let count = read_header(&mut r, CacheId::Accessory)? as usize;
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        let key = read_accessory_key(&mut r)?;
        let scene_len = r.read_u32("scene.len")? as usize;
        let scene_bytes = r.read_n(scene_len, "scene.bytes")?;
        let mut sub = Reader::new(scene_bytes);
        let scene = decode_scene(&mut sub)?;
        out.push((key, scene));
    }
    Ok(out)
}

// ── Legacy aliases (will be removed after lib.rs migrates) ────────────

/// Legacy alias for `encode_body_stream`. Returns `Ok(bytes)`; the
/// skip count is dropped because the original signature is `Result`.
/// New call sites should use `encode_body_stream` directly to see how
/// many entries were skipped.
pub fn encode_stream<I>(entries: I) -> Result<Vec<u8>, SceneCacheError>
where
    I: IntoIterator<Item = (BodySubsceneKey, vello::Scene)>,
{
    let (bytes, _skipped) = encode_body_stream(entries);
    Ok(bytes)
}

pub fn decode_stream(
    bytes: &[u8],
) -> Result<Vec<(BodySubsceneKey, vello::Scene)>, SceneCacheError> {
    decode_body_stream(bytes)
}
