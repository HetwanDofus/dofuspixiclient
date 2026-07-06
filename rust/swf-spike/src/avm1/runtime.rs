//! Shared AVM1 runtime helpers used by the bytecode interpreter:
//! property index resolution, target path lookup, member access,
//! method dispatch (Math.*, gotoAndStop, attachMovie, ...), and a
//! cheap thread-local PRNG for `random(n)`.

use swf::avm1::types::Value as PushValue;

use super::state::{AvmEngine, ClipState, ExecOutcome, InstanceId, SpawnRequest, Value};

pub(super) fn push_value_to_value(v: &PushValue<'_>, pool: &[String]) -> Value {
    match v {
        PushValue::Undefined => Value::Undefined,
        PushValue::Null => Value::Null,
        PushValue::Bool(b) => Value::Bool(*b),
        PushValue::Int(i) => Value::Number(f64::from(*i)),
        PushValue::Float(f) => Value::Number(f64::from(*f)),
        PushValue::Double(d) => Value::Number(*d),
        PushValue::Str(s) => Value::String(s.to_string_lossy(swf::UTF_8).to_string()),
        PushValue::Register(_) => Value::Undefined,
        PushValue::ConstantPool(idx) => pool
            .get(*idx as usize)
            .cloned()
            .map(Value::String)
            .unwrap_or(Value::Undefined),
    }
}

pub(super) fn pop_number(stack: &mut Vec<Value>) -> f64 {
    stack.pop().map(|v| v.as_f64()).unwrap_or(f64::NAN)
}

/// Public re-export so render_avm1's `apply_spawns` can resolve init-object
/// keys (`_x`/`_y`/etc.) the same way the interpreter does.
pub fn prop_index_pub(name: &str) -> Option<i32> {
    prop_index(name)
}

/// Public re-export of `property_set` for the same reason.
pub fn property_set_pub(state: &mut ClipState, idx: i32, value: Value) {
    property_set(state, idx, value)
}

/// Map a Flash `_<name>` property accessor or numeric SetProperty index to a
/// canonical numeric index. Returns None for non-property names.
pub(super) fn prop_index(name: &str) -> Option<i32> {
    Some(match name {
        "_x" => 0,
        "_y" => 1,
        "_xscale" => 2,
        "_yscale" => 3,
        "_currentframe" => 4,
        "_totalframes" => 5,
        "_alpha" => 6,
        "_visible" => 7,
        "_width" => 8,
        "_height" => 9,
        "_rotation" => 10,
        _ => return None,
    })
}

pub(super) fn property_get(state: &ClipState, idx: i32) -> Value {
    match idx {
        0 => Value::Number(state.x),
        1 => Value::Number(state.y),
        2 => Value::Number(state.xscale),
        3 => Value::Number(state.yscale),
        4 => Value::Number(f64::from(state.current_frame)),
        5 => Value::Number(f64::from(state.total_frames)),
        6 => Value::Number(state.alpha),
        10 => Value::Number(state.rotation),
        _ => Value::Number(0.0),
    }
}

pub(super) fn property_set(state: &mut ClipState, idx: i32, value: Value) {
    // Flash silently coerces NaN/Inf assignments to 0 via i32 cast in the
    // twips path. We mirror that here so `_x = Math.sin(undef) * 100`
    // doesn't poison state.x with NaN, which would later flow into the
    // world matrix and make Vello produce a fully transparent frame
    // (silent failure mode in render-to-texture).
    let mut n = value.as_f64();
    if !n.is_finite() {
        n = 0.0;
    }
    // Setting any transform property flips the `transformed_by_script` flag.
    // Subsequent timeline Modify/Place matrix updates on this clip become
    // no-ops (Flash semantic — see `ClipState::transformed_by_script`).
    // _alpha (6) does NOT count — color_transform isn't strictly part of
    // the matrix. But Ruffle's apply_place_object also gates color_transform
    // on this flag, so we include 6 too for parity.
    match idx {
        0 | 1 | 2 | 3 | 6 | 10 => state.transformed_by_script = true,
        _ => {}
    }
    match idx {
        0 => state.x = n,
        1 => state.y = n,
        2 => state.xscale = n,
        3 => state.yscale = n,
        6 => state.alpha = n,
        10 => state.rotation = n,
        _ => {} // Other properties (_visible, _width, _height) — not modelled.
    }
}

/// Resolve a target path string like `""`, `"this"`, `"_parent"`, `"_root"`.
/// Returns the InstanceId of the resolved clip, or None if the path didn't
/// resolve (we don't support deep absolute paths yet).
pub(super) fn resolve_target(
    path: &str,
    this_id: InstanceId,
    engine: &AvmEngine,
) -> Option<InstanceId> {
    match path {
        "" | "this" => Some(this_id),
        "_parent" => engine.clips.get(&this_id).and_then(|s| s.parent),
        "_root" => {
            // Walk up to the topmost ancestor.
            let mut cur = this_id;
            while let Some(parent) = engine.clips.get(&cur).and_then(|s| s.parent) {
                cur = parent;
            }
            Some(cur)
        }
        _ => None,
    }
}

/// Look up `member` on `target`. Walks Object property bags and Clip
/// `vars`/property indices the same way `GetMember` does. Used by
/// `CallMethod` to detect user-defined Function values bound to clip
/// instances (e.g. `this.onEnterFrame = function(){…}` then later invoked
/// indirectly).
pub(super) fn lookup_member(target: &Value, member: &str, engine: &AvmEngine) -> Value {
    match target {
        Value::Clip(id) => match engine.clips.get(id) {
            Some(state) => match prop_index(member) {
                Some(idx) => property_get(state, idx),
                None => state.vars.get(member).cloned().unwrap_or(Value::Undefined),
            },
            None => Value::Undefined,
        },
        Value::Object(o) => o.borrow().get(member).cloned().unwrap_or(Value::Undefined),
        _ => Value::Undefined,
    }
}

pub(super) fn resolve_get(name: &str, this_id: InstanceId, engine: &AvmEngine) -> Value {
    // Special pseudo-vars that aren't local: `_parent` and `_root` resolve to
    // a clip reference. Anything else falls through to the local var dict.
    match name {
        "_parent" => engine
            .clips
            .get(&this_id)
            .and_then(|s| s.parent)
            .map(Value::Clip)
            .unwrap_or(Value::Undefined),
        "_root" => {
            let mut cur = this_id;
            while let Some(parent) = engine.clips.get(&cur).and_then(|s| s.parent) {
                cur = parent;
            }
            Value::Clip(cur)
        }
        _ => engine
            .clips
            .get(&this_id)
            .and_then(|s| s.vars.get(name).cloned())
            .unwrap_or(Value::Undefined),
    }
}

pub(super) fn resolve_set(name: &str, value: Value, this_id: InstanceId, engine: &mut AvmEngine) {
    if let Some(state) = engine.clips.get_mut(&this_id) {
        state.vars.insert(name.to_string(), value);
    }
}

pub(super) fn call_method(
    name: &str,
    target: &Value,
    args: &[Value],
    this_id: InstanceId,
    engine: &mut AvmEngine,
    outcome: &mut ExecOutcome,
) -> Value {
    // Math methods. AS2 calls them as `Math.sin(x)` which compiles to a
    // CallMethod with target=lookupGetVariable("Math") — and we don't
    // register a Math object, so the lookup returns Undefined. Match by
    // method name regardless of target so the math actually runs.
    // Without this, `_x = Math.sin(i) * 100` evaluates to NaN, the matrix
    // translation becomes NaN, and Vello produces (0,0,0,0) for the entire
    // frame (silent failure mode in render-to-texture).
    if let Some(v) = call_math_method(name, args) {
        return v;
    }
    let target_id = match target {
        Value::Clip(id) => *id,
        _ => this_id,
    };
    match name {
        "removeMovieClip" => {
            if let Some(state) = engine.clips.get_mut(&target_id) {
                state.removed = true;
            }
            Value::Undefined
        }
        "stop" => {
            if let Some(state) = engine.clips.get_mut(&target_id) {
                state.playing = false;
            }
            Value::Undefined
        }
        "play" => {
            if let Some(state) = engine.clips.get_mut(&target_id) {
                state.playing = true;
            }
            Value::Undefined
        }
        "gotoAndStop" => {
            if let Some(state) = engine.clips.get_mut(&target_id) {
                let frame = args.first().map(|v| v.as_f64()).unwrap_or(1.0).max(1.0) as u16;
                state.current_frame = frame;
                state.playing = false;
            }
            Value::Undefined
        }
        "gotoAndPlay" => {
            if let Some(state) = engine.clips.get_mut(&target_id) {
                let frame = args.first().map(|v| v.as_f64()).unwrap_or(1.0).max(1.0) as u16;
                state.current_frame = frame;
                state.playing = true;
            }
            Value::Undefined
        }
        "attachMovie" => {
            // Args (in code order): linkage_name, instance_name, depth, [init_obj].
            // The renderer creates the clip after exec returns; we just record
            // the request here. The Value::Clip we return is a *placeholder* —
            // it points at the parent so subsequent property access doesn't
            // crash. The renderer fixes up references on the next tick.
            let linkage = args.first().map(|v| v.as_string()).unwrap_or_default();
            let inst_name = args.get(1).map(|v| v.as_string()).unwrap_or_default();
            let depth = args.get(2).map(|v| v.as_f64() as i32).unwrap_or(0);
            let init_obj = args.get(3).and_then(|v| match v {
                Value::Object(o) => Some(o.borrow().clone()),
                _ => None,
            });
            outcome.spawns.push(SpawnRequest::AttachMovie {
                target: target_id,
                symbol_name: linkage,
                instance_name: inst_name,
                depth,
                init_obj,
            });
            Value::Clip(target_id)
        }
        "duplicateMovieClip" => {
            // Args: instance_name, depth.
            let inst_name = args.first().map(|v| v.as_string()).unwrap_or_default();
            let depth = args.get(1).map(|v| v.as_f64() as i32).unwrap_or(0);
            outcome.spawns.push(SpawnRequest::Duplicate {
                source: target_id,
                instance_name: inst_name,
                depth,
            });
            Value::Clip(target_id)
        }
        _ => Value::Undefined,
    }
}

/// AS2 Math.* helpers. Returns Some(result) if `name` is a known Math
/// method; None otherwise. Argument count matches AS2: each method pulls
/// its arity from `args` and defaults missing ones to NaN.
pub(super) fn call_math_method(name: &str, args: &[Value]) -> Option<Value> {
    let a0 = || args.first().map(|v| v.as_f64()).unwrap_or(f64::NAN);
    let a1 = || args.get(1).map(|v| v.as_f64()).unwrap_or(f64::NAN);
    let v = match name {
        "sin" => a0().sin(),
        "cos" => a0().cos(),
        "tan" => a0().tan(),
        "asin" => a0().asin(),
        "acos" => a0().acos(),
        "atan" => a0().atan(),
        "atan2" => a0().atan2(a1()),
        "sqrt" => a0().sqrt(),
        "abs" => a0().abs(),
        "floor" => a0().floor(),
        "ceil" => a0().ceil(),
        "round" => a0().round(),
        "exp" => a0().exp(),
        "log" => a0().ln(),
        "pow" => a0().powf(a1()),
        "min" => a0().min(a1()),
        "max" => a0().max(a1()),
        "random" => rand_u32() as f64 / u32::MAX as f64,
        _ => return None,
    };
    Some(Value::Number(v))
}

pub(super) fn call_global(
    name: &str,
    args: &[Value],
    this_id: InstanceId,
    engine: &mut AvmEngine,
    outcome: &mut ExecOutcome,
) -> Value {
    match name {
        "random" => {
            let n = args.first().map(|v| v.as_f64()).unwrap_or(0.0).max(0.0);
            if n <= 0.0 {
                Value::Number(0.0)
            } else {
                let r = (rand_u32() as f64 / u32::MAX as f64 * n).floor();
                Value::Number(r)
            }
        }
        // `attachMovie` / `duplicateMovieClip` are also reachable as bare
        // function calls in some compiled output, so route them through here
        // too. Target = current clip (this).
        "attachMovie" => {
            let linkage = args.first().map(|v| v.as_string()).unwrap_or_default();
            let inst_name = args.get(1).map(|v| v.as_string()).unwrap_or_default();
            let depth = args.get(2).map(|v| v.as_f64() as i32).unwrap_or(0);
            let init_obj = args.get(3).and_then(|v| match v {
                Value::Object(o) => Some(o.borrow().clone()),
                _ => None,
            });
            outcome.spawns.push(SpawnRequest::AttachMovie {
                target: this_id,
                symbol_name: linkage,
                instance_name: inst_name,
                depth,
                init_obj,
            });
            Value::Clip(this_id)
        }
        _ => {
            let _ = engine;
            Value::Undefined
        }
    }
}

thread_local! {
    static RNG_STATE: std::cell::Cell<u32> = const { std::cell::Cell::new(0x1234_5678) };
}

/// Cheap PRNG. We don't need cryptographic randomness — Dofus spells just want
/// flicker and per-instance jitter — and pulling in `rand` would inflate the
/// WASM bundle. xorshift32 is good enough.
pub(super) fn rand_u32() -> u32 {
    RNG_STATE.with(|s| {
        let mut x = s.get();
        if x == 0 {
            x = 0x1234_5678;
        }
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        s.set(x);
        x
    })
}

/// Seed the thread-local PRNG. Callers that need deterministic per-instance
/// random output (e.g. map tiles whose variant must stay stable across
/// re-renders and snapshots, or settled-static child simulation) reseed
/// before each call to [`super::exec::exec`]. Reseeding with `0` is silently
/// bumped to a non-zero default — xorshift32 is degenerate at state `0`.
pub fn seed_rng(seed: u32) {
    let s = if seed == 0 { 0x1234_5678 } else { seed };
    RNG_STATE.with(|cell| cell.set(s));
}
