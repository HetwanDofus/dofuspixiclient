use std::collections::HashMap;

use crate::swf_doc::{OwnedOp, OwnedPlace, OwnedSprite, SwfDoc, Symbol};

use super::{TileBehavior, resolve, resolve_full};

fn sprite(num_frames: u16, ops: Vec<OwnedOp>) -> OwnedSprite {
    OwnedSprite {
        num_frames,
        ops,
        frame_labels: HashMap::new(),
    }
}

fn empty_doc() -> SwfDoc {
    SwfDoc {
        stage_size: (0.0, 0.0),
        frame_rate: 24.0,
        by_id: HashMap::new(),
        by_name: HashMap::new(),
        sprite_color_zones: HashMap::new(),
        accessory_mounts: HashMap::new(),
        root: OwnedSprite {
            num_frames: 0,
            ops: Vec::new(),
            frame_labels: HashMap::new(),
        },
    }
}

/// gotoAndStop(random(_totalframes - 1) + 2) — the canonical
/// random-variant script we extracted from sprite 1721 in g1.swf.
fn random_variant_script() -> Vec<u8> {
    vec![
        // Stop + End — minimum payload to flip playing=false.
        0x07, 0x00,
    ]
}

#[test]
fn single_frame_wrapper_with_no_children_is_static() {
    let s = sprite(1, vec![]);
    let d = empty_doc();
    assert_eq!(resolve(&s, &d, 0), TileBehavior::Static { frame: 0 });
}

#[test]
fn multi_frame_self_animated() {
    let s = sprite(4, vec![OwnedOp::ShowFrame; 4]);
    let d = empty_doc();
    assert!(matches!(
        resolve(&s, &d, 0),
        TileBehavior::Animated { cycle: 4, .. }
    ));
}

#[test]
fn multi_frame_with_stop_is_static() {
    let s = sprite(4, vec![OwnedOp::DoAction(vec![0x07, 0x00])]);
    let d = empty_doc();
    assert_eq!(resolve(&s, &d, 0), TileBehavior::Static { frame: 0 });
}

#[test]
fn wrapper_with_two_animated_children_uses_lcm() {
    let mut d = empty_doc();
    d.by_id.insert(
        10,
        Symbol::Sprite(OwnedSprite {
            num_frames: 4,
            ops: vec![OwnedOp::ShowFrame; 4],
            frame_labels: HashMap::new(),
        }),
    );
    d.by_id.insert(
        11,
        Symbol::Sprite(OwnedSprite {
            num_frames: 6,
            ops: vec![OwnedOp::ShowFrame; 6],
            frame_labels: HashMap::new(),
        }),
    );
    let root = sprite(
        1,
        vec![
            OwnedOp::Place(OwnedPlace {
                character_id: Some(10),
                ..Default::default()
            }),
            OwnedOp::Place(OwnedPlace {
                character_id: Some(11),
                ..Default::default()
            }),
            OwnedOp::ShowFrame,
        ],
    );
    // lcm(4, 6) = 12.
    let b = resolve(&root, &d, 0);
    assert!(
        matches!(b, TileBehavior::Animated { cycle: 12, .. }),
        "got {:?}",
        b
    );
}

#[test]
fn wrapper_with_animated_child_propagates_cycle() {
    let mut d = empty_doc();
    d.by_id.insert(
        99,
        Symbol::Sprite(OwnedSprite {
            num_frames: 30,
            ops: vec![OwnedOp::ShowFrame; 30],
            frame_labels: HashMap::new(),
        }),
    );
    let root = sprite(
        1,
        vec![
            OwnedOp::Place(OwnedPlace {
                character_id: Some(99),
                ..Default::default()
            }),
            OwnedOp::ShowFrame,
        ],
    );
    let b = resolve(&root, &d, 0);
    assert!(
        matches!(b, TileBehavior::Animated { cycle: 30, .. }),
        "got {:?}",
        b
    );
}

#[test]
fn wrapper_with_stopping_child_freezes_via_override() {
    // A multi-frame child whose frame-1 script calls Stop, placed
    // without `onClipEvent(enterFrame)`, has no path back to motion.
    // Resolve must put it in `child_overrides` (one-shot pin), NOT
    // `child_scripts` (per-tick AVM1) — animating a permanently-
    // stopped child would re-rasterise its scene every frame for no
    // visible change. The wrapper is classified Static so the
    // `PendingFreeze` countdown lets VelloPlugin retire the scene.
    let mut d = empty_doc();
    d.by_id.insert(
        99,
        Symbol::Sprite(OwnedSprite {
            num_frames: 5,
            ops: vec![
                OwnedOp::DoAction(random_variant_script()),
                OwnedOp::ShowFrame,
            ],
            frame_labels: HashMap::new(),
        }),
    );
    let root = sprite(
        1,
        vec![
            OwnedOp::Place(OwnedPlace {
                character_id: Some(99),
                ..Default::default()
            }),
            OwnedOp::ShowFrame,
        ],
    );
    let res = resolve_full(&root, &d, 0);
    assert!(
        res.child_scripts.is_empty(),
        "no per-tick script for a static-stopped child"
    );
    assert_eq!(
        res.child_overrides.len(),
        1,
        "the chosen frame is pinned via override"
    );
    assert!(
        matches!(res.behavior, TileBehavior::Static { .. }),
        "got {:?}",
        res.behavior
    );
}

// ---------------------------------------------------------------------------
// wc2 EXTENSIONS — everything ABOVE this line is wc3's tile_behavior/tests.rs
// verbatim EXCEPT two type-bridge deletions in `empty_doc()`: wc3's SwfDoc
// carries `lazy` + `base_zone_colors` fields (their swf_doc/ module — adopted
// in a later unified-atlas step); wc2's SwfDoc doesn't have them yet.
// Below: tests for the wc2-only extension surface (settled_static_overrides,
// overrides_signature) appended after the verbatim suite.
// ---------------------------------------------------------------------------

#[test]
fn settled_static_ticks_playing_child_to_its_stop() {
    // Canonical settle-in idle: a 1-frame `staticR` wrapper places a
    // 6-frame child with a `stop()` on its LAST frame. Flash runs the
    // timeline to the stop; `settled_static_overrides` must pin the
    // child at frame 5 (0-based), not the setup frame 0.
    let mut d = empty_doc();
    d.by_id.insert(
        42,
        Symbol::Sprite(OwnedSprite {
            num_frames: 6,
            ops: vec![
                OwnedOp::ShowFrame,
                OwnedOp::ShowFrame,
                OwnedOp::ShowFrame,
                OwnedOp::ShowFrame,
                OwnedOp::ShowFrame,
                OwnedOp::DoAction(random_variant_script()),
                OwnedOp::ShowFrame,
            ],
            frame_labels: HashMap::new(),
        }),
    );
    let root = sprite(
        1,
        vec![
            OwnedOp::Place(OwnedPlace {
                character_id: Some(42),
                ..Default::default()
            }),
            OwnedOp::ShowFrame,
        ],
    );
    let sym = Symbol::Sprite(root);
    let overrides = super::settled_static_overrides(&d, &sym);
    assert_eq!(overrides.get(&42), Some(&5));
}

#[test]
fn overrides_signature_is_order_independent_and_frame_sensitive() {
    let mut a: HashMap<u16, u16> = HashMap::new();
    a.insert(10, 3);
    a.insert(20, 7);
    let mut b: HashMap<u16, u16> = HashMap::new();
    b.insert(20, 7);
    b.insert(10, 3);
    assert_eq!(
        super::overrides_signature(2, &a),
        super::overrides_signature(2, &b)
    );
    // Different wrapper frame or different pin → different signature.
    assert_ne!(
        super::overrides_signature(2, &a),
        super::overrides_signature(3, &a)
    );
    b.insert(10, 4);
    assert_ne!(
        super::overrides_signature(2, &a),
        super::overrides_signature(2, &b)
    );
}
