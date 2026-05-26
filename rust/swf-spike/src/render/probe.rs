//! TEMP diagnostic counters for attributing scene-build CPU.
//!
//! Thread-local tallies for the work the body-band walk does that is
//! NOT the inherent Vello fill encoding: mask-path collection (which
//! bypasses both render caches), shape flattening (cache misses), and
//! frame-state builds (cache misses). Lets the `classAtlasBake` log
//! attribute `p1emit` time to optimizable redundancy vs. inherent
//! encoding cost.
//!
//! Single-threaded (wasm32 in browser) so `Cell` is sufficient.
//! Strip once the optimization decision is made.

use std::cell::Cell;

thread_local! {
    static MASK_PATH_CALLS: Cell<u32> = const { Cell::new(0) };
    static MASK_PATH_FLATTENS: Cell<u32> = const { Cell::new(0) };
    static SHAPE_FLATTENS: Cell<u32> = const { Cell::new(0) };
    static FRAME_STATE_MISSES: Cell<u32> = const { Cell::new(0) };
    // Per-(frame,band) build flip counter — reset before a build,
    // peeked after, to detect bfix=true builds that flipped nothing
    // (provably byte-identical to their bfix=false sibling).
    static BFIX_FLIPS: Cell<u32> = const { Cell::new(0) };
    // Aggregate: bfix=true builds that flipped zero placements.
    static BFIX_ZERO_FLIP_BUILDS: Cell<u32> = const { Cell::new(0) };
}

#[derive(Clone, Copy, Default, Debug)]
pub struct ProbeCounts {
    /// `collect_mask_path` invocations (one per clip-mask placement).
    pub mask_path_calls: u32,
    /// `flatten_shape` calls made *inside* mask-path collection — these
    /// bypass the `shape_cmds` cache entirely.
    pub mask_path_flattens: u32,
    /// `flatten_shape` cache misses in the main walk (`shape_cmds`).
    pub shape_flattens: u32,
    /// `build_frame_state` cache misses (`frame_state`).
    pub frame_state_misses: u32,
    /// bfix=true (frame,band) builds that flipped zero placements —
    /// i.e. provably identical to the bfix=false sibling, hence
    /// redundant. The upper bound on what bfix-band dedup can save.
    pub bfix_zero_flip_builds: u32,
}

/// Record a bfix matrix flip (sprite.rs flip site).
#[inline]
pub fn bfix_flip() {
    BFIX_FLIPS.with(|c| c.set(c.get() + 1));
}
/// Reset the per-build flip counter (call before a single
/// `render_body_band_dual` build).
#[inline]
pub fn bfix_flips_reset() {
    BFIX_FLIPS.with(|c| c.set(0));
}
/// Read the per-build flip counter.
#[inline]
pub fn bfix_flips_peek() -> u32 {
    BFIX_FLIPS.with(|c| c.get())
}
/// Tally one zero-flip bfix=true build (redundant).
#[inline]
pub fn note_bfix_zero_flip_build() {
    BFIX_ZERO_FLIP_BUILDS.with(|c| c.set(c.get() + 1));
}

#[inline]
pub fn mask_path_call() {
    MASK_PATH_CALLS.with(|c| c.set(c.get() + 1));
}
#[inline]
pub fn mask_path_flatten() {
    MASK_PATH_FLATTENS.with(|c| c.set(c.get() + 1));
}
#[inline]
pub fn shape_flatten() {
    SHAPE_FLATTENS.with(|c| c.set(c.get() + 1));
}
#[inline]
pub fn frame_state_miss() {
    FRAME_STATE_MISSES.with(|c| c.set(c.get() + 1));
}

pub fn reset() {
    MASK_PATH_CALLS.with(|c| c.set(0));
    MASK_PATH_FLATTENS.with(|c| c.set(0));
    SHAPE_FLATTENS.with(|c| c.set(0));
    FRAME_STATE_MISSES.with(|c| c.set(0));
    BFIX_FLIPS.with(|c| c.set(0));
    BFIX_ZERO_FLIP_BUILDS.with(|c| c.set(0));
}

pub fn take() -> ProbeCounts {
    let counts = ProbeCounts {
        mask_path_calls: MASK_PATH_CALLS.with(|c| c.get()),
        mask_path_flattens: MASK_PATH_FLATTENS.with(|c| c.get()),
        shape_flattens: SHAPE_FLATTENS.with(|c| c.get()),
        frame_state_misses: FRAME_STATE_MISSES.with(|c| c.get()),
        bfix_zero_flip_builds: BFIX_ZERO_FLIP_BUILDS.with(|c| c.get()),
    };
    reset();
    counts
}
