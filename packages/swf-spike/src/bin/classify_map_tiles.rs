//! For each tile id on a map, mirror exactly what `swfTileAnimKind` does
//! in vello-wasm: walk the top sprite + immediate children's frame-1 ops
//! looking for a Random/Slope/Animated marker, otherwise fall through to
//! a depth-4 recursive "any nested sprite has >1 frame" check.

use anyhow::Result;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use swf_spike::swf_doc::{
    avm1_classify_frame1, OwnedOp, OwnedSprite, Symbol, SwfDoc, TileScriptKind,
};

fn classify(doc: &SwfDoc, export: &str) -> (String, u16, u16) {
    let Some(Symbol::Sprite(top)) = doc.lookup_export(export) else {
        return ("?".into(), 0, 0);
    };
    // Mirror the WASM `swfTileAnimKind` logic exactly:
    // - top-level Random wins
    // - top-level Slope wins ONLY if top.num_frames > 1
    // - then check children one level deep, but only honor Random
    //   (child-level Stop is a paused sub-anim, not a slope tile)
    let mut found: Option<TileScriptKind> = None;
    let mut top_kind: Option<TileScriptKind> = None;
    for op in &top.ops {
        if matches!(op, OwnedOp::ShowFrame) {
            break;
        }
        if let OwnedOp::DoAction(bc) = op
            && let Some(k) = avm1_classify_frame1(bc)
        {
            top_kind = Some(k);
            break;
        }
    }
    if let Some(k) = top_kind {
        match k {
            TileScriptKind::Random => found = Some(k),
            TileScriptKind::Slope if top.num_frames > 1 => found = Some(k),
            _ => {}
        }
    }
    if found.is_none() {
        'outer: for op in &top.ops {
            if matches!(op, OwnedOp::ShowFrame) {
                break;
            }
            if let OwnedOp::Place(p) = op {
                for ca in &p.clip_actions {
                    if matches!(
                        avm1_classify_frame1(&ca.bytecode),
                        Some(TileScriptKind::Random)
                    ) {
                        found = Some(TileScriptKind::Random);
                        break 'outer;
                    }
                }
                if let Some(id) = p.character_id
                    && let Some(Symbol::Sprite(child)) = doc.lookup_id(id)
                {
                    for cop in &child.ops {
                        if matches!(cop, OwnedOp::ShowFrame) {
                            break;
                        }
                        if let OwnedOp::DoAction(bc) = cop
                            && matches!(
                                avm1_classify_frame1(bc),
                                Some(TileScriptKind::Random)
                            )
                        {
                            found = Some(TileScriptKind::Random);
                            break 'outer;
                        }
                    }
                }
            }
        }
    }
    fn deep(doc: &SwfDoc, sp: &OwnedSprite, depth: u32, best: &mut u16) {
        if depth == 0 {
            return;
        }
        for op in &sp.ops {
            if let OwnedOp::Place(p) = op {
                if let Some(id) = p.character_id
                    && let Some(Symbol::Sprite(child)) = doc.lookup_id(id)
                {
                    if child.num_frames > *best {
                        *best = child.num_frames;
                    }
                    deep(doc, child, depth - 1, best);
                }
            }
        }
    }
    let mut best = top.num_frames;
    deep(doc, top, 4, &mut best);
    let kind = match found {
        Some(TileScriptKind::Random) => "random".into(),
        Some(TileScriptKind::Slope) => "slope".into(),
        Some(TileScriptKind::Animated) => "animated".into(),
        None => {
            if best > 1 {
                "animated".into()
            } else {
                "".into()
            }
        }
    };
    (kind, top.num_frames, best)
}

fn main() -> Result<()> {
    let map_json = PathBuf::from(std::env::args().nth(1).unwrap());
    let bundles_dir = PathBuf::from(std::env::args().nth(2).unwrap());
    let raw = std::fs::read_to_string(&map_json)?;
    let v: serde_json::Value = serde_json::from_str(&raw)?;
    let cells = v["cells"].as_array().unwrap();
    let mut layer1: BTreeSet<u32> = BTreeSet::new();
    let mut layer2: BTreeSet<u32> = BTreeSet::new();
    let mut ground: BTreeSet<u32> = BTreeSet::new();
    for c in cells {
        if let Some(n) = c["layer1"].as_u64() {
            if n > 0 {
                layer1.insert(n as u32);
            }
        }
        if let Some(n) = c["layer2"].as_u64() {
            if n > 0 {
                layer2.insert(n as u32);
            }
        }
        if let Some(n) = c["ground"].as_u64() {
            if n > 0 {
                ground.insert(n as u32);
            }
        }
    }
    let object_bundles = ["o1", "o2", "o3", "o4", "o5", "o6", "o7", "o8", "o9", "o10", "o11", "o12"];
    let ground_bundles = ["g1", "g2"];

    let load = |name: &str| -> Option<SwfDoc> {
        let p: PathBuf = bundles_dir.join(format!("{}.swf", name));
        if p.exists() {
            SwfDoc::load(&p).ok()
        } else {
            None
        }
    };

    let docs_obj: Vec<(String, SwfDoc)> = object_bundles
        .iter()
        .filter_map(|n| load(n).map(|d| (n.to_string(), d)))
        .collect();
    let docs_grd: Vec<(String, SwfDoc)> = ground_bundles
        .iter()
        .filter_map(|n| load(n).map(|d| (n.to_string(), d)))
        .collect();

    let print = |label: &str, ids: &BTreeSet<u32>, docs: &[(String, SwfDoc)]| {
        println!("== {} ==", label);
        for id in ids {
            let s = id.to_string();
            for (name, doc) in docs {
                if doc.lookup_export(&s).is_some() {
                    let (kind, top_frames, deepest) = classify(doc, &s);
                    println!(
                        "{:>6}  {:>4}  top_frames={:<3} deepest={:<4} kind={}",
                        id, name, top_frames, deepest, kind
                    );
                    break;
                }
            }
        }
    };

    print("layer1", &layer1, &docs_obj);
    print("layer2", &layer2, &docs_obj);
    print("ground", &ground, &docs_grd);

    Ok(())
}

fn _silence_unused() {
    let _: &Path = Path::new("");
}
