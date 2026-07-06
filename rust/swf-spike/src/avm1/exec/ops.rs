//! Bulky action handlers split out of the main dispatch in `mod.rs`
//! so the per-arm code stays readable.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use swf::avm1::types as swf_types;

use super::super::runtime::{
    call_global, call_method, lookup_member, pop_number, resolve_get, resolve_set,
};
use super::super::state::{AvmEngine, ExecOutcome, FnDef, InstanceId, Value};

pub(super) fn handle_goto_frame_2(
    g2: &swf_types::GotoFrame2,
    stack: &mut Vec<Value>,
    this_id: InstanceId,
    engine: &mut AvmEngine,
    outcome: &mut ExecOutcome,
) {
    let frame_value = stack.pop().unwrap_or(Value::Undefined);
    let frame = match &frame_value {
        Value::Number(n) => *n as i64,
        Value::String(s) => s.parse::<i64>().unwrap_or(0),
        _ => 0,
    };
    // Flash CLAMPS goto target to [1, total_frames]. spell 802's
    // sp6.d3 mask handler does `gotoAndStop(random(2)+1)` which can
    // pick frame 2 on a 1-frame sprite — Flash silently clamps to 1.
    let raw = (frame + i64::from(g2.scene_offset)).max(1) as u16;
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

pub(super) fn handle_call_method(
    stack: &mut Vec<Value>,
    this_id: InstanceId,
    engine: &mut AvmEngine,
    outcome: &mut ExecOutcome,
) {
    let method_name = stack.pop().map(|v| v.as_string()).unwrap_or_default();
    let target = stack.pop().unwrap_or(Value::Undefined);
    let num_args = pop_number(stack) as usize;
    let mut args = Vec::with_capacity(num_args);
    for _ in 0..num_args {
        args.push(stack.pop().unwrap_or(Value::Undefined));
    }
    let resolved_member = lookup_member(&target, &method_name, engine);
    let result = if let Value::Function(fn_def) = resolved_member {
        let call_this = match &target {
            Value::Clip(id) => *id,
            _ => this_id,
        };
        let sub = super::exec_with_pool(
            &fn_def.code,
            fn_def.swf_version,
            call_this,
            engine,
            fn_def.constant_pool.clone(),
        );
        outcome.spawns.extend(sub.spawns);
        sub.return_value.unwrap_or(Value::Undefined)
    } else {
        call_method(&method_name, &target, &args, this_id, engine, outcome)
    };
    stack.push(result);
}

pub(super) fn handle_call_function(
    stack: &mut Vec<Value>,
    this_id: InstanceId,
    engine: &mut AvmEngine,
    outcome: &mut ExecOutcome,
) {
    let fn_name = stack.pop().map(|v| v.as_string()).unwrap_or_default();
    let num_args = pop_number(stack) as usize;
    let mut args = Vec::with_capacity(num_args);
    for _ in 0..num_args {
        args.push(stack.pop().unwrap_or(Value::Undefined));
    }
    let resolved = resolve_get(&fn_name, this_id, engine);
    let result = if let Value::Function(fn_def) = resolved {
        let sub = super::exec_with_pool(
            &fn_def.code,
            fn_def.swf_version,
            this_id,
            engine,
            fn_def.constant_pool.clone(),
        );
        outcome.spawns.extend(sub.spawns);
        sub.return_value.unwrap_or(Value::Undefined)
    } else {
        call_global(&fn_name, &args, this_id, engine, outcome)
    };
    stack.push(result);
}

pub(super) fn handle_define_function(
    df: &swf_types::DefineFunction<'_>,
    swf_version: u8,
    constant_pool: &[String],
    stack: &mut Vec<Value>,
    this_id: InstanceId,
    engine: &mut AvmEngine,
) {
    let fn_def = Rc::new(FnDef {
        code: df.actions.to_vec(),
        swf_version,
        constant_pool: Rc::new(constant_pool.to_vec()),
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

pub(super) fn handle_define_function_2(
    df: &swf_types::DefineFunction2<'_>,
    swf_version: u8,
    constant_pool: &[String],
    stack: &mut Vec<Value>,
    this_id: InstanceId,
    engine: &mut AvmEngine,
) {
    let fn_def = Rc::new(FnDef {
        code: df.actions.to_vec(),
        swf_version,
        constant_pool: Rc::new(constant_pool.to_vec()),
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

pub(super) fn handle_init_object(stack: &mut Vec<Value>) {
    let num_pairs = pop_number(stack) as usize;
    let mut map: HashMap<String, Value> = HashMap::with_capacity(num_pairs);
    for _ in 0..num_pairs {
        let value = stack.pop().unwrap_or(Value::Undefined);
        let key = stack.pop().map(|v| v.as_string()).unwrap_or_default();
        map.insert(key, value);
    }
    stack.push(Value::Object(Rc::new(RefCell::new(map))));
}

pub(super) fn handle_init_array(stack: &mut Vec<Value>) {
    // AVM1 InitArray: pop length, then pop `length` values pushed in
    // reverse order (last element on top). Builds the array as a normal
    // Vec keeping insertion order matching the source `[a, b, c]`.
    let len = pop_number(stack) as usize;
    let mut elems: Vec<Value> = Vec::with_capacity(len);
    for _ in 0..len {
        elems.push(stack.pop().unwrap_or(Value::Undefined));
    }
    stack.push(Value::Array(Rc::new(RefCell::new(elems))));
}

pub(super) fn handle_new_object(stack: &mut Vec<Value>) {
    let _class_name = stack.pop().map(|v| v.as_string()).unwrap_or_default();
    let num_args = pop_number(stack) as usize;
    for _ in 0..num_args {
        stack.pop();
    }
    stack.push(Value::Object(Rc::new(RefCell::new(HashMap::new()))));
}

#[cfg(not(target_arch = "wasm32"))]
pub(super) fn log_unimplemented_once(action: &swf::avm1::types::Action<'_>) {
    use std::sync::Mutex;
    static SEEN: Mutex<Option<std::collections::HashSet<String>>> = Mutex::new(None);
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

#[cfg(target_arch = "wasm32")]
pub(super) fn log_unimplemented_once(_action: &swf::avm1::types::Action<'_>) {}
