//! Dump every named placement reachable from an export. Used to find
//! the accessory ghost convention in Dofus character SWFs.
//!
//! Usage: cargo run --bin dump_named_places -- <bundle.swf> <export> [depth]

use std::collections::HashSet;
use std::path::PathBuf;

use anyhow::Result;
use swf_spike::swf_doc::{OwnedOp, Symbol, SwfDoc};

fn dump(
    doc: &SwfDoc,
    sym: &Symbol,
    indent: usize,
    max_depth: usize,
    seen: &mut HashSet<u16>,
) {
    let pad = "  ".repeat(indent);
    let Symbol::Sprite(sp) = sym else {
        return;
    };
    let mut frame = 1u16;
    for op in &sp.ops {
        match op {
            OwnedOp::Place(p) => {
                if let Some(name) = &p.name {
                    let m = match p.matrix {
                        Some(m) => format!(
                            " M=[{:.2},{:.2},{:.2},{:.2},{:.2},{:.2}]",
                            m.as_coeffs()[0],
                            m.as_coeffs()[1],
                            m.as_coeffs()[2],
                            m.as_coeffs()[3],
                            m.as_coeffs()[4],
                            m.as_coeffs()[5]
                        ),
                        None => String::new(),
                    };
                    println!(
                        "{pad}f{frame} depth={} name={:?} char={:?}{m}",
                        p.depth, name, p.character_id
                    );
                }
                if let Some(child_id) = p.character_id
                    && indent < max_depth
                    && !seen.contains(&child_id)
                    && let Some(child) = doc.lookup_id(child_id)
                {
                    seen.insert(child_id);
                    dump(doc, child, indent + 1, max_depth, seen);
                }
            }
            OwnedOp::ShowFrame => {
                frame += 1;
            }
            _ => {}
        }
    }
}

fn main() -> Result<()> {
    let path = PathBuf::from(std::env::args().nth(1).unwrap());
    let exp = std::env::args().nth(2).unwrap();
    let max_depth: usize = std::env::args()
        .nth(3)
        .and_then(|s| s.parse().ok())
        .unwrap_or(4);
    let doc = SwfDoc::load(&path)?;
    let Some(sym) = doc.lookup_export(&exp) else {
        println!("export {} not found", exp);
        println!("available exports:");
        for n in doc.by_name.keys().take(40) {
            println!("  {}", n);
        }
        return Ok(());
    };
    let mut seen = HashSet::new();
    dump(&doc, sym, 0, max_depth, &mut seen);
    Ok(())
}
