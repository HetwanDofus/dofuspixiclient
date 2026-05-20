//! AVM1 runtime types: ClipState, AvmEngine, Value, FnDef,
//! ExecOutcome, SpawnRequest, plus the InstanceId alias. Pure data
//! — no interpreter logic, no bytecode reading.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

/// Stable identifier for one MovieClip instance in the display tree. We use
/// the path `(parent_id, depth)` to derive these so that re-placing the same
/// clip on the same depth keeps its state across frames (matches Flash
/// semantics where a `PlaceObject` to an occupied depth modifies the existing
/// clip instead of creating a new one).
pub type InstanceId = u32;

/// Per-clip mutable runtime state. Scripts read and write these fields.
#[derive(Clone, Debug)]
pub struct ClipState {
    /// 1-indexed current frame, matching `_currentframe` semantics.
    pub current_frame: u16,
    /// Total number of timeline frames in the underlying DefineSprite.
    pub total_frames: u16,
    pub playing: bool,
    /// Degrees. 0 = no rotation. Default 0.
    pub rotation: f64,
    /// 0..100. Default 100.
    pub alpha: f64,
    /// 0..100. Default 100.
    pub xscale: f64,
    pub yscale: f64,
    /// `_x` and `_y` — pixels in parent coordinates (matrix.tx/ty / 20).
    /// Synced from the placement matrix's translation. Default 0.
    pub x: f64,
    pub y: f64,
    /// Local variables (`var`-less assignments and `onClipEvent(load)` locals).
    pub vars: HashMap<String, Value>,
    /// Parent instance id for `_parent` resolution.
    pub parent: Option<InstanceId>,
    /// True after `removeMovieClip` is called on this clip; the renderer
    /// honours it by skipping the clip on subsequent ticks.
    pub removed: bool,
    /// Set by `onClipEvent(load)` running once per instance.
    pub loaded: bool,
    /// FLASH SEMANTIC (verified against Ruffle's `apply_place_object`,
    /// display_object.rs:2497): once a script writes to `_x`/`_y`/
    /// `_xscale`/`_yscale`/`_rotation` (or any other transform-affecting
    /// property), this flag flips to `true` and all subsequent timeline
    /// `Modify`/`Place` ops on this clip's matrix become no-ops. The
    /// script-set transform persists across the clip's entire lifetime.
    /// This is what keeps spell 802's sp6._x at -3.75 (sp7 f2 value)
    /// even though sp7's f3, f4, … `Modify` ops would otherwise overwrite
    /// it every frame.
    pub transformed_by_script: bool,
}

impl ClipState {
    pub fn new(total_frames: u16, parent: Option<InstanceId>) -> Self {
        Self {
            current_frame: 1,
            total_frames,
            playing: true,
            rotation: 0.0,
            alpha: 100.0,
            xscale: 100.0,
            yscale: 100.0,
            x: 0.0,
            y: 0.0,
            vars: HashMap::new(),
            parent,
            removed: false,
            loaded: false,
            transformed_by_script: false,
        }
    }
}

/// A user-defined AVM1 function (from `DefineFunction`/`DefineFunction2`).
/// Stores the bytecode body so we can re-invoke it when the function is
/// called via `CallMethod`/`CallFunction`, or when it's bound to a clip
/// event property (`this.onEnterFrame = function(){…}`).
#[derive(Debug)]
pub struct FnDef {
    pub params: Vec<String>,
    pub code: Vec<u8>,
    pub swf_version: u8,
    /// Function body's source SWF bytecode. We store the bytes inline so the
    /// FnDef can outlive the parent action stream's lifetime.
    pub register_count: u8,
}

/// AVM1 dynamic value.
#[derive(Clone, Debug)]
pub enum Value {
    Undefined,
    Null,
    Number(f64),
    String(String),
    Bool(bool),
    /// Reference to another clip instance (e.g. `_parent` on the stack).
    Clip(InstanceId),
    /// User-defined function created by `DefineFunction`/`DefineFunction2`.
    Function(Rc<FnDef>),
    /// Object literal `{key:val,…}` from `InitObject`. Used by `attachMovie`
    /// init-object args (e.g. `attachMovie("frag","f"+c,c,{_x:_X,_y:_Y})`)
    /// and by general property bag patterns.
    Object(Rc<RefCell<HashMap<String, Value>>>),
}

impl Value {
    pub fn as_f64(&self) -> f64 {
        match self {
            Value::Number(n) => *n,
            Value::String(s) => s.parse().unwrap_or(f64::NAN),
            Value::Bool(b) => {
                if *b {
                    1.0
                } else {
                    0.0
                }
            }
            _ => f64::NAN,
        }
    }
    pub fn as_string(&self) -> String {
        match self {
            Value::String(s) => s.clone(),
            Value::Number(n) => {
                if n.fract() == 0.0 && n.abs() < 1e16 {
                    format!("{}", *n as i64)
                } else {
                    format!("{n}")
                }
            }
            Value::Bool(b) => (if *b { "true" } else { "false" }).to_string(),
            Value::Undefined => "undefined".to_string(),
            Value::Null => "null".to_string(),
            Value::Clip(_) => "[movie clip]".to_string(),
            Value::Function(_) => "[function]".to_string(),
            Value::Object(_) => "[object]".to_string(),
        }
    }
    pub fn as_clip(&self) -> Option<InstanceId> {
        match self {
            Value::Clip(id) => Some(*id),
            _ => None,
        }
    }
    /// AVM1 boolean coercion (used by `Not`, `If`).
    pub fn as_bool(&self) -> bool {
        match self {
            Value::Bool(b) => *b,
            Value::Number(n) => *n != 0.0 && !n.is_nan(),
            Value::String(s) => !s.is_empty() && s != "0" && s != "false",
            Value::Undefined | Value::Null => false,
            Value::Clip(_) | Value::Function(_) | Value::Object(_) => true,
        }
    }
}

/// Holds all clip state. Owned by the renderer; passed in to `exec`.
#[derive(Default)]
pub struct AvmEngine {
    pub clips: HashMap<InstanceId, ClipState>,
}

impl AvmEngine {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn ensure(
        &mut self,
        id: InstanceId,
        parent: Option<InstanceId>,
        total_frames: u16,
    ) -> &mut ClipState {
        self.clips
            .entry(id)
            .or_insert_with(|| ClipState::new(total_frames, parent))
    }
}

/// Result of running a script — frame jumps need to be applied AFTER exec
/// returns so we don't fight with the interpreter's own state mutation.
/// `spawns` carries any clips the script asked to spawn at runtime
/// (`attachMovie` / `duplicateMovieClip`). The renderer processes them after
/// exec returns so it can do the SwfDoc-symbol lookup and create the new
/// instance with proper parentage.
#[derive(Debug, Default)]
pub struct ExecOutcome {
    pub stop: bool,
    pub play: bool,
    pub goto: Option<u16>,
    pub spawns: Vec<SpawnRequest>,
    /// Set by `Return` action — the value popped from the stack at the
    /// return site. The recursive caller (when invoking a user-defined
    /// `Function`) reads this and pushes it onto its own stack.
    pub return_value: Option<Value>,
}

/// A runtime clip-spawn request emitted by the AVM1 interpreter.
#[derive(Debug, Clone)]
pub enum SpawnRequest {
    /// `target.attachMovie(symbol_name, instance_name, depth, [init_obj])`
    /// — spawn a fresh instance of the named library symbol on `target` at
    /// `depth`. The optional `init_obj`'s key/value pairs are copied to the
    /// new clip's `vars` map (covers `_x`/`_y`/etc. set at spawn time).
    AttachMovie {
        target: InstanceId,
        symbol_name: String,
        instance_name: String,
        depth: i32,
        init_obj: Option<HashMap<String, Value>>,
    },
    /// `source.duplicateMovieClip(instance_name, depth)` — clone an existing
    /// clip at a new depth on its parent. The renderer resolves which
    /// character to place by looking at `source`'s current placement.
    Duplicate {
        source: InstanceId,
        instance_name: String,
        depth: i32,
    },
}
