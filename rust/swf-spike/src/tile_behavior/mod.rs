//! Resolve a tile sprite's canonical render behavior by executing its
//! frame-1 AS2 script — and the frame-1 scripts of every multi-frame
//! descendant placed at frame 1 — via `swf-spike::avm1::exec`.
//!
//! ## The chimney-smoke / slope-wrapper insight
//!
//! Canonical Dofus tile sprites are **wrapper sprites**: the linkage-id
//! sprite has `num_frames = 1` and places a *child* sprite that holds
//! the actual timeline. Whether the tile animates is determined by the
//! child's frame-1 script, not the wrapper's:
//!
//! - Ground gfx 5 (slope tile, g1.swf): wrapper places child 1721, and
//!   1721's frame 1 runs `gotoAndStop(random(_totalframes − 1) + 2)`
//!   — child stops at a random slope variant.
//! - Object2 gfx 343 (chimney smoke, o1.swf): wrapper places many
//!   children, several with multi-frame timelines and **no** Stop in
//!   their frame 1 — those genuinely animate.
//!
//! Algorithm: see [`resolve_inner`].
//!
//! ## Per-cell determinism
//!
//! `seed_rng` is called *once* at the top-level entry point. Recursive
//! sub-calls share the advancing thread-local state, so each descendant
//! gets a distinct draw — matching Flash's semantics.

mod resolve;
mod seed;

#[cfg(test)]
mod tests;

use std::collections::HashMap;

use crate::swf_doc::{OwnedSprite, SwfDoc};

use crate::tile_script::ChildScript;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TileBehavior {
    /// Render a single frame, no animator. `frame` is the value to pass
    /// into `render_symbol` — for wrapper sprites whose child stopped
    /// at frame `F`, the renderer passes `F`, and the child gets
    /// `F % child.num_frames` via `ctx.child`'s propagation.
    Static { frame: u16 },
    /// Tick a counter from `start_frame` upward modulo `cycle`.
    Animated { start_frame: u16, cycle: u16 },
}

impl TileBehavior {
    pub fn first_frame(self) -> u16 {
        match self {
            TileBehavior::Static { frame }
            | TileBehavior::Animated {
                start_frame: frame, ..
            } => frame,
        }
    }
}

/// Full per-tile rendering plan returned by [`resolve_full`]. Carries
/// both a static [`TileBehavior`] (used by the renderer to decide what
/// to do at first paint) and a list of [`ChildScript`] state machines
/// for any immediate multi-frame child that needs per-instance AVM1
/// simulation — `onClipEvent(enterFrame)` handlers, per-frame Stop
/// scripts, etc.
#[derive(Debug, Clone)]
pub struct TileResolution {
    pub behavior: TileBehavior,
    /// Children with an `onClipEvent(enterFrame)` handler OR a frame
    /// timeline that's still playing after frame-0 scripts. These need
    /// per-tick AVM1 simulation, so the renderer attaches a
    /// `TileAnimator` and rebuilds the `VelloScene` each frame.
    pub child_scripts: Vec<ChildScript>,
    /// Children whose initial frame-0 script left them stopped and have
    /// no `enterFrame` handler. They'll never change state, so the
    /// renderer just pins them via `render_symbol_with_overrides` once.
    pub child_overrides: HashMap<u16, u16>,
}

pub fn resolve(sprite: &OwnedSprite, doc: &SwfDoc, cell_id: u16) -> TileBehavior {
    resolve_full(sprite, doc, cell_id).behavior
}

/// Same as [`resolve`] but also extracts per-instance script state for
/// every immediate multi-frame child of the wrapper. Callers attaching
/// a `TileAnimator` need this; diagnostic dumps that only want the
/// classification go through [`resolve`].
pub fn resolve_full(sprite: &OwnedSprite, doc: &SwfDoc, cell_id: u16) -> TileResolution {
    resolve::resolve_full(sprite, doc, cell_id)
}

// ---------------------------------------------------------------------------
// wc2 EXTENSIONS — everything ABOVE this line is a byte-verbatim copy of
// wc3's tile_behavior/mod.rs (dofuswebclient3/rust/swf-spike/src/
// tile_behavior/mod.rs); verify with
//   `diff <(head -n <wc3 lines> mod.rs) <wc3 mod.rs>`.
// Everything below is wc2-only surface built ON TOP of the verbatim engine
// (no behavior changes to resolve/classification):
// - `seed_for_cell` re-export: wc3 keeps `mod seed` private (its only
//   consumers live inside tile_behavior); wc2's vello-wasm exposes the seed
//   to JS diagnostics, so we bridge it out.
// - `TileResolution::is_simple_loop` + `overrides_signature`: the wc2
//   strip-atlas fast path + texture-cache keying (no wc3 counterpart —
//   wc3 ticks a TileAnimator per instance).
// - `settled_static_overrides`: byte-identical body to wc3's private fn in
//   bake_body.rs:163 (their bake spine). It moves THERE when bake_body.rs
//   is adopted in unified-atlas Step 3; parked here until then because wc2
//   has no bake_body module yet. Consumers: render/cache.rs (cached),
//   render_settled_static / render_player_tinted bins.
// ---------------------------------------------------------------------------

pub use seed::seed_for_cell;

use crate::swf_doc::Symbol;

impl TileResolution {
    /// Fast-path eligibility: TRUE means a single linear frame counter
    /// reproduces canonical Flash playback exactly, so the consumer can
    /// keep the cheap pre-baked strip-atlas path (`DynamicAt(counter)`
    /// gives every free-running child `counter % child_frames`, which
    /// IS its playhead when nothing can stop or divert it).
    ///
    /// Requires:
    /// - behavior is `Animated` (there is something to tick),
    /// - no one-shot frozen children (`child_overrides` — the strip
    ///   path can't pin per-cell random variants), and
    /// - every simulated child free-runs: playing, no
    ///   `onClipEvent(enterFrame)` trigger, no per-frame DoActions
    ///   (canonical `stop()` parks — chimney elevator o1/343 child
    ///   1361 — make the playhead diverge from elapsed time).
    ///
    /// Anything else needs the per-instance scripted path
    /// (`ChildScript::tick` per render tick).
    pub fn is_simple_loop(&self) -> bool {
        matches!(self.behavior, TileBehavior::Animated { .. })
            && self.child_overrides.is_empty()
            && self
                .child_scripts
                .iter()
                .all(|s| s.playing && !s.has_enter_frame() && !s.has_frame_actions())
    }
}

/// Stable signature of a resolved STATIC variant: the wrapper frame
/// plus every frozen-child pin, order-independent (FNV-1a over the
/// sorted pairs). Two cells whose seeded `gotoAndStop(random(...))`
/// draws landed on the same variant share the same signature — the
/// texture-cache key on the consumer side — so N grass cells collapse
/// to (number of authored variants) bakes.
pub fn overrides_signature(frame: u16, overrides: &HashMap<u16, u16>) -> u32 {
    let mut ordered: Vec<(u16, u16)> = overrides.iter().map(|(&k, &v)| (k, v)).collect();
    ordered.sort_unstable();
    let mut h: u32 = 0x811c_9dc5;
    let mut mix = |v: u16| {
        for b in v.to_le_bytes() {
            h ^= u32::from(b);
            h = h.wrapping_mul(0x0100_0193);
        }
    };
    mix(frame);
    for (k, v) in ordered {
        mix(k);
        mix(v);
    }
    h
}

/// Settled child-frame pins for a `static*` character export.
///
/// CANONICAL SEMANTICS: Dofus 1.29 attaches the idle body with
/// `mc.attachMovie(animation + dir, "clip", 1)`
/// (`GlobalSpriteHandler.applySprite`,
/// assets/sources/client-code/ank/battlefield/GlobalSpriteHandler.as:441-466)
/// and then simply lets Flash RUN the timeline. NPC/monster `static*`
/// exports are 1-frame wrappers whose multi-frame children play a
/// settle-in and park on a `stop()` — Flash keeps showing the stopped
/// frame forever. The only client-side playhead forcing is
/// `recursiveGotoAndStop` (GlobalSpriteHandler.as:505-516, via
/// `onLoadInit`:517-520), which pins children at a STOPPED frame — never
/// rewinds a settled idle to its setup pose. Rendering such children at
/// `parent_frame % child_frames == 0` therefore shows the un-settled
/// setup pose (e.g. NPC gfx 1211 milicien, moskitos 1564/1572).
///
/// This simulates each still-playing child's AVM1 playhead (per-tick
/// `onClipEvent(enterFrame)` + arriving-frame DoActions) until it
/// parks, capped at `SETTLE_CAP` ticks, and returns
/// `child_id → settled 0-based frame` pins for
/// `RenderCtx::with_child_frame_overrides`. Children that never stop
/// (a genuinely looping idle) are left un-pinned so they keep their
/// normal `% num_frames` propagation.
///
/// BODY IS BYTE-IDENTICAL to wc3's `bake_body.rs::settled_static_overrides`
/// (private there); keep them in lockstep until Step 3 adopts bake_body.
///
/// COST: re-runs AVM1 ticks (up to 600 per child) — callers MUST cache
/// the result per (bundle, export); see `RenderCache::settled_overrides`.
pub fn settled_static_overrides(doc: &SwfDoc, sym: &Symbol) -> HashMap<u16, u16> {
    const SETTLE_CAP: u32 = 600;
    let Symbol::Sprite(sprite) = sym else {
        return HashMap::new();
    };
    let mut resolution = resolve_full(sprite, doc, 0);
    let mut overrides = resolution.child_overrides;
    for script in &mut resolution.child_scripts {
        let mut ticks = 0;
        while script.playing && ticks < SETTLE_CAP {
            script.tick();
            ticks += 1;
        }
        if !script.playing {
            overrides.insert(script.child_id, script.current_frame);
        }
    }
    overrides
}
