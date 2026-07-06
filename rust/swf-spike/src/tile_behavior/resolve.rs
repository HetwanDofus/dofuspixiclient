//! Recursive frame-1 script execution: figure out which children
//! animate, which freeze at a chosen frame, and which need a per-tick
//! `ChildScript` state machine.

use std::collections::{HashMap, HashSet};

use crate::avm1::{AvmEngine, InstanceId, exec, seed_rng};
use crate::swf_doc::{OwnedOp, OwnedSprite, SwfDoc, Symbol, clip_event};

use crate::tile_script::ChildScript;

use super::seed::{lcm_u16, seed_for_cell};
use super::{TileBehavior, TileResolution};

const AVM1_VERSION: u8 = 6;
const THIS_ID: InstanceId = 1;

pub(super) fn resolve_full(sprite: &OwnedSprite, doc: &SwfDoc, cell_id: u16) -> TileResolution {
    seed_rng(seed_for_cell(cell_id));
    let mut visited: HashSet<u16> = HashSet::new();
    let mut scripts: Vec<ChildScript> = Vec::new();
    let mut overrides: HashMap<u16, u16> = HashMap::new();
    let behavior = resolve_inner(
        sprite,
        doc,
        &mut visited,
        &mut scripts,
        &mut overrides,
        cell_id,
        true,
    );
    TileResolution {
        behavior,
        child_scripts: scripts,
        child_overrides: overrides,
    }
}

fn resolve_inner(
    sprite: &OwnedSprite,
    doc: &SwfDoc,
    visited: &mut HashSet<u16>,
    scripts: &mut Vec<ChildScript>,
    overrides: &mut HashMap<u16, u16>,
    cell_id: u16,
    is_root: bool,
) -> TileBehavior {
    let mut engine = AvmEngine::new();
    engine.ensure(THIS_ID, None, sprite.num_frames.max(1));

    // Run every frame-1 DoAction (scripts may be split across multiple
    // tags). The PRNG is seeded once at the outer entry point so each
    // recursive descendant draws distinct random values.
    for op in &sprite.ops {
        match op {
            OwnedOp::ShowFrame => break,
            OwnedOp::DoAction(bc) => {
                let _ = exec(bc, AVM1_VERSION, THIS_ID, &mut engine);
            }
            _ => {}
        }
    }
    let state = engine
        .clips
        .get(&THIS_ID)
        .expect("ClipState was inserted by ensure()");
    let max_frame = sprite.num_frames.max(1) - 1;
    let own_frame_0based = state.current_frame.saturating_sub(1).min(max_frame);
    let own_playing = state.playing;

    // 1) Self-stopped: ignore descendants — Flash has frozen this clip's
    //    playhead.
    if !own_playing {
        return TileBehavior::Static {
            frame: own_frame_0based,
        };
    }

    // 2) Self-animated (own timeline > 1 frame, playing).
    if sprite.num_frames > 1 {
        return TileBehavior::Animated {
            start_frame: own_frame_0based,
            cycle: sprite.num_frames,
        };
    }

    // 3) Single-frame wrapper that's still "playing" — the wrapper
    //    itself doesn't change, but its child placements may. Recurse
    //    into every child placed at frame 1 to find the true behavior.
    let mut any_animated: Option<TileBehavior> = None;
    let mut last_stopped_frame: Option<u16> = None;
    for op in &sprite.ops {
        match op {
            OwnedOp::ShowFrame => break,
            OwnedOp::Place(place) => {
                let Some(child_id) = place.character_id else {
                    continue;
                };
                if !visited.insert(child_id) {
                    continue;
                }
                let Some(Symbol::Sprite(child)) = doc.lookup_id(child_id) else {
                    continue;
                };

                // Immediate multi-frame children of an animated tile
                // wrapper split into two paths:
                //
                // - **Dynamic** — has an `onClipEvent(enterFrame)`
                //   handler OR is still playing after frame-0 scripts.
                //   Gets a per-instance `ChildScript` so the tick system
                //   can run its AVM1 every frame (canonical chimney-
                //   smoke elevator pattern).
                //
                // - **Permanently static** — frame-0 script left it
                //   stopped and there's no enterFrame trigger that
                //   could revive it. Pin it to the canonical frame via
                //   `child_overrides` and skip the animator entirely.
                if is_root && child.num_frames > 1 {
                    let base_seed = seed_for_cell(cell_id)
                        .wrapping_add(u32::from(child_id).wrapping_mul(0x85eb_ca6b));
                    let has_enter_frame = place
                        .clip_actions
                        .iter()
                        .any(|ca| (ca.events & clip_event::ENTER_FRAME) != 0);
                    let script =
                        ChildScript::build(child_id, child, &place.clip_actions, base_seed);
                    let dynamic = script.playing || has_enter_frame;
                    if dynamic {
                        let was_playing = script.playing;
                        let cycle = child.num_frames;
                        scripts.push(script);
                        if was_playing {
                            let combined = match any_animated {
                                Some(TileBehavior::Animated { cycle: c, .. }) => lcm_u16(cycle, c),
                                _ => cycle,
                            };
                            any_animated = Some(TileBehavior::Animated {
                                start_frame: 0,
                                cycle: combined,
                            });
                        }
                    } else {
                        // Stopped child with no enterFrame revival —
                        // freeze it once at the canonical chosen frame.
                        overrides.insert(child_id, script.current_frame);
                        last_stopped_frame = Some(script.current_frame);
                    }
                    continue;
                }

                let child_behavior =
                    resolve_inner(child, doc, visited, scripts, overrides, cell_id, false);
                match child_behavior {
                    TileBehavior::Animated { cycle, start_frame } => {
                        let combined = match any_animated {
                            Some(TileBehavior::Animated { cycle: c, .. }) => lcm_u16(cycle, c),
                            _ => cycle,
                        };
                        any_animated = Some(TileBehavior::Animated {
                            start_frame,
                            cycle: combined,
                        });
                    }
                    TileBehavior::Static { frame } => {
                        last_stopped_frame = Some(frame);
                    }
                }
            }
            _ => {}
        }
    }

    // Promote to Animated when at least one ChildScript was added —
    // even a script that started stopped can be revived by an
    // `enterFrame` handler at any tick.
    if any_animated.is_none() && !scripts.is_empty() {
        any_animated = Some(TileBehavior::Animated {
            start_frame: 0,
            cycle: 1,
        });
    }

    if let Some(b) = any_animated {
        return b;
    }
    // No animated descendants — either some are stopped (use that
    // chosen frame so propagation lands on the canonical variant) or
    // there are no multi-frame descendants at all (truly static).
    TileBehavior::Static {
        frame: last_stopped_frame.unwrap_or(0),
    }
}
