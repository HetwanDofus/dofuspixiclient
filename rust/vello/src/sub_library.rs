//! GPU-resident library of unique sub-encodings, interned by `Arc::as_ptr` identity.

use std::collections::HashMap;
use std::sync::Arc;

use bytemuck::{Pod, Zeroable};
use vello_encoding::Encoding;

/// Host-side descriptor of a sub stored in [`SubLibrary`].
///
/// Word counts are kept inline so the GPU instance-expand kernel can size
/// its per-stream copies without re-walking the sub bytes. `offset` is
/// expressed in u32 units to match the shader's `array<u32>` indexing.
///
/// `zone_patches_offset` and `zone_patches_count` describe an optional
/// packed `ZonePatchGpu` record array appended to the sub-library bytes
/// after the six streams. Zero when the sub has no zone patches
/// (tiles, accessories — most common case).
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct SubHandle {
    pub offset: u32,
    // u32 (not u16): complex map-tile subs exceed 65535 words/stream
    // (e.g. ~90k path_data words), which silently wrapped under u16 and
    // corrupted the downstream `xf_src` offset → kernel read path-data as
    // transforms → flatten over-tessellated.
    pub path_tags_words: u32,
    pub path_data_words: u32,
    pub draw_tags_words: u32,
    pub draw_data_words: u32,
    pub transforms_words: u32,
    pub styles_words: u32,
    /// Σ `DrawTag::info_size()` over the sub's draw tags — the number of
    /// `info_bin_data` words the GPU's draw-monoid scan reserves for this
    /// sub. The compose layer sums these into
    /// `SlabStreamTotals::draw_info_words` so `resolve_slabbed` can set
    /// `Layout::bin_data_start` past the info the GAP tags generate;
    /// counting only host tags lets binning allocations overwrite draw
    /// info (intermittent torn geometry).
    pub draw_info_words: u32,
    pub zone_patches_offset: u32,
    pub zone_patches_count: u32,
}

/// GPU-visible per-zone patch record. Packed `u32` =
/// `(alpha << 24) | (zone << 16) | (offset_in_sub_draw_data & 0xFFFF)`.
/// `offset_in_sub_draw_data` is in u32 words relative to the sub's own
/// `draw_data` stream start — the shader adds it to the slot's
/// per-stream gap base to land on the right scene buffer word.
#[repr(C)]
#[derive(Copy, Clone, Debug, Default, Pod, Zeroable)]
pub struct ZonePatchGpu(pub u32);

impl ZonePatchGpu {
    pub const fn pack(offset_in_sub_draw_data: u16, zone: u8, alpha: u8) -> Self {
        Self((offset_in_sub_draw_data as u32) | ((zone as u32) << 16) | ((alpha as u32) << 24))
    }
}

const INITIAL_CAP: u64 = 64 * 1024 * 1024;
// DOFUS Tier 7: ceiling for the on-demand doubling growth. A 1000-actor
// fully-diverse animated crowd interns far more unique geometry (every
// distinct body × frame × segment) than the old 128 MB cap held, so it
// silently dropped subs (intern → sentinel offset 0). 1 GiB holds that
// working set; the doubling (64→128→256→512→1024 MiB) stops as soon as
// the live set fits, so the common shared-look case never reaches it.
const MAX_CAP: u64 = 1024 * 1024 * 1024;
const GROW_WARN_THRESHOLD: u64 = 256 * 1024 * 1024;

/// Multiplicative mixer for the intern cache's `(pointer, digest)`
/// keys. The cache is probed thousands of times per frame at crowd
/// scale (every band emit interns); SipHash's per-lookup cost is
/// measurable there, and DoS resistance is pointless for keys derived
/// from our own heap pointers.
#[derive(Default)]
struct PtrKeyHasher(u64);

impl std::hash::Hasher for PtrKeyHasher {
    fn finish(&self) -> u64 {
        self.0
    }

    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 = (self.0 ^ u64::from(b)).wrapping_mul(0x100000001b3);
        }
    }

    fn write_u64(&mut self, i: u64) {
        self.0 = (self.0 ^ i).wrapping_mul(0x9E37_79B9_7F4A_7C15);
        self.0 ^= self.0 >> 29;
    }

    fn write_usize(&mut self, i: usize) {
        self.write_u64(i as u64);
    }
}

type PtrKeyBuildHasher = std::hash::BuildHasherDefault<PtrKeyHasher>;

pub struct SubLibrary {
    device: wgpu::Device,
    buffer: wgpu::Buffer,
    mirror: Vec<u8>,
    capacity: u64,
    used: u64,
    /// Cache keyed on `(Arc::as_ptr(sub), zone_patches_digest)` so the
    /// same sub interned with different zone-patch variants gets
    /// distinct cached handles. The digest is FNV-1a over the packed
    /// ZonePatchGpu record bytes (kept small — body segments carry ≤ 8).
    ///
    /// The value holds a STRONG `Arc` clone of the keyed encoding. A
    /// pointer key without ownership is an ABA hazard: prebake caches
    /// pool/recycle encodings, so a dropped sub's heap address can be
    /// reused by a different sub, and the lookup would return the OLD
    /// sub's handle — wrong geometry (observed as mis-attached / wrong
    /// accessories after map churn). Holding the Arc pins the address
    /// for the entry's lifetime, which matches the library semantics:
    /// the packed GPU bytes are never freed either.
    by_ptr: HashMap<(usize, u64), (SubHandle, Arc<Encoding>), PtrKeyBuildHasher>,
    sentinel: SubHandle,
    intern_count: u64,
    overflow: bool,
}

impl SubLibrary {
    pub fn new(device: &wgpu::Device, capacity_bytes: u64) -> Self {
        let capacity = capacity_bytes.max(INITIAL_CAP).min(MAX_CAP);
        let buffer = create_buffer(device, capacity);
        let mut lib = Self {
            device: device.clone(),
            buffer,
            mirror: Vec::with_capacity(capacity as usize),
            capacity,
            used: 0,
            by_ptr: HashMap::default(),
            sentinel: SubHandle::zeroed(),
            intern_count: 0,
            overflow: false,
        };
        // The empty-sub at offset 0 is the no-op slot descriptor slabs target
        // when a slot is unfilled. Seeded here so callers can always trust
        // `sentinel().offset == 0`.
        let empty = Arc::new(Encoding::default());
        lib.sentinel = lib.intern_inner(None, &empty, None, &[]);
        // The empty sentinel packs to 0 bytes, leaving `used == 0` — so the
        // FIRST real sub would also land at byte offset 0, which compose
        // reads as "intern failed / sentinel" and DROPS. Reserve one word so
        // the sentinel uniquely owns offset 0 and every real sub is offset
        // >= 1 word.
        if lib.used == 0 {
            lib.used = 4;
            lib.mirror.extend_from_slice(&[0u8; 4]);
        }
        lib.intern_count = 0;
        lib
    }

    /// Cache probe without interning. `Renderer::intern_sub` calls this
    /// before resolving vello-level patches: resolution clones the whole
    /// encoding, so paying it on every warm call (every emit, every
    /// frame) instead of only on first sight was a per-frame compose
    /// cost proportional to total sub bytes.
    pub fn lookup(&self, sub: &Arc<Encoding>, zone_patches: &[ZonePatchGpu]) -> Option<SubHandle> {
        let key = (Arc::as_ptr(sub) as usize, hash_zone_patches(zone_patches));
        self.by_ptr.get(&key).map(|(h, _)| *h)
    }

    /// DOFUS: intern `sub` with an optional inline `ZonePatchGpu`
    /// record array. The patches are packed into the sub-library bytes
    /// immediately after the six streams; the returned `SubHandle`
    /// carries the patch range so the GPU expander can apply them.
    /// Cache keys include a hash of the patch bytes so the same sub
    /// interned with different patch sets yields distinct handles.
    pub fn intern_with_patches(
        &mut self,
        queue: &wgpu::Queue,
        sub: &Arc<Encoding>,
        zone_patches: &[ZonePatchGpu],
    ) -> SubHandle {
        self.intern_count += 1;
        let key = (Arc::as_ptr(sub) as usize, hash_zone_patches(zone_patches));
        if let Some((h, _)) = self.by_ptr.get(&key) {
            return *h;
        }
        self.intern_inner(Some(queue), sub, None, zone_patches)
    }

    /// DOFUS: intern using `sub` as the cache identity (its `Arc::as_ptr`
    /// keys the cache) but pack `resolved` bytes into the GPU buffer.
    /// `Renderer::intern_sub` uses this so vello-level patches (Ramp /
    /// Image) get substituted into a temporary `Encoding` before
    /// packing — same identity, resolved bytes.
    pub fn intern_with_resolved(
        &mut self,
        queue: &wgpu::Queue,
        sub: &Arc<Encoding>,
        resolved: &Encoding,
        zone_patches: &[ZonePatchGpu],
    ) -> SubHandle {
        self.intern_count += 1;
        let key = (Arc::as_ptr(sub) as usize, hash_zone_patches(zone_patches));
        if let Some((h, _)) = self.by_ptr.get(&key) {
            return *h;
        }
        self.intern_inner(Some(queue), sub, Some(resolved), zone_patches)
    }

    pub fn buffer(&self) -> &wgpu::Buffer {
        &self.buffer
    }

    pub fn used_bytes(&self) -> u64 {
        self.used
    }

    pub fn unique_subs(&self) -> u64 {
        self.by_ptr.len() as u64
    }

    pub fn intern_count(&self) -> u64 {
        self.intern_count
    }

    pub fn frame_step(&mut self) {
        self.intern_count = 0;
        self.overflow = false;
    }

    /// Drop every interned sub and start packing from scratch (the GPU
    /// buffer is retained at its current capacity; bytes are simply
    /// overwritten by subsequent interns). Called on map change together
    /// with the resolver's pinned ramp/image resets — the baked
    /// ramp ids / atlas coordinates inside the packed bytes go stale the
    /// moment those caches reset, so the library must restart with them.
    /// Also bounds the held `Arc<Encoding>` working set per map.
    pub fn reset(&mut self) {
        self.by_ptr.clear();
        self.mirror.clear();
        // Re-reserve the sentinel word so offset 0 stays "empty slot"
        // and the first real sub lands at a non-zero offset (compose
        // reads offset 0 as "intern failed / sentinel").
        self.mirror.extend_from_slice(&[0u8; 4]);
        self.used = 4;
        self.intern_count = 0;
        self.overflow = false;
    }

    pub fn overflow(&self) -> bool {
        self.overflow
    }

    pub fn sentinel(&self) -> SubHandle {
        self.sentinel
    }

    /// Debug: read `count` u32 words starting at `word_offset` from the
    /// CPU mirror of the sub-library buffer. Used by client compose to
    /// verify intern-time padding wrote the expected bytes (identity
    /// padding transforms, pad TRANSFORM tags appended to path_tags,
    /// etc.) without going through a GPU readback.
    pub fn peek_words(&self, word_offset: u32, count: usize) -> Vec<u32> {
        let byte_off = word_offset as usize * 4;
        let byte_end = (byte_off + count * 4).min(self.mirror.len());
        if byte_off >= self.mirror.len() {
            return Vec::new();
        }
        let slice = &self.mirror[byte_off..byte_end];
        slice
            .chunks_exact(4)
            .map(|chunk| u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
            .collect()
    }

    fn intern_inner(
        &mut self,
        queue: Option<&wgpu::Queue>,
        sub: &Arc<Encoding>,
        resolved: Option<&Encoding>,
        zone_patches: &[ZonePatchGpu],
    ) -> SubHandle {
        let input: &Encoding = resolved.unwrap_or(sub.as_ref());
        // No transform padding: each sub keeps its ACTUAL transform tags
        // and records. The slab gap tight-packs transforms per slot at a
        // prefix-sum offset (`SlabSlotAux::transforms_dst_words`), exactly
        // like path_data — so there is no per-sub transform-count limit
        // and complex tiles (e.g. the map-35 windmill, ~175 transforms)
        // are no longer truncated.
        let to_pack: &Encoding = input;
        let stream_bytes = pack_sub_bytes(to_pack);
        let patches_bytes = bytemuck::cast_slice::<ZonePatchGpu, u8>(zone_patches);
        let pack_size = (stream_bytes.len() + patches_bytes.len()) as u64;
        if self.used + pack_size > self.capacity {
            // Constructor seeds the empty sentinel before any GPU work; if a
            // grow request slips in here with no queue it means a caller has
            // wired a non-trivial sub through `new()` — return sentinel
            // rather than panic.
            let Some(q) = queue else {
                self.overflow = true;
                return self.sentinel;
            };
            if !self.try_grow(self.used + pack_size, q) {
                self.overflow = true;
                return self.sentinel;
            }
        }

        let offset_bytes = self.used;
        let stream_off_words = (offset_bytes / 4) as u32;
        self.mirror.extend_from_slice(&stream_bytes);
        let patches_off_bytes = offset_bytes + stream_bytes.len() as u64;
        self.mirror.extend_from_slice(patches_bytes);
        self.used += pack_size;
        if let Some(q) = queue {
            q.write_buffer(&self.buffer, offset_bytes, &stream_bytes);
            if !patches_bytes.is_empty() {
                q.write_buffer(&self.buffer, patches_off_bytes, patches_bytes);
            }
        }

        // offset stored in u32 words; pack_sub_bytes pads each stream to a
        // u32 boundary so the cumulative offset is always 4-aligned.
        debug_assert!(offset_bytes % 4 == 0);
        debug_assert!(patches_off_bytes % 4 == 0);
        let mut handle = sub_handle_for(stream_off_words, to_pack);
        handle.zone_patches_offset = (patches_off_bytes / 4) as u32;
        handle.zone_patches_count = zone_patches.len() as u32;
        let key = (Arc::as_ptr(sub) as usize, hash_zone_patches(zone_patches));
        self.by_ptr.insert(key, (handle, Arc::clone(sub)));
        handle
    }

    fn try_grow(&mut self, required: u64, queue: &wgpu::Queue) -> bool {
        let mut new_cap = self.capacity;
        while new_cap < required && new_cap < MAX_CAP {
            new_cap = (new_cap * 2).min(MAX_CAP);
        }
        if new_cap < required {
            return false;
        }
        let new_buffer = create_buffer(&self.device, new_cap);
        if !self.mirror.is_empty() {
            queue.write_buffer(&new_buffer, 0, &self.mirror);
        }
        self.buffer = new_buffer;
        self.capacity = new_cap;
        self.mirror
            .reserve(new_cap as usize - self.mirror.capacity());
        if new_cap > GROW_WARN_THRESHOLD {
            log::warn!(
                target: "client::sublibrary",
                "sub library grew to {} bytes (cap {} MB)",
                new_cap,
                new_cap / (1024 * 1024)
            );
        }
        true
    }
}

fn create_buffer(device: &wgpu::Device, size: u64) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("sub_library"),
        size,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    })
}

/// Pack a sub-encoding into its on-GPU byte layout.
///
/// Layout: `[path_tags | path_data | draw_tags | draw_data | transforms | styles]`.
/// `path_tags` (a `Vec<u8>`-equivalent) is padded up to the next u32 boundary
/// with zeroes; every other stream is already u32-aligned. The whole packed
/// blob is a multiple of 4 bytes so the next sub starts on a word boundary.
pub fn pack_sub_bytes(sub: &Encoding) -> Vec<u8> {
    let path_tags = bytemuck::cast_slice::<_, u8>(&sub.path_tags);
    let path_tags_padded = path_tags.len().next_multiple_of(4);
    let path_data = bytemuck::cast_slice::<_, u8>(&sub.path_data);
    let draw_tags = bytemuck::cast_slice::<_, u8>(&sub.draw_tags);
    let draw_data = bytemuck::cast_slice::<_, u8>(&sub.draw_data);
    let transforms = bytemuck::cast_slice::<_, u8>(&sub.transforms);
    let styles = bytemuck::cast_slice::<_, u8>(&sub.styles);

    let total = path_tags_padded
        + path_data.len()
        + draw_tags.len()
        + draw_data.len()
        + transforms.len()
        + styles.len();
    let mut out = Vec::with_capacity(total);

    out.extend_from_slice(path_tags);
    out.resize(path_tags_padded, 0);
    out.extend_from_slice(path_data);
    out.extend_from_slice(draw_tags);
    out.extend_from_slice(draw_data);
    out.extend_from_slice(transforms);
    out.extend_from_slice(styles);
    debug_assert_eq!(out.len() % 4, 0);
    out
}

/// Build the handle that names a sub already packed at `offset` (in u32 words).
pub fn sub_handle_for(offset: u32, sub: &Encoding) -> SubHandle {
    let path_tag_bytes = sub.path_tags.len();
    let path_tags_words = (path_tag_bytes.next_multiple_of(4) / 4) as u32;
    SubHandle {
        offset,
        path_tags_words,
        path_data_words: sub.path_data.len() as u32,
        draw_tags_words: sub.draw_tags.len() as u32,
        draw_data_words: sub.draw_data.len() as u32,
        transforms_words: (sub.transforms.len() * 6) as u32,
        styles_words: (sub.styles.len() * 2) as u32,
        draw_info_words: sub.draw_tags.iter().map(|tag| tag.info_size()).sum(),
        zone_patches_offset: 0,
        zone_patches_count: 0,
    }
}

/// FNV-1a over the patch byte slice. Small (< 64 bytes typical) so the
/// per-intern hash overhead is negligible; only fires on first sight.
fn hash_zone_patches(patches: &[ZonePatchGpu]) -> u64 {
    let bytes = bytemuck::cast_slice::<ZonePatchGpu, u8>(patches);
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

#[cfg(test)]
mod tests {
    use super::*;
    use vello_encoding::{DrawTag, PathTag, Style, Transform};

    fn make_sub(path_tag_bytes: usize, transforms: usize) -> Arc<Encoding> {
        let mut e = Encoding::default();
        e.path_tags = (0..path_tag_bytes).map(|i| PathTag(i as u8)).collect();
        e.path_data = vec![0xDEAD_BEEF; 4];
        e.draw_tags = vec![DrawTag(0x44); 2];
        e.draw_data = vec![0xC0FF_EEEE; 3];
        e.transforms = (0..transforms).map(|_| Transform::IDENTITY).collect();
        e.styles = vec![Style::default(); 1];
        Arc::new(e)
    }

    #[test]
    fn pack_layout_is_u32_aligned() {
        // 5 path tags → 8-byte stream after pad; everything that follows
        // must be word-aligned so the next sub starts on a u32 boundary.
        let sub = make_sub(5, 2);
        let bytes = pack_sub_bytes(&sub);
        assert_eq!(bytes.len() % 4, 0);
        let expected = 8 // path_tags padded
            + sub.path_data.len() * 4
            + sub.draw_tags.len() * 4
            + sub.draw_data.len() * 4
            + sub.transforms.len() * 24
            + sub.styles.len() * 8;
        assert_eq!(bytes.len(), expected);
    }

    #[test]
    fn handle_word_counts_match_streams() {
        let sub = make_sub(7, 3);
        let h = sub_handle_for(0, &sub);
        assert_eq!(h.path_tags_words, 2); // 7 bytes → 8-byte (2 word) padded
        assert_eq!(h.path_data_words, 4);
        assert_eq!(h.draw_tags_words, 2);
        assert_eq!(h.draw_data_words, 3);
        assert_eq!(h.transforms_words, 18); // 3 × 6
        assert_eq!(h.styles_words, 2); // 1 × 2
    }

    #[test]
    fn sentinel_handle_offset_is_zero() {
        let sub = Arc::new(Encoding::default());
        let h = sub_handle_for(0, &sub);
        assert_eq!(h.offset, 0);
        // Empty sub has all-zero word counts.
        assert_eq!(h.path_tags_words, 0);
        assert_eq!(h.path_data_words, 0);
    }

    #[test]
    fn intern_idempotent_on_arc_identity() {
        // Pure-Rust check: build the by_ptr map by hand the same way
        // `intern_inner` does. A real device test would duplicate this
        // logic over the wgpu API; the contract is pointer identity.
        let sub_a = make_sub(3, 1);
        let sub_b = sub_a.clone();
        let sub_c = make_sub(3, 1);
        assert_eq!(Arc::as_ptr(&sub_a), Arc::as_ptr(&sub_b));
        assert_ne!(Arc::as_ptr(&sub_a), Arc::as_ptr(&sub_c));
        let mut map: HashMap<usize, u32> = HashMap::new();
        let mut next: u32 = 0;
        let mut record = |s: &Arc<Encoding>| -> u32 {
            let k = Arc::as_ptr(s) as usize;
            *map.entry(k).or_insert_with(|| {
                let o = next;
                next += pack_sub_bytes(s).len() as u32 / 4;
                o
            })
        };
        let o_a = record(&sub_a);
        let o_b = record(&sub_b);
        let o_c = record(&sub_c);
        assert_eq!(o_a, o_b);
        assert_ne!(o_a, o_c);
    }

    #[test]
    fn growth_doubles_until_max() {
        // Replicates the `try_grow` loop without a device. Confirms
        // doubling stops at the first power-of-two that fits and that a
        // request past MAX_CAP is left unsatisfied (signals overflow).
        let mut cap: u64 = INITIAL_CAP;
        let required: u64 = 100 * 1024 * 1024;
        while cap < required && cap < MAX_CAP {
            cap = (cap * 2).min(MAX_CAP);
        }
        assert!(cap >= required);
        assert_eq!(cap, 128 * 1024 * 1024);

        let mut cap2: u64 = INITIAL_CAP;
        let too_big: u64 = 2 * MAX_CAP;
        while cap2 < too_big && cap2 < MAX_CAP {
            cap2 = (cap2 * 2).min(MAX_CAP);
        }
        assert!(cap2 < too_big);
        assert_eq!(cap2, MAX_CAP);
    }
}
