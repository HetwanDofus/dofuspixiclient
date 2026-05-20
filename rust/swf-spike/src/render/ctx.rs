//! `RenderCtx` — single value carrying every parameter the renderer
//! needs as it walks a SWF symbol tree. Replaces the 10-arg parameter
//! chain that grew across `render_symbol_xformed_ctx_ratio`,
//! `render_sprite_ctx`, etc.
//!
//! Phase 1 status: struct + builder methods are defined here, but the
//! existing rendering functions still take individual parameters. The
//! adoption switch happens in Phase 2 — every internal `render_*`
//! function will then take `&mut RenderCtx<'_>` instead.
//!
//! Lifetime model: one `'a` covers the doc + scene + wgpu borrows.
//! `child()` and `with_*()` return short-lived ctxs that reborrow the
//! mutable scene/wgpu refs, so a child render can't outlive its
//! parent.

use std::collections::HashMap;

use vello::kurbo::Affine;

use crate::recolor::PlayerColors;
use crate::swf_doc::{OwnedColorTransform, OwnedPlace, Symbol, SwfDoc};

use super::cache::RenderCache;
use super::WgpuCtx;

/// One accessory's render data. Keyed by the AS2 mount slot id (1-4
/// in vanilla Dofus character SWFs) inside `AccessoryDict`. The
/// renderer pulls this out when it encounters a placement whose
/// character is in `SwfDoc::accessory_mounts` for the matching slot,
/// then computes the accessory's actual frame at render time using
/// the body part's declared `side`, the character's `anim_type`
/// (0=static, 1=walk, 2=run), and the current `char_frame` index
/// within the character animation. This matches the canonical
/// dofasset behaviour where an accessory's animation is independent
/// of (but synced to) the character's animation.
pub struct AccessoryEntry<'a> {
    pub doc: &'a SwfDoc,
    pub symbol: &'a Symbol,
    /// Animation classification — 0=static (no cycling), 1=walk,
    /// 2=run. Selects between the slot-specific direction tables
    /// (capes/shields use different fallbacks for run vs walk).
    pub anim_type: u8,
    /// Index of the character's CURRENT animation frame (0-based,
    /// not modulo'd). Used to cycle the accessory's per-direction
    /// 3-frame sequence in lockstep with the character.
    pub char_frame: u16,
    /// Direction-suffix character of the active character animation
    /// ('R'|'L'|'S'|'F'|'B'). Drives slot-3 (pet) named-export
    /// fallback (`staticR`, `walkR`, etc. — pets ship as full
    /// characters with their own multi-anim timeline rather than the
    /// 5×3 flat layout that hats/capes use).
    pub char_dir_suffix: char,
}

/// Map of `slot → accessory render data`. Built by the WASM caller
/// from the parsed look + loaded accessory bundles. Stays alive for
/// the duration of one strip render so all `'a` borrows hold.
pub type AccessoryDict<'a> = HashMap<u8, AccessoryEntry<'a>>;

/// Everything the renderer reads while walking a symbol tree.
///
/// Construct with `RenderCtx::new(doc, scene)` for stateless
/// rendering (tile path) or `RenderCtx::new(...).with_wgpu(...)` for
/// the filter-capable path.
pub struct RenderCtx<'a> {
    /// The SWF document being rendered.
    pub doc: &'a SwfDoc,
    /// Vello scene we're emitting commands into. Mutably borrowed.
    pub scene: &'a mut vello::Scene,
    /// Optional wgpu context. Required for filter rendering
    /// (drop-shadow / glow / blur compute passes); `None` for
    /// stateless tile rendering.
    pub wgpu: Option<WgpuCtx<'a>>,

    /// World-space transform from twip coordinates to scene units.
    /// Composes with each placement's matrix as we recurse.
    pub transform: Affine,
    /// Current sprite frame (0-based). Multi-frame sprite children
    /// inherit this from the parent; single-frame children always
    /// see frame 0.
    pub frame: u16,
    /// Morph interpolation ratio of the *current* placement
    /// (0..=65535). Only meaningful when the current symbol is a
    /// `MorphShape`; sprites/shapes ignore it.
    pub ratio: u16,

    /// Multiplicative + additive color transform from PlaceObject's
    /// CXFORM. Composes with the parent's at each placement.
    pub color_xform: OwnedColorTransform,
    /// HSL-recolor target for the current zone (the player's chosen
    /// colour for whichever zone covers this subtree). `None` means
    /// no recolor — fills emit as authored.
    pub recolor_target: Option<u32>,
    /// Player's three zone colours. Used to *resolve* a child's
    /// `applyColor` zone into a `recolor_target`. Stays the same as
    /// we descend; the per-subtree change is `recolor_target`, not
    /// this.
    pub player_colors: PlayerColors,

    /// Memoization for shape flattening, morph interpolation, and
    /// frame-state walks. Shared across the whole render call (and
    /// across multiple calls if the caller reuses the cache).
    pub cache: &'a RenderCache,

    /// Optional accessory dictionary for character rendering. When
    /// present, the sprite walker renders an accessory's symbol at
    /// the body part's world transform whenever it encounters a
    /// placement whose character is in `doc.accessory_mounts` and
    /// the dict has an entry for the mount's slot. `None` for
    /// non-character renders (tiles, spells, UI).
    pub accessories: Option<&'a AccessoryDict<'a>>,

    /// True when the character is rendering for a direction (3/4/7 —
    /// SW/W/NE) that the JS layer will then mirror via
    /// `sprite.scale.x = -1`. Set per-strip by the WASM caller. The
    /// renderer uses it to honor the canonical AS2 `bFix` semantic:
    /// for body part placements whose `accessory_mounts` declares
    /// `b_fix=true` (capes, shields), we negate the placement's
    /// translation X so the global JS-flip ends up putting that body
    /// part on the canonical side. Without this, capes appear on the
    /// wrong side when walking SW/W/NE — the user-visible "cape
    /// reversed when walking" symptom.
    pub apply_b_fix: bool,
}

impl<'a> RenderCtx<'a> {
    /// Stateless renderer (no filters). Used by tile rendering and
    /// the AVM1-free spell preview path.
    pub fn new(
        doc: &'a SwfDoc,
        scene: &'a mut vello::Scene,
        cache: &'a RenderCache,
    ) -> Self {
        Self {
            doc,
            scene,
            wgpu: None,
            transform: Affine::IDENTITY,
            frame: 0,
            ratio: 0,
            color_xform: OwnedColorTransform::IDENTITY,
            recolor_target: None,
            player_colors: PlayerColors::default(),
            cache,
            accessories: None,
            apply_b_fix: false,
        }
    }

    /// Attach an accessory dictionary so the sprite walker composes
    /// the matching accessory SWFs at body part mount points.
    pub fn with_accessories(mut self, dict: &'a AccessoryDict<'a>) -> Self {
        self.accessories = Some(dict);
        self
    }

    /// Enable canonical-AS2 `bFix` X-mirror for body part placements
    /// whose mount declares `b_fix=true`. Pass `true` when rendering
    /// a strip whose final display will be JS-flipped (directions
    /// 3/4/7 — SW/W/NE). See `RenderCtx::apply_b_fix`.
    pub fn with_b_fix(mut self, apply: bool) -> Self {
        self.apply_b_fix = apply;
        self
    }

    /// Attach a wgpu context so filtered placements can render to
    /// intermediate textures and apply compute passes. Without this,
    /// filtered placements fall back to the cheap halo approximation.
    pub fn with_wgpu(mut self, wgpu: WgpuCtx<'a>) -> Self {
        self.wgpu = Some(wgpu);
        self
    }

    /// Set the world transform. Typically used at the entry point to
    /// position the symbol within the output texture.
    pub fn with_transform(mut self, transform: Affine) -> Self {
        self.transform = transform;
        self
    }

    /// Set the starting frame. Tile rendering passes the desired
    /// frame here; nested children pick it up via `child()`.
    pub fn with_frame(mut self, frame: u16) -> Self {
        self.frame = frame;
        self
    }

    /// Set the player's three zone colours. After this, descending
    /// into a sprite tagged with an `applyColor` zone will resolve
    /// to the right `recolor_target` automatically.
    pub fn with_player_colors(mut self, pc: PlayerColors) -> Self {
        self.player_colors = pc;
        self
    }

    /// Seed the color transform. Used by `render_symbol_xformed`
    /// callers (e.g. spell with player background) that want a
    /// non-identity starting CXFORM at the entry point.
    pub fn with_color_xform(mut self, cx: OwnedColorTransform) -> Self {
        self.color_xform = cx;
        self
    }

    /// Compute the child ctx for a placement at the given
    /// `child_id`. Composes transform + color_xform, propagates
    /// frame to multi-frame sprite children, picks the placement's
    /// ratio, and resolves the child's zone (if any) into a fresh
    /// `recolor_target` (else inherits the parent's).
    ///
    /// Returns a *reborrow*: the new ctx mutably borrows the same
    /// scene/wgpu, so the parent ctx is suspended until the child
    /// drops. This is the same pattern Vello uses for `Scene`
    /// recursion and prevents accidentally rendering twice into the
    /// same scene from two ctxs.
    #[must_use]
    pub fn child<'b>(&'b mut self, place: &OwnedPlace, child_id: u16) -> RenderCtx<'b>
    where
        'a: 'b,
    {
        let transform = self.transform * place.matrix.unwrap_or(Affine::IDENTITY);
        let color_xform = self
            .color_xform
            .compose(place.color_transform.unwrap_or(OwnedColorTransform::IDENTITY));

        // Zone resolution: if this child sprite has its own
        // applyColor zone, that overrides the inherited recolor
        // target for this subtree.
        let recolor_target = self
            .doc
            .sprite_color_zones
            .get(&child_id)
            .and_then(|z| self.player_colors.lookup(*z))
            .or(self.recolor_target);

        // Frame propagation: multi-frame sprite children loop their
        // own timeline modulo num_frames as the parent advances;
        // single-frame children (shapes, bitmaps, morphs, 1-frame
        // wrapper sprites) always see 0. Without the modulo a 30-frame
        // smoke clip nested inside a 210-frame parent would clamp to
        // its last frame for 180 of 210 parent frames.
        let frame = match self.doc.lookup_id(child_id) {
            Some(crate::swf_doc::Symbol::Sprite(c)) if c.num_frames > 1 => {
                self.frame % c.num_frames
            }
            _ => 0,
        };

        let ratio = place.ratio.unwrap_or(0);

        RenderCtx {
            doc: self.doc,
            scene: self.scene,
            wgpu: self.wgpu.as_mut().map(|w| WgpuCtx {
                device: w.device,
                queue: w.queue,
                renderer: w.renderer,
                filter_pipelines: w.filter_pipelines,
                output_scale: w.output_scale,
            }),
            transform,
            frame,
            ratio,
            color_xform,
            recolor_target,
            player_colors: self.player_colors,
            cache: self.cache,
            accessories: self.accessories,
            apply_b_fix: self.apply_b_fix,
        }
    }
}
