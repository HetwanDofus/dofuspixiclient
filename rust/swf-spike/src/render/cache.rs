//! Memoization for repeatable per-symbol work the renderer does on
//! every frame. Three caches sit here:
//!
//! - `shape_cmds`: shape-id → flattened `DrawCmd` list. Shape geometry
//!   is immutable post-parse; flattening (path construction + brush
//!   resolution) is the expensive bit. A typical Dofus body part
//!   sprite places the same shape many times across animation
//!   frames; cache hit rate is ~99% after the first walk.
//!
//! - `morph_frames`: (morph-id, ratio_high_byte) → interpolated
//!   `swf::Shape`. Morph interpolation runs through every
//!   `ShapeRecord` lerping coords; bucketing the ratio to its high
//!   byte (≈256 unique values) keeps the cache bounded and is finer
//!   than the eye can see at 60 fps.
//!
//! - `frame_states`: (sprite-pointer, frame) → resolved
//!   `BTreeMap<depth, OwnedPlace>`. Walking ops to build the
//!   placement snapshot is O(N ops); same (sprite, frame) gets
//!   asked many times during a single class-atlas bake (once per
//!   band × frame, and the bands all read the same state).
//!   Pointer identity is safe because `SwfDoc::by_id` is immutable
//!   for the lifetime of the doc; once parsed, sprite addresses
//!   are stable. Each bundle has its own `RenderCache`, so cross-
//!   bundle pointer reuse is impossible.
//!
//! Everything is keyed by parser-immutable IDs, so cache invalidation
//! is "drop the cache when the SwfDoc drops". `RefCell` gives interior
//! mutability through the `&RenderCache` references the renderer
//! holds.

use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::shape::{flatten_shape, DrawCmd};
use crate::swf_doc::{OwnedPlace, OwnedSprite, SwfDoc};

use super::build_frame_state;

/// cpu-bench support: when set, [`RenderCache::shape_frags`] builds its
/// fragment scenes with display-list recording enabled so a recording
/// parent scene captures fragment appends instead of marking them lossy.
/// Off by default — production bakes pay zero recording overhead. Set it
/// BEFORE the first walk; already-cached fragments are not rebuilt.
static RECORD_FRAGMENTS: AtomicBool = AtomicBool::new(false);

/// See [`RECORD_FRAGMENTS`].
pub fn set_record_fragments(on: bool) {
    RECORD_FRAGMENTS.store(on, Ordering::Relaxed);
}

#[derive(Default)]
pub struct RenderCache {
    shape_cmds: RefCell<HashMap<u16, Arc<Vec<DrawCmd>>>>,
    /// Per-shape pre-encoded vello fragments — one `Scene` per `DrawCmd` (same
    /// order/length as [`shape_cmds`]), each emitted at IDENTITY with no colour
    /// transform. The crowd bake appends these with the per-frame transform
    /// (`Scene::append` = memcpy streams + rebase offsets) instead of
    /// re-serializing every path on every bake.
    shape_frags: RefCell<HashMap<u16, Arc<Vec<vello::Scene>>>>,
    morph_frames: RefCell<HashMap<(u16, u8), Arc<swf::Shape>>>,
    /// Keyed by `(sprite as *const _ as usize, frame)`. The pointer
    /// is stable for the doc's lifetime; using it instead of the
    /// sprite's character_id avoids plumbing the id through every
    /// recursive renderer call.
    frame_states: RefCell<HashMap<(usize, u16), Arc<BTreeMap<u16, OwnedPlace>>>>,
    /// Settled child-frame pins for `static*` exports, keyed by the
    /// export's character id. Computing them re-runs AVM1 ticks
    /// (`tile_behavior::settled_static_overrides`, up to 600 per
    /// child) — memoized here so per-frame render paths pay one
    /// HashMap lookup. Empty maps are cached too (a static export
    /// whose children never settle must not recompute every render).
    settled_static: RefCell<HashMap<u16, Arc<HashMap<u16, u16>>>>,
}

impl RenderCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// Cached `flatten_shape`. Returns an `Arc` so callers can iterate
    /// borrowed; recolor callers clone individual `DrawCmd`s as
    /// needed (cheap — `BezPath` and `Brush` are internally
    /// reference-counted).
    pub fn shape_cmds(&self, shape: &swf::Shape, doc: &SwfDoc) -> Arc<Vec<DrawCmd>> {
        let id = shape.id;
        if let Some(cached) = self.shape_cmds.borrow().get(&id) {
            return Arc::clone(cached);
        }
        super::probe::shape_flatten();
        let cmds = Arc::new(flatten_shape(shape, doc));
        self.shape_cmds.borrow_mut().insert(id, Arc::clone(&cmds));
        cmds
    }

    /// Cached per-`DrawCmd` vello fragments for a shape (see [`shape_frags`]
    /// field). Built from [`shape_cmds`] so indices line up 1:1. Each fragment
    /// is the cmd emitted at IDENTITY with no colour transform; the caller
    /// `Scene::append`s it with the real per-frame transform.
    pub fn shape_frags(&self, shape: &swf::Shape, doc: &SwfDoc) -> Arc<Vec<vello::Scene>> {
        let id = shape.id;
        if let Some(cached) = self.shape_frags.borrow().get(&id) {
            return Arc::clone(cached);
        }
        let cmds = self.shape_cmds(shape, doc);
        let frags: Vec<vello::Scene> = cmds
            .iter()
            .map(|cmd| {
                let mut s = vello::Scene::new();

                if RECORD_FRAGMENTS.load(Ordering::Relaxed) {
                    s.enable_recording();
                }

                super::emit::emit_cmd(
                    &mut s,
                    cmd,
                    vello::kurbo::Affine::IDENTITY,
                    crate::swf_doc::OwnedColorTransform::IDENTITY,
                );
                s
            })
            .collect();
        let arc = Arc::new(frags);
        self.shape_frags.borrow_mut().insert(id, Arc::clone(&arc));
        arc
    }

    /// Cached morph interpolation. Bucketed by `ratio >> 8`.
    pub fn morph_frame(
        &self,
        ms: &swf::DefineMorphShape,
        ratio: u16,
    ) -> Arc<swf::Shape> {
        let key = (ms.id, (ratio >> 8) as u8);
        if let Some(cached) = self.morph_frames.borrow().get(&key) {
            return Arc::clone(cached);
        }
        let shape = Arc::new(crate::morph::build_morph_frame(ms, ratio));
        self.morph_frames.borrow_mut().insert(key, Arc::clone(&shape));
        shape
    }

    /// Cached `build_frame_state` keyed by sprite pointer identity.
    /// Callers do not need to know the sprite's char_id; pointers
    /// into `SwfDoc::by_id` are stable for the doc's lifetime.
    pub fn frame_state(
        &self,
        sprite: &OwnedSprite,
        frame: u16,
    ) -> Arc<BTreeMap<u16, OwnedPlace>> {
        let key = (sprite as *const OwnedSprite as usize, frame);
        if let Some(cached) = self.frame_states.borrow().get(&key) {
            return Arc::clone(cached);
        }
        super::probe::frame_state_miss();
        let state = Arc::new(build_frame_state(sprite, frame));
        self.frame_states
            .borrow_mut()
            .insert(key, Arc::clone(&state));
        state
    }

    /// Settled child-frame pins for a `static*` character export —
    /// `None` for every other export (cycling anims must keep their
    /// normal `% num_frames` child propagation; pinning them would
    /// freeze the animation).
    ///
    /// CANONICAL SEMANTICS: NPC/monster `static*` exports are 1-frame
    /// wrappers whose multi-frame children play a settle-in then
    /// `stop()`; Flash keeps showing the stopped frame (see
    /// `tile_behavior::settled_static_overrides` for the AS2
    /// citations). The returned map feeds
    /// `RenderCtx::with_child_frame_overrides` so every render path
    /// (strip, class atlas, crowd bands, portraits) shows the settled
    /// pose. Memoized per export character id; the underlying AVM1
    /// simulation never runs more than once per (bundle, export).
    pub fn settled_overrides(
        &self,
        doc: &SwfDoc,
        export: &str,
    ) -> Option<Arc<HashMap<u16, u16>>> {
        if !export.starts_with("static") {
            return None;
        }
        let id = *doc.by_name.get(export)?;
        if let Some(cached) = self.settled_static.borrow().get(&id) {
            return Some(Arc::clone(cached));
        }
        let sym = doc.lookup_id(id)?;
        let overrides = Arc::new(crate::tile_behavior::settled_static_overrides(doc, sym));
        self.settled_static
            .borrow_mut()
            .insert(id, Arc::clone(&overrides));
        Some(overrides)
    }

    /// Drop everything. Callers may want this if the SwfDoc was
    /// mutated (it shouldn't be, but defensive).
    pub fn clear(&self) {
        self.shape_cmds.borrow_mut().clear();
        self.morph_frames.borrow_mut().clear();
        self.frame_states.borrow_mut().clear();
        self.settled_static.borrow_mut().clear();
    }
}
