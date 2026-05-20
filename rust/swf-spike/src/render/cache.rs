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
//! - `frame_states`: (sprite-id, frame) → resolved
//!   `BTreeMap<depth, OwnedPlace>`. Walking ops to build the
//!   placement snapshot is O(N ops); same (sprite, frame) gets
//!   asked many times in a steady-state animation loop.
//!
//! Everything is keyed by parser-immutable IDs, so cache invalidation
//! is "drop the cache when the SwfDoc drops". `RefCell` gives interior
//! mutability through the `&RenderCache` references the renderer
//! holds.

use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use crate::shape::{flatten_shape, DrawCmd};
use crate::swf_doc::{OwnedPlace, OwnedSprite, SwfDoc};

use super::build_frame_state;

#[derive(Default)]
pub struct RenderCache {
    shape_cmds: RefCell<HashMap<u16, Arc<Vec<DrawCmd>>>>,
    morph_frames: RefCell<HashMap<(u16, u8), Arc<swf::Shape>>>,
    frame_states: RefCell<HashMap<(u16, u16), Arc<BTreeMap<u16, OwnedPlace>>>>,
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
        let cmds = Arc::new(flatten_shape(shape, doc));
        self.shape_cmds.borrow_mut().insert(id, Arc::clone(&cmds));
        cmds
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

    /// Cached `build_frame_state`. Sprite is identified by its
    /// `(parent-pseudo-id, frame)` tuple — callers pass the sprite's
    /// own `char_id` (or 0 for the root timeline).
    pub fn frame_state(
        &self,
        sprite_id: u16,
        sprite: &OwnedSprite,
        frame: u16,
    ) -> Arc<BTreeMap<u16, OwnedPlace>> {
        let key = (sprite_id, frame);
        if let Some(cached) = self.frame_states.borrow().get(&key) {
            return Arc::clone(cached);
        }
        let state = Arc::new(build_frame_state(sprite, frame));
        self.frame_states
            .borrow_mut()
            .insert(key, Arc::clone(&state));
        state
    }

    /// Drop everything. Callers may want this if the SwfDoc was
    /// mutated (it shouldn't be, but defensive).
    pub fn clear(&self) {
        self.shape_cmds.borrow_mut().clear();
        self.morph_frames.borrow_mut().clear();
        self.frame_states.borrow_mut().clear();
    }
}
