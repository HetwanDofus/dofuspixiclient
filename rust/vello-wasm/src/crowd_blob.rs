//! Off-thread crowd bake: (de)serialization of baked crowd sub-geometry so
//! the CPU walk + vello encode can run in a Web Worker while the GPU intern
//! stays on the main thread.
//!
//! A "look" is one actor's `(bundle, export, frame, flip, accessories)`
//! combination. `emit_player_look_split` turns it into an ordered list of
//! SUBS — body bands and accessory geometry. Each sub is a patch-free
//! `vello_encoding::Encoding` (solid-fill characters), plus the per-zone
//! recolor patches, the point-in-path hit geometry, and a few scalars.
//!
//! The worker bakes the look into a flat byte blob with [`serialize_look`];
//! the main thread reconstructs the subs with [`deserialize_look`] and
//! interns each `Encoding` into the renderer's SubLibrary (the only GPU
//! step). The blob format is little-endian and target-local — it never
//! leaves the process, so no endianness/versioning ceremony beyond a magic
//! + version guard.
//!
//! Subs whose encoding carries vello patches (gradient/image fills — rare
//! for characters) are NOT representable here; the bake reports a fallback
//! and the main thread bakes that whole look synchronously instead.

use vello::kurbo::{Affine, BezPath, PathEl, Point};
use vello::peniko::color::{ColorSpaceTag, DynamicColor, Flags};
use vello::peniko::{Blob, ColorStop, Extend, ImageAlphaType, ImageData, ImageFormat};
use vello::{
    PackedSubPatch, SubHandle, ZonePatchGpu, pack_sub_bytes, sub_handle_for,
};
use vello_encoding::{DrawTag, Encoding, Patch, PathTag, Style, Transform};

const MAGIC: u32 = 0x43_42_4C_42; // "CBLB"
const VERSION: u32 = 1;
/// Sentinel sub-count meaning "this look has patch-bearing subs — bake it on
/// the main thread instead." Distinct from a genuine 0-sub look.
const FALLBACK: u32 = u32::MAX;

/// Borrowed view of one baked sub, ready to serialize.
pub(crate) struct SubParts<'a> {
    pub key: u64,
    pub is_body: bool,
    pub acc_mount_world: Option<Affine>,
    pub enc: &'a Encoding,
    pub zone_patches: &'a [ZonePatchGpu],
    pub hit_geom: &'a [swf_spike::render::hit_geometry::HitGeom],
}

/// A worker-PRE-PACKED sub reconstructed on the main thread. The geometry is
/// already in GPU-ready `pack_sub_bytes` form (`packed`) + the worker-computed
/// `template` handle (stream word-counts; offset/zone filled at intern). The
/// main thread does NO `Encoding` rebuild/clone/re-pack — it resolves
/// `patches` against its own caches and `memcpy`s `packed` into the buffer.
pub(crate) struct PackedSub {
    pub key: u64,
    pub is_body: bool,
    pub acc_mount_world: Option<Affine>,
    pub packed: Vec<u8>,
    pub template: SubHandle,
    pub n_paths: u32,
    pub n_path_segments: u32,
    pub n_clips: u32,
    pub patches: Vec<PackedSubPatch>,
    pub zone_patches: Vec<ZonePatchGpu>,
    /// Serialized picking silhouette — parsed lazily on first hit-test.
    pub hit_raw: Vec<u8>,
}

/// One sub from a deserialized look. `Cached` means the main thread already
/// has this sub interned, so its heavy block (packed bytes + bitmap image) was
/// SKIPPED during parse — the caller reuses the cached handle. `Full` carries
/// the worker-packed bytes ready to intern with no Encoding round-trip.
pub(crate) enum DeSub {
    Cached {
        key: u64,
        is_body: bool,
        acc_mount_world: Option<Affine>,
    },
    Full(PackedSub),
}

// ── little-endian writers ──────────────────────────────────────────────

fn w_u32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes());
}
fn w_u8(out: &mut Vec<u8>, v: u8) {
    out.push(v);
}
fn w_f64(out: &mut Vec<u8>, v: f64) {
    out.extend_from_slice(&v.to_le_bytes());
}
fn w_f32(out: &mut Vec<u8>, v: f32) {
    out.extend_from_slice(&v.to_le_bytes());
}
fn w_u64(out: &mut Vec<u8>, v: u64) {
    out.extend_from_slice(&v.to_le_bytes());
}
/// FNV-1a 64-bit content hash — used to dedup reconstructed bitmap images
/// (same body texture across an actor's frames → one shared `Blob`/atlas slot).
fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// Intern a sub key string to a u64 (FNV-1a). Crowd sub keys are carried as
/// integers so the hot deserialize path neither allocates a `String` per sub
/// nor SipHashes it — that per-sub `String::from_utf8` + `HashMap<String>`
/// lookup was the residual spawn-dip `deser` cost (~102k subs at movement
/// launch). 64-bit FNV collision over the look keyspace is negligible.
pub(crate) fn key_hash(s: &str) -> u64 {
    fnv1a64(s.as_bytes())
}
fn w_bytes(out: &mut Vec<u8>, b: &[u8]) {
    w_u32(out, b.len() as u32);
    out.extend_from_slice(b);
}
/// Write a `Pod` slice as `len(elements) :: raw bytes`.
fn w_pod<T: bytemuck::Pod>(out: &mut Vec<u8>, s: &[T]) {
    w_u32(out, s.len() as u32);
    out.extend_from_slice(bytemuck::cast_slice(s));
}
fn w_affine(out: &mut Vec<u8>, a: &Affine) {
    for c in a.as_coeffs() {
        w_f64(out, c);
    }
}

// ── cursor reader ──────────────────────────────────────────────────────

struct Reader<'a> {
    b: &'a [u8],
    p: usize,
}
impl<'a> Reader<'a> {
    fn new(b: &'a [u8]) -> Self {
        Self { b, p: 0 }
    }
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let end = self.p.checked_add(n)?;
        if end > self.b.len() {
            return None;
        }
        let s = &self.b[self.p..end];
        self.p = end;
        Some(s)
    }
    fn skip(&mut self, n: usize) -> Option<()> {
        self.take(n).map(|_| ())
    }
    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }
    fn u8(&mut self) -> Option<u8> {
        Some(self.take(1)?[0])
    }
    fn f64(&mut self) -> Option<f64> {
        Some(f64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }
    fn f32(&mut self) -> Option<f32> {
        Some(f32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }
    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }
    fn bytes(&mut self) -> Option<&'a [u8]> {
        let n = self.u32()? as usize;
        self.take(n)
    }
    /// Read a `len :: raw bytes` `Pod` vector. Copies into a freshly
    /// allocated (properly aligned) `Vec<T>` — the blob's byte offset is not
    /// guaranteed aligned to `T`, so `cast_slice` on it would panic.
    fn pod<T: bytemuck::Pod>(&mut self) -> Option<Vec<T>> {
        let n = self.u32()? as usize;
        let bytes = self.take(n * std::mem::size_of::<T>())?;
        let mut v = vec![T::zeroed(); n];
        bytemuck::cast_slice_mut::<T, u8>(&mut v).copy_from_slice(bytes);
        Some(v)
    }
    fn affine(&mut self) -> Option<Affine> {
        let mut c = [0.0f64; 6];
        for slot in &mut c {
            *slot = self.f64()?;
        }
        Some(Affine::new(c))
    }
}

// ── hit geometry (BezPath) ─────────────────────────────────────────────

fn w_bezpath(out: &mut Vec<u8>, path: &BezPath) {
    let els = path.elements();
    w_u32(out, els.len() as u32);
    for el in els {
        match el {
            PathEl::MoveTo(p) => {
                w_u8(out, 0);
                w_point(out, *p);
            }
            PathEl::LineTo(p) => {
                w_u8(out, 1);
                w_point(out, *p);
            }
            PathEl::QuadTo(a, b) => {
                w_u8(out, 2);
                w_point(out, *a);
                w_point(out, *b);
            }
            PathEl::CurveTo(a, b, c) => {
                w_u8(out, 3);
                w_point(out, *a);
                w_point(out, *b);
                w_point(out, *c);
            }
            PathEl::ClosePath => w_u8(out, 4),
        }
    }
}
fn w_point(out: &mut Vec<u8>, p: Point) {
    w_f64(out, p.x);
    w_f64(out, p.y);
}

fn r_bezpath(r: &mut Reader) -> Option<BezPath> {
    let n = r.u32()? as usize;
    let mut els = Vec::with_capacity(n);
    for _ in 0..n {
        let tag = r.u8()?;
        els.push(match tag {
            0 => PathEl::MoveTo(r_point(r)?),
            1 => PathEl::LineTo(r_point(r)?),
            2 => PathEl::QuadTo(r_point(r)?, r_point(r)?),
            3 => PathEl::CurveTo(r_point(r)?, r_point(r)?, r_point(r)?),
            4 => PathEl::ClosePath,
            _ => return None,
        });
    }
    Some(BezPath::from_vec(els))
}
fn r_point(r: &mut Reader) -> Option<Point> {
    Some(Point::new(r.f64()?, r.f64()?))
}

// ── lazy hit geometry ──────────────────────────────────────────────────
//
// The per-sub picking silhouette (`BezPath`s) is only read on a click —
// rare vs. the thousands of subs interned per spawn. Reconstructing the
// `BezPath` object graph at intern (it's ~3× the size of its raw bytes:
// every `PathEl` is a 3-point-sized enum) bloated the wasm heap (~doubled
// it) and added to the intern cost. So we keep the COMPACT raw bytes and
// parse the silhouette on first hit-test, caching the result.

/// Per-sub picking geometry, parsed lazily from its serialized bytes.
pub(crate) struct HitLazy {
    raw: Vec<u8>,
    geom: std::cell::OnceCell<Vec<swf_spike::render::hit_geometry::HitGeom>>,
}
impl HitLazy {
    /// From the serialized hit block (the worker-baked common path).
    pub(crate) fn from_raw(raw: Vec<u8>) -> Self {
        Self {
            raw,
            geom: std::cell::OnceCell::new(),
        }
    }
    /// From already-parsed geometry (the synchronous main-thread fallback).
    pub(crate) fn from_parsed(g: Vec<swf_spike::render::hit_geometry::HitGeom>) -> Self {
        let c = std::cell::OnceCell::new();
        let _ = c.set(g);
        Self {
            raw: Vec::new(),
            geom: c,
        }
    }
    /// The silhouette — parsed + cached on first call.
    pub(crate) fn geom(&self) -> &[swf_spike::render::hit_geometry::HitGeom] {
        self.geom.get_or_init(|| parse_hit(&self.raw)).as_slice()
    }
}

/// Parse a serialized hit block (`count` + per-entry bezpath/xform/stroke).
fn parse_hit(raw: &[u8]) -> Vec<swf_spike::render::hit_geometry::HitGeom> {
    let mut r = Reader::new(raw);
    let n = match r.u32() {
        Some(n) => n as usize,
        None => return Vec::new(),
    };
    let mut out = Vec::with_capacity(n);
    for _ in 0..n {
        let (Some(path), Some(xform), Some(flag)) = (r_bezpath(&mut r), r.affine(), r.u8()) else {
            break;
        };
        let stroke_width = if flag != 0 { r.f64() } else { None };
        out.push(swf_spike::render::hit_geometry::HitGeom {
            path: std::sync::Arc::new(path),
            xform,
            stroke_width,
        });
    }
    out
}

/// Serialize a hit block into its own length-prefixed byte run (so the main
/// thread can store it raw and parse lazily).
fn w_hit_block(out: &mut Vec<u8>, hit: &[swf_spike::render::hit_geometry::HitGeom]) {
    // Build into a scratch so we can length-prefix it.
    let mut hb = Vec::new();
    w_u32(&mut hb, hit.len() as u32);
    for g in hit {
        w_bezpath(&mut hb, &g.path);
        w_affine(&mut hb, &g.xform);
        match g.stroke_width {
            Some(sw) => {
                w_u8(&mut hb, 1);
                w_f64(&mut hb, sw);
            }
            None => w_u8(&mut hb, 0),
        }
    }
    w_bytes(out, &hb);
}

// ── gradient patches (Patch::Ramp) + color stops ───────────────────────
//
// Character body art uses authored gradient fills → vello `Patch::Ramp`
// entries referencing `resources.color_stops`. The worker can't resolve them
// (its ramp atlas is a different GPU device), so we ship the UNRESOLVED ramp
// (draw-data offset + stops range + extend) plus the color stops; the main
// thread's `intern_sub_transient` resolves them against its own ramp cache.
// `Patch::Image`/`GlyphRun` are not shipped — a look containing them falls
// back to a main-thread bake (rare for characters).

fn patches_supported(patches: &[Patch]) -> bool {
    // Ramp (gradient) + Image (bitmap fill — what Dofus character bodies use)
    // are shippable; only GlyphRun (text, never in characters) falls back.
    patches.iter().all(|p| !matches!(p, Patch::GlyphRun { .. }))
}

/// Explicit u8 ↔ enum maps (these `repr(u8)` enums don't expose a public
/// integer constructor in this color/peniko version).
fn extend_from_u8(n: u8) -> Extend {
    match n {
        1 => Extend::Repeat,
        2 => Extend::Reflect,
        _ => Extend::Pad,
    }
}
fn img_format_from_u8(n: u8) -> ImageFormat {
    match n {
        1 => ImageFormat::Bgra8,
        _ => ImageFormat::Rgba8,
    }
}
fn img_alpha_from_u8(n: u8) -> ImageAlphaType {
    match n {
        1 => ImageAlphaType::AlphaPremultiplied,
        _ => ImageAlphaType::Alpha,
    }
}
fn cs_from_u8(n: u8) -> ColorSpaceTag {
    use ColorSpaceTag::*;
    match n {
        1 => LinearSrgb,
        2 => Lab,
        3 => Lch,
        4 => Hsl,
        5 => Hwb,
        6 => Oklab,
        7 => Oklch,
        8 => DisplayP3,
        9 => A98Rgb,
        10 => ProphotoRgb,
        11 => Rec2020,
        12 => AcesCg,
        13 => XyzD50,
        14 => XyzD65,
        15 => Aces2065_1,
        _ => Srgb,
    }
}

/// Serialize the look's patches into packed-WORD space. `base_word` is the
/// u32-word offset of the `draw_data` stream within the packed bytes
/// (path_tags + path_data + draw_tags), so each patch's resolved word lands at
/// `base_word + draw_data_offset` in `packed`. Ramp stops are inlined (the
/// Encoding's `color_stops` aren't shipped separately).
fn w_patches(out: &mut Vec<u8>, patches: &[Patch], color_stops: &[ColorStop], base_word: u32) {
    w_u32(out, patches.len() as u32);
    for p in patches {
        match p {
            Patch::Ramp {
                draw_data_offset,
                stops,
                extend,
            } => {
                w_u8(out, 0);
                w_u32(out, base_word + *draw_data_offset as u32);
                w_color_stops(out, &color_stops[stops.clone()]);
                w_u8(out, (*extend) as u8);
            }
            Patch::Image {
                draw_data_offset,
                image,
            } => {
                w_u8(out, 1);
                w_u32(out, base_word + *draw_data_offset as u32);
                // Content hash first → main dedups identical bitmaps (the body
                // texture repeats across every frame) and skips the byte block.
                w_u64(out, fnv1a64(image.data.data()));
                w_bytes(out, image.data.data());
                w_u8(out, image.format as u8);
                w_u8(out, image.alpha_type as u8);
                w_u32(out, image.width);
                w_u32(out, image.height);
            }
            // GlyphRun is filtered out by `patches_supported` (whole-look
            // fallback), so it never reaches serialization.
            Patch::GlyphRun { .. } => {}
        }
    }
}
fn r_patches(
    r: &mut Reader,
    image_dedup: &mut std::collections::HashMap<u64, Blob<u8>>,
) -> Option<Vec<PackedSubPatch>> {
    let n = r.u32()? as usize;
    let mut v = Vec::with_capacity(n);
    for _ in 0..n {
        let tag = r.u8()?;
        match tag {
            0 => {
                let word_off = r.u32()?;
                let stops = r_color_stops(r)?;
                let extend = extend_from_u8(r.u8()?);
                v.push(PackedSubPatch::Ramp {
                    word_off,
                    stops,
                    extend,
                });
            }
            1 => {
                let word_off = r.u32()?;
                let hash = r.u64()?;
                // Reuse the shared `Blob` for an image we've already
                // reconstructed (same id → the atlas dedups → no re-upload).
                // Only build a fresh `Blob` (and read bytes) on first sight.
                let data = if let Some(existing) = image_dedup.get(&hash) {
                    let len = r.u32()? as usize;
                    r.skip(len)?;
                    existing.clone()
                } else {
                    let bytes = r.bytes()?.to_vec();
                    let blob = Blob::from(bytes);
                    image_dedup.insert(hash, blob.clone());
                    blob
                };
                let format = img_format_from_u8(r.u8()?);
                let alpha_type = img_alpha_from_u8(r.u8()?);
                let width = r.u32()?;
                let height = r.u32()?;
                v.push(PackedSubPatch::Image {
                    word_off,
                    image: ImageData {
                        data,
                        format,
                        alpha_type,
                        width,
                        height,
                    },
                });
            }
            _ => return None,
        }
    }
    Some(v)
}

fn w_color_stops(out: &mut Vec<u8>, stops: &[ColorStop]) {
    w_u32(out, stops.len() as u32);
    for s in stops {
        w_f32(out, s.offset);
        w_u8(out, s.color.cs as u8);
        for c in s.color.components {
            w_f32(out, c);
        }
    }
}
fn r_color_stops(r: &mut Reader) -> Option<Vec<ColorStop>> {
    let n = r.u32()? as usize;
    let mut v = Vec::with_capacity(n);
    for _ in 0..n {
        let offset = r.f32()?;
        let cs = cs_from_u8(r.u8()?);
        let mut components = [0.0f32; 4];
        for c in &mut components {
            *c = r.f32()?;
        }
        v.push(ColorStop {
            offset,
            color: DynamicColor {
                cs,
                flags: Flags::default(),
                components,
            },
        });
    }
    Some(v)
}

// ── public API ─────────────────────────────────────────────────────────

/// Serialize a baked look's subs into a flat blob. Returns the FALLBACK
/// marker blob if any sub carries vello patches (caller bakes it on the
/// main thread instead).
pub(crate) fn serialize_look(subs: &[SubParts]) -> Vec<u8> {
    let mut out = Vec::with_capacity(64 * 1024);
    w_u32(&mut out, MAGIC);
    w_u32(&mut out, VERSION);
    // Only `Patch::Ramp` gradients are shippable; an Image/GlyphRun patch
    // (rare for characters) falls the whole look back to a main-thread bake.
    if subs
        .iter()
        .any(|s| !patches_supported(&s.enc.resources.patches))
    {
        w_u32(&mut out, FALLBACK);
        return out;
    }
    w_u32(&mut out, subs.len() as u32);
    // Reused scratch for each sub's heavy block (geometry + bitmap image
    // bytes). The block is length-prefixed so the main thread can SKIP it
    // entirely for a sub it has already interned — the body bitmap (~30 KB)
    // rides in every frame's blob, and re-deserializing it for cached subs
    // was the residual spawn-dip cost.
    let mut heavy = Vec::with_capacity(48 * 1024);
    for s in subs {
        let e = s.enc;
        w_u64(&mut out, s.key);
        w_u8(&mut out, u8::from(s.is_body));
        match s.acc_mount_world {
            Some(a) => {
                w_u8(&mut out, 1);
                w_affine(&mut out, &a);
            }
            None => w_u8(&mut out, 0),
        }
        heavy.clear();
        // PRE-PACKED GPU-ready bytes (the worker runs `pack_sub_bytes` so the
        // main thread does no Encoding rebuild / clone / re-pack) + the
        // worker-computed handle (stream word-counts; offset/zone set at
        // intern) + the encoding-level counts the slab block needs.
        let packed = pack_sub_bytes(e);
        let template = sub_handle_for(0, e);
        w_bytes(&mut heavy, &packed);
        heavy.extend_from_slice(bytemuck::bytes_of(&template));
        w_u32(&mut heavy, e.n_paths);
        w_u32(&mut heavy, e.n_path_segments);
        w_u32(&mut heavy, e.n_clips);
        // Patches in packed-WORD space: their resolved word lands at
        // `base_word + draw_data_offset` in `packed`.
        let base_word =
            template.path_tags_words + template.path_data_words + template.draw_tags_words;
        w_patches(&mut heavy, &e.resources.patches, &e.resources.color_stops, base_word);
        // Zone recolor patches (ZonePatchGpu is a transparent u32).
        let zp: Vec<u32> = s.zone_patches.iter().map(|z| z.0).collect();
        w_pod(&mut heavy, &zp);
        // Hit geometry — length-prefixed raw block (parsed lazily on the main
        // thread, only when a sub is actually picked).
        w_hit_block(&mut heavy, s.hit_geom);
        w_u32(&mut out, heavy.len() as u32);
        out.extend_from_slice(&heavy);
    }
    out
}

/// Result of [`deserialize_look`]: either the per-sub list (each `Cached` or
/// `Full`), or a signal that the worker punted and the caller must bake this
/// look synchronously.
pub(crate) enum LookBlob {
    Subs(Vec<DeSub>),
    Fallback,
}

/// Deserialize a look blob. `is_cached(key)` lets the main thread SKIP the
/// heavy block (geometry + bitmap image) for subs it has already interned —
/// those come back as [`DeSub::Cached`] (reuse the cached handle); the rest
/// are [`DeSub::Full`] ready to intern.
pub(crate) fn deserialize_look(
    blob: &[u8],
    is_cached: &dyn Fn(u64) -> bool,
    image_dedup: &mut std::collections::HashMap<u64, Blob<u8>>,
) -> Option<LookBlob> {
    let mut r = Reader::new(blob);
    if r.u32()? != MAGIC || r.u32()? != VERSION {
        return None;
    }
    let count = r.u32()?;
    if count == FALLBACK {
        return Some(LookBlob::Fallback);
    }
    let mut subs = Vec::with_capacity(count as usize);
    for _ in 0..count {
        let key = r.u64()?;
        let is_body = r.u8()? != 0;
        let acc_mount_world = if r.u8()? != 0 { Some(r.affine()?) } else { None };
        let heavy_len = r.u32()? as usize;
        if is_cached(key) {
            // Already interned — don't pay the bitmap deserialize.
            r.skip(heavy_len)?;
            subs.push(DeSub::Cached {
                key,
                is_body,
                acc_mount_world,
            });
            continue;
        }
        let packed = r.bytes()?.to_vec();
        let template: SubHandle =
            bytemuck::pod_read_unaligned(r.take(std::mem::size_of::<SubHandle>())?);
        let n_paths = r.u32()?;
        let n_path_segments = r.u32()?;
        let n_clips = r.u32()?;
        let patches = r_patches(&mut r, image_dedup)?;
        let zone_patches = r.pod::<u32>()?.into_iter().map(ZonePatchGpu).collect();
        // Keep the hit block raw — parsed lazily on first pick (see `HitLazy`).
        let hit_raw = r.bytes()?.to_vec();
        subs.push(DeSub::Full(PackedSub {
            key,
            is_body,
            acc_mount_world,
            packed,
            template,
            n_paths,
            n_path_segments,
            n_clips,
            patches,
            zone_patches,
            hit_raw,
        }));
    }
    Some(LookBlob::Subs(subs))
}

/// In-target round-trip check (the crate can't build for host — it uses
/// WebGPU-only dispatch — so this runs on the real wasm target via a thin
/// `#[wasm_bindgen]` export in `lib.rs`). Returns true iff serialize →
/// deserialize reproduces every field, plus the malformed-input guards hold.
pub(crate) fn selftest() -> bool {
    let mut enc = Encoding::new();
    enc.path_tags = vec![PathTag(1), PathTag(9), PathTag(0x10)];
    enc.path_data = vec![0xDEAD_BEEF, 0x0000_0001, 42, 7, 7];
    enc.draw_tags = vec![DrawTag(0x44), DrawTag(0)];
    enc.draw_data = vec![0xFF00_FF00, 0x1234_5678];
    enc.transforms = vec![Transform {
        matrix: [1.0, 0.0, 0.0, 1.0],
        translation: [3.5, -2.25],
    }];
    enc.styles = vec![Style {
        flags_and_miter_limit: 0xABCD_1234,
        line_width: 2.5,
    }];
    enc.n_paths = 1;
    enc.n_path_segments = 2;
    enc.resources.patches = vec![Patch::Ramp {
        draw_data_offset: 4,
        stops: 0..2,
        extend: Extend::Repeat,
    }];
    enc.resources.color_stops = vec![
        ColorStop {
            offset: 0.0,
            color: DynamicColor {
                cs: ColorSpaceTag::Srgb,
                flags: Flags::default(),
                components: [1.0, 0.25, 0.0, 1.0],
            },
        },
        ColorStop {
            offset: 1.0,
            color: DynamicColor {
                cs: ColorSpaceTag::LinearSrgb,
                flags: Flags::default(),
                components: [0.0, 0.5, 1.0, 0.8],
            },
        },
    ];

    let mut p = BezPath::new();
    p.move_to((0.0, 0.0));
    p.line_to((10.0, 0.0));
    p.quad_to((10.0, 5.0), (5.0, 5.0));
    p.curve_to((4.0, 4.0), (3.0, 3.0), (0.0, 0.0));
    p.close_path();
    let hit = vec![swf_spike::render::hit_geometry::HitGeom {
        path: std::sync::Arc::new(p),
        xform: Affine::new([1.0, 0.0, 0.0, 1.0, 12.0, 34.0]),
        stroke_width: Some(1.5),
    }];
    let zp = vec![ZonePatchGpu(0x0102_0304), ZonePatchGpu(7)];

    let subs = vec![
        SubParts {
            key: key_hash("B|sprite-11|walkR|3|0|2"),
            is_body: true,
            acc_mount_world: None,
            enc: &enc,
            zone_patches: &zp,
            hit_geom: &hit,
        },
        SubParts {
            key: key_hash("A|sprite-90|capeR|2|wr1|0"),
            is_body: false,
            acc_mount_world: Some(Affine::new([0.9, 0.1, -0.1, 0.9, 5.0, -5.0])),
            enc: &enc,
            zone_patches: &[],
            hit_geom: &[],
        },
    ];
    let blob = serialize_look(&subs);
    let mut dedup = std::collections::HashMap::new();
    // Nothing cached → both subs come back Full.
    let out = match deserialize_look(&blob, &|_| false, &mut dedup) {
        Some(LookBlob::Subs(s)) => s,
        _ => return false,
    };
    if out.len() != 2 {
        return false;
    }
    let (a, b) = match (&out[0], &out[1]) {
        (DeSub::Full(a), DeSub::Full(b)) => (a, b),
        _ => return false,
    };
    let expected_packed = pack_sub_bytes(&enc);
    let expected_template = sub_handle_for(0, &enc);
    // Hit geometry is shipped raw + parsed lazily — round-trip via HitLazy.
    let a_hit = HitLazy::from_raw(a.hit_raw.clone());
    let b_hit = HitLazy::from_raw(b.hit_raw.clone());
    let ag = a_hit.geom();
    let ok = a.key == key_hash("B|sprite-11|walkR|3|0|2")
        && a.is_body
        && a.acc_mount_world.is_none()
        && a.packed == expected_packed
        && bytemuck::bytes_of(&a.template) == bytemuck::bytes_of(&expected_template)
        && a.n_paths == 1
        && a.n_path_segments == 2
        && a.zone_patches.iter().map(|z| z.0).collect::<Vec<_>>() == vec![0x0102_0304, 7]
        && ag.len() == 1
        && ag[0].path.elements() == hit[0].path.elements()
        && ag[0].xform.as_coeffs() == hit[0].xform.as_coeffs()
        && ag[0].stroke_width == Some(1.5)
        && b.key == key_hash("A|sprite-90|capeR|2|wr1|0")
        && !b.is_body
        && b.acc_mount_world.map(|m| m.as_coeffs()) == Some([0.9, 0.1, -0.1, 0.9, 5.0, -5.0])
        && b.zone_patches.is_empty()
        && b_hit.geom().is_empty();
    // Gradient ramp round-trip in packed-word space (shared `enc`, both subs).
    let base_word = expected_template.path_tags_words
        + expected_template.path_data_words
        + expected_template.draw_tags_words;
    let patch_ok = matches!(
        a.patches.first(),
        Some(PackedSubPatch::Ramp { word_off, stops, extend })
            if *word_off == base_word + 4
                && stops.len() == 2
                && (*extend as u8) == (Extend::Repeat as u8)
                && stops[0].color.components == [1.0, 0.25, 0.0, 1.0]
                && (stops[0].color.cs as u8) == (ColorSpaceTag::Srgb as u8)
                && (stops[1].color.cs as u8) == (ColorSpaceTag::LinearSrgb as u8)
                && stops[1].offset == 1.0
    ) && a.patches.len() == 1;
    // Cached-skip path: everything cached → both subs come back as `Cached`
    // (heavy blocks skipped) with key/is_body/acc_mount intact + cursor still
    // aligned (parse succeeds for both).
    let cached_ok = match deserialize_look(&blob, &|_| true, &mut dedup) {
        Some(LookBlob::Subs(s)) if s.len() == 2 => {
            matches!(&s[0], DeSub::Cached { key, is_body, acc_mount_world }
                if *key == key_hash("B|sprite-11|walkR|3|0|2") && *is_body && acc_mount_world.is_none())
                && matches!(&s[1], DeSub::Cached { key, is_body, acc_mount_world }
                    if *key == key_hash("A|sprite-90|capeR|2|wr1|0")
                        && !*is_body
                        && acc_mount_world.map(|m| m.as_coeffs())
                            == Some([0.9, 0.1, -0.1, 0.9, 5.0, -5.0]))
        }
        _ => false,
    };
    // Malformed-input guards.
    ok && patch_ok
        && cached_ok
        && deserialize_look(&[0, 1, 2], &|_| false, &mut dedup).is_none()
        && deserialize_look(&[], &|_| false, &mut dedup).is_none()
}
