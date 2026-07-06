//! Per-instance simulated AVM1 state for multi-frame children of an
//! animated wrapper sprite. Ported from wc3's validated implementation
//! (`dofuswebclient3/rust/swf-spike/src/tile_script.rs`).
//!
//! Canonical example (chimney smoke `gfx 343` on map 35):
//!
//! - Root sprite has 1 frame; places two multi-frame children among
//!   many static shapes.
//! - Child `1373` (129 frames): no scripts anywhere → loops naturally
//!   at the bundle's fps.
//! - Child `1361` (210 frames, the **elevator**): canonical Flash
//!   behavior is "parked at frame 1, occasionally triggered to descend
//!   then re-parked at frame 102":
//!     - Frame 1 DoAction: `Stop`.
//!     - Frame 102 DoAction: `Stop`.
//!     - The placement's `onClipEvent(enterFrame)` runs `if
//!       Math.random() < 0.001 { play() }` every tick (~16.7 s mean
//!       idle time at 60 fps).
//!
//! The SAME machinery drives settled NPC/monster idles: `static*`
//! character exports are 1-frame wrappers placing multi-frame children
//! that play a settle-in and then `stop()` (canonical Flash just runs
//! the timeline until the Stop; `GlobalSpriteHandler.recursiveGotoAndStop`,
//! assets/sources/client-code/ank/battlefield/GlobalSpriteHandler.as:505-516,
//! is the only place the client ever forces child playheads, and it does so
//! to PIN a stopped pose). Ticking a `ChildScript` until `!playing`
//! recovers exactly the frame Flash would be showing once the idle has
//! settled — see `tile_behavior::settled_static_overrides`.
//!
//! ## Spawn sequence (matches Flash)
//!
//! On attach:
//! 1. `onClipEvent(load)` fires once (if the placement defines one).
//! 2. Frame 1's `DoAction` runs (a `Stop` here parks the clip).
//!
//! Each subsequent tick:
//! 1. `onClipEvent(enterFrame)` fires.
//! 2. If `playing`, the playhead advances by one frame.
//! 3. The newly-arrived frame's `DoAction` runs (a `Stop` here parks
//!    the clip mid-animation, the canonical "elevator parks at frame
//!    102" mechanism).
//!
//! ## Determinism
//!
//! `seed_rng` is called per [`run_avm`] with a per-instance seed
//! `base_seed ⊕ tick_count · golden_ratio`. That gives:
//! - Different cells with the same gfx ID get different trigger
//!   schedules (matches Flash, where each instance draws from the
//!   global PRNG and ends up phase-offset).
//! - The sequence is reproducible for a given cell, so snapshots and
//!   headless replays produce identical visuals.

use std::collections::HashMap;

use crate::avm1::{exec, seed_rng, AvmEngine, InstanceId};
use crate::swf_doc::{clip_event, OwnedClipAction, OwnedOp, OwnedSprite};

const AVM1_VERSION: u8 = 6;
const THIS_ID: InstanceId = 1;
/// SplitMix32 step constant — mixes consecutive tick counters into
/// well-spread seeds so xorshift32 doesn't take dozens of iterations
/// to decorrelate near-identical inputs.
const GOLDEN_RATIO_32: u32 = 0x9e37_79b9;

#[derive(Debug, Clone)]
pub struct ChildScript {
    pub child_id: u16,
    pub num_frames: u16,
    pub current_frame: u16,
    pub playing: bool,
    on_enter_frame: Option<Vec<u8>>,
    frame_actions: HashMap<u16, Vec<Vec<u8>>>,
    base_seed: u32,
    tick_count: u32,
}

impl ChildScript {
    /// Build a script-driven state for `child` placed inside an
    /// animated wrapper. `place_clip_actions` is the placement's
    /// `clip_actions` (per-placement `onClipEvent` handlers).
    /// `base_seed` should be derived from `cell_id + child_id` so each
    /// `(cell, child)` pair has its own deterministic random
    /// sequence.
    pub fn build(
        child_id: u16,
        sprite: &OwnedSprite,
        place_clip_actions: &[OwnedClipAction],
        base_seed: u32,
    ) -> Self {
        let on_enter_frame = place_clip_actions
            .iter()
            .find(|ca| (ca.events & clip_event::ENTER_FRAME) != 0)
            .map(|ca| ca.bytecode.clone());
        // `load` fires once at attach, BEFORE frame-1's DoAction runs.
        // We don't keep it after construction.
        let on_load = place_clip_actions
            .iter()
            .find(|ca| (ca.events & clip_event::LOAD) != 0);

        let mut frame_actions: HashMap<u16, Vec<Vec<u8>>> = HashMap::new();
        let mut frame: u16 = 0;
        for op in &sprite.ops {
            match op {
                OwnedOp::ShowFrame => {
                    frame += 1;
                }
                OwnedOp::DoAction(bc) => {
                    frame_actions.entry(frame).or_default().push(bc.clone());
                }
                _ => {}
            }
        }

        let num_frames = sprite.num_frames.max(1);

        // Flash attach order:
        //   1. ClipEvent.load fires (default initial state: frame 1,
        //      playing=true).
        //   2. The current frame's DoAction runs. If load called
        //      gotoAndPlay/Stop(N), the playhead has moved and it's
        //      frame N's DoAction that runs — NOT the original frame
        //      1's. (Verified against the per-frame DoAction model:
        //      timeline scripts fire when the playhead enters a
        //      frame.)
        let mut current_frame: u16 = 0;
        let mut playing = true;
        if let Some(load) = on_load {
            let (cf, p) = run_avm(
                &load.bytecode,
                current_frame,
                playing,
                num_frames,
                base_seed,
            );
            current_frame = cf;
            playing = p;
        }
        if let Some(bcs) = frame_actions.get(&current_frame) {
            for bc in bcs {
                let (cf, p) = run_avm(bc, current_frame, playing, num_frames, base_seed);
                current_frame = cf;
                playing = p;
            }
        }

        ChildScript {
            child_id,
            num_frames,
            current_frame,
            playing,
            on_enter_frame,
            frame_actions,
            base_seed,
            tick_count: 0,
        }
    }

    pub fn tick(&mut self) {
        self.tick_count = self.tick_count.wrapping_add(1);
        let seed = self
            .base_seed
            .wrapping_add(self.tick_count.wrapping_mul(GOLDEN_RATIO_32));

        // Snapshot mutable state into locals — keeps the borrow
        // checker happy when we read `self.on_enter_frame` /
        // `self.frame_actions` (immutable refs) inside the loop and
        // still need to thread state updates through them.
        let mut current_frame = self.current_frame;
        let mut playing = self.playing;
        let num_frames = self.num_frames;

        // 1) onClipEvent(enterFrame). Borrowing `&self.on_enter_frame`
        //    means we pass `&[u8]` straight into the exec call — no
        //    `.clone()` of the bytecode per tick.
        if let Some(bc) = self.on_enter_frame.as_deref() {
            let (cf, p) = run_avm(bc, current_frame, playing, num_frames, seed);
            current_frame = cf;
            playing = p;
        }

        // 2) If still playing, advance the playhead and run the
        //    arriving frame's DoActions.
        if playing && num_frames > 1 {
            current_frame = (current_frame + 1) % num_frames;
            if let Some(bcs) = self.frame_actions.get(&current_frame) {
                for bc in bcs {
                    let (cf, p) = run_avm(bc, current_frame, playing, num_frames, seed);
                    current_frame = cf;
                    playing = p;
                }
            }
        }

        self.current_frame = current_frame;
        self.playing = playing;
    }
}

/// Stateless AVM1 host: spins up a one-clip `AvmEngine`, plants the
/// caller's `(frame, playing)` into it, runs the bytecode, reads the
/// resulting state back. Allocation cost is one `HashMap<InstanceId,
/// ClipState>` + one `ClipState` per call — measured below tens of
/// microseconds in practice, fine for the handful of scripted clips a
/// map / character carries.
fn run_avm(
    bytecode: &[u8],
    current_frame: u16,
    playing: bool,
    num_frames: u16,
    seed: u32,
) -> (u16, bool) {
    seed_rng(seed);
    let mut engine = AvmEngine::new();
    engine.ensure(THIS_ID, None, num_frames);
    {
        let s = engine.clips.get_mut(&THIS_ID).expect("ensured");
        s.current_frame = current_frame.saturating_add(1);
        s.playing = playing;
    }
    let _ = exec(bytecode, AVM1_VERSION, THIS_ID, &mut engine);
    let s = engine.clips.get(&THIS_ID).expect("ensured");
    let frame = s
        .current_frame
        .saturating_sub(1)
        .min(num_frames.saturating_sub(1));
    (frame, s.playing)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sprite(num_frames: u16, ops: Vec<OwnedOp>) -> OwnedSprite {
        OwnedSprite {
            num_frames,
            ops,
            frame_labels: HashMap::new(),
        }
    }

    fn stop_bc() -> Vec<u8> {
        vec![0x07, 0x00]
    }

    fn play_bc() -> Vec<u8> {
        vec![0x06, 0x00]
    }

    #[test]
    fn parks_at_frame_zero_when_frame1_stops() {
        let sp = sprite(10, vec![OwnedOp::DoAction(stop_bc()), OwnedOp::ShowFrame]);
        let s = ChildScript::build(99, &sp, &[], 1);
        assert_eq!(s.current_frame, 0);
        assert!(!s.playing);
    }

    #[test]
    fn on_clip_event_load_runs_at_build_time_before_frame_actions() {
        // sprite frame 1: Stop (would normally park).
        // onClipEvent(load): gotoAndPlay(3) → jumps to frame 3, plays.
        //
        // Canonical Flash sequence is: load → frame1.DoAction. Because
        // gotoAndPlay sets current_frame *and* playing=true, the
        // subsequent Stop at frame 1 doesn't run (we already jumped
        // away). So after build the clip should be at frame 3
        // (0-based 2), playing.
        //
        // gotoAndPlay(3) bytecode:
        //   Push Int(3), GotoFrame2(set_playing=true).
        let load_bc: Vec<u8> = vec![
            0x96, 0x05, 0x00, 0x07, 0x03, 0x00, 0x00, 0x00, // Int(3)
            0x9F, 0x01, 0x00, 0x01, // GotoFrame2 flags=0x01 (set_playing)
            0x00,
        ];
        let sp = sprite(10, vec![OwnedOp::DoAction(stop_bc()), OwnedOp::ShowFrame]);
        let load = OwnedClipAction {
            events: clip_event::LOAD,
            bytecode: load_bc,
        };
        let s = ChildScript::build(99, &sp, &[load], 1);
        assert_eq!(s.current_frame, 2);
        assert!(s.playing);
    }

    #[test]
    fn freely_animates_with_no_scripts() {
        let mut ops = Vec::new();
        for _ in 0..5 {
            ops.push(OwnedOp::ShowFrame);
        }
        let sp = sprite(5, ops);
        let mut s = ChildScript::build(99, &sp, &[], 1);
        assert!(s.playing);
        s.tick();
        assert_eq!(s.current_frame, 1);
        s.tick();
        assert_eq!(s.current_frame, 2);
    }

    #[test]
    fn stops_at_later_frame_when_play_is_triggered() {
        let ops = vec![
            OwnedOp::DoAction(stop_bc()),
            OwnedOp::ShowFrame,
            OwnedOp::ShowFrame,
            OwnedOp::ShowFrame,
            OwnedOp::ShowFrame,
            OwnedOp::DoAction(stop_bc()),
            OwnedOp::ShowFrame,
        ];
        let sp = sprite(5, ops);
        let clip_action = OwnedClipAction {
            events: clip_event::ENTER_FRAME,
            bytecode: play_bc(),
        };
        let mut s = ChildScript::build(99, &sp, &[clip_action], 1);
        assert_eq!(s.current_frame, 0);
        assert!(!s.playing);
        s.tick();
        assert_eq!(s.current_frame, 1);
        assert!(s.playing);
        s.tick();
        assert_eq!(s.current_frame, 2);
        s.tick();
        assert_eq!(s.current_frame, 3);
        s.tick();
        assert_eq!(s.current_frame, 4);
        assert!(!s.playing);
    }

    #[test]
    fn tick_does_not_allocate_when_state_unchanged() {
        // Smoke test that ticking a parked clip with no enterFrame
        // never advances or panics — we should be able to call it
        // many times cheaply.
        let sp = sprite(10, vec![OwnedOp::DoAction(stop_bc()), OwnedOp::ShowFrame]);
        let mut s = ChildScript::build(99, &sp, &[], 7);
        for _ in 0..1000 {
            s.tick();
        }
        assert_eq!(s.current_frame, 0);
        assert!(!s.playing);
    }
}
