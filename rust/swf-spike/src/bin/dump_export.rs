//! Print the sprite that an export name maps to + its top-level ops.

use std::path::PathBuf;
use anyhow::Result;
use swf_spike::swf_doc::{OwnedOp, Symbol, SwfDoc};

fn main() -> Result<()> {
    let path = PathBuf::from(std::env::args().nth(1).unwrap());
    let exp = std::env::args().nth(2).unwrap();
    let doc = SwfDoc::load(&path)?;
    let Some(sym) = doc.lookup_export(&exp) else {
        println!("export {} not found", exp);
        return Ok(());
    };
    if let Symbol::Sprite(sp) = sym {
        println!("export={} → sprite with {} frames, {} ops", exp, sp.num_frames, sp.ops.len());
        let mut frame = 1u16;
        for op in &sp.ops {
            match op {
                OwnedOp::Place(p) => {
                    println!("  f{} Place depth={} char={:?} is_move={} clip_actions={}", frame, p.depth, p.character_id, p.is_move, p.clip_actions.len());
                    for ca in &p.clip_actions {
                        println!("    clip_action ({} bytes):", ca.bytecode.len());
                        let mut r = swf::avm1::read::Reader::new(&ca.bytecode, 6);
                        while let Ok(a) = r.read_action() {
                            println!("      {:?}", a);
                            if matches!(a, swf::avm1::types::Action::End) { break; }
                        }
                    }
                }
                OwnedOp::Remove { depth } => println!("  f{} Remove depth={}", frame, depth),
                OwnedOp::ShowFrame => { frame += 1; }
                OwnedOp::DoAction(bc) => {
                    println!("  f{} DoAction ({} bytes):", frame, bc.len());
                    let mut r = swf::avm1::read::Reader::new(bc, 6);
                    while let Ok(a) = r.read_action() {
                        println!("    {:?}", a);
                        if matches!(a, swf::avm1::types::Action::End) { break; }
                    }
                }
            }
        }
    } else {
        println!("export {} is not a Sprite", exp);
    }
    Ok(())
}
