//! Per-direction (slot, depth) extraction for body symbols.
//!
//! Path B slices the body symbol into Z-ordered bands at the depths
//! where accessory slots mount. The walker (`render::sprite`) places
//! accessories at whatever depth the matching child clip is placed at
//! in the body's display list — `accessory_mounts` is keyed by child
//! `character_id`, not by depth. To pre-compute the band split, we
//! walk the body's frame state at frame 0 of the requested export and
//! emit one `SlotDepth { slot, depth }` per declared mount.
//!
//! Dofus 1.29 character bundles export one symbol per (anim,
//! direction) tuple (`staticR`, `walkR`, …). Each export is its own
//! body sprite with its own display list — so slot depths are
//! extracted from the resolved symbol, not from a global "body
//! symbol". For exports that internally label multiple directions on
//! one timeline, callers can supply a non-zero frame.
//!
//! Sorting: depths ascending. Band `i` (0-based) covers depth in
//! (slots[i-1].depth, slots[i].depth), with band 0 covering depth <
//! slots[0].depth and band N covering depth > slots[N-1].depth.
//! Slot-marker depths themselves are filtered out — they're the
//! placeholder children replaced by accessory sprites.
//!
//! Caching is the caller's responsibility (the WASM bridge keys cache
//! by `(bundle_name, export, frame)`).

use crate::swf_doc::{OwnedSprite, SwfDoc};

use super::bounds::build_frame_state;

/// One accessory slot placement inside the body's display list at the
/// reference frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SlotDepth {
    pub slot: u8,
    pub depth: u16,
}

/// Extract slot depths from a body sprite at the given frame.
/// Returns entries sorted by depth ascending. Empty when the body has
/// no accessory mounts at this frame.
pub fn extract_slot_depths(doc: &SwfDoc, body: &OwnedSprite, frame: u16) -> Vec<SlotDepth> {
    let state = build_frame_state(body, frame);
    let mut entries: Vec<SlotDepth> = Vec::new();
    for (depth, place) in state {
        let Some(cid) = place.character_id else { continue };
        let Some(mounts) = doc.accessory_mounts.get(&cid) else {
            continue;
        };
        for mount in mounts {
            entries.push(SlotDepth {
                slot: mount.slot,
                depth,
            });
        }
    }
    entries.sort_by_key(|e| e.depth);
    entries
}

/// Compute the band depth range for `band_index`. The body display
/// list is conceptually split into `slots.len() + 1` Z-ordered bands:
///
/// - band 0: depths < slots[0].depth
/// - band i (0 < i < N): slots[i-1].depth < depths < slots[i].depth
/// - band N: depths > slots[N-1].depth
///
/// Slot-marker depths themselves are filtered out of every band —
/// they are the placeholder children replaced by the accessory
/// sprite.
pub fn band_range(slots: &[SlotDepth], band_index: usize) -> BandRange {
    let n = slots.len();
    let lo = if band_index == 0 {
        None
    } else {
        slots.get(band_index - 1).map(|s| s.depth)
    };
    let hi = if band_index >= n {
        None
    } else {
        slots.get(band_index).map(|s| s.depth)
    };
    BandRange { lo_exclusive: lo, hi_exclusive: hi }
}

/// Depth range for a band. Both bounds exclusive. `None` means
/// unbounded on that side.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BandRange {
    pub lo_exclusive: Option<u16>,
    pub hi_exclusive: Option<u16>,
}

impl BandRange {
    /// Whole-range constant; equivalent to "no band filter".
    pub const ALL: BandRange = BandRange {
        lo_exclusive: None,
        hi_exclusive: None,
    };

    /// Test whether a depth falls inside this band.
    #[inline]
    pub fn contains(&self, depth: u16) -> bool {
        if let Some(lo) = self.lo_exclusive
            && depth <= lo
        {
            return false;
        }
        if let Some(hi) = self.hi_exclusive
            && depth >= hi
        {
            return false;
        }
        true
    }
}

/// Total band count for a slot-depth list. Equals `slots.len() + 1`.
/// When `slots` is empty the body is one band.
#[inline]
pub fn band_count(slots: &[SlotDepth]) -> usize {
    slots.len() + 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn band_range_three_slots() {
        let slots = vec![
            SlotDepth { slot: 0, depth: 5 },
            SlotDepth { slot: 1, depth: 10 },
            SlotDepth { slot: 2, depth: 15 },
        ];
        assert_eq!(band_count(&slots), 4);

        let b0 = band_range(&slots, 0);
        assert_eq!(b0, BandRange { lo_exclusive: None, hi_exclusive: Some(5) });
        assert!(b0.contains(1));
        assert!(b0.contains(4));
        assert!(!b0.contains(5));

        let b1 = band_range(&slots, 1);
        assert_eq!(b1, BandRange { lo_exclusive: Some(5), hi_exclusive: Some(10) });
        assert!(!b1.contains(5));
        assert!(b1.contains(6));
        assert!(b1.contains(9));
        assert!(!b1.contains(10));

        let b3 = band_range(&slots, 3);
        assert_eq!(b3, BandRange { lo_exclusive: Some(15), hi_exclusive: None });
        assert!(!b3.contains(15));
        assert!(b3.contains(16));
        assert!(b3.contains(99));
    }

    #[test]
    fn band_range_empty_slots_is_single_band() {
        let slots: Vec<SlotDepth> = vec![];
        assert_eq!(band_count(&slots), 1);
        let b0 = band_range(&slots, 0);
        assert_eq!(b0, BandRange::ALL);
        assert!(b0.contains(0));
        assert!(b0.contains(u16::MAX));
    }
}
