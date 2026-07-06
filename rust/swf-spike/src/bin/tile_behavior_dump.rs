//! Differential oracle (wc2 side): dump `tile_behavior::resolve_full`
//! results for EVERY export of the tile bundles × a fixed set of cell
//! seeds. The twin dump produced from wc3's validated implementation
//! (standalone crate `rust/tile-behavior-diff`, path-dep on
//! `../dofuswebclient3/rust/swf-spike`) must match line-for-line —
//! any divergence is a wc2 port bug.
//!
//! Usage: cargo run -p swf-spike --bin tile-behavior-dump -- \
//!            assets/sources/clips/gfx > /tmp/wc2.dump

use anyhow::Result;
use std::path::PathBuf;
use swf_spike::swf_doc::{SwfDoc, Symbol};
use swf_spike::tile_behavior::{resolve_full, TileBehavior};

/// Fixed per-cell seeds: exercise several PRNG streams so seeded
/// `gotoAndStop(random(N))` draws are compared across distinct values.
const CELLS: [u16; 8] = [0, 17, 100, 233, 250, 333, 456, 479];

const BUNDLES: [&str; 14] = [
    "g1", "g2", "o1", "o2", "o3", "o4", "o5", "o6", "o7", "o8", "o9", "o10", "o11", "o12",
];

fn main() -> Result<()> {
    let gfx_dir = PathBuf::from(
        std::env::args()
            .nth(1)
            .expect("usage: tile-behavior-dump <gfx dir>"),
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
