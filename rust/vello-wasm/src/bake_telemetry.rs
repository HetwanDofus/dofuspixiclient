//! Per-bake instrumentation: phase timings, subscene cache hit/miss,
//! output pixel area, kind classifier.
//!
//! Why this exists: the existing per-call `console.log` lines
//! (`classAtlasBake`, `singleVariantWall`, etc.) are scattered text
//! and hard to aggregate. With 250+ bots and a zoom change triggering
//! hundreds of bakes in a 2-second burst, we need bucketed histograms
//! to know WHERE the time is going — CPU scene build, GPU rasterize,
//! pixel readback, or queue wait — before deciding what to optimize.
//!
//! Cost: one f64 push to a thread-local Vec per bake call. The Vec is
//! capped at 10k entries so a stuck consumer can't grow it unbounded.
//! The user-facing drain returns owned records; subsequent records
//! start a fresh window.
//!
//! Resolution: per-record timings come from `js_sys::Date::now()`
//! (millisecond precision in browsers). Fractional milliseconds are
//! preserved because the f64 subtraction keeps the precision the
//! browser gives us. For sub-ms GPU timing we'd need
//! `performance.now()` via `web_sys::Window::performance` — out of
//! scope for the first cut; current ms granularity is enough to
//! identify the dominant phase.

use std::cell::RefCell;

/// Per-call kind classifier. The set is closed and small (<10) so we
/// don't pay for owning strings on every record.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BakeKind {
    /// `render_swf_class_atlas` — whole-class atlas bake (all
    /// variants packed into one or more pages).
    ClassAtlas,
    /// `render_swf_body_atlas` — single-variant character body bake.
    BodyAtlas,
    /// `render_swf_body_band_atlas` — z-band sub-region bake (rare;
    /// used for occlusion-aware composition).
    BodyBandAtlas,
    /// `render_swf_frame` — single tile frame bake.
    TileFrame,
    /// `render_swf_accessory_strip` — 3-cycle accessory strip bake.
    AccessoryStrip,
    /// `render_swf_strip` / `render_swf_strip_range` — generic SWF
    /// animation strip (spells, FX, etc.).
    Strip,
    /// `render_swf_spell_strip` / `render_swf_spell_icon` — spell
    /// composition bakes.
    SpellComposition,
}

impl BakeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            BakeKind::ClassAtlas => "ClassAtlas",
            BakeKind::BodyAtlas => "BodyAtlas",
            BakeKind::BodyBandAtlas => "BodyBandAtlas",
            BakeKind::TileFrame => "TileFrame",
            BakeKind::AccessoryStrip => "AccessoryStrip",
            BakeKind::Strip => "Strip",
            BakeKind::SpellComposition => "SpellComposition",
        }
    }
}

/// One bake call's measurement. Fields use ms units for timings.
///
/// Subscene hit/miss counts are diagnostic-only: a hit means the
/// scene was reused from the in-memory subscene cache (the L3 layer
/// we just persisted to IDB); a miss means the AS2 walk + scene
/// build ran fresh. Hit count can exceed 1 per bake when a single
/// call composes multiple sub-scenes (class atlas → N variants ×
/// M bands).
#[derive(Clone, Debug, Default)]
pub struct BakeRecord {
    pub kind: &'static str,
    pub bundle: String,
    /// Wall time spent assembling the Vello `Scene` on the CPU — AS2
    /// walk, sub-scene assembly, transform stacking. Excludes
    /// per-bundle enumerate prep (counted separately for class atlas).
    pub scene_build_ms: f64,
    /// Wall time from `render_to_texture` start to GPU work submit
    /// completion. Includes pipeline compile (rare; first-time per
    /// shader) and command-buffer build.
    pub gpu_render_ms: f64,
    /// Time spent moving the result out of WGPU into a JS bitmap or
    /// Pixi-adopted texture. Includes the readback for atlas bakes
    /// that don't share GPU device with Pixi.
    pub bridge_ms: f64,
    /// `enumerate` step for class atlas; zero for other kinds.
    pub enumerate_ms: f64,
    /// `combineCopy` step for class atlas; zero for other kinds.
    pub combine_copy_ms: f64,
    /// `scene_build_ms + gpu_render_ms + bridge_ms + enumerate_ms +
    /// combine_copy_ms` — the per-record sum we use to compute the
    /// dominant phase. Recorded by the call site (not re-derived
    /// here) to keep one source of truth.
    pub total_ms: f64,
    /// Sub-scene cache lookups that hit (skipped AS2 walk).
    pub subscene_hits: u32,
    /// Sub-scene cache lookups that missed (full AS2 walk ran).
    pub subscene_misses: u32,
    /// Final raster pixel area for the bake's primary output
    /// (`width × height`). For class atlases this is the page area;
    /// for variants the variant area; for accessories the strip area.
    /// Used to flag GPU-bound (high px-area, high gpu_ms) vs
    /// CPU-bound (low px-area, high scene_ms) bakes.
    pub pixel_area: u64,
    /// Number of sub-scenes composed in this bake (variants for
    /// class atlas, cycles for accessory strip, 1 for body/tile).
    pub sub_count: u32,
    /// `js_sys::Date::now()` at record time — lets the JS side
    /// correlate with frame ticker timestamps.
    pub ts_recorded: f64,
}

/// Cap on the per-thread record buffer. ~10k entries × ~120 bytes
/// per record ≈ 1.2 MB. Bursts above 10k drop newest records (silent
/// — would otherwise create unbounded memory pressure on a stuck
/// consumer). For a 250-bot zoom burst we see ~700 records, well
/// under this cap.
const MAX_RECORDS: usize = 10_000;

thread_local! {
    static RECORDS: RefCell<Vec<BakeRecord>> = RefCell::new(Vec::with_capacity(2048));
    static ENABLED: RefCell<bool> = const { RefCell::new(true) };
    static DROPS: RefCell<u32> = const { RefCell::new(0) };
    // Per-call subscene-cache hit/miss tally. Each top-level bake
    // entry point should reset these on entry and read them on exit.
    // Single-threaded (wasm32 in browser), so RefCell is fine.
    static SUBSCENE_HITS: RefCell<u32> = const { RefCell::new(0) };
    static SUBSCENE_MISSES: RefCell<u32> = const { RefCell::new(0) };
}

/// Reset per-call subscene counters. Call at the top of every bake
/// entry point that may consult a sub-scene cache.
pub fn subscene_reset() {
    SUBSCENE_HITS.with(|c| *c.borrow_mut() = 0);
    SUBSCENE_MISSES.with(|c| *c.borrow_mut() = 0);
}

/// Note one cache hit (sub-scene reused; no AS2 walk).
pub fn subscene_hit() {
    SUBSCENE_HITS.with(|c| *c.borrow_mut() += 1);
}

/// Note one cache miss (sub-scene built fresh).
pub fn subscene_miss() {
    SUBSCENE_MISSES.with(|c| *c.borrow_mut() += 1);
}

/// Read the per-call subscene counters WITHOUT clearing (diagnostic
/// log reads them before `subscene_take` consumes them for telemetry).
pub fn peek_subscene() -> (u32, u32) {
    let hits = SUBSCENE_HITS.with(|c| *c.borrow());
    let misses = SUBSCENE_MISSES.with(|c| *c.borrow());
    (hits, misses)
}

/// Read and clear the per-call subscene counters.
pub fn subscene_take() -> (u32, u32) {
    let hits = SUBSCENE_HITS.with(|c| std::mem::replace(&mut *c.borrow_mut(), 0));
    let misses = SUBSCENE_MISSES.with(|c| std::mem::replace(&mut *c.borrow_mut(), 0));
    (hits, misses)
}

/// Append a record. No-op if telemetry is disabled.
pub fn record(rec: BakeRecord) {
    ENABLED.with(|e| {
        if !*e.borrow() {
            return;
        }
        RECORDS.with(|r| {
            let mut buf = r.borrow_mut();
            if buf.len() >= MAX_RECORDS {
                DROPS.with(|d| *d.borrow_mut() += 1);
                return;
            }
            buf.push(rec);
        });
    });
}

/// Take every record accumulated since the last drain. Resets the
/// counters; returns dropped count separately so the caller can
/// surface back-pressure.
pub fn drain() -> (Vec<BakeRecord>, u32) {
    let records = RECORDS.with(|r| std::mem::take(&mut *r.borrow_mut()));
    let drops = DROPS.with(|d| std::mem::replace(&mut *d.borrow_mut(), 0));
    (records, drops)
}

#[allow(dead_code)]
pub fn enable(on: bool) {
    ENABLED.with(|e| *e.borrow_mut() = on);
}

/// Helper: small ergonomic builder for the common bake-record shape.
pub struct Builder {
    rec: BakeRecord,
}

impl Builder {
    pub fn new(kind: BakeKind, bundle: &str) -> Self {
        Self {
            rec: BakeRecord {
                kind: kind.as_str(),
                bundle: bundle.to_string(),
                ts_recorded: js_sys::Date::now(),
                ..Default::default()
            },
        }
    }
    pub fn scene_build(mut self, ms: f64) -> Self {
        self.rec.scene_build_ms = ms;
        self
    }
    pub fn gpu_render(mut self, ms: f64) -> Self {
        self.rec.gpu_render_ms = ms;
        self
    }
    pub fn bridge(mut self, ms: f64) -> Self {
        self.rec.bridge_ms = ms;
        self
    }
    pub fn enumerate(mut self, ms: f64) -> Self {
        self.rec.enumerate_ms = ms;
        self
    }
    pub fn combine_copy(mut self, ms: f64) -> Self {
        self.rec.combine_copy_ms = ms;
        self
    }
    pub fn total(mut self, ms: f64) -> Self {
        self.rec.total_ms = ms;
        self
    }
    pub fn subscene(mut self, hits: u32, misses: u32) -> Self {
        self.rec.subscene_hits = hits;
        self.rec.subscene_misses = misses;
        self
    }
    pub fn pixel_area(mut self, area: u64) -> Self {
        self.rec.pixel_area = area;
        self
    }
    pub fn sub_count(mut self, n: u32) -> Self {
        self.rec.sub_count = n;
        self
    }
    pub fn commit(self) {
        record(self.rec);
    }
}
