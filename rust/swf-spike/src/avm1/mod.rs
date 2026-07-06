//! Tiny AVM1 interpreter — just enough to drive Dofus 1.29 spell SWFs.
//!
//! What it handles (every opcode actually emitted by spell 802 — verified via
//! `dump-avm1` against `clips/spells/802.swf`):
//!
//! ```text
//! Push, Pop, ConstantPool, GetVariable, SetVariable, GetMember,
//! GetProperty, SetProperty, RandomNumber, Add2, Subtract, Multiply,
//! GotoFrame2, Stop, Play, CallMethod, End
//! ```
//!
//! Plus the four MovieClip properties Dofus actually drives (`_xscale`,
//! `_yscale`, `_alpha`, `_rotation`), the `random(n)` builtin, target paths
//! (`""` = this, `"_parent"`, `"_root"`), and `_parent.removeMovieClip()`.
//!
//! What it does NOT handle (and will silently log a warning the first time
//! they appear): `If`, `Jump`, `DefineFunction*`, `NewObject`, `NewMethod`,
//! `Enumerate`, type coercions beyond Number/String, etc. If a spell hits one
//! of those it'll typically fall back to the unscripted timeline behavior,
//! which is at worst what `render-cast-sheet` already produces.
//!
//! Module layout:
//! - `state`   — types (ClipState, AvmEngine, Value, ExecOutcome, SpawnRequest)
//! - `runtime` — helpers shared by the interpreter (property/resolve/call*)
//! - `exec`    — the bytecode dispatcher itself (one big match-on-Action)

pub mod exec;
pub mod lang;
pub mod runtime;
pub mod state;

pub use exec::exec;
pub use lang::{LangError, extract as extract_lang};
pub use runtime::{prop_index_pub, property_set_pub, seed_rng};
pub use state::{AvmEngine, ClipState, ExecOutcome, FnDef, InstanceId, SpawnRequest, Value};

// wc2 NOTE: wc3's avm1/mod.rs additionally declares `pub mod effect;` +
// `pub mod renderer;` (and re-exports VisualEffect / AvmRenderer). Those two
// modules are the spell-FX surface — adopted in unified-atlas Step 5 (they
// depend on wc3's swf_doc/ + render shapes wc2 hasn't merged yet; wc2's
// interim equivalent is `render_avm1.rs`). Everything else in this file is
// wc3-verbatim; `exec/`, `runtime.rs`, `state.rs`, `lang.rs` are
// byte-identical copies.
