//! Tier-7 slab crowd render, ported from dofuswebclient3
//! (`actor_batch/world_compose_slab.rs` + `engine/render/plugin/render.rs`).
//! Every unique look is interned ONCE into the renderer-owned SubLibrary;
//! per-frame cost is a descriptor-table rebuild, narrow GPU writes and a
//! single recording replay into the crowd target — no per-actor re-encode,
//! no batch textures, no composite pass.

use std::collections::HashMap;
use std::sync::Arc;

use vello::kurbo::{Affine, BezPath, ParamCurveNearest, Point, Shape};
use vello::wgpu;
use vello::{Renderer, ReuseToken, Scene, SubHandle};
use vello_encoding::{
    SlabBlockGpu, SlabSlotAux, SlabSlotDesc, SlabStreamTotals, Transform, begin_slab_block,
    slab_block_set_slot, slab_block_set_stream_totals,
};

/// Whole-crowd slot capacity. wc3 uses 8192 per band with ~9 emits per
/// actor (segments + accessories); here each emit is one pre-composed
/// look, so 500 actors occupy 500 slots. Emits past the cap are dropped
/// with overflow accounting.
const CROWD_SLOT_COUNT: u32 = 8192;

/// Token namespace keeping slab tokens disjoint from the batch paths'
/// small-integer `ReuseToken(b)` mints on the same renderer.
const SLAB_TOKEN_BASE: u64 = 0x51AB_0000_0000_0000;

/// Frames the live totals must stay below half the pinned reservation
/// before the high-water decays back to the live values (~10 s @60fps).
const DECAY_FRAMES: u64 = 600;

/// Minimum over-reservation (u32 words across all streams) worth a
/// decay; below this the forced `reuse_full` costs more than the
/// memory/zero-upload it reclaims.
const DECAY_MIN_WASTE_WORDS: u64 = 64 * 1024;

/// Grow-only envelope over the slab's per-stream word totals and slot
/// count (port of wc3 `SlabBandHighWater`). Pinning the gap reservations
/// at the envelope keeps `resolve_slabbed`'s packed length and every
/// region offset byte-identical while actors animate, so the fast path's
/// fingerprint compare hits every frame; growth past the envelope changes
/// `packed.len()` and routes through `reuse_full` naturally.
///
/// `draw_info_words` is deliberately NOT pinned: it only feeds
/// `Layout::bin_data_start`, and the replayed recording is rebuilt fresh
/// each frame, so the exact per-frame value is both safe and tighter.
#[derive(Default, Clone, Copy)]
struct SlabHighWater {
    totals: SlabStreamTotals,
    slot_count: u32,
    below_since: Option<u64>,
}

impl SlabHighWater {
    fn observe(
        &mut self,
        live: SlabStreamTotals,
        live_slots: u32,
        frame: u64,
    ) -> (SlabStreamTotals, u32) {
        if self.decay_due(live, live_slots, frame) {
            self.totals = live;
            self.slot_count = live_slots;
            self.below_since = None;
        } else {
            self.totals.path_tags_words = self.totals.path_tags_words.max(live.path_tags_words);
            self.totals.path_data_words = self.totals.path_data_words.max(live.path_data_words);
            self.totals.draw_tags_words = self.totals.draw_tags_words.max(live.draw_tags_words);
            self.totals.draw_data_words = self.totals.draw_data_words.max(live.draw_data_words);
            self.totals.transforms_words = self.totals.transforms_words.max(live.transforms_words);
            self.totals.styles_words = self.totals.styles_words.max(live.styles_words);
            self.slot_count = self.slot_count.max(live_slots);
        }
        let mut pinned = self.totals;
        pinned.draw_info_words = live.draw_info_words;
        (pinned, self.slot_count)
    }

    fn decay_due(&mut self, live: SlabStreamTotals, live_slots: u32, frame: u64) -> bool {
        let below = live_slots <= self.slot_count / 2
            && live.path_tags_words <= self.totals.path_tags_words / 2
            && live.path_data_words <= self.totals.path_data_words / 2
            && live.draw_tags_words <= self.totals.draw_tags_words / 2
            && live.draw_data_words <= self.totals.draw_data_words / 2
            && live.transforms_words <= self.totals.transforms_words / 2
            && live.styles_words <= self.totals.styles_words / 2
            && waste_words(&self.totals, &live) > DECAY_MIN_WASTE_WORDS;
        if !below {
            self.below_since = None;
            return false;
        }
        let since = *self.below_since.get_or_insert(frame);
        frame.wrapping_sub(since) >= DECAY_FRAMES
    }
}

fn waste_words(pinned: &SlabStreamTotals, live: &SlabStreamTotals) -> u64 {
    let sum = |t: &SlabStreamTotals| {
        u64::from(t.path_tags_words)
            + u64::from(t.path_data_words)
            + u64::from(t.draw_tags_words)
            + u64::from(t.draw_data_words)
            + u64::from(t.transforms_words)
            + u64::from(t.styles_words)
    };
    sum(pinned).saturating_sub(sum(live))
}

/// One slot in paint order: the COMPACT interned-sub handle (bytes already
/// live in the SubLibrary), this actor's world placement, and — for a body
/// sub baked colour-agnostically — the actor's per-zone palette applied via
/// the slab colour overlay (`None` for accessories, whose colours are baked
/// in). No `Arc<Encoding>` is retained — that was the heap blow-up.
#[derive(Clone, Copy)]
pub(crate) struct SlabEmit {
    pub look: CachedLook,
    pub world: Affine,
    /// Per-zone RGBA (`[zone1, zone2, zone3]`) for a colour-agnostic body
    /// sub; the slab expander patches it in per `ZonePatchGpu`. `None`
    /// leaves the sub's authored colours.
    pub overlay: Option<[[u8; 4]; 3]>,
}

/// One slot of a cached look layout (port of wc3's body segments + mount
/// accessories). A look's full layout is the ordered list of these; each
/// references a SHARED interned sub (body band or accessory), so all actors
/// with the same body/accessory reuse the same handle.
#[derive(Clone)]
pub(crate) struct LayoutSlot {
    pub look: CachedLook,
    pub is_body: bool,
    /// Per-frame mount transform for accessory slots (`None` for body
    /// bands). The accessory sub is interned pose-agnostic; this is composed
    /// onto the actor's `place` at emit time (`place * mount`) so the
    /// accessory tracks its swinging anchor across the walk cycle. Stored per
    /// layout, which is itself cached per `(sig|frame)`, so it animates.
    pub acc_mount_world: Option<vello::kurbo::Affine>,
    /// Colour-independent draw-op geometry for this sub, shared (`Arc`) with
    /// every actor reusing the same interned sub. Parsed lazily on first
    /// pick (see `crowd_blob::HitLazy`); used only by [`hit_test`].
    pub hit: Arc<crate::crowd_blob::HitLazy>,
}

/// What the crowd caches per unique `(sig|frame)` look: the SubLibrary
/// handle (offset + per-stream word counts) and the three encoding-level
/// counts the slab block needs. ~72 bytes — vs the ~30-60 KB `vello::Scene`
/// + cloned `Arc<Encoding>` the old path pinned per look.
#[derive(Clone, Copy)]
pub(crate) struct CachedLook {
    pub handle: SubHandle,
    pub n_paths: u32,
    pub n_path_segments: u32,
    pub n_clips: u32,
}

/// One actor's hit-test record, captured in paint order each crowd tick: the
/// actor's index (returned on a hit), its world placement `place`, and the
/// cached layout slots (each carrying the shared per-sub hit geometry). The
/// hit test inverts `world` then each op's `xform` to map the cursor into
/// path-local space — exactly the inverse of the compose's `place * xform`.
pub(crate) struct HitActor {
    pub idx: u32,
    pub world: Affine,
    pub slots: Arc<Vec<LayoutSlot>>,
}

#[derive(Default, Clone, Copy)]
pub(crate) struct SlabFrameStats {
    pub slots_used: u32,
    pub overflow: u32,
    pub fast: bool,
    pub resolve_ms: f64,
    /// Full path: `prepare_reuse` upload. Fast path: narrow writes.
    pub upload_ms: f64,
    pub replay_ms: f64,
    pub packed_kb: f64,
}

/// Fingerprints of the retained GPU-resident scene buffer. A mismatch on
/// any field means the narrow writes would target stale bytes — fall back
/// to a full `prepare_reuse`.
struct RetainedSlab {
    token: ReuseToken,
    packed_len: usize,
    transform_len: u64,
    descriptor_slab_base: u32,
    descriptor_slab_size: u32,
    n_slab_blocks: u32,
    /// Per-block `(path_tags, draw_tags)` live word totals of the LAST
    /// rendered frame — the tag-tail zeroing reference.
    prev_live: Vec<(u32, u32)>,
}

#[derive(Default)]
pub(crate) struct SlabCrowdState {
    /// Per-SUB cache: a colour-agnostic body band or accessory's stable key
    /// → interned handle + counts. Body bands key on `(gfx,export,frame,
    /// flip,band)` and accessories on `(bundle,export,slot,side,frame,flip)`
    /// — NO colour in the key, so every actor sharing a body/accessory reuses
    /// one interned sub (the dedup that bounds the SubLibrary: 24 breeds ×
    /// 8 dir × frames × bands, not 300 unique full looks × frames). Tiny
    /// entries; cleared on crowd (re)setup.
    handle_by_look: HashMap<String, CachedLook>,
    /// Parallel to `handle_by_look`: the same sub key → its colour-independent
    /// hit geometry, shared (`Arc`) across every actor reusing the sub.
    /// Populated alongside `cache_sub`; read into each `LayoutSlot::hit`.
    hit_by_sub: HashMap<String, Arc<crate::crowd_blob::HitLazy>>,
    /// Per-look LAYOUT cache: `(sig|frame)` → the ordered slot list (body
    /// bands + accessories) referencing shared sub handles. Built once per
    /// distinct look+frame via the split bake; subsequent actors with the
    /// same look+frame reuse it with zero SWF walk.
    layout_by_sig: HashMap<String, std::sync::Arc<Vec<LayoutSlot>>>,
    /// Per-signature fallback: `sig` (look+anim+direction, frame-agnostic) →
    /// the most-recently-built layout. When an actor's exact `(sig|frame)`
    /// layout isn't built yet and the bake budget is spent, it renders this
    /// nearby frame's layout instead of vanishing — crowd stays full,
    /// animation catches up as frames warm.
    fallback_layout_by_sig: HashMap<String, std::sync::Arc<Vec<LayoutSlot>>>,
    /// OFF-THREAD BAKE: per-actor (by index) last successfully-rendered layout.
    /// When an actor reaches a `(sig|frame)` whose look isn't baked yet AND the
    /// per-direction `fallback_layout_by_sig` has nothing (first sight of a new
    /// DIRECTION — the common roam case), it renders this last pose instead of
    /// VANISHING. Briefly stale (wrong frame/dir for a few frames) but never a
    /// disappear/flicker; snaps correct once the worker bake lands.
    last_layout_by_idx: HashMap<u32, std::sync::Arc<Vec<LayoutSlot>>>,
    /// Per-actor hit records rebuilt every crowd tick (front-to-back paint
    /// order). Cleared before the per-actor loop and pushed one entry per
    /// drawn actor; read back-to-front by [`hit_test`].
    pub(crate) hit_actors: Vec<HitActor>,
    high_water: SlabHighWater,
    retained: Option<RetainedSlab>,
    frame: u64,
    token_seq: u64,
    pub(crate) last: SlabFrameStats,
    diag: CrowdDiag,
    /// OFF-THREAD BAKE. When true, the emit loop NEVER bakes synchronously on
    /// a `(sig|frame)` miss: it records the look in `pending_bakes` for the
    /// JS-driven worker pool and renders the last-good same-direction frame
    /// (or skips a never-seen direction until its first bake lands). Default
    /// false → the proven synchronous bake. Toggled via `setCrowdOffThreadBake`
    /// once the worker pool is up AND the crowd renderer is draining pending.
    off_thread_bake: bool,
    /// Looks (`sig_key`) whose bake has been handed to JS this run and not yet
    /// completed — so the emit loop enqueues each miss exactly once instead of
    /// every frame while it's in flight. Cleared per entry on `mark_baked`.
    requested: std::collections::HashSet<String>,
    /// Misses recorded this frame for JS to drain via `crowdTakePendingBakes`.
    pending_bakes: Vec<PendingBake>,
}

/// One accessory descriptor carried in a [`PendingBake`] (mirror of the
/// look's `LookAcc`, kept primitive so this module stays independent of
/// `lib.rs`).
pub(crate) struct PendingAcc {
    pub bundle: String,
    pub export: String,
    pub slot: u8,
    pub anim_type: u8,
}

/// A look the emit loop couldn't render from cache, queued for the off-thread
/// baker. Carries everything `bakeCrowdLook` needs plus the cache keys the
/// returned blob is interned under.
pub(crate) struct PendingBake {
    pub bundle: String,
    pub export: String,
    pub frame: u16,
    pub flipped: bool,
    pub acc: Vec<PendingAcc>,
    pub layout_sig: String,
    pub sig_key: String,
}

/// Rolling crowd diagnostics. Accumulated per frame and flushed to the console
/// (`client::crowd`) once a second, plus an immediate HITCH line on any frame
/// that could stutter — so the live render's behaviour is fully traceable.
#[derive(Default)]
struct CrowdDiag {
    frames: u32,
    interned: u32,
    layouts: u32,
    full: u32,
    build_ms_sum: f64,
    build_ms_max: f64,
    run_ms_sum: f64,
    run_ms_max: f64,
    slots_max: u32,
    overflow: u32,
}

impl SlabCrowdState {
    /// Accumulate one frame of crowd stats; flush a per-second summary to the
    /// console (`client::crowd`) and emit an immediate HITCH line on any frame
    /// that could drop (intern burst, overflow, reuse_full, slow CPU build).
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn diag_record(
        &mut self,
        interned: u32,
        layouts: u32,
        slots: u32,
        overflow: u32,
        build_ms: f64,
        sublib_used: u64,
        unique_subs: u64,
        n_actors: u32,
    ) {
        let run_ms = self.last.replay_ms;
        let full = !self.last.fast;
        let frame = self.frame;
        let sublib_mb = sublib_used as f64 / 1_048_576.0;
        if overflow > 0 || interned > 40 || build_ms > 3.0 || full {
            web_sys::console::warn_1(
                &format!(
                    "[crowd] HITCH f={frame} interned={interned} layouts={layouts} slots={slots} overflow={overflow} reuse_full={full} buildMs={build_ms:.2} runMs={run_ms:.2} sublibMB={sublib_mb:.1} subs={unique_subs}",
                )
                .into(),
            );
        }
        let d = &mut self.diag;
        d.frames += 1;
        d.interned += interned;
        d.layouts += layouts;
        if full {
            d.full += 1;
        }
        d.build_ms_sum += build_ms;
        d.build_ms_max = d.build_ms_max.max(build_ms);
        d.run_ms_sum += run_ms;
        d.run_ms_max = d.run_ms_max.max(run_ms);
        d.slots_max = d.slots_max.max(slots);
        d.overflow += overflow;
        if d.frames >= 60 {
            let bf = d.frames as f64;
            web_sys::console::log_1(
                &format!(
                    "[crowd {}f] actors={n_actors} slots<={} reuse_full={}/{} interned={} layouts={} subs={unique_subs} sublibMB={sublib_mb:.1} buildMs(avg={:.2} max={:.2}) runMs(avg={:.2} max={:.2}) overflow={}",
                    d.frames, d.slots_max, d.full, d.frames, d.interned, d.layouts,
                    d.build_ms_sum / bf, d.build_ms_max, d.run_ms_sum / bf, d.run_ms_max, d.overflow,
                )
                .into(),
            );
            *d = CrowdDiag::default();
        }
    }

    pub(crate) fn cached_sub(&self, key: &str) -> Option<CachedLook> {
        self.handle_by_look.get(key).copied()
    }

    /// True when a sub's geometry AND hit record are both already interned,
    /// so the bake can skip re-encoding it (the caller reuses the handle).
    /// `cache_sub`+`cache_hit` are always inserted together, so this is the
    /// "don't re-encode this sub" signal the emit path checks.
    pub(crate) fn has_sub(&self, key: &str) -> bool {
        self.handle_by_look.contains_key(key) && self.hit_by_sub.contains_key(key)
    }

    pub(crate) fn cache_sub(&mut self, key: String, look: CachedLook) {
        self.handle_by_look.insert(key, look);
    }

    pub(crate) fn cached_hit(&self, key: &str) -> Option<Arc<crate::crowd_blob::HitLazy>> {
        self.hit_by_sub.get(key).cloned()
    }

    pub(crate) fn cache_hit(&mut self, key: String, hit: Arc<crate::crowd_blob::HitLazy>) {
        self.hit_by_sub.insert(key, hit);
    }

    pub(crate) fn cached_layout(&self, key: &str) -> Option<std::sync::Arc<Vec<LayoutSlot>>> {
        self.layout_by_sig.get(key).cloned()
    }

    pub(crate) fn fallback_layout(&self, sig: &str) -> Option<std::sync::Arc<Vec<LayoutSlot>>> {
        self.fallback_layout_by_sig.get(sig).cloned()
    }

    /// The actor's last successfully-rendered layout (off-thread anti-flicker).
    pub(crate) fn last_layout(&self, idx: u32) -> Option<std::sync::Arc<Vec<LayoutSlot>>> {
        self.last_layout_by_idx.get(&idx).cloned()
    }
    pub(crate) fn set_last_layout(&mut self, idx: u32, layout: std::sync::Arc<Vec<LayoutSlot>>) {
        self.last_layout_by_idx.insert(idx, layout);
    }

    pub(crate) fn cache_layout(
        &mut self,
        sig: &str,
        key: String,
        layout: std::sync::Arc<Vec<LayoutSlot>>,
    ) {
        self.fallback_layout_by_sig
            .insert(sig.to_owned(), layout.clone());
        self.layout_by_sig.insert(key, layout);
    }

    pub(crate) fn unique_looks(&self) -> usize {
        self.handle_by_look.len()
    }

    // ── off-thread bake ────────────────────────────────────────────────

    pub(crate) fn off_thread_bake_enabled(&self) -> bool {
        self.off_thread_bake
    }

    pub(crate) fn set_off_thread_bake(&mut self, on: bool) {
        self.off_thread_bake = on;
        if !on {
            // Returning to synchronous bakes: drop any queued/in-flight
            // requests so the emit loop bakes them itself next frame.
            self.requested.clear();
            self.pending_bakes.clear();
        }
    }

    /// Queue a `(sig|frame)` miss for the off-thread baker, exactly once per
    /// in-flight window. Returns false if it was already requested.
    pub(crate) fn record_pending_bake(&mut self, bake: PendingBake) -> bool {
        if self.requested.contains(&bake.sig_key) {
            return false;
        }
        self.requested.insert(bake.sig_key.clone());
        self.pending_bakes.push(bake);
        true
    }

    /// Drain the looks queued since the last call (the JS worker-pool driver
    /// dispatches these). The `requested` guard persists so they aren't
    /// re-enqueued until `mark_baked`.
    pub(crate) fn take_pending_bakes(&mut self) -> Vec<PendingBake> {
        std::mem::take(&mut self.pending_bakes)
    }

    /// A queued look finished baking (interned, or fell back to a sync bake):
    /// clear its in-flight guard so a later eviction could re-request it.
    pub(crate) fn mark_baked(&mut self, sig_key: &str) {
        self.requested.remove(sig_key);
    }

    /// Point-in-path hit test in crowd-texture pixel space — port of wc3's
    /// `actor_batch/hit_test.rs`. Walks the actors front-to-back (reverse paint
    /// order), maps the cursor into each actor's local space (`inv(world)`) and
    /// each op's path-local space (`inv(xform)`), and tests fills with
    /// `path.contains` and strokes against their centerline. Returns the first
    /// hit actor's `idx`, or `-1` on a miss.
    pub(crate) fn hit_test(&self, x: f64, y: f64) -> i32 {
        let p = Point::new(x, y);
        for actor in self.hit_actors.iter().rev() {
            let Some(inv_world) = invert(actor.world) else {
                continue;
            };
            let look_pt = inv_world * p;
            for slot in actor.slots.iter() {
                // `geom()` parses the silhouette on first touch (rare — only on
                // a click), then caches it.
                for g in slot.hit.geom() {
                    if op_contains_point(&g.path, g.xform, g.stroke_width, look_pt) {
                        return actor.idx as i32;
                    }
                }
            }
        }
        -1
    }

    /// Drop all retained slab state: frees the resident scene buffer,
    /// resets the SubLibrary + pinned ramp/atlas caches, drops the sub +
    /// layout caches, and forgets the envelope. Call on crowd (re)setup —
    /// the pinned caches are append-only within a crowd lifetime (wc3 resets
    /// per MapEpoch for the same reason); interned handles go stale the
    /// moment the SubLibrary is reset, so they must be dropped together.
    pub(crate) fn reset(&mut self, renderer: &mut Renderer) {
        if let Some(r) = self.retained.take() {
            renderer.free_reused(r.token);
        }
        renderer.reset_slab_interns();
        self.handle_by_look.clear();
        self.hit_by_sub.clear();
        self.hit_actors.clear();
        self.layout_by_sig.clear();
        self.fallback_layout_by_sig.clear();
        self.last_layout_by_idx.clear();
        self.high_water = SlabHighWater::default();
        self.frame = 0;
        // Off-thread queues reference looks interned into the now-reset
        // SubLibrary — drop them so stale in-flight requests don't intern
        // against the new crowd. (`off_thread_bake` is config, kept.)
        self.requested.clear();
        self.pending_bakes.clear();
    }

}

struct SlotEmit {
    handle: SubHandle,
    world: Affine,
    n_paths: u32,
    n_path_segments: u32,
    n_clips: u32,
    overlay: Option<[[u8; 4]; 3]>,
}

/// Build the whole-crowd slab scene. `emits` must already be in paint
/// order (back-to-front Y sort): the GPU expander tight-packs geometry by
/// slot index, so slot order IS paint order. Returns the scene plus
/// `(slots_used, overflow)`.
pub(crate) fn build_crowd_slab_scene(
    renderer: &mut Renderer,
    state: &mut SlabCrowdState,
    emits: &[SlabEmit],
) -> (Scene, u32, u32) {
    state.frame += 1;
    renderer.sub_library_frame_step();
    let mut scene = Scene::new();
    let mut used = 0u32;
    let mut overflow = 0u32;

    // Pass 1: assign slots in emit order. Handles are already interned
    // (by the caller's compact bake-and-cache); a sentinel handle
    // (offset 0 = bake skipped/failed) still occupies its slot so later
    // emits keep their layering position.
    let mut slots: Vec<Option<SlotEmit>> = Vec::with_capacity(emits.len());
    for emit in emits {
        if slots.len() >= CROWD_SLOT_COUNT as usize {
            overflow += 1;
            continue;
        }
        if emit.look.handle.offset == 0 {
            overflow += 1;
            slots.push(None);
            continue;
        }
        slots.push(Some(SlotEmit {
            handle: emit.look.handle,
            world: emit.world,
            n_paths: emit.look.n_paths,
            n_path_segments: emit.look.n_path_segments,
            n_clips: emit.look.n_clips,
            overlay: emit.overlay,
        }));
    }
    let live_slot_count = u32::try_from(slots.len())
        .unwrap_or(0)
        .clamp(1, CROWD_SLOT_COUNT);

    // Live totals walk over surviving slots only — counting failed
    // interns would inflate `n_paths`/`n_draw_objects` and make the GPU
    // read words past the real draw-tag gap as tags.
    let mut live = SlabStreamTotals::default();
    let mut n_paths: u32 = 0;
    let mut n_path_segments: u32 = 0;
    let mut n_clips: u32 = 0;
    for slot_emit in slots.iter().filter_map(|s| s.as_ref()) {
        let h = &slot_emit.handle;
        live.path_tags_words = live.path_tags_words.saturating_add(h.path_tags_words);
        live.path_data_words = live.path_data_words.saturating_add(h.path_data_words);
        live.draw_tags_words = live.draw_tags_words.saturating_add(h.draw_tags_words);
        live.draw_data_words = live.draw_data_words.saturating_add(h.draw_data_words);
        live.transforms_words = live.transforms_words.saturating_add(h.transforms_words);
        live.styles_words = live.styles_words.saturating_add(h.styles_words);
        live.draw_info_words = live.draw_info_words.saturating_add(h.draw_info_words);
        n_paths = n_paths.saturating_add(slot_emit.n_paths);
        n_path_segments = n_path_segments.saturating_add(slot_emit.n_path_segments);
        n_clips = n_clips.saturating_add(slot_emit.n_clips);
    }
    {
        let enc = scene.encoding_mut();
        enc.n_paths = enc.n_paths.saturating_add(n_paths);
        enc.n_path_segments = enc.n_path_segments.saturating_add(n_path_segments);
        enc.n_clips = enc.n_clips.saturating_add(n_clips);
    }

    // Reserve the block at the grow-only high-water envelope, not the
    // live size: a constant slot count + constant per-stream gap keeps
    // the packed byte layout identical while actors animate.
    let (pinned_totals, pinned_slot_count) =
        state.high_water.observe(live, live_slot_count, state.frame);
    let block_idx = begin_slab_block(scene.encoding_mut(), pinned_slot_count);
    let transforms_base = scene.encoding().instance_slab_blocks[block_idx].transforms_base;

    // Pass 2: walk live slots in order, compute per-stream prefix sums
    // for the tight-pack layout, write each slot's descriptor / aux /
    // world transform. Empty (sentinel) slots contribute nothing.
    let mut pt_running: u32 = 0;
    let mut pd_running: u32 = 0;
    let mut dt_running: u32 = 0;
    let mut dd_running: u32 = 0;
    let mut st_running: u32 = 0;
    let mut xf_running: u32 = 0;
    for (slot_idx, slot) in slots.iter().enumerate() {
        let Some(slot_emit) = slot.as_ref() else {
            continue;
        };
        let handle = &slot_emit.handle;
        let slot = slot_idx as u32;
        let desc = SlabSlotDesc {
            sub_offset: handle.offset,
            transform_idx: transforms_base + slot,
            // Body subs are baked colour-agnostic with `ZonePatchGpu`
            // records; the per-zone palette rides in via the per-slot
            // colour overlay below. The shader gates the patch apply on
            // `zone_patches_count`, so this descriptor field is left inert.
            color_overlay_idx: u32::MAX,
            path_tags_words: handle.path_tags_words,
            path_data_words: handle.path_data_words,
        };
        let aux = SlabSlotAux {
            draw_tags_words: handle.draw_tags_words,
            draw_data_words: handle.draw_data_words,
            transforms_words: handle.transforms_words,
            styles_words: handle.styles_words,
            zone_patches_offset: handle.zone_patches_offset,
            zone_patches_count: handle.zone_patches_count,
            path_tags_dst_words: pt_running,
            path_data_dst_words: pd_running,
            draw_tags_dst_words: dt_running,
            draw_data_dst_words: dd_running,
            styles_dst_words: st_running,
            transforms_dst_words: xf_running,
        };
        slab_block_set_slot(
            scene.encoding_mut(),
            block_idx,
            slot,
            desc,
            aux,
            Transform::from_kurbo(&slot_emit.world),
            slot_emit.overlay,
        );
        pt_running = pt_running.saturating_add(handle.path_tags_words);
        pd_running = pd_running.saturating_add(handle.path_data_words);
        dt_running = dt_running.saturating_add(handle.draw_tags_words);
        dd_running = dd_running.saturating_add(handle.draw_data_words);
        st_running = st_running.saturating_add(handle.styles_words);
        xf_running = xf_running.saturating_add(handle.transforms_words);
        used += 1;
    }
    slab_block_set_stream_totals(scene.encoding_mut(), block_idx, pinned_totals);
    {
        // The expander rewrites `[0, live)` of each gap every frame; the
        // render side zeroes the pinned gap's `[live, prev_live)` tail
        // for the two tag streams (stale tags mint phantom paths / draw
        // objects). Stash the live totals it needs.
        let block = &mut scene.encoding_mut().instance_slab_blocks[block_idx];
        block.live_path_tags_words = live.path_tags_words;
        block.live_draw_tags_words = live.draw_tags_words;
    }
    state.last = SlabFrameStats {
        slots_used: used,
        overflow,
        ..Default::default()
    };
    (scene, used, overflow)
}

/// Resolve + render the slab scene with reuse: fast path narrow-writes
/// only the descriptor/aux/transform/overlay regions and replays the
/// retained recording; any fingerprint miss re-prepares the resident
/// buffer in full. Port of wc3 `render_with_reuse` for a single
/// whole-crowd "band".
pub(crate) fn render_crowd_slab(
    renderer: &mut Renderer,
    state: &mut SlabCrowdState,
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    scene: &Scene,
    params: &vello::RenderParams,
    texture: &wgpu::TextureView,
) -> Result<(), vello::Error> {
    let t_resolve = web_time::Instant::now();
    let resolved = renderer.resolve_scene_reuse(scene, params);
    state.last.resolve_ms = t_resolve.elapsed().as_secs_f64() * 1000.0;
    state.last.packed_kb = resolved.packed.len() as f64 / 1024.0;

    if resolved.layout.n_paths == 0 && resolved.layout.n_slab_blocks == 0 {
        // Empty crowd: the caller hides the crowd sprite; the stale
        // texture content is never sampled, so skip the pipeline.
        if let Some(r) = state.retained.take() {
            renderer.free_reused(r.token);
        }
        return Ok(());
    }

    if let Some(r) = state.retained.take() {
        let layout_matches = r.packed_len == resolved.packed.len()
            && r.transform_len == resolved.transform_len()
            && r.descriptor_slab_base == resolved.layout.descriptor_slab_base
            && r.descriptor_slab_size == resolved.layout.descriptor_slab_size
            && r.n_slab_blocks == resolved.layout.n_slab_blocks
            && renderer.reuse_structure_matches(r.token, &resolved);
        if layout_matches {
            let t_upload = web_time::Instant::now();
            run_fast_writes(renderer, queue, &resolved, r.token, &r.prev_live, scene);
            state.last.upload_ms = t_upload.elapsed().as_secs_f64() * 1000.0;
            let t_replay = web_time::Instant::now();
            let result = renderer.reuse_replay(
                device,
                queue,
                r.token,
                &resolved.recording,
                resolved.scene_buf,
                resolved.out_image,
                texture,
                resolved.sub_library_proxy,
                resolved.slab_image_proxies,
            );
            state.last.replay_ms = t_replay.elapsed().as_secs_f64() * 1000.0;
            state.last.fast = true;
            state.retained = Some(RetainedSlab {
                prev_live: slab_live_words(scene),
                ..r
            });
            return result;
        }
        renderer.free_reused(r.token);
    }

    state.token_seq += 1;
    let token = ReuseToken(SLAB_TOKEN_BASE | state.token_seq);
    let t_prepare = web_time::Instant::now();
    renderer.prepare_reuse(device, queue, token, &resolved);
    state.last.upload_ms = t_prepare.elapsed().as_secs_f64() * 1000.0;
    let t_replay = web_time::Instant::now();
    let result = renderer.reuse_replay(
        device,
        queue,
        token,
        &resolved.recording,
        resolved.scene_buf,
        resolved.out_image,
        texture,
        resolved.sub_library_proxy,
        resolved.slab_image_proxies,
    );
    state.last.replay_ms = t_replay.elapsed().as_secs_f64() * 1000.0;
    state.last.fast = false;
    if result.is_ok() {
        state.retained = Some(RetainedSlab {
            token,
            packed_len: resolved.packed.len(),
            transform_len: resolved.transform_len(),
            descriptor_slab_base: resolved.layout.descriptor_slab_base,
            descriptor_slab_size: resolved.layout.descriptor_slab_size,
            n_slab_blocks: resolved.layout.n_slab_blocks,
            prev_live: slab_live_words(scene),
        });
    }
    result
}

/// Per-block `(path_tags, draw_tags)` LIVE word totals stamped by the
/// compose, in block order.
fn slab_live_words(scene: &Scene) -> Vec<(u32, u32)> {
    scene
        .encoding()
        .instance_slab_blocks
        .iter()
        .map(|b| (b.live_path_tags_words, b.live_draw_tags_words))
        .collect()
}

/// Fast-path narrow writes: the descriptor slab + aux slab + per-slot
/// transforms + overlays cover every byte the GPU pre-pass and shaders
/// read across frames; everything else is resident. Descriptor/aux
/// bases+sizes are u32 WORDS, xform/overlay bases+sizes are BYTES —
/// don't confuse the two (a 4x drift silently clobbers neighbors).
fn run_fast_writes(
    renderer: &mut Renderer,
    queue: &wgpu::Queue,
    resolved: &vello::ResolvedReuse,
    token: ReuseToken,
    prev_live: &[(u32, u32)],
    scene: &Scene,
) {
    let layout = &resolved.layout;
    if layout.n_slab_blocks == 0 {
        if !resolved.packed.is_empty() {
            renderer.reuse_write(queue, token, 0, &resolved.packed);
        }
        return;
    }
    if layout.descriptor_slab_size > 0 {
        let base = layout.descriptor_slab_base as usize * 4;
        let size = layout.descriptor_slab_size as usize * 4;
        renderer.reuse_write(
            queue,
            token,
            base as u64,
            &resolved.packed[base..base + size],
        );
    }
    if layout.aux_slab_size > 0 {
        let base = layout.aux_slab_base as usize * 4;
        let size = layout.aux_slab_size as usize * 4;
        renderer.reuse_write(
            queue,
            token,
            base as u64,
            &resolved.packed[base..base + size],
        );
    }
    if layout.instance_xform_size > 0 {
        let base = layout.instance_xform_base as usize;
        let size = layout.instance_xform_size as usize;
        renderer.reuse_write(
            queue,
            token,
            base as u64,
            &resolved.packed[base..base + size],
        );
    }
    if layout.instance_overlay_size > 0 {
        let base = layout.instance_overlay_base as usize;
        let size = layout.instance_overlay_size as usize;
        renderer.reuse_write(
            queue,
            token,
            base as u64,
            &resolved.packed[base..base + size],
        );
    }
    // The gap reservations are pinned at the high-water envelope while
    // the GPU expander only rewrites `[0, live)` of each tag stream's
    // gap. When a block's live total shrinks, `[live_now, live_prev)`
    // still holds last frame's tag bytes — zero the delta. Only the two
    // TAG streams need this: the other streams are reached solely
    // through tag-derived cursors.
    let sbb = layout.slab_blocks_base as usize * 4;
    let sbe = sbb + layout.n_slab_blocks as usize * std::mem::size_of::<SlabBlockGpu>();
    let blocks_gpu: &[SlabBlockGpu] = bytemuck::cast_slice(&resolved.packed[sbb..sbe]);
    for (i, block) in scene.encoding().instance_slab_blocks.iter().enumerate() {
        let (prev_pt, prev_dt) = prev_live.get(i).copied().unwrap_or((0, 0));
        let Some(gpu) = blocks_gpu.get(i) else {
            continue;
        };
        for (gap_offset, live, prev) in [
            (
                gpu.gap_path_tags_offset,
                block.live_path_tags_words,
                prev_pt,
            ),
            (
                gpu.gap_draw_tags_offset,
                block.live_draw_tags_words,
                prev_dt,
            ),
        ] {
            if live < prev {
                let zeros = vec![0u8; (prev - live) as usize * 4];
                renderer.reuse_write(
                    queue,
                    token,
                    (gap_offset as u64 + u64::from(live)) * 4,
                    &zeros,
                );
            }
        }
    }
}

/// Hit test one captured draw op the way Flash paints it: a fill hits on its
/// interior (point-in-path), a stroke hits within `width/2` of its CENTERLINE.
/// Port of wc3 `actor_batch/hit_test.rs::op_contains_point`. `p` is already in
/// the sub's scene space; `transform` maps path-local → scene.
fn op_contains_point(path: &BezPath, transform: Affine, stroke_width: Option<f64>, p: Point) -> bool {
    let Some(inv) = invert(transform) else {
        return false;
    };
    let lp = inv * p;
    let bb = path.bounding_box();
    match stroke_width {
        None => bb.contains(lp) && path.contains(lp),
        Some(w) => {
            // Half-width plus ~half a pixel of antialiasing slop, in path-local
            // units (the transform is uniform-ish; use the mean scale).
            let scale = transform.determinant().abs().sqrt().max(f64::EPSILON);
            let r = (w.max(1.0 / scale)) * 0.5 + 0.5 / scale;
            if !bb.inflate(r, r).contains(lp) {
                return false;
            }
            let r2 = r * r;
            path.segments()
                .any(|seg| seg.nearest(lp, 0.05).distance_sq <= r2)
        }
    }
}

/// kurbo's `inverse()` panics on a singular matrix; degenerate (zero-scale)
/// placements exist in authored SWFs, so guard.
fn invert(a: Affine) -> Option<Affine> {
    if a.determinant().abs() < 1e-12 {
        None
    } else {
        Some(a.inverse())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn totals(scale: u32) -> SlabStreamTotals {
        SlabStreamTotals {
            path_tags_words: 10 * scale,
            path_data_words: 100_000 * scale,
            draw_tags_words: 20 * scale,
            draw_data_words: 30 * scale,
            transforms_words: 60 * scale,
            styles_words: 4 * scale,
            draw_info_words: 20 * scale,
        }
    }

    #[test]
    fn envelope_grows_and_pins() {
        let mut hw = SlabHighWater::default();
        let (p1, s1) = hw.observe(totals(2), 8, 0);
        assert_eq!(p1.path_data_words, 200_000);
        assert_eq!(s1, 8);
        let (p2, s2) = hw.observe(totals(1), 5, 1);
        assert_eq!(p2.path_data_words, 200_000);
        assert_eq!(s2, 8);
        assert_eq!(p2.draw_info_words, 20);
        let (p3, s3) = hw.observe(totals(3), 9, 2);
        assert_eq!(p3.path_data_words, 300_000);
        assert_eq!(s3, 9);
    }

    #[test]
    fn decay_requires_sustained_undershoot() {
        let mut hw = SlabHighWater::default();
        let _ = hw.observe(totals(4), 16, 0);
        for f in 1..=DECAY_FRAMES {
            let (p, _) = hw.observe(totals(1), 4, f);
            assert_eq!(p.path_data_words, 400_000);
        }
        let (p, s) = hw.observe(totals(1), 4, DECAY_FRAMES + 1);
        assert_eq!(p.path_data_words, 100_000);
        assert_eq!(s, 4);
    }
}
