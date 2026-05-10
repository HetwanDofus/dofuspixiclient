//! Owned representation of a parsed SWF: indexes character_id → DefineShape /
//! DefineSprite / DefineBits, plus exported-name → character_id. Stripping
//! lifetimes here means the renderer can hold references long-term without
//! threading the SwfBuf through every call.

use std::collections::HashMap;
#[cfg(not(target_arch = "wasm32"))]
use std::fs::File;
#[cfg(not(target_arch = "wasm32"))]
use std::io::Read;
#[cfg(not(target_arch = "wasm32"))]
use std::path::Path;

use anyhow::{anyhow, Result};
#[cfg(not(target_arch = "wasm32"))]
use anyhow::Context;
use swf::{decompress_swf, parse_swf, Tag};
use vello::kurbo::Affine;


#[derive(Clone)]
pub enum Symbol {
    Shape(swf::Shape),
    Sprite(OwnedSprite),
    /// Bitmap stored as raw tag bytes; decoded on demand by the shape
    /// flattener. Eager decode bottlenecked the WASM load path because every
    /// SWF carries dozens to hundreds of bitmaps and only a handful are
    /// actually drawn for any given tile / sprite.
    Bitmap(EncodedBitmap),
    /// MorphShape: interpolates between a start and end shape based on the
    /// `ratio` field on each placement (0..65535). Spell 108 uses morph
    /// shapes for its flame growing animation. Lerping logic lives in
    /// `build_morph_frame` (ported from Ruffle's morph_shape.rs).
    MorphShape(Box<swf::DefineMorphShape>),
}

/// Raw bitmap payload as it sits in the SWF, plus enough format info for the
/// decoder to reconstruct RGBA8 pixels later.
#[derive(Clone, Debug)]
pub enum EncodedBitmap {
    Lossless {
        version: u8,
        format: swf::BitmapFormat,
        width: u16,
        height: u16,
        data: Vec<u8>,
    },
    Jpeg2 {
        data: Vec<u8>,
    },
    Jpeg3 {
        jpeg: Vec<u8>,
        alpha: Vec<u8>,
    },
    /// DefineBits + JPEGTables already glued together at parse time.
    LegacyJpeg {
        data: Vec<u8>,
    },
}

#[derive(Clone, Debug)]
pub struct OwnedSprite {
    pub num_frames: u16,
    /// Flat list of timeline operations in order. ShowFrame entries delimit frames.
    pub ops: Vec<OwnedOp>,
    /// Frame labels declared on this sprite's timeline. Maps `label`
    /// (lowercased — Flash compares case-insensitively, e.g. "WR"
    /// vs. "wr" both target the same labeled frame) → 0-based frame
    /// index. Populated at parse time from `Tag::FrameLabel`. Used
    /// by `render::pick_accessory_frame` to honor canonical
    /// `gotoAndStop(side)` semantics where `side` is a string label
    /// like "R", "WR", "L", etc. — the AS2 layer cannot rely on
    /// fixed offsets because Dofus accessory SWFs encode different
    /// per-direction frame layouts (some ship 5×3, some 5×1, some
    /// only R + intro — in canonical Dofus 1.29, capes also have
    /// W-prefix walk variants).
    pub frame_labels: HashMap<String, u16>,
}

#[derive(Clone, Debug)]
pub enum OwnedOp {
    Place(OwnedPlace),
    Remove { depth: u16 },
    ShowFrame,
    /// A `DoAction` tag: AVM1 bytecode that runs at the current frame BEFORE
    /// the next ShowFrame. We store the raw bytes; `crate::avm1` parses on
    /// demand. Multiple DoActions per frame concatenate naturally as they're
    /// emitted in order.
    DoAction(Vec<u8>),
}

#[derive(Clone, Debug, Default)]
pub struct OwnedPlace {
    pub depth: u16,
    /// Some(id) for new placements / character swaps. None means "modify existing
    /// object at this depth" (PlaceObject2 with `is_move = true`).
    pub character_id: Option<u16>,
    pub is_move: bool,
    pub matrix: Option<Affine>,
    /// SWF color transform: (mult_rgba, add_rgba). All in 0..1 (or signed for add).
    pub color_transform: Option<OwnedColorTransform>,
    pub ratio: Option<u16>,
    pub clip_depth: Option<u16>,
    pub name: Option<String>,
    pub filters: Vec<OwnedFilter>,
    /// `onClipEvent(...) { ... }` handlers attached to this placement. Each
    /// entry is one (event-mask, AVM1-bytecode) pair. AVM1-only — empty for
    /// PlaceObject1 placements (which can't carry clip actions).
    pub clip_actions: Vec<OwnedClipAction>,
    /// SWF blend mode (None = inherit, which collapses to Normal).
    pub blend_mode: Option<OwnedBlendMode>,
}

/// SWF blend modes that PlaceObject can assign. Only the variants we know how
/// to map cleanly to Vello/peniko are listed; the rest fall through to
/// `Normal` via `From<swf::BlendMode>`. **Add** is the one that matters most
/// for Dofus spell VFX — particle systems use it for the lit/glow look.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OwnedBlendMode {
    Normal,
    Layer,
    Multiply,
    Screen,
    Lighten,
    Darken,
    Difference,
    Add,
    Overlay,
    HardLight,
}

/// One `onClipEvent` handler. SWF `ClipAction` is borrowed (`&'a [u8]`); we
/// own the bytecode so the document can outlive the parsed `swf::Tag`.
#[derive(Clone, Debug)]
pub struct OwnedClipAction {
    /// Bitmask of `ClipEvent::*` constants below.
    pub events: u32,
    pub bytecode: Vec<u8>,
}

pub mod clip_event {
    pub const LOAD: u32 = 1 << 0;
    pub const ENTER_FRAME: u32 = 1 << 1;
    pub const UNLOAD: u32 = 1 << 2;
}

/// Subset of swf::Filter that we actually act on. Variants we don't implement
/// are captured as `Unsupported(name)` so we can console-log on first use.
#[derive(Clone, Debug)]
pub enum OwnedFilter {
    DropShadow {
        color_rgba: [u8; 4],
        blur_x: f32,
        blur_y: f32,
        angle: f32,
        distance: f32,
        strength: f32,
        inner: bool,
        knockout: bool,
    },
    Blur {
        blur_x: f32,
        blur_y: f32,
        passes: u8,
    },
    Glow {
        color_rgba: [u8; 4],
        blur_x: f32,
        blur_y: f32,
        strength: f32,
        inner: bool,
        knockout: bool,
    },
    ColorMatrix {
        matrix: [f32; 20],
    },
    Unsupported(&'static str),
}

#[derive(Clone, Debug, Copy)]
pub struct OwnedColorTransform {
    pub mult_r: f32,
    pub mult_g: f32,
    pub mult_b: f32,
    pub mult_a: f32,
    /// Per-channel additive offset in the 0..1 range (i.e. swf::ColorTransform's
    /// raw 0..255 add converted to fractional).
    pub add_r: f32,
    pub add_g: f32,
    pub add_b: f32,
    pub add_a: f32,
}

impl OwnedColorTransform {
    pub const IDENTITY: Self = Self {
        mult_r: 1.0,
        mult_g: 1.0,
        mult_b: 1.0,
        mult_a: 1.0,
        add_r: 0.0,
        add_g: 0.0,
        add_b: 0.0,
        add_a: 0.0,
    };

    pub fn is_identity(&self) -> bool {
        (self.mult_r - 1.0).abs() < 1e-4
            && (self.mult_g - 1.0).abs() < 1e-4
            && (self.mult_b - 1.0).abs() < 1e-4
            && (self.mult_a - 1.0).abs() < 1e-4
            && self.add_r.abs() < 1e-4
            && self.add_g.abs() < 1e-4
            && self.add_b.abs() < 1e-4
            && self.add_a.abs() < 1e-4
    }

    /// SWF semantics: composing parent ∘ child mirrors how `PlaceObject`
    /// transforms accumulate down the tree. `child_mult` is the multiplier
    /// applied first (innermost), then this transform.
    pub fn compose(self, child: Self) -> Self {
        Self {
            mult_r: self.mult_r * child.mult_r,
            mult_g: self.mult_g * child.mult_g,
            mult_b: self.mult_b * child.mult_b,
            mult_a: self.mult_a * child.mult_a,
            add_r: self.mult_r * child.add_r + self.add_r,
            add_g: self.mult_g * child.add_g + self.add_g,
            add_b: self.mult_b * child.add_b + self.add_b,
            add_a: self.mult_a * child.add_a + self.add_a,
        }
    }
}

/// Frame-1 script kind on a Dofus 1.29 tile sprite.
///
/// Three categories (verified against MapHandler.as in the decompiled
/// 1.29 client):
///   * **Random** — frame 1 contains either:
///     - `gotoAndStop(random(N) + K)` via `RandomNumber` →
///       `GotoFrame2(set_playing=false)`, OR
///     - `this.gotoAndStop(random(this._totalframes) + K)` via
///       `RandomNumber` → `CallMethod("gotoAndStop")`.
///     The sprite picks ONE variant on load and freezes there. Caller
///     must pick a stable random frame per cell so the variant stays
///     consistent across re-rasterization.
///   * **Slope** — frame 1 is just `Stop` (no random call). The engine
///     calls `gotoAndStop(cell.groundSlope)` externally (see
///     MapHandler.as line 226) to select the slope orientation. Caller
///     must look at the cell's groundSlope and pick that frame.
///   * **Animated** — no frame-1 script. The timeline plays naturally
///     through all frames in a loop. Caller cycles frames at FPS.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TileScriptKind {
    Random,
    Slope,
    Animated,
}

pub fn avm1_classify_frame1(bytecode: &[u8]) -> Option<TileScriptKind> {
    use swf::avm1::read::Reader;
    use swf::avm1::types::Action;
    let mut reader = Reader::new(bytecode, 6);
    let mut saw_random = false;
    let mut saw_stop = false;
    while let Ok(action) = reader.read_action() {
        match action {
            Action::RandomNumber => saw_random = true,
            Action::Stop => saw_stop = true,
            Action::GotoFrame2(g) if !g.set_playing && saw_random => {
                return Some(TileScriptKind::Random);
            }
            Action::CallMethod if saw_random => {
                // `random(N) → ... → CallMethod("gotoAndStop")` —
                // the method name is on the stack but checking that
                // perfectly is fiddly; the random+CallMethod pair
                // is unique enough in tile bundles to identify the
                // pattern reliably.
                return Some(TileScriptKind::Random);
            }
            Action::End => break,
            _ => {}
        }
    }
    if saw_stop {
        Some(TileScriptKind::Slope)
    } else {
        None // sprite has script but neither random nor stop —
             // treat as animated (the bytecode is something we
             // don't recognize, so don't freeze it).
    }
}

/// Back-compat shim: returns true only for explicit Random.
pub fn avm1_has_random_stop(bytecode: &[u8]) -> bool {
    matches!(avm1_classify_frame1(bytecode), Some(TileScriptKind::Random))
}

/// Compatibility wrapper for callers that only need the first zone.
/// Prefer `avm1_extract_apply_color_calls` for full multi-call support.
pub fn avm1_extract_apply_color_zone(bytecode: &[u8]) -> Option<u8> {
    avm1_extract_apply_color_calls(bytecode)
        .into_iter()
        .next()
        .map(|(_, z)| z)
}

/// Detect a `GAC.applyColor(<elem>, N)` call in a sprite's frame-1
/// DoAction and return the zone `N`. Returns the FIRST call found —
/// most body-part sprites only have one; sprites that recolor multiple
/// named children with different zones (rare; e.g. `cFeca_Jambe00` +
/// `cFeca_JambeOurlet00` in class-10's char 24) get only their first
/// zone applied to all their fills, which matches the dofasset bake
/// behaviour and is good enough for first-pass tinting.
///
/// AS2 push pattern (verified against `clips/sprites/10.swf`):
/// ```text
/// Push(Int(N), Str(varname))   ; arg2=zone, arg1=varname
/// GetVariable                  ; resolves varname → sprite ref
/// Push(Int(2), Str("GAC"))     ; numargs, object
/// GetVariable
/// Push(Str("applyColor"))      ; method name
/// CallMethod
/// ```
/// SWFs with a `ConstantPool` use `ConstantPool(idx)` strings — the
/// reader resolves them after the pool is set, so we just look for
/// the literal "applyColor" string and walk back to the preceding
/// integer push.
/// Extract ALL `(child_name, zone)` pairs from a sprite's frame-1
/// DoAction. A single body sprite can call `applyColor` multiple
/// times for differently-named children with different zones —
/// e.g. class-10 char 224 calls
///   `applyColor("cVlad_L_Brassard00", 1)` (bracer / skin zone) AND
///   `applyColor("cVlad_L_Bras00", 3)` (the arm / clothing zone).
/// First-int-wins would tag the whole sprite as zone 1 and tint the
/// arm with skin colour. Returning the full list lets the caller
/// resolve each named placement to its own zone.
///
/// AS2 push pattern per call (verified across classes 10, 100, 200):
/// ```text
/// Push(Int(zone), Str(child_name))   ; via Str or ConstantPool
/// GetVariable
/// Push(Int(2), Str("GAC"))
/// GetVariable
/// Push(Str("applyColor"))
/// CallMethod
/// Pop
/// ```
pub fn avm1_extract_apply_color_calls(bytecode: &[u8]) -> Vec<(String, u8)> {
    use swf::avm1::read::Reader;
    use swf::avm1::types::{Action, Value};
    let mut reader = Reader::new(bytecode, 6);
    let mut pool: Vec<String> = Vec::new();
    let mut out: Vec<(String, u8)> = Vec::new();

    // Scratch state describing the currently-building call:
    //   args[0] = zone (Int), args[1] = child_name (Str/CP),
    //   followed by a CallMethod whose method name is "applyColor".
    // We rebuild from each fresh Push and reset on Pop / unrelated ops.
    let mut last_int: Option<i32> = None;
    let mut last_str: Option<String> = None;
    while let Ok(action) = reader.read_action() {
        match action {
            Action::ConstantPool(cp) => {
                pool = cp
                    .strings
                    .iter()
                    .map(|s| s.to_string_lossy(swf::UTF_8))
                    .collect();
            }
            Action::Push(p) => {
                for v in &p.values {
                    match v {
                        Value::Int(n) => {
                            // Each new Push starts a fresh tuple — but
                            // the second Int(2) is numargs, not a zone.
                            // The 2-args call signature is fixed; ignore
                            // any int after we already have a zone+name.
                            if last_int.is_none() || last_str.is_none() {
                                last_int = Some(*n);
                            }
                        }
                        Value::Str(s) => {
                            let resolved = s.to_string_lossy(swf::UTF_8);
                            if resolved == "applyColor" {
                                if let (Some(z), Some(name)) = (last_int.take(), last_str.take())
                                    && (1..=8).contains(&z)
                                {
                                    out.push((name, z as u8));
                                }
                            } else if last_str.is_none() {
                                last_str = Some(resolved);
                            }
                        }
                        Value::ConstantPool(idx) => {
                            let resolved = pool.get(*idx as usize).cloned();
                            if resolved.as_deref() == Some("applyColor") {
                                if let (Some(z), Some(name)) = (last_int.take(), last_str.take())
                                    && (1..=8).contains(&z)
                                {
                                    out.push((name, z as u8));
                                }
                            } else if last_str.is_none()
                                && let Some(s) = resolved
                            {
                                last_str = Some(s);
                            }
                        }
                        _ => {}
                    }
                }
            }
            Action::Pop | Action::End => {
                // End of one call; reset tuple builder so the next
                // applyColor pair starts fresh.
                last_int = None;
                last_str = None;
                if matches!(action, Action::End) {
                    break;
                }
            }
            _ => {}
        }
    }
    out
}

/// One `(slot, side, bFix)` accessory mount declaration from a body
/// part sprite's frame-1 DoAction. A body part can have multiple
/// sides (e.g. weapon depth declares slot 6 + side "R" for right-
/// facing, slot 6 + side "L" for left-facing) — the renderer picks
/// the entry whose `side` matches the active animation's direction.
///
/// `b_fix` mirrors the canonical AS2 parameter: when true AND the
/// active character direction is 3/4/7 (SW, W, NE), `applyAccessory`
/// negates the body part's `_x`. Capes/shields ship with
/// `bFix=true`; hats/weapons typically don't. Capturing it here lets
/// the renderer apply the same X-mirror so capes stop showing
/// reversed when the character walks SW/W/NE.
#[derive(Clone, Debug)]
pub struct AccessoryMount {
    pub slot: u8,
    pub side: Option<String>,
    pub b_fix: bool,
}

/// Extract every `GAC.applyAccessory(this, slot, side)` call from a
/// sprite's frame-1 DoAction. Mirrors `avm1_extract_apply_color_calls`
/// — same bytecode shape, different method name, different arg
/// extraction:
///
///   Push(Str(side))                   ; arg3 = side
///   Push(Int(slot))                   ; arg2 = slot
///   Push(varname / "this")            ; arg1 = mc
///   GetVariable / Push(Register)      ; resolves mc
///   Push(Int(numargs), Str("GAC"))    ; numargs, object
///   GetVariable
///   Push(Str("applyAccessory"))       ; method name
///   CallMethod
///
/// Returns a Vec because the same body part can declare multiple
/// (slot, side) pairs across frame-1 DoActions — although we have
/// not yet observed multi-slot body parts in vanilla Dofus, the
/// pattern matches `applyColor` and keeps the API symmetric.
pub fn avm1_extract_apply_accessory_calls(bytecode: &[u8]) -> Vec<AccessoryMount> {
    use swf::avm1::read::Reader;
    use swf::avm1::types::{Action, Value};
    let mut reader = Reader::new(bytecode, 6);
    let mut pool: Vec<String> = Vec::new();
    let mut out: Vec<AccessoryMount> = Vec::new();

    // Pending tuple state. We build (slot, side, b_fix) as values
    // flow in; commit when we observe a "applyAccessory" string
    // immediately before a CallMethod.
    //
    // AS2 push order for `GAC.applyAccessory(this, slot, side, mcToHide, bFix)`
    // is right-to-left: first push is bFix (Bool), then mcToHide
    // (often Undefined), then side (Str), then slot (Int), then
    // `this`/Register, then numargs, then "GAC", then GetVariable,
    // then "applyAccessory", then CallMethod. We capture `b_fix`
    // when we see a Boolean push BEFORE the slot int — there's only
    // one bool in this signature so first-bool-wins is unambiguous.
    let mut last_int: Option<i32> = None;
    let mut last_short_str: Option<String> = None;
    let mut last_bool: Option<bool> = None;
    let mut saw_apply_accessory = false;

    let commit_pending = |last_int: &mut Option<i32>,
                              last_short_str: &mut Option<String>,
                              last_bool: &mut Option<bool>,
                              out: &mut Vec<AccessoryMount>| {
        if let Some(slot) = last_int.take()
            && (0..=10).contains(&slot)
        {
            out.push(AccessoryMount {
                slot: slot as u8,
                side: last_short_str.take(),
                b_fix: last_bool.take().unwrap_or(false),
            });
        } else {
            *last_short_str = None;
            *last_bool = None;
        }
    };

    while let Ok(action) = reader.read_action() {
        match action {
            Action::ConstantPool(cp) => {
                pool = cp
                    .strings
                    .iter()
                    .map(|s| s.to_string_lossy(swf::UTF_8))
                    .collect();
            }
            Action::Push(p) => {
                for v in &p.values {
                    match v {
                        Value::Int(n) => {
                            // First int seen since reset: candidate slot.
                            // Subsequent ints (numargs=2 or 3) are
                            // ignored — we already captured the slot.
                            if last_int.is_none() {
                                last_int = Some(*n);
                            }
                        }
                        Value::Bool(b) => {
                            // First bool seen since reset is bFix
                            // (only one bool in the signature).
                            if last_bool.is_none() {
                                last_bool = Some(*b);
                            }
                        }
                        Value::Str(s) => {
                            let resolved = s.to_string_lossy(swf::UTF_8);
                            if resolved == "applyAccessory" {
                                saw_apply_accessory = true;
                            } else if !is_method_or_object(&resolved)
                                && resolved.len() <= 3
                                && !resolved.is_empty()
                                && last_short_str.is_none()
                            {
                                last_short_str = Some(resolved);
                            }
                        }
                        Value::ConstantPool(idx) => {
                            let resolved = pool.get(*idx as usize).cloned();
                            match resolved.as_deref() {
                                Some("applyAccessory") => {
                                    saw_apply_accessory = true;
                                }
                                Some(s) if !is_method_or_object(s)
                                    && s.len() <= 3
                                    && !s.is_empty()
                                    && last_short_str.is_none() =>
                                {
                                    last_short_str = resolved;
                                }
                                _ => {}
                            }
                        }
                        _ => {}
                    }
                }
            }
            Action::CallMethod => {
                if saw_apply_accessory {
                    commit_pending(
                        &mut last_int,
                        &mut last_short_str,
                        &mut last_bool,
                        &mut out,
                    );
                }
                saw_apply_accessory = false;
                last_int = None;
                last_short_str = None;
                last_bool = None;
            }
            Action::Pop | Action::End => {
                last_int = None;
                last_short_str = None;
                last_bool = None;
                saw_apply_accessory = false;
                if matches!(action, Action::End) {
                    break;
                }
            }
            _ => {}
        }
    }
    out
}

fn is_method_or_object(s: &str) -> bool {
    matches!(
        s,
        "GAC"
            | "applyAccessory"
            | "applyColor"
            | "applyEnd"
            | "applyHeadColor"
            | "applyBodyColor"
            | "applyBottomColor"
            | "this"
    )
}

pub struct SwfDoc {
    pub stage_size: (f64, f64),
    /// Frames-per-second from the SWF header (8.8 fixed-point in the spec,
    /// converted here to f32). Dofus 1.29 ground/object bundles vary
    /// wildly: `g1.swf` reports 12, `o1.swf` reports 60, `o3.swf`
    /// reports 40 — the JS tile ticker MUST use this and not assume a
    /// fixed 24 fps or the building-style animations end up sluggish.
    pub frame_rate: f32,
    pub by_id: HashMap<u16, Symbol>,
    pub by_name: HashMap<String, u16>,
    /// `char_id → zone_id (1..=3)` for sprites whose frame-1 AS2 calls
    /// `GAC.applyColor(elem, zone)`. Populated lazily during parse via
    /// `avm1_extract_apply_color_zone`. The renderer uses this to apply
    /// player skin/hair/clothing tint to all fills inside the tagged
    /// sub-sprite (HSL-preserve-lightness recolor — same scheme as the
    /// dofasset path).
    pub sprite_color_zones: HashMap<u16, u8>,
    /// `char_id → AccessoryMount` for body part sprites whose frame-1
    /// AS2 calls `GAC.applyAccessory(this, slot, side)`. The renderer
    /// uses this to identify accessory-mount placements in a character
    /// animation: when a placement's `character_id` is in this map and
    /// the active animation's direction matches `side`, render the
    /// caller-supplied accessory SWF at the placement's matrix.
    pub accessory_mounts: HashMap<u16, Vec<AccessoryMount>>,
    /// Top-level (root) timeline as an OwnedSprite.
    pub root: OwnedSprite,
}

impl SwfDoc {
    #[cfg(not(target_arch = "wasm32"))]
    pub fn load(path: &Path) -> Result<Self> {
        let mut bytes = Vec::new();
        File::open(path)
            .with_context(|| format!("open {}", path.display()))?
            .read_to_end(&mut bytes)?;
        Self::from_bytes(&bytes)
    }

    /// Same as `load` but takes raw SWF bytes — usable from WASM where there's
    /// no filesystem.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        let buf = decompress_swf(bytes)?;
        let swf = parse_swf(&buf)?;

        // First pass: locate the single JpegTables tag (if any) so we can
        // glue it onto every legacy DefineBits scan stream.
        let mut jpeg_tables: Option<Vec<u8>> = None;
        for tag in &swf.tags {
            if let Tag::JpegTables(data) = tag {
                jpeg_tables = Some(data.to_vec());
                break;
            }
        }

        let stage_size = (
            swf.header.stage_size().width().to_pixels(),
            swf.header.stage_size().height().to_pixels(),
        );
        let frame_rate = swf.header.frame_rate().to_f32();

        let mut by_id: HashMap<u16, Symbol> = HashMap::new();
        let mut by_name: HashMap<String, u16> = HashMap::new();
        let mut root_ops: Vec<OwnedOp> = Vec::new();
        let mut root_frames: u16 = 0;

        for tag in &swf.tags {
            match tag {
                Tag::DefineShape(shape) => {
                    by_id.insert(shape.id, Symbol::Shape(shape.clone()));
                }
                Tag::DefineButton(btn) | Tag::DefineButton2(btn) => {
                    // Render the button's UP state as a single-frame sprite.
                    // Buttons placed inside object sprites would otherwise
                    // resolve to None and leave their region transparent.
                    let mut ops = Vec::new();
                    for rec in &btn.records {
                        if rec.states.contains(swf::ButtonState::UP) {
                            ops.push(OwnedOp::Place(OwnedPlace {
                                depth: rec.depth,
                                character_id: Some(rec.id),
                                is_move: false,
                                matrix: Some(swf_matrix_to_affine(&rec.matrix)),
                                color_transform: Some(own_color_transform(
                                    &rec.color_transform,
                                )),
                                ratio: None,
                                clip_depth: None,
                                name: None,
                                filters: rec
                                    .filters
                                    .iter()
                                    .map(own_filter)
                                    .collect(),
                                clip_actions: Vec::new(),
                                blend_mode: None,
                            }));
                        }
                    }
                    ops.push(OwnedOp::ShowFrame);
                    by_id.insert(
                        btn.id,
                        Symbol::Sprite(OwnedSprite {
                            num_frames: 1,
                            ops,
                            frame_labels: HashMap::new(),
                        }),
                    );
                }
                Tag::SymbolClass(links) => {
                    // SymbolClass is the AS3 equivalent of ExportAssets.
                    // The class name acts as the export key. Some SWFs use
                    // it instead of (or alongside) ExportAssets.
                    for link in links {
                        by_name.insert(
                            link.class_name.to_string_lossy(swf::UTF_8).to_owned(),
                            link.id,
                        );
                    }
                }
                Tag::DefineMorphShape(ms) => {
                    // Store as MorphShape — `build_morph_frame` interpolates
                    // start/end shapes per the placement's `ratio` field
                    // at render time.
                    by_id.insert(ms.id, Symbol::MorphShape(ms.clone()));
                }
                Tag::DefineSprite(sprite) => {
                    by_id.insert(
                        sprite.id,
                        Symbol::Sprite(own_sprite(sprite.num_frames, &sprite.tags)),
                    );
                }
                Tag::DefineBitsLossless(tag) => {
                    by_id.insert(
                        tag.id,
                        Symbol::Bitmap(EncodedBitmap::Lossless {
                            version: tag.version,
                            format: tag.format,
                            width: tag.width,
                            height: tag.height,
                            data: tag.data.to_vec(),
                        }),
                    );
                }
                Tag::DefineBits { id, jpeg_data } => {
                    // Legacy: scan stream + shared JPEGTables header. Glue
                    // here so the decoder side stays simple.
                    let combined: Vec<u8> = match &jpeg_tables {
                        Some(tables) => {
                            let mut v = Vec::with_capacity(tables.len() + jpeg_data.len());
                            let trimmed = if tables.len() >= 2 && tables.ends_with(&[0xFF, 0xD9]) {
                                &tables[..tables.len() - 2]
                            } else {
                                tables.as_slice()
                            };
                            v.extend_from_slice(trimmed);
                            let scan = if jpeg_data.len() >= 2 && jpeg_data.starts_with(&[0xFF, 0xD8]) {
                                &jpeg_data[2..]
                            } else {
                                jpeg_data.as_ref()
                            };
                            v.extend_from_slice(scan);
                            v
                        }
                        None => jpeg_data.to_vec(),
                    };
                    by_id.insert(
                        *id,
                        Symbol::Bitmap(EncodedBitmap::LegacyJpeg { data: combined }),
                    );
                }
                Tag::DefineBitsJpeg2 { id, jpeg_data } => {
                    by_id.insert(
                        *id,
                        Symbol::Bitmap(EncodedBitmap::Jpeg2 {
                            data: jpeg_data.to_vec(),
                        }),
                    );
                }
                Tag::DefineBitsJpeg3(tag) => {
                    by_id.insert(
                        tag.id,
                        Symbol::Bitmap(EncodedBitmap::Jpeg3 {
                            jpeg: tag.data.to_vec(),
                            alpha: tag.alpha_data.to_vec(),
                        }),
                    );
                }
                Tag::ExportAssets(assets) => {
                    for a in assets {
                        by_name
                            .insert(a.name.to_string_lossy(swf::UTF_8).to_owned(), a.id);
                    }
                }
                Tag::PlaceObject(_) | Tag::RemoveObject(_) | Tag::ShowFrame
                | Tag::DoAction(_) => {
                    // DoAction at root level was previously dropped — spell
                    // 802's root has a `SOMA.playSound("vlad_802")` init
                    // script, and other SWFs may have rendering-relevant
                    // root scripts. Capture them as root timeline ops so
                    // the AVM1 interpreter can run them.
                    if let Some(op) = tag_to_op(tag) {
                        if matches!(op, OwnedOp::ShowFrame) {
                            root_frames += 1;
                        }
                        root_ops.push(op);
                    }
                }
                _ => {}
            }
        }

        // Build child_char_id → zone index. Each sprite's frame-1
        // DoActions can call `applyColor(child_name, zone)` MULTIPLE
        // times (e.g. class-10 char 224 paints `Brassard00` zone 1
        // and `Bras00` zone 3 — bracer-skin and arm-clothing). We
        // resolve each name to the placement's character_id via
        // `Place(name=..., character_id=...)` ops in the same sprite,
        // then record the zone against that *child* char_id. The
        // renderer keys on child_id so when render_sprite_ctx
        // descends into a placement it picks up the right zone.
        //
        // Self-references (`applyColor(this, N)`) hit the simple
        // case where every Place inside the sprite gets the same
        // zone — handled by recording the parent itself with that
        // zone (matches the "all my fills are zone N" semantic).
        let mut sprite_color_zones: HashMap<u16, u8> = HashMap::new();
        for (id, sym) in &by_id {
            let Symbol::Sprite(sp) = sym else { continue };
            // Step 1: collect (name, zone) calls from frame-1 DoActions.
            let mut calls: Vec<(String, u8)> = Vec::new();
            for op in &sp.ops {
                if matches!(op, OwnedOp::ShowFrame) {
                    break;
                }
                if let OwnedOp::DoAction(bc) = op {
                    calls.extend(avm1_extract_apply_color_calls(bc));
                }
            }
            if calls.is_empty() {
                continue;
            }
            // Step 2: resolve each name to a child character_id by
            // walking frame-1 Place ops. A name match assigns the
            // zone to that child; an unresolved name (e.g. `this` or
            // a non-existent ref) falls back to tagging the parent
            // sprite itself, which gives the simple "tint everything
            // I own" semantic.
            let mut consumed: Vec<bool> = vec![false; calls.len()];
            for op in &sp.ops {
                if matches!(op, OwnedOp::ShowFrame) {
                    break;
                }
                if let OwnedOp::Place(p) = op
                    && let (Some(child_id), Some(name)) = (p.character_id, p.name.as_ref())
                {
                    for (idx, (call_name, zone)) in calls.iter().enumerate() {
                        if call_name == name {
                            sprite_color_zones.insert(child_id, *zone);
                            consumed[idx] = true;
                        }
                    }
                }
            }
            // Any unresolved call (e.g. `applyColor(this, N)` with
            // name=="this", or names referencing AS2-introspected
            // children we can't see statically) tags the parent
            // sprite itself — covers the simple body-part case.
            for (i, (_, zone)) in calls.iter().enumerate() {
                if !consumed[i] {
                    sprite_color_zones.entry(*id).or_insert(*zone);
                }
            }
        }

        // Mirror sprite_color_zones for accessory mounts. Body part
        // sprites that contain `GAC.applyAccessory(this, slot, side)`
        // in their frame-1 DoAction are mount points: the renderer
        // identifies them by id and renders the corresponding
        // caller-supplied accessory SWF at the placement's matrix.
        // Scan EVERY frame's DoAction for applyAccessory calls — not
        // just frame 1. Some body parts (notably weapon mounts on the
        // hand sprites) declare their slot in later frames as part of
        // animation-state-specific mount changes.
        let mut accessory_mounts: HashMap<u16, Vec<AccessoryMount>> = HashMap::new();
        for (id, sym) in &by_id {
            let Symbol::Sprite(sp) = sym else { continue };
            let mut mounts: Vec<AccessoryMount> = Vec::new();
            for op in &sp.ops {
                if let OwnedOp::DoAction(bc) = op {
                    mounts.extend(avm1_extract_apply_accessory_calls(bc));
                }
            }
            if !mounts.is_empty() {
                accessory_mounts.insert(*id, mounts);
            }
        }

        Ok(SwfDoc {
            stage_size,
            frame_rate,
            by_id,
            by_name,
            sprite_color_zones,
            accessory_mounts,
            root: OwnedSprite {
                num_frames: root_frames,
                ops: root_ops,
                // Root-level FrameLabels are rare in Dofus assets but
                // we leave the map in place for symmetry; the parse
                // path above doesn't currently capture root labels.
                // If a future asset relies on `gotoAndStop("foo")` at
                // the root level, populate this similarly.
                frame_labels: HashMap::new(),
            },
        })
    }

    pub fn lookup_export(&self, name: &str) -> Option<&Symbol> {
        self.by_name.get(name).and_then(|id| self.by_id.get(id))
    }

    pub fn lookup_id(&self, id: u16) -> Option<&Symbol> {
        self.by_id.get(&id)
    }
}

fn own_sprite(num_frames: u16, tags: &[Tag<'_>]) -> OwnedSprite {
    let mut ops = Vec::with_capacity(tags.len());
    let mut frame_labels: HashMap<String, u16> = HashMap::new();
    // FrameLabel tags are emitted IN POSITION on the timeline — the
    // labelled frame is whichever frame the next ShowFrame closes.
    // Walk in order, increment on ShowFrame, attach the label to the
    // current frame counter. Lower-cased so AS2 case-insensitive
    // `gotoAndStop("WR")` / `gotoAndStop("wr")` both resolve.
    let mut current_frame: u16 = 0;
    for t in tags {
        match t {
            Tag::FrameLabel(fl) => {
                let label = fl.label.to_string_lossy(swf::UTF_8).to_lowercase();
                frame_labels.entry(label).or_insert(current_frame);
            }
            Tag::ShowFrame => {
                if let Some(op) = tag_to_op(t) {
                    ops.push(op);
                }
                current_frame = current_frame.saturating_add(1);
            }
            other => {
                if let Some(op) = tag_to_op(other) {
                    ops.push(op);
                }
            }
        }
    }
    OwnedSprite {
        num_frames,
        ops,
        frame_labels,
    }
}

fn tag_to_op(tag: &Tag<'_>) -> Option<OwnedOp> {
    match tag {
        Tag::PlaceObject(place) => Some(OwnedOp::Place(own_place(place))),
        Tag::RemoveObject(r) => Some(OwnedOp::Remove { depth: r.depth }),
        Tag::ShowFrame => Some(OwnedOp::ShowFrame),
        // Frame-level AVM1 bytecode. We capture verbatim and parse on demand
        // in `crate::avm1::exec`.
        Tag::DoAction(data) => Some(OwnedOp::DoAction(data.to_vec())),
        _ => None,
    }
}

fn own_place(place: &swf::PlaceObject<'_>) -> OwnedPlace {
    let is_move = matches!(place.action, swf::PlaceObjectAction::Modify);
    let character_id = match place.action {
        swf::PlaceObjectAction::Place(id) | swf::PlaceObjectAction::Replace(id) => Some(id),
        swf::PlaceObjectAction::Modify => None,
    };

    let filters = place
        .filters
        .as_ref()
        .map(|fs| fs.iter().map(own_filter).collect())
        .unwrap_or_default();

    // PlaceObject2/3 carry `clip_actions` — onClipEvent handlers. Captured
    // here so the AVM1 stateful renderer can run them per tick. We keep only
    // the events we currently model (LOAD, ENTER_FRAME, UNLOAD); the others
    // are masked out so unused handlers don't bloat the document.
    let clip_actions = place
        .clip_actions
        .as_ref()
        .map(|actions| {
            actions
                .iter()
                .filter_map(|ca| {
                    let mut events = 0u32;
                    if ca.events.contains(swf::ClipEventFlag::LOAD) {
                        events |= clip_event::LOAD;
                    }
                    if ca.events.contains(swf::ClipEventFlag::ENTER_FRAME) {
                        events |= clip_event::ENTER_FRAME;
                    }
                    if ca.events.contains(swf::ClipEventFlag::UNLOAD) {
                        events |= clip_event::UNLOAD;
                    }
                    if events == 0 {
                        return None;
                    }
                    Some(OwnedClipAction {
                        events,
                        bytecode: ca.action_data.to_vec(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    OwnedPlace {
        depth: place.depth,
        character_id,
        is_move,
        matrix: place.matrix.as_ref().map(swf_matrix_to_affine),
        color_transform: place.color_transform.as_ref().map(own_color_transform),
        ratio: place.ratio,
        clip_depth: place.clip_depth,
        name: place
            .name
            .as_ref()
            .map(|n| n.to_string_lossy(swf::UTF_8).to_owned()),
        filters,
        clip_actions,
        blend_mode: place.blend_mode.map(own_blend_mode),
    }
}

fn own_blend_mode(bm: swf::BlendMode) -> OwnedBlendMode {
    // SWF BlendMode (per Adobe spec / Ruffle's enum order):
    //   0 Normal, 1 Normal (Layer), 2 Multiply, 3 Screen, 4 Lighten,
    //   5 Darken, 6 Difference, 7 Add, 8 Subtract, 9 Invert, 10 Alpha,
    //   11 Erase, 12 Overlay, 13 HardLight.
    // We mirror that here and let unsupported variants fall back to Normal so
    // the renderer treats them as "ignore" rather than panicking.
    match bm {
        swf::BlendMode::Normal => OwnedBlendMode::Normal,
        swf::BlendMode::Layer => OwnedBlendMode::Layer,
        swf::BlendMode::Multiply => OwnedBlendMode::Multiply,
        swf::BlendMode::Screen => OwnedBlendMode::Screen,
        swf::BlendMode::Lighten => OwnedBlendMode::Lighten,
        swf::BlendMode::Darken => OwnedBlendMode::Darken,
        swf::BlendMode::Difference => OwnedBlendMode::Difference,
        swf::BlendMode::Add => OwnedBlendMode::Add,
        swf::BlendMode::Overlay => OwnedBlendMode::Overlay,
        swf::BlendMode::HardLight => OwnedBlendMode::HardLight,
        // Subtract / Invert / Alpha / Erase aren't directly representable in
        // peniko's Mix+Compose vocabulary — degrade to Normal until someone
        // hits a real case.
        _ => OwnedBlendMode::Normal,
    }
}

fn own_filter(filter: &swf::Filter) -> OwnedFilter {
    match filter {
        swf::Filter::DropShadowFilter(f) => OwnedFilter::DropShadow {
            color_rgba: [f.color.r, f.color.g, f.color.b, f.color.a],
            blur_x: f.blur_x.to_f32(),
            blur_y: f.blur_y.to_f32(),
            angle: f.angle.to_f32(),
            distance: f.distance.to_f32(),
            strength: f.strength.to_f32(),
            inner: f.is_inner(),
            knockout: f.is_knockout(),
        },
        swf::Filter::BlurFilter(f) => OwnedFilter::Blur {
            blur_x: f.blur_x.to_f32(),
            blur_y: f.blur_y.to_f32(),
            passes: f.num_passes(),
        },
        swf::Filter::GlowFilter(f) => OwnedFilter::Glow {
            color_rgba: [f.color.r, f.color.g, f.color.b, f.color.a],
            blur_x: f.blur_x.to_f32(),
            blur_y: f.blur_y.to_f32(),
            strength: f.strength.to_f32(),
            inner: f.is_inner(),
            knockout: f.is_knockout(),
        },
        swf::Filter::ColorMatrixFilter(f) => OwnedFilter::ColorMatrix { matrix: f.matrix },
        swf::Filter::BevelFilter(_) => OwnedFilter::Unsupported("Bevel"),
        swf::Filter::GradientGlowFilter(_) => OwnedFilter::Unsupported("GradientGlow"),
        swf::Filter::GradientBevelFilter(_) => OwnedFilter::Unsupported("GradientBevel"),
        swf::Filter::ConvolutionFilter(_) => OwnedFilter::Unsupported("Convolution"),
    }
}

fn swf_matrix_to_affine(m: &swf::Matrix) -> Affine {
    Affine::new([
        m.a.to_f64(),
        m.b.to_f64(),
        m.c.to_f64(),
        m.d.to_f64(),
        f64::from(m.tx.get()),
        f64::from(m.ty.get()),
    ])
}

fn own_color_transform(ct: &swf::ColorTransform) -> OwnedColorTransform {
    OwnedColorTransform {
        mult_r: ct.r_multiply.to_f32(),
        mult_g: ct.g_multiply.to_f32(),
        mult_b: ct.b_multiply.to_f32(),
        mult_a: ct.a_multiply.to_f32(),
        add_r: f32::from(ct.r_add) / 255.0,
        add_g: f32::from(ct.g_add) / 255.0,
        add_b: f32::from(ct.b_add) / 255.0,
        add_a: f32::from(ct.a_add) / 255.0,
    }
}

/// Convenience: open a SWF and resolve a name to an OwnedSprite (root timeline
/// for static frames, or an exported MovieClip).
pub fn lookup_sprite<'a>(doc: &'a SwfDoc, name: &str) -> Result<&'a OwnedSprite> {
    match doc.lookup_export(name) {
        Some(Symbol::Sprite(s)) => Ok(s),
        Some(Symbol::Shape(_)) => Err(anyhow!("export {} is a Shape, not a Sprite", name)),
        Some(Symbol::Bitmap { .. }) => Err(anyhow!("export {} is a Bitmap, not a Sprite", name)),
        Some(Symbol::MorphShape(_)) => {
            Err(anyhow!("export {} is a MorphShape, not a Sprite", name))
        }
        None => Err(anyhow!("export {} not found", name)),
    }
}
