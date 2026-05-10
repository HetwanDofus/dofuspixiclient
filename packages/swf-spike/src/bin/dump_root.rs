//! Dump the root timeline of a SWF.
//! Usage: cargo run --bin dump-root -- <bundle.swf>

use std::collections::HashSet;
use std::path::PathBuf;
use anyhow::Result;
use swf_spike::swf_doc::{OwnedOp, Symbol, SwfDoc};

fn dump_sprite(doc: &SwfDoc, sprite: &swf_spike::swf_doc::OwnedSprite, indent: usize, max_depth: usize, seen: &mut HashSet<u16>) {
    let pad = "  ".repeat(indent);
    let mut frame = 1u16;
    for op in &sprite.ops {
        match op {
            OwnedOp::Place(p) => {
                let name = p.name.as_deref().unwrap_or("");
                let mat = p.matrix.map(|m| format!("{:?}", m)).unwrap_or_default();
                println!(
                    "{pad}f{} Place depth={} char={:?} name={:?} matrix={}",
                    frame, p.depth, p.character_id, name, mat
                );
                if let Some(child_id) = p.character_id {
                    if !seen.contains(&child_id) && indent < max_depth {
                        seen.insert(child_id);
                        if let Some(Symbol::Sprite(s)) = doc.lookup_id(child_id) {
                            println!("{pad}  -> child id={} Sprite frames={} ops={}", child_id, s.num_frames, s.ops.len());
                            dump_sprite(doc, s, indent + 1, max_depth, seen);
                        } else if let Some(Symbol::Shape(sh)) = doc.lookup_id(child_id) {
                            println!("{pad}  -> child id={} Shape bounds=({:?},{:?})-({:?},{:?})",
                                child_id,
                                sh.shape_bounds.x_min, sh.shape_bounds.y_min,
                                sh.shape_bounds.x_max, sh.shape_bounds.y_max);
                        }
                    }
                }
            }
            OwnedOp::Remove { depth } => println!("{pad}f{} Remove depth={depth}", frame),
            OwnedOp::ShowFrame => { frame += 1; }
            OwnedOp::DoAction(bc) => println!("{pad}f{} DoAction ({} bytes)", frame, bc.len()),
        }
    }
}

fn main() -> Result<()> {
    let path = PathBuf::from(std::env::args().nth(1).unwrap());
    let doc = SwfDoc::load(&path)?;
    let root = &doc.root;
    println!("root: {} frames, {} ops", root.num_frames, root.ops.len());
    let mut seen = HashSet::new();
    dump_sprite(&doc, root, 0, 4, &mut seen);
    println!();
    println!("Done");
    Ok(())
}

#[allow(dead_code)]
fn old_main() -> Result<()> {
    let path = PathBuf::from(std::env::args().nth(1).unwrap());
    let doc = SwfDoc::load(&path)?;
    let root = &doc.root;
    println!("root: {} frames, {} ops", root.num_frames, root.ops.len());
    let mut frame = 1u16;
    for op in &root.ops {
        match op {
            OwnedOp::Place(p) => {
                let name = p.name.as_deref().unwrap_or("");
                let mat = p.matrix.map(|m| format!("{:?}", m)).unwrap_or_default();
                let cxform = if p.color_transform.is_some() { " cxform=Y" } else { "" };
                println!(
                    "  f{} Place depth={} char={:?} is_move={} name={:?}{cxform} matrix={}",
                    frame, p.depth, p.character_id, p.is_move, name, mat
                );
                if let Some(child_id) = p.character_id {
                    if let Some(child) = doc.lookup_id(child_id) {
                        let kind = match child {
                            Symbol::Sprite(s) => format!("Sprite num_frames={} ops={}", s.num_frames, s.ops.len()),
                            Symbol::Shape(_) => "Shape".to_string(),
                            Symbol::MorphShape(_) => "MorphShape".to_string(),
                            Symbol::Bitmap(_) => "Bitmap".to_string(),
                        };
                        println!("    -> child id={} {}", child_id, kind);
                    }
                }
            }
            OwnedOp::Remove { depth } => println!("  f{} Remove depth={depth}", frame),
            OwnedOp::ShowFrame => {
                frame += 1;
            }
            OwnedOp::DoAction(bc) => println!("  f{} DoAction ({} bytes)", frame, bc.len()),
        }
    }
    println!();
    println!("Named exports:");
    // by_name is private; just list a few we expect
    for n in ["_spellBackground", "_spellFrame", "_spellPrint", "_spellGlyph"] {
        if let Some(_) = doc.lookup_export(n) {
            println!("  {}", n);
        }
    }
    Ok(())
}
