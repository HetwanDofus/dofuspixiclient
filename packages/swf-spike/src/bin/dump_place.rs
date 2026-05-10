//! Dump every Place op (incl. filters/matrix/color_xform) for an export
//! and recursively into its children. Diagnostic for tiles that hang the
//! WASM render path but render fine via render-tile (CLI strips wgpu).
//!
//! Usage: cargo run --bin dump-place -- <bundle.swf> <export> [depth]

use std::collections::HashSet;
use std::path::PathBuf;

use anyhow::Result;
use swf_spike::swf_doc::{OwnedOp, Symbol, SwfDoc};

fn dump(doc: &SwfDoc, sym: &Symbol, indent: usize, max_depth: usize, seen: &mut HashSet<u16>) {
    let pad = "  ".repeat(indent);
    let Symbol::Sprite(sp) = sym else {
        println!("{pad}(non-sprite)");
        return;
    };
    let mut frame = 1u16;
    for op in &sp.ops {
        match op {
            OwnedOp::Place(p) => {
                let filt = if p.filters.is_empty() {
                    String::new()
                } else {
                    format!(" filters={:?}", p.filters)
                };
                let cxform = if p.color_transform.is_some() {
                    " color_transform=Y"
                } else {
                    ""
                };
                let ratio = match p.ratio {
                    Some(r) => format!(" ratio={r}"),
                    None => String::new(),
                };
                println!(
                    "{pad}f{frame} Place depth={} char={:?} is_move={}{filt}{cxform}{ratio}",
                    p.depth, p.character_id, p.is_move
                );
                if let Some(child_id) = p.character_id
                    && indent < max_depth
                    && !seen.contains(&child_id)
                    && let Some(child) = doc.lookup_id(child_id)
                {
                    seen.insert(child_id);
                    dump(doc, child, indent + 1, max_depth, seen);
                }
            }
            OwnedOp::Remove { depth } => println!("{pad}f{frame} Remove depth={depth}"),
            OwnedOp::ShowFrame => {
                frame += 1;
            }
            OwnedOp::DoAction(_) => println!("{pad}f{frame} DoAction"),
        }
    }
}

fn main() -> Result<()> {
    let path = PathBuf::from(std::env::args().nth(1).unwrap());
    let exp = std::env::args().nth(2).unwrap();
    let max_depth: usize = std::env::args()
        .nth(3)
        .and_then(|s| s.parse().ok())
        .unwrap_or(2);
    let doc = SwfDoc::load(&path)?;
    let Some(sym) = doc.lookup_export(&exp) else {
        println!("export {} not found", exp);
        return Ok(());
    };
    let mut seen = HashSet::new();
    dump(&doc, sym, 0, max_depth, &mut seen);
    Ok(())
}
