//! Run a Dofus 1.29 lang SWF's root timeline scripts and return the
//! resulting top-level table as a `serde_json::Value::Object`. The
//! canonical reader (`dofus.utils.LangFileLoader.as:108-118`) iterates
//! `for(var k in mc)` after `onLoadInit`, ignoring `VERSION`,
//! `FILE_BEGIN`, `FILE_END`; we apply the same filter so the returned
//! map contains exactly the payload keys (`S`, `E`, …).

use serde_json::{Map, Value as Json};

use crate::swf_doc::{OwnedOp, SwfDoc};

use super::exec;
use super::state::{AvmEngine, ClipState, Value};

const ROOT_ID: u32 = 1;

#[derive(Debug, thiserror::Error)]
pub enum LangError {
    #[error("malformed SWF: {0}")]
    Parse(String),
    #[error("missing required key: {0}")]
    MissingKey(&'static str),
}

fn lift(value: &Value) -> Json {
    match value {
        Value::Undefined | Value::Null => Json::Null,
        Value::Number(n) => {
            if n.is_finite() {
                if n.fract() == 0.0 && n.abs() < 1e16 {
                    Json::from(*n as i64)
                } else {
                    serde_json::Number::from_f64(*n)
                        .map(Json::Number)
                        .unwrap_or(Json::Null)
                }
            } else {
                Json::Null
            }
        }
        Value::String(s) => Json::String(s.clone()),
        Value::Bool(b) => Json::Bool(*b),
        Value::Object(o) => {
            let mut out = Map::with_capacity(o.borrow().len());
            for (k, v) in o.borrow().iter() {
                out.insert(k.clone(), lift(v));
            }
            Json::Object(out)
        }
        Value::Array(a) => Json::Array(a.borrow().iter().map(lift).collect()),
        Value::Clip(_) | Value::Function(_) => Json::Null,
    }
}

/// Parse a lang SWF, execute its root scripts, and return the payload
/// keys as a `serde_json` map. The canonical metadata flags
/// (`VERSION`, `FILE_BEGIN`, `FILE_END`) are stripped.
pub fn extract(bytes: &[u8]) -> Result<Map<String, Json>, LangError> {
    let doc = SwfDoc::from_bytes(bytes).map_err(|e| LangError::Parse(e.to_string()))?;
    // Lang SWFs ship as SWF6; AVM1's reader needs the version for
    // opcode-set dispatch.
    let swf_version = 6;
    let mut engine = AvmEngine::new();
    engine
        .clips
        .insert(ROOT_ID, ClipState::new(doc.root.num_frames.max(1), None));
    if let Some(state) = engine.clips.get_mut(&ROOT_ID) {
        state.vars.insert("this".to_string(), Value::Clip(ROOT_ID));
    }
    for op in &doc.root.ops {
        if let OwnedOp::DoAction(bc) = op {
            exec(bc, swf_version, ROOT_ID, &mut engine);
        }
    }
    let Some(state) = engine.clips.get(&ROOT_ID) else {
        return Err(LangError::MissingKey("root"));
    };
    let mut out = Map::with_capacity(state.vars.len());
    for (k, v) in &state.vars {
        if matches!(k.as_str(), "VERSION" | "FILE_BEGIN" | "FILE_END" | "this") {
            continue;
        }
        out.insert(k.clone(), lift(v));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(bytecode: Vec<u8>) -> std::collections::HashMap<String, Value> {
        let mut engine = AvmEngine::new();
        engine.clips.insert(ROOT_ID, ClipState::new(1, None));
        engine
            .clips
            .get_mut(&ROOT_ID)
            .unwrap()
            .vars
            .insert("this".to_string(), Value::Clip(ROOT_ID));
        exec(&bytecode, 6, ROOT_ID, &mut engine);
        engine.clips.remove(&ROOT_ID).unwrap().vars
    }

    fn push_int(out: &mut Vec<u8>, n: i32) {
        let payload = std::iter::once(7u8)
            .chain(n.to_le_bytes())
            .collect::<Vec<u8>>();
        out.push(0x96);
        out.extend_from_slice(&(payload.len() as u16).to_le_bytes());
        out.extend_from_slice(&payload);
    }

    fn push_string(out: &mut Vec<u8>, s: &str) {
        let mut payload = vec![0u8];
        payload.extend_from_slice(s.as_bytes());
        payload.push(0);
        out.push(0x96);
        out.extend_from_slice(&(payload.len() as u16).to_le_bytes());
        out.extend_from_slice(&payload);
    }

    #[test]
    fn init_array_builds_in_source_order() {
        // Canonical AVM1 InitArray: stack on entry is
        // `[vN-1, …, v1, v0, N]`. Source-order `[a, b, c]` requires
        // pushing `c, b, a, 3` (length last).
        let mut bc = Vec::new();
        push_string(&mut bc, "arr");
        push_int(&mut bc, 30);
        push_int(&mut bc, 20);
        push_int(&mut bc, 10);
        push_int(&mut bc, 3);
        bc.push(0x42); // Action::InitArray
        bc.push(0x1d); // Action::SetVariable
        bc.push(0); // Action::End

        let vars = run(bc);
        let Value::Array(items) = vars.get("arr").unwrap() else {
            panic!("not an array");
        };
        let items = items.borrow();
        assert_eq!(items.len(), 3);
        for (i, expected) in [10.0, 20.0, 30.0].iter().enumerate() {
            match items[i] {
                Value::Number(n) => assert!((n - expected).abs() < 1e-9),
                ref other => panic!("expected number, got {other:?}"),
            }
        }
    }
}
