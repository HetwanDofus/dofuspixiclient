//! Resolve a wrapper sprite's canonical render behavior by executing
//! its frame-1 AS2 script — and the frame-1 scripts of every
//! multi-frame descendant placed at frame 1 — via `swf-spike::avm1::exec`.
//! Ported from wc3's validated implementation
//! (`dofuswebclient3/rust/swf-spike/src/tile_behavior/`).
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
//! Character `static*` exports follow the same wrapper pattern: a
//! 1-frame export placing multi-frame children that play a settle-in
//! then `stop()`. See [`settled_static_overrides`].
//!
//! Algorithm: see `resolve_inner` in `resolve.rs`.
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

use crate::swf_doc::{OwnedSprite, SwfDoc, Symbol};

use crate::tile_script::ChildScript;

pub use seed::seed_for_cell;

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
    /// per-tick AVM1 simulation, so an animating consumer attaches a
    /// ticker and rebuilds the scene each frame (and the settled-static
    /// path ticks them offline until they park — see
    /// [`settled_static_overrides`]).
    pub child_scripts: Vec<ChildScript>,
    /// Children whose initial frame-0 script left them stopped and have
    /// no `enterFrame` handler. They'll never change state, so the
    /// renderer just pins them via `RenderCtx::with_child_frame_overrides`.
    pub child_overrides: HashMap<u16, u16>,
}

pub fn resolve(sprite: &OwnedSprite, doc: &SwfDoc, cell_id: u16) -> TileBehavior {
    resolve_full(sprite, doc, cell_id).behavior
}

/// Same as [`resolve`] but also extracts per-instance script state for
/// every immediate multi-frame child of the wrapper. Callers attaching
/// a per-tick animator need this; diagnostic dumps that only want the
/// classification go through [`resolve`].
pub fn resolve_full(sprite: &OwnedSprite, doc: &SwfDoc, cell_id: u16) -> TileResolution {
    resolve::resolve_full(sprite, doc, cell_id)
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
