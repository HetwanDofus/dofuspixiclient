//! AVM1 bytecode interpreter. One big `match` on `Action::*`.
//! Reads from a clip's bytecode, mutates the engine's clip state,
//! returns an `ExecOutcome` carrying any frame-jump / spawn /
//! return-value the script triggered.

mod ops;

use swf::avm1::read::Reader;
use swf::avm1::types::{Action, Push, Value as PushValue};

use super::runtime::{
    pop_number, prop_index, property_get, property_set, push_value_to_value, rand_u32, resolve_get,
    resolve_set, resolve_target,
};
use super::state::{AvmEngine, ExecOutcome, InstanceId, Value};

/// Execute a chunk of AVM1 bytecode against `this_id`. `swf_version` should be
/// the file's reported version.
pub fn exec(
    bytecode: &[u8],
    swf_version: u8,
    this_id: InstanceId,
    engine: &mut AvmEngine,
) -> ExecOutcome {
    exec_with_pool(
        bytecode,
        swf_version,
        this_id,
        engine,
        std::rc::Rc::new(Vec::new()),
    )
}

/// Like [`exec`], but seeds the constant pool — used to invoke a function body
/// with its closure's captured pool (`FnDef::constant_pool`).
pub(crate) fn exec_with_pool(
    bytecode: &[u8],
    swf_version: u8,
    this_id: InstanceId,
    engine: &mut AvmEngine,
    mut constant_pool: std::rc::Rc<Vec<String>>,
) -> ExecOutcome {
    let mut stack: Vec<Value> = Vec::with_capacity(8);
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
                constant_pool = std::rc::Rc::new(
                    cp.strings
                        .iter()
                        .map(|s| s.to_string_lossy(swf::UTF_8).to_string())
                        .collect(),
                );
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
                // operand is a string.
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
                    Value::Object(o) => {
                        o.borrow().get(&member).cloned().unwrap_or(Value::Undefined)
                    }
                    Value::Array(a) => {
                        if member == "length" {
                            Value::Number(a.borrow().len() as f64)
                        } else if let Ok(idx) = member.parse::<usize>() {
                            a.borrow().get(idx).cloned().unwrap_or(Value::Undefined)
                        } else {
                            Value::Undefined
                        }
                    }
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
                    Value::Array(a) => {
                        if let Ok(idx) = member.parse::<usize>() {
                            let mut v = a.borrow_mut();
                            if idx >= v.len() {
                                v.resize(idx + 1, Value::Undefined);
                            }
                            v[idx] = value;
                        }
                    }
                    _ => {}
                }
            }
            Action::GotoFrame2(g2) => {
                ops::handle_goto_frame_2(&g2, &mut stack, this_id, engine, &mut outcome);
            }
            Action::CallMethod => {
                ops::handle_call_method(&mut stack, this_id, engine, &mut outcome);
            }
            Action::CallFunction => {
                ops::handle_call_function(&mut stack, this_id, engine, &mut outcome);
            }
            // Trace: pops one value, logs to stderr. Used for parity
            // checking against Flash Player Debugger's flashlog.txt.
            Action::Trace => {
                let v = stack.pop().unwrap_or(Value::Undefined);
                #[cfg(not(target_arch = "wasm32"))]
                eprintln!("{}", v.as_string());
                #[cfg(target_arch = "wasm32")]
                let _ = v;
            }
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
                let b = stack.pop().unwrap_or(Value::Undefined);
                let a = stack.pop().unwrap_or(Value::Undefined);
                let eq = match (&a, &b) {
                    (Value::Undefined | Value::Null, Value::Undefined | Value::Null) => true,
                    (Value::String(_), _) | (_, Value::String(_)) => a.as_string() == b.as_string(),
                    _ => a.as_f64() == b.as_f64(),
                };
                stack.push(Value::Bool(eq));
            }
            Action::Not => {
                let v = stack.pop().unwrap_or(Value::Undefined);
                stack.push(Value::Bool(!v.as_bool()));
            }
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
            Action::Jump(j) => {
                reader.seek(bytecode, j.offset);
            }
            Action::If(j) => {
                let cond = stack.pop().unwrap_or(Value::Undefined).as_bool();
                if cond {
                    reader.seek(bytecode, j.offset);
                }
            }
            // StoreRegister copies the top of the stack into a register
            // WITHOUT popping.
            Action::StoreRegister(r) => {
                if let Some(v) = stack.last() {
                    let idx = r.register as usize;
                    if idx < registers.len() {
                        registers[idx] = v.clone();
                    }
                }
            }
            Action::DefineLocal => {
                let value = stack.pop().unwrap_or(Value::Undefined);
                let name = stack.pop().map(|v| v.as_string()).unwrap_or_default();
                resolve_set(&name, value, this_id, engine);
            }
            Action::DefineLocal2 => {
                let name = stack.pop().map(|v| v.as_string()).unwrap_or_default();
                resolve_set(&name, Value::Undefined, this_id, engine);
            }
            Action::GotoFrame(g) => {
                let target = (u32::from(g.frame) + 1) as u16;
                if let Some(state) = engine.clips.get_mut(&this_id) {
                    let target = target.max(1).min(state.total_frames.max(1));
                    state.current_frame = target;
                    // A bare `ActionGotoFrame` is `gotoAndStop` — the AS2
                    // compiler emits just the goto for a constant-frame
                    // `gotoAndStop(N)`, and goto + `ActionPlay` (or
                    // `GotoFrame2` with the play flag) for `gotoAndPlay`. So
                    // stop here; a following `Play` re-sets `playing`. Without
                    // this, decor frozen by `onClipEvent(load){gotoAndStop(N)}`
                    // (e.g. the class-temple emblem, o2 sprite 472) keeps
                    // "playing" and animates forever.
                    state.playing = false;
                    outcome.goto = Some(target);
                }
            }
            Action::RemoveSprite => {
                // `removeMovieClip(target)` — target is a clip ref (`this` now
                // yields `Value::Clip`; spell 103 `effet` f16 self-removes) or a
                // path string.
                let target_id = match stack.pop().unwrap_or(Value::Undefined) {
                    Value::Clip(id) => Some(id),
                    other => resolve_target(&other.as_string(), this_id, engine),
                };
                if let Some(target_id) = target_id
                    && let Some(state) = engine.clips.get_mut(&target_id)
                {
                    state.removed = true;
                }
            }
            Action::DefineFunction(df) => {
                ops::handle_define_function(
                    &df,
                    swf_version,
                    &constant_pool,
                    &mut stack,
                    this_id,
                    engine,
                );
            }
            Action::DefineFunction2(df) => {
                ops::handle_define_function_2(
                    &df,
                    swf_version,
                    &constant_pool,
                    &mut stack,
                    this_id,
                    engine,
                );
            }
            Action::Return => {
                outcome.return_value = stack.pop();
                break;
            }
            // `gotoAndPlay("label")` — record the label; the renderer resolves
            // it to a frame via the running clip's `frame_labels`. Used by
            // spells 704-713's animation timelines.
            Action::GotoLabel(g) => {
                outcome.goto_label = Some(g.label.to_string_lossy(swf::UTF_8).to_string());
            }
            Action::InitObject => {
                ops::handle_init_object(&mut stack);
            }
            Action::InitArray => {
                ops::handle_init_array(&mut stack);
            }
            Action::NewObject => {
                ops::handle_new_object(&mut stack);
            }
            // Quietly ignore opcodes we don't model — this lets the script
            // run as far as possible. Most spells degrade to "default
            // timeline" behavior rather than crashing.
            other => {
                ops::log_unimplemented_once(&other);
            }
        }
    }
    outcome
}
