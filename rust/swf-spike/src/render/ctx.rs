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
use super::slot_depths::BandRange;
use super::WgpuCtx;

/// Choose what the renderer emits into the scene. The default
/// `Colour` mode is the existing behaviour — fills carry their
/// authored RGB (or, when `recolor_target` is set, the HSL-substituted
/// player tint). `ZoneId` mode replaces every recoloured fill with
/// `(zone_id * 60, 0, 0, 255)` and drops every other fill — used to
/// bake the per-band zone-id sidecar texture that drives the Pixi
/// shader's HSL substitution at composite time.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum RenderMode {
    #[default]
    Colour,
    ZoneId,
}

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
    /// Optional SECOND output scene for single-walk dual emit. When
    /// `Some`, the body-band walk emits Colour fills into `scene` AND
    /// per-zone marker fills into `zone_scene` in ONE traversal —
    /// eliminating the duplicate Colour/ZoneId walk (and the
    /// duplicate, uncached `collect_mask_path` per clip). Clip-mask
    /// layers are pushed/popped on both scenes in lockstep. `None` for
    /// every other path (tile, snapshot, filter, single-mode body),
    /// which behave exactly as before.
    pub zone_scene: Option<&'a mut vello::Scene>,
    /// Optional wgpu context. Required for filter rendering
    /// (drop-shadow / glow / blur compute passes); `None` for
    /// stateless tile rendering.
    pub wgpu: Option<WgpuCtx<'a>>,

    /// World-space transform from twip coordinates to scene units.
    /// Composes with each placement's matrix as we recurse.
    pub transform: Affine,
    /// Scale the OUTPUT scene will later be appended/rendered at, on
    /// top of `transform`. `1.0` for direct renders (transform already
    /// carries the twip→device-pixel scale). Twip-identity encode-once
    /// bakes (tile/body/accessory sub-scene caches) set the replay
    /// scale here so the canonical stroke floor
    /// (`device_width = max(natural_width × total_scale, 1 device px)`,
    /// ground truth = Flash player, user-confirmed) is computed against
    /// the TRUE device scale instead of 1 twip. Constant across the
    /// walk — placement matrices compose into `transform`, not here.
    pub downstream_scale: f64,
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
    /// Active zone id (1..=3) when the current subtree is under an
    /// `applyColor` zone. Mirrors `recolor_target` lifetime but
    /// preserves the original zone identity — needed by Path B's
    /// `RenderMode::ZoneId` output mode, which emits the zone id as
    /// a fill marker (so the Pixi shader can apply per-bot HSL
    /// substitution at composite time).
    pub recolor_zone: Option<u8>,
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

    /// Path B body-band filter. When `Some`, the timeline walker
    /// drops placements at the TOP-LEVEL body walk whose depth falls
    /// outside this band. Set only on the entry call; `child()`
    /// clears it so nested sub-clips render normally. `None` means
    /// "no filter" — every depth renders.
    pub band_filter: Option<BandRange>,

    /// Path B accessory composition toggle. When `true`, the walker
    /// skips the `accessory_mounts` emit block in `sprite.rs` —
    /// accessories are baked separately and composed in Pixi at
    /// runtime. Propagates through `child()`.
    pub disable_accessories: bool,

    /// Selects fill emission strategy. Propagates through `child()`.
    /// See `RenderMode`.
    pub output_mode: RenderMode,

    /// Canonical AS2 mcToHide signal: true when the bot has a hat
    /// (slot 1) equipped. Multi-frame accessory-toggle sprites (e.g.
    /// Iop's `R_tete` with full vs short hair on different frames)
    /// get PINNED to frame 1 when this is true, frame 0 otherwise —
    /// instead of cycling with the body's anim frame. Without this
    /// pin the hair flips every body frame ("alternating hair"
    /// bug). Propagates through `child()`.
    pub hat_equipped: bool,

    /// RETAINED-VELLO union bake: stable per-leaf identity = the chain of
    /// placement depths from the root sprite to the current node. `child()`
    /// pushes each placement's `depth`. Only READ by the union capture sink
    /// (`render::union`); empty + inert for normal rendering.
    pub depth_path: Vec<u16>,

    /// Per-character frame pins. When `child()` would propagate
    /// `parent_frame % child.num_frames` to a multi-frame descendant,
    /// it instead uses the pinned frame from this map if the child's
    /// id is a key. Inherited by every recursive descendant via
    /// `child()`, so a stopped grandchild is honored too.
    ///
    /// CANONICAL SEMANTICS: Flash runs child timelines until their
    /// AS2 `stop()` and then keeps showing the stopped frame; the
    /// client's only playhead forcing (`GlobalSpriteHandler.
    /// recursiveGotoAndStop`, assets/sources/client-code/ank/
    /// battlefield/GlobalSpriteHandler.as:505-516) pins children at a
    /// stopped frame. Used to render `static*` NPC/monster idles at
    /// their SETTLED pose (see `tile_behavior::settled_static_overrides`)
    /// and available to the tile renderer for canonical `Stop`
    /// descendants of animated wrappers.
    pub child_frame_overrides: Option<&'a HashMap<u16, u16>>,
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
            zone_scene: None,
            wgpu: None,
            transform: Affine::IDENTITY,
            downstream_scale: 1.0,
            frame: 0,
            ratio: 0,
            color_xform: OwnedColorTransform::IDENTITY,
            recolor_target: None,
            recolor_zone: None,
            player_colors: PlayerColors::default(),
            cache,
            accessories: None,
            apply_b_fix: false,
            band_filter: None,
            disable_accessories: false,
            output_mode: RenderMode::default(),
            hat_equipped: false,
            depth_path: Vec::new(),
            child_frame_overrides: None,
        }
    }

    /// Pin specific child characters to fixed frames (see the
    /// `child_frame_overrides` field doc). `None` clears back to the
    /// default modulo propagation.
    pub fn with_child_frame_overrides(
        mut self,
        overrides: Option<&'a HashMap<u16, u16>>,
    ) -> Self {
        self.child_frame_overrides = overrides;
        self
    }

    /// Set the canonical mcToHide signal (slot 1 / hat equipped).
    /// See `hat_equipped` field doc. Propagates through `child()`.
    pub fn with_hat_equipped(mut self, equipped: bool) -> Self {
        self.hat_equipped = equipped;
        self
    }

    /// Restrict the TOP-LEVEL body walk to the given depth band.
    /// Used by Path B's body-band rasteriser. Cleared by `child()` so
    /// nested sub-clips render in full.
    pub fn with_band_filter(mut self, band: BandRange) -> Self {
        self.band_filter = Some(band);
        self
    }

    /// Disable the `accessory_mounts` composition block in
    /// `sprite.rs`. Used by Path B: accessories are baked separately
    /// and composed in Pixi. Propagates through `child()`.
    pub fn with_disable_accessories(mut self, disable: bool) -> Self {
        self.disable_accessories = disable;
        self
    }

    /// Override fill emission strategy (`Colour` vs `ZoneId`).
    /// Propagates through `child()`.
    pub fn with_output_mode(mut self, mode: RenderMode) -> Self {
        self.output_mode = mode;
        self
    }

    /// Attach a second scene for single-walk dual emit. The walk emits
    /// Colour into `self.scene` and the per-zone markers into
    /// `zone_scene`, so one traversal produces both atlases. Caller
    /// keeps `output_mode = Colour`; `render_shape_into` forks at the
    /// leaf when `zone_scene` is present. See the field doc.
    pub fn with_zone_scene(mut self, zone_scene: &'a mut vello::Scene) -> Self {
        self.zone_scene = Some(zone_scene);
        self
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

    /// Set the downstream replay scale (see the `downstream_scale`
    /// field doc). Pass the twip→device-pixel scale when this render
    /// encodes a twip-identity sub-scene that is later
    /// `Scene::append`ed at that scale; leave at 1.0 for direct
    /// renders.
    pub fn with_downstream_scale(mut self, scale: f64) -> Self {
        self.downstream_scale = scale;
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
        // target for this subtree. `recolor_zone` mirrors
        // `recolor_target` but preserves the zone id (1..=3) so
        // `RenderMode::ZoneId` can emit per-zone marker fills.
        let recolor_zone = self
            .doc
            .sprite_color_zones
            .get(&child_id)
            .copied()
            .or(self.recolor_zone);
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
        //
        // Special case — `accessory-toggle` sprites: canonical Dofus
        // AS2 uses a 2-frame sprite with DIFFERENT children per frame
        // as the `mcToHide` argument to `applyAccessory`. Iop's R_tete
        // is the textbook case: frame 1 shows full hair
        // (`cIop_R_Cheveux`), frame 2 swaps it for short
        // (`cIop_R_CheveuxCourt`) so a hat doesn't clip. The AS2
        // `gotoAndStop(1 or 2)` PINS the toggle's frame based on
        // whether the relevant accessory is equipped — it does NOT
        // cycle. If we let the standard `% num_frames` rule apply,
        // the hair flips every body frame ("alternating hair" bug).
        // We detect this pattern structurally (frames have different
        // active character sets) and pin the frame to `hat_equipped
        // ? 1 : 0`. For canonical Dofus this only ever fires for
        // hair/head sprites — slot 1 is the only authored mcToHide.
        // Override path (checked FIRST, mirrors wc3 ctx.rs): a
        // caller-supplied map pins specific characters to a fixed
        // frame — canonical AS2 `stop()` on descendants of a wrapper
        // (settled `static*` idles, stopped tile children). The maps
        // are built from root-level timeline children only, so they
        // never collide with the deeper accessory-toggle sprites.
        let frame = if let Some(&pinned) = self
            .child_frame_overrides
            .and_then(|map| map.get(&child_id))
        {
            pinned
        } else {
            match self.doc.lookup_id(child_id) {
                Some(crate::swf_doc::Symbol::Sprite(c)) if c.num_frames > 1 => {
                    if is_accessory_toggle_sprite(c) {
                        if self.hat_equipped && c.num_frames > 1 { 1 } else { 0 }
                    } else {
                        self.frame % c.num_frames
                    }
                }
                _ => 0,
            }
        };

        let ratio = place.ratio.unwrap_or(0);

        let mut depth_path = self.depth_path.clone();
        depth_path.push(place.depth);

        RenderCtx {
            doc: self.doc,
            scene: self.scene,
            zone_scene: self.zone_scene.as_deref_mut(),
            wgpu: self.wgpu.as_mut().map(|w| WgpuCtx {
                device: w.device,
                queue: w.queue,
                renderer: w.renderer,
                filter_pipelines: w.filter_pipelines,
                output_scale: w.output_scale,
            }),
            transform,
            downstream_scale: self.downstream_scale,
            frame,
            ratio,
            color_xform,
            recolor_target,
            recolor_zone,
            player_colors: self.player_colors,
            cache: self.cache,
            accessories: self.accessories,
            apply_b_fix: self.apply_b_fix,
            // Band filter applies only to the entry walk; children
            // (sub-clips) render in full.
            band_filter: None,
            // Accessory toggle + output mode are sticky — propagate
            // through the recursion.
            disable_accessories: self.disable_accessories,
            output_mode: self.output_mode,
            hat_equipped: self.hat_equipped,
            depth_path,
            child_frame_overrides: self.child_frame_overrides,
        }
    }
}

/// Detect the canonical AS2 `mcToHide` pattern: a multi-frame
/// sprite whose frames have DIFFERENT active character sets (i.e.
/// the frames swap children, not just animate one child). This is
/// the structural signature of `applyAccessory`'s mcToHide arg —
/// Iop's `R_tete` (full hair on frame 1, short hair on frame 2) is
/// the textbook case.
///
/// We track active depth → character_id as we walk the timeline,
/// rebuilding the snapshot at every ShowFrame. If any frame's char
/// set differs from frame 1's, the sprite qualifies. Walking-arm
/// style animation (same child, different transform per frame)
/// keeps the same char set and is correctly excluded.
pub fn is_accessory_toggle_sprite(sprite: &crate::swf_doc::OwnedSprite) -> bool {
    if sprite.num_frames < 2 {
        return false;
    }
    use std::collections::{BTreeMap, BTreeSet};
    let mut depth_to_char: BTreeMap<u16, u16> = BTreeMap::new();
    let mut first_chars: Option<BTreeSet<u16>> = None;
    for op in &sprite.ops {
        match op {
            crate::swf_doc::OwnedOp::Place(p) => {
                if let Some(cid) = p.character_id {
                    depth_to_char.insert(p.depth, cid);
                }
            }
            crate::swf_doc::OwnedOp::Remove { depth } => {
                depth_to_char.remove(depth);
            }
            crate::swf_doc::OwnedOp::ShowFrame => {
                let cur: BTreeSet<u16> = depth_to_char.values().copied().collect();
                match &first_chars {
                    None => first_chars = Some(cur),
                    Some(first) if first != &cur => return true,
                    _ => {}
                }
            }
            _ => {}
        }
    }
    false
}
