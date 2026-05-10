//! Dump per-frame bounds of an accessory symbol so we can see where
//! its visible content sits relative to its (0,0) origin.
use std::path::PathBuf;
use anyhow::Result;
use swf_spike::render::symbol_bounds;
use swf_spike::swf_doc::{Symbol, SwfDoc};

fn main() -> Result<()> {
    let path = PathBuf::from(std::env::args().nth(1).unwrap());
    let exp = std::env::args().nth(2).unwrap();
    let doc = SwfDoc::load(&path)?;
    let Some(sym) = doc.lookup_export(&exp) else {
        eprintln!("export `{}` not found in {}", exp, path.display());
        return Ok(());
    };
    let frame_count = if let Symbol::Sprite(sp) = sym { sp.num_frames } else { 1 };
    println!("export={}  num_frames={}", exp, frame_count);
    for f in 0..frame_count.min(20) {
        let b = symbol_bounds(&doc, sym, f);
        println!(
            "  f{:2}: bounds twip=[{:.1},{:.1} .. {:.1},{:.1}]  size=({:.1}x{:.1})  origin_offset=({:.1},{:.1})",
            f,
            b.x0, b.y0, b.x1, b.y1,
            b.width(), b.height(),
            -b.x0, -b.y0,
        );
    }
    Ok(())
}
