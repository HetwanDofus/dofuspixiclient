//! Diagnostic: compare extract_slot_depths (band split) vs
//! extract_mount_transforms (accessory placement) across walk frames,
//! to find where accessory anchoring diverges when the character moves.
//!
//! Usage: cargo run --bin dump_walk_mounts -- <sprite.swf> [export]

use std::path::PathBuf;

use anyhow::Result;
use swf_spike::render::mount_transforms::extract_mount_transforms;
use swf_spike::render::{extract_slot_depths, find_effective_body_symbol};
use swf_spike::swf_doc::{Symbol, SwfDoc};

fn main() -> Result<()> {
    let path = PathBuf::from(std::env::args().nth(1).unwrap());
    let want = std::env::args().nth(2).unwrap_or_else(|| "walkR".to_string());
    let doc = SwfDoc::load(&path)?;
    println!("# frame_rate = {}", doc.frame_rate);

    let mut names: Vec<&String> = doc.by_name.keys().collect();
    names.sort();
    let walks: Vec<&String> = names
        .iter()
        .filter(|n| n.contains("walk") || n.contains("static"))
        .copied()
        .collect();
    println!("# walk/static exports: {walks:?}");

    let export = if doc.by_name.contains_key(&want) {
        want.clone()
    } else {
        walks
            .iter()
            .find(|n| n.contains("walk"))
            .map(|s| s.to_string())
            .unwrap_or(want)
    };
    println!("# using export: {export}");

    let Some(sym) = doc.lookup_export(&export) else {
        println!("export not found");
        return Ok(());
    };
    let Symbol::Sprite(body) = sym else {
        println!("not a sprite");
        return Ok(());
    };
    let nframes = body.num_frames.max(1);
    println!("# num_frames={nframes}");

    for frame in 0..6 {
        let (_eff, exf) = find_effective_body_symbol(&doc, sym, frame);
        let slots = extract_slot_depths(&doc, body, frame);
        let (mats, pres) = extract_mount_transforms(&doc, sym, frame, 1, false, 7);
        println!("--- frame {frame}  effective_xform={:?} ---", exf.as_coeffs());
        print!("  slot_depths: ");
        for s in &slots {
            print!("[slot={} d={} side={:?}] ", s.slot, s.depth, s.side);
        }
        println!();
        for slot in 0..7usize {
            if pres[slot] == 1 {
                let o = slot * 6;
                println!(
                    "  mount slot={slot} tx={:.1} ty={:.1} lin=[{:.3},{:.3},{:.3},{:.3}]",
                    mats[o + 4], mats[o + 5], mats[o], mats[o + 1], mats[o + 2], mats[o + 3]
                );
            }
        }
    }
    Ok(())
}
