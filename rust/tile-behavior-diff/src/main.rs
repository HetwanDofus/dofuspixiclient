//! Differential oracle (wc3 side): identical logic to wc2's
//! `swf-spike/src/bin/tile_behavior_dump.rs`, but running WC3's
//! validated `tile_behavior::resolve_full` via a read-only path-dep.
//!
//! Usage: cargo run --release -- <gfx dir> > /tmp/wc3.dump
//! Then:  diff /tmp/wc2.dump /tmp/wc3.dump   (must be empty)

use anyhow::Result;
use std::path::PathBuf;
use swf_spike_wc3::swf_doc::{Symbol, SwfDoc};
use swf_spike_wc3::tile_behavior::{TileBehavior, resolve_full};

const CELLS: [u16; 8] = [0, 17, 100, 233, 250, 333, 456, 479];

const BUNDLES: [&str; 14] = [
    "g1", "g2", "o1", "o2", "o3", "o4", "o5", "o6", "o7", "o8", "o9", "o10", "o11", "o12",
];

fn main() -> Result<()> {
    let gfx_dir = PathBuf::from(
        std::env::args()
            .nth(1)
            .expect("usage: tile-behavior-diff <gfx dir>"),
    );
    for b in BUNDLES {
        let doc = SwfDoc::load(&gfx_dir.join(format!("{b}.swf")))?;
        let mut names: Vec<&String> = doc.by_name.keys().collect();
        names.sort();
        for name in names {
            let Some(Symbol::Sprite(sprite)) = doc.lookup_export(name) else {
                continue;
            };
            for cell in CELLS {
                let r = resolve_full(sprite, &doc, cell);
                let behavior = match r.behavior {
                    TileBehavior::Static { frame } => format!("static:{frame}"),
                    TileBehavior::Animated { start_frame, cycle } => {
                        format!("anim:{start_frame}:{cycle}")
                    }
                };
                let mut scripts: Vec<String> = r
                    .child_scripts
                    .iter()
                    .map(|s| {
                        format!(
                            "{}:{}:{}:{}",
                            s.child_id,
                            s.num_frames,
                            s.current_frame,
                            u8::from(s.playing)
                        )
                    })
                    .collect();
                scripts.sort();
                let mut ov: Vec<(u16, u16)> =
                    r.child_overrides.iter().map(|(&k, &v)| (k, v)).collect();
                ov.sort_unstable();
                let ov: Vec<String> = ov.iter().map(|(k, v)| format!("{k}:{v}")).collect();
                println!(
                    "{b}\t{name}\t{cell}\t{behavior}\tscripts=[{}]\tov=[{}]",
                    scripts.join(","),
                    ov.join(",")
                );
            }
        }
    }
    Ok(())
}
