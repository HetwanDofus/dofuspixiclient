//! AVM1 bytecode interpreter. One big `match` on `Action::*`.
//! Reads from a clip's bytecode, mutates the engine's clip state,
//! returns an `ExecOutcome` carrying any frame-jump / spawn /
//! return-value the script triggered.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use swf::avm1::read::Reader;
use swf::avm1::types::{Action, Push, Value as PushValue};

use super::runtime::{
    call_global, call_method, lookup_member, pop_number, prop_index, property_get,
    property_set, push_value_to_value, rand_u32, resolve_get, resolve_set, resolve_target,
};
use super::state::{AvmEngine, ExecOutcome, FnDef, InstanceId, Value};

/// Execute a chunk of AVM1 bytecode against `this_id`. `swf_version` should be
/// the file's reported version (`SwfDoc::stage_size` is per-file; we pass it
/// down).
pub fn exec(
    bytecode: &[u8],
    swf_version: u8,
    this_id: InstanceId,
    engine: &mut AvmEngine,
) -> ExecOutcome {
    let mut stack: Vec<Value> = Vec::with_capacity(8);
    let mut constant_pool: Vec<String> = Vec::new();
    let mut outcome = ExecOutcome::default();
    let mut reader = Reader::new(bytecode, swf_version);
    // 256-slot register file. AVM1 `StoreRegister` writes the top-of-stack
    // here, used by the AS2 compiler as scratch storage. AVM1 (SWF 5+) has
    // 4 base registers; DefineFunction2 can declare more (we don't model
    // function frames yet, so 256 is generous).
    let mut registers: Vec<Value> = vec![Value::Undefined; 256];

    loop {
        let action = match reader.read_action() {
            Ok(a) => a,
            Err(_) => break,
        };
        match action {
            Action::End => break,
            Action::ConstantPool(cp) => {
                constant_pool = cp
                    .strings
                    .iter()
                    .map(|s| s.to_string_lossy(swf::UTF_8).to_string())
                    .collect();
            }
            Action::Push(Push { values }) => {
                for v in values {
                    let pushed = match &v {
                        PushValue::Register(idx) => registers
                            .get(*idx as usize)
                            .cloned()
                            .unwrap_or(Value::Undefined),
                        _ => push_value_to_value(&v, &constant_pool),
                    };
                    stack.push(pushed);
                }
            }
            Action::Pop => {
                stack.pop();
            }
            Action::Stop => {
                outcome.stop = true;
                if let Some(s) = engine.clips.get_mut(&this_id) {
                    s.playing = false;
                }
            }
            Action::Play => {
                outcome.play = true;
                if let Some(s) = engine.clips.get_mut(&this_id) {
                    s.playing = true;
                }
            }
            Action::RandomNumber => {
                let n = pop_number(&mut stack).max(0.0);
                let r = if n <= 0.0 {
                    0.0
                } else {
                    (rand_u32() as f64 / u32::MAX as f64 * n).floor()
                };
                stack.push(Value::Number(r));
            }
            Action::Add2 => {
                // AVM1's `+` adds numbers OR concatenates strings if either
                // operand is a string. Spell 802 only uses it numerically,
                // but model the type check faithfully so other spells don't
                // silently NaN.
                let b = stack.pop().unwrap_or(Value::Undefined);
                let a = stack.pop().unwrap_or(Value::Undefined);
                let result = if matches!(a, Value::String(_)) || matches!(b, Value::String(_)) {
                    Value::String(format!("{}{}", a.as_string(), b.as_string()))
                } else {
                    Value::Number(a.as_f64() + b.as_f64())
                };
                stack.push(result);
            }
            Action::Subtract => {
                let b = pop_number(&mut stack);
                let a = pop_number(&mut stack);
                stack.push(Value::Number(a - b));
            }
            Action::Multiply => {
                let b = pop_number(&mut stack);
                let a = pop_number(&mut stack);
                stack.push(Value::Number(a * b));
            }
            Action::Divide => {
                let b = pop_number(&mut stack);
                let a = pop_number(&mut stack);
                stack.push(Value::Number(a / b));
            }
            Action::GetVariable => {
                let name = stack.pop().map(|v| v.as_string()).unwrap_or_default();
                let v = resolve_get(&name, this_id, engine);
                stack.push(v);
            }
            Action::SetVariable => {
                let value = stack.pop().unwrap_or(Value::Undefined);
                let name = stack.pop().map(|v| v.as_string()).unwrap_or_default();
                resolve_set(&name, value, this_id, engine);
            }
            Action::GetProperty => {
                let prop_idx = pop_number(&mut stack) as i32;
                let target_path = stack.pop().map(|v| v.as_string()).unwrap_or_default();
                let target_id = resolve_target(&target_path, this_id, engine);
                let value = match target_id.and_then(|id| engine.clips.get(&id)) {
                    Some(state) => property_get(state, prop_idx),
                    None => Value::Undefined,
                };
                stack.push(value);
            }
            Action::SetProperty => {
                let value = stack.pop().unwrap_or(Value::Undefined);
                let prop_idx = pop_number(&mut stack) as i32;
                let target_path = stack.pop().map(|v| v.as_string()).unwrap_or_default();
                if let Some(target_id) = resolve_target(&target_path, this_id, engine)
                    && let Some(state) = engine.clips.get_mut(&target_id)
                {
                    property_set(state, prop_idx, value);
                }
            }
            Action::GetMember => {
                let member = stack.pop().map(|v| v.as_string()).unwrap_or_default();
                let target = stack.pop().unwrap_or(Value::Undefined);
                let value = match target {
                    Value::Clip(id) => match engine.clips.get(&id) {
                        Some(state) => match prop_index(&member) {
                            Some(idx) => property_get(state, idx),
                            None => state.vars.get(&member).cloned().unwrap_or(Value::Undefined),
                        },
                        None => Value::Undefined,
                    },
                    Value::Object(o) => o.borrow().get(&member).cloned().unwrap_or(Value::Undefined),
                    _ => Value::Undefined,
                };
                stack.push(value);
            }
            Action::SetMember => {
                let value = stack.pop().unwrap_or(Value::Undefined);
                let member = stack.pop().map(|v| v.as_string()).unwrap_or_default();
                let target = stack.pop().unwrap_or(Value::Undefined);
                match target {
                    Value::Clip(id) => {
                        if let Some(state) = engine.clips.get_mut(&id) {
                            match prop_index(&member) {
                                Some(idx) => property_set(state, idx, value),
                                None => {
                                    state.vars.insert(member, value);
                                }
                            }
                        }
                    }
                    Value::Object(o) => {
                        o.borrow_mut().insert(member, value);
                    }
                    _ => {}
                }
            }
            Action::GotoFrame2(g2) => {
                // Stack: [frame]. `set_playing` flag controls whether we
                // play or stop after the jump.
                let frame_value = stack.pop().unwrap_or(Value::Undefined);
                let frame = match &frame_value {
                    Value::Number(n) => *n as i64,
                    Value::String(s) => s.parse::<i64>().unwrap_or(0),
                    _ => 0,
                };
                // GotoFrame2 frame numbers are 0-indexed plus the
                // `scene_offset`. Most Dofus content uses 0 scene offset and
                // 0-indexed frames, but the AS source `gotoAndStop(N+1)` we
                // dump is the human form — bytecode pushed N then the goto
                // adds 1 internally. Treat the popped value as the 1-indexed
                // frame already.
                // Flash CLAMPS goto target to [1, total_frames]. spell 802's
                // sp6.d3 mask handler does `gotoAndStop(random(2)+1)` which
                // can pick frame 2 on a 1-frame sprite — Flash silently
                // clamps to 1. Without this, our `_currentframe` reads back
                // 2 forever, diverging from Flash logs.
                let raw = (frame as i64 + i64::from(g2.scene_offset)).max(1) as u16;
                if let Some(state) = engine.clips.get_mut(&this_id) {
                    let target_frame = raw.min(state.total_frames.max(1));
                    outcome.goto = Some(target_frame);
                    state.current_frame = target_frame;
                    state.playing = g2.set_playing;
                } else {
                    outcome.goto = Some(raw);
                }
                if g2.set_playing {
                    outcome.play = true;
                } else {
                    outcome.stop = true;
                }
            }
            Action::CallMethod => {
                // Stack: [method_name, target, num_args, args...]
                let method_name = stack.pop().map(|v| v.as_string()).unwrap_or_default();
                let target = stack.pop().unwrap_or(Value::Undefined);
                let num_args = pop_number(&mut stack) as usize;
                let mut args = Vec::with_capacity(num_args);
                for _ in 0..num_args {
                    args.push(stack.pop().unwrap_or(Value::Undefined));
                }
                // Resolve member: if it's a user-defined Function, recurse
                // exec into it. `this` for the call = the resolved target.
                let resolved_member = lookup_member(&target, &method_name, engine);
                let result = if let Value::Function(fn_def) = resolved_member {
                    let call_this = match &target {
                        Value::Clip(id) => *id,
                        _ => this_id,
                    };
                    let sub = exec(&fn_def.code, fn_def.swf_version, call_this, engine);
                    outcome.spawns.extend(sub.spawns);
                    sub.return_value.unwrap_or(Value::Undefined)
                } else {
                    call_method(
                        &method_name,
                        &target,
                        &args,
                        this_id,
                        engine,
                        &mut outcome,
                    )
                };
                stack.push(result);
            }
            Action::CallFunction => {
                // Stack: [function_name, num_args, args...]
                let fn_name = stack.pop().map(|v| v.as_string()).unwrap_or_default();
                let num_args = pop_number(&mut stack) as usize;
                let mut args = Vec::with_capacity(num_args);
                for _ in 0..num_args {
                    args.push(stack.pop().unwrap_or(Value::Undefined));
                }
                // Resolve as a local user-defined function first; if it's
                // a Function, invoke it (the AS2 source `myFn(x)` ends up
                // here when `myFn` is a clip-local or root-level function).
                let resolved = resolve_get(&fn_name, this_id, engine);
                let result = if let Value::Function(fn_def) = resolved {
                    let sub = exec(&fn_def.code, fn_def.swf_version, this_id, engine);
                    outcome.spawns.extend(sub.spawns);
                    sub.return_value.unwrap_or(Value::Undefined)
                } else {
                    call_global(&fn_name, &args, this_id, engine, &mut outcome)
                };
                stack.push(result);
            }
            // Trace: pops one value, logs it to stderr. Used for parity
            // checking against Flash Player Debugger's flashlog.txt — when
            // we feed a traced SWF through our renderer, the trace output
            // can be diffed line-by-line against Flash's.
            Action::Trace => {
                let v = stack.pop().unwrap_or(Value::Undefined);
                #[cfg(not(target_arch = "wasm32"))]
                eprintln!("{}", v.as_string());
            }
            // ---- Comparisons (32 spells use Less2, 30 Greater, 26 Equals2) ----
            Action::Less2 => {
                let b = pop_number(&mut stack);
                let a = pop_number(&mut stack);
                stack.push(Value::Bool(a < b));
            }
            Action::Greater => {
                let b = pop_number(&mut stack);
                let a = pop_number(&mut stack);
                stack.push(Value::Bool(a > b));
            }
            Action::Equals2 => {
                // Loose equality with type coercion (==). Strings compare
                // as strings; numbers as numbers; null/undefined are equal
                // to each other.
                let b = stack.pop().unwrap_or(Value::Undefined);
                let a = stack.pop().unwrap_or(Value::Undefined);
                let eq = match (&a, &b) {
                    (Value::Undefined | Value::Null, Value::Undefined | Value::Null) => true,
                    (Value::String(_), _) | (_, Value::String(_)) => a.as_string() == b.as_string(),
                    _ => a.as_f64() == b.as_f64(),
                };
                stack.push(Value::Bool(eq));
            }
            // ---- Boolean (49 spells use Not) ----
            Action::Not => {
                let v = stack.pop().unwrap_or(Value::Undefined);
                stack.push(Value::Bool(!v.as_bool()));
            }
            // ---- Arithmetic (32 Increment, 5 Modulo, 15 BitAnd) ----
            Action::Increment => {
                let n = pop_number(&mut stack);
                stack.push(Value::Number(n + 1.0));
            }
            Action::Decrement => {
                let n = pop_number(&mut stack);
                stack.push(Value::Number(n - 1.0));
            }
            Action::Modulo => {
                let b = pop_number(&mut stack);
                let a = pop_number(&mut stack);
                stack.push(Value::Number(a % b));
            }
            Action::BitAnd => {
                let b = pop_number(&mut stack) as i32;
                let a = pop_number(&mut stack) as i32;
                stack.push(Value::Number(f64::from(a & b)));
            }
            Action::BitOr => {
                let b = pop_number(&mut stack) as i32;
                let a = pop_number(&mut stack) as i32;
                stack.push(Value::Number(f64::from(a | b)));
            }
            Action::BitXor => {
                let b = pop_number(&mut stack) as i32;
                let a = pop_number(&mut stack) as i32;
                stack.push(Value::Number(f64::from(a ^ b)));
            }
            Action::BitLShift => {
                let b = pop_number(&mut stack) as i32;
                let a = pop_number(&mut stack) as i32;
                stack.push(Value::Number(f64::from(a << (b & 0x1f))));
            }
            Action::BitRShift => {
                let b = pop_number(&mut stack) as i32;
                let a = pop_number(&mut stack) as i32;
                stack.push(Value::Number(f64::from(a >> (b & 0x1f))));
            }
            // ---- Control flow (49 If, 14 Jump) ----
            Action::Jump(j) => {
                // Jump's offset is signed: positive jumps forward, negative
                // jumps back. Reader::seek modifies the input slice within
                // the original bytecode — exactly what we need here.
                reader.seek(bytecode, j.offset);
            }
            Action::If(j) => {
                let cond = stack.pop().unwrap_or(Value::Undefined).as_bool();
                if cond {
                    reader.seek(bytecode, j.offset);
                }
            }
            // ---- Register file (27 spells) ----
            // StoreRegister copies the top of the stack into a register
            // WITHOUT popping. The AS2 compiler emits this for repeated
            // expressions (`r = expensive_call(); use r; use r;`).
            Action::StoreRegister(r) => {
                if let Some(v) = stack.last() {
                    let idx = r.register as usize;
                    if idx < registers.len() {
                        registers[idx] = v.clone();
                    }
                }
            }
            // ---- Variable scoping (4 spells) ----
            // DefineLocal pops [name, value]. We don't model true function
            // scopes yet, so locals land on the same `vars` map as
            // SetVariable — fine in practice because spell scripts don't
            // recurse function calls.
            Action::DefineLocal => {
                let value = stack.pop().unwrap_or(Value::Undefined);
                let name = stack.pop().map(|v| v.as_string()).unwrap_or_default();
                resolve_set(&name, value, this_id, engine);
            }
            Action::DefineLocal2 => {
                // Same as DefineLocal but pops only the name; sets it to
                // undefined.
                let name = stack.pop().map(|v| v.as_string()).unwrap_or_default();
                resolve_set(&name, Value::Undefined, this_id, engine);
            }
            // ---- Old-style GotoFrame (8 spells) ----
            // Frame field is 0-indexed in the SWF spec; we store
            // 1-indexed. After goto, playing semantics depend on whether
            // the prior tag was a Stop/Play — we just set the frame; the
            // outer renderer handles the rest.
            Action::GotoFrame(g) => {
                let target = (u32::from(g.frame) + 1) as u16; // 0-based → 1-based
                if let Some(state) = engine.clips.get_mut(&this_id) {
                    let target = target.max(1).min(state.total_frames.max(1));
                    state.current_frame = target;
                    outcome.goto = Some(target);
                }
            }
            // RemoveSprite: pops target, removes that clip.
            Action::RemoveSprite => {
                let target_path = stack.pop().map(|v| v.as_string()).unwrap_or_default();
                if let Some(target_id) = resolve_target(&target_path, this_id, engine)
                    && let Some(state) = engine.clips.get_mut(&target_id)
                {
                    state.removed = true;
                }
            }
            // ---- DefineFunction (3 spells) ----
            // Pushes a Function value onto the stack. The function body's
            // bytecode is captured verbatim so we can re-execute it on
            // every CallMethod / event dispatch.
            Action::DefineFunction(df) => {
                let params: Vec<String> = df
                    .params
                    .iter()
                    .map(|p| p.to_string_lossy(swf::UTF_8).to_string())
                    .collect();
                let fn_def = Rc::new(FnDef {
                    params,
                    code: df.actions.to_vec(),
                    swf_version,
                    register_count: 0,
                });
                let name = df.name.to_string_lossy(swf::UTF_8).to_string();
                let value = Value::Function(fn_def);
                if name.is_empty() {
                    // Anonymous function literal — push for the next op
                    // (typically SetMember or SetVariable) to grab.
                    stack.push(value);
                } else {
                    // Named function — registered as a local variable
                    // AND pushed (matches Flash behavior).
                    resolve_set(&name, value.clone(), this_id, engine);
                    stack.push(value);
                }
            }
            Action::DefineFunction2(df) => {
                let params: Vec<String> = df
                    .params
                    .iter()
                    .map(|p| p.name.to_string_lossy(swf::UTF_8).to_string())
                    .collect();
                let fn_def = Rc::new(FnDef {
                    params,
                    code: df.actions.to_vec(),
                    swf_version,
                    register_count: df.register_count,
                });
                let name = df.name.to_string_lossy(swf::UTF_8).to_string();
                let value = Value::Function(fn_def);
                if name.is_empty() {
                    stack.push(value);
                } else {
                    resolve_set(&name, value.clone(), this_id, engine);
                    stack.push(value);
                }
            }
            // ---- Return (1 spell directly; many via DefineFunction bodies) ----
            Action::Return => {
                outcome.return_value = stack.pop();
                break;
            }
            // ---- InitObject (1 spell directly + many DefineFunction
            // bodies) — pops num_pairs, then num_pairs * 2 items (key,
            // value pairs in interleaved order on the stack), pushes a
            // fresh Object value.
            Action::InitObject => {
                let num_pairs = pop_number(&mut stack) as usize;
                let mut map: HashMap<String, Value> = HashMap::with_capacity(num_pairs);
                for _ in 0..num_pairs {
                    let value = stack.pop().unwrap_or(Value::Undefined);
                    let key = stack.pop().map(|v| v.as_string()).unwrap_or_default();
                    map.insert(key, value);
                }
                stack.push(Value::Object(Rc::new(RefCell::new(map))));
            }
            // NewObject: pops object_class_name, num_args, args... — used
            // for `new Object()` / `new MyClass(args)`. We don't model
            // classes, but a bare `new Object()` should yield an empty
            // object literal.
            Action::NewObject => {
                let _class_name = stack.pop().map(|v| v.as_string()).unwrap_or_default();
                let num_args = pop_number(&mut stack) as usize;
                for _ in 0..num_args {
                    stack.pop();
                }
                stack.push(Value::Object(Rc::new(RefCell::new(HashMap::new()))));
            }
            // Quietly ignore opcodes we don't model — this lets the script
            // run as far as possible. Most spells degrade to "default
            // timeline" behavior rather than crashing.
            _ => {
                // Log every distinct unimplemented action variant so the
                // coverage survey across all spells gets the full set, not
                // just whichever one fires first.
                #[cfg(not(target_arch = "wasm32"))]
                {
                    use std::sync::Mutex;
                    static SEEN: Mutex<Option<std::collections::HashSet<String>>> =
                        Mutex::new(None);
                    let key = format!("{action:?}");
                    let head: String = key
                        .split(|c: char| c == '(' || c == ' ')
                        .next()
                        .unwrap_or(&key)
                        .to_string();
                    let mut guard = SEEN.lock().unwrap();
                    let set = guard.get_or_insert_with(Default::default);
                    if set.insert(head.clone()) {
                        eprintln!("[avm1] unimplemented action: {head}");
                    }
                }
            }
        }
    }
    outcome
}
