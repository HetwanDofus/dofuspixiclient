//! Dump every accessory mount detected in a character SWF.
//! Verifies that `avm1_extract_apply_accessory_calls` is finding the
//! `GAC.applyAccessory(this, slot, side)` calls correctly.
//!
//! Usage: cargo run --bin dump_accessory_mounts -- <bundle.swf>

use std::path::PathBuf;

use anyhow::Result;
use swf_spike::swf_doc::SwfDoc;

fn main() -> Result<()> {
    let path = PathBuf::from(std::env::args().nth(1).unwrap());
    let doc = SwfDoc::load(&path)?;
    println!("# accessory mounts in {}: {}", path.display(), doc.accessory_mounts.len());
    let mut entries: Vec<_> = doc.accessory_mounts.iter().collect();
    entries.sort_by_key(|(id, _)| **id);
    for (id, mounts) in entries {
        for m in mounts {
            println!(
                "  sprite {} → slot={} side={:?} bFix={}",
                id, m.slot, m.side, m.b_fix
            );
        }
    }
    Ok(())
}
