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

use std::collections::HashSet;

use vello::kurbo::Affine;

use crate::swf_doc::{OwnedOp, OwnedSprite, Symbol, SwfDoc};

use super::bounds::build_frame_state;

/// One accessory slot placement inside the body's display list at the
/// reference frame. `side` is the authored AS2 `applyAccessory(this,
/// slot, side)` argument — canonical Dofus 1.29 expects this exact
/// string to be passed to the accessory's `gotoAndStop()`. JS must
/// use it as the `side` argument when baking the accessory strip;
/// using the bot's `dir` instead silently breaks "walking" variants
/// like `WR` (cape walking right) by routing them to the `R` frame.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SlotDepth {
    pub slot: u8,
    pub depth: u16,
    pub side: Option<String>,
}

/// Extract slot depths from a body sprite at the given frame.
/// Returns entries sorted by depth ascending. Empty when the body has
/// no accessory mounts in its (potentially nested) display tree.
///
/// **Canonical Dofus 1.29 wrapping**: character body exports
/// (`staticR`, `walkB`, etc.) typically place their actual body
/// parts inside a SINGLE unnamed wrapper child at depth 1. Mounts
/// live in the WRAPPER's display list, not the body export's. We
/// detect this by descending through single-placement chains until
/// we find a level with at least one mount, OR exhaust the descent
/// budget. Without this descent, `extract_slot_depths` returns
/// empty for canonical bodies → band_count=1 → the JS compositor
/// can't interleave accessories between bands → all accessories
/// render in front of the body (the "cape in front when north" bug).
pub fn extract_slot_depths(doc: &SwfDoc, body: &OwnedSprite, frame: u16) -> Vec<SlotDepth> {
    if let Some(effective) = find_effective_body_inner(doc, body, frame) {
        extract_slot_depths_direct(doc, effective, frame)
    } else {
        extract_slot_depths_direct(doc, body, frame)
    }
}

/// Same descent logic as `find_effective_body_symbol` but returns
/// `&OwnedSprite` directly. Returns `None` if the body sprite itself
/// is the canonical layer (no descent needed). The accumulated
/// transform is dropped — for non-rendering callers (slot depth
/// extraction) the transform doesn't matter.
fn find_effective_body_inner<'a>(
    doc: &'a SwfDoc,
    body: &'a OwnedSprite,
    frame: u16,
) -> Option<&'a OwnedSprite> {
    let mut current: &OwnedSprite = body;
    let mut descended = false;
    for _ in 0..MAX_WRAPPER_DESCENT {
        if !extract_slot_depths_direct(doc, current, frame).is_empty() {
            return if descended { Some(current) } else { None };
        }
        let state = build_frame_state(current, frame);
        if state.len() != 1 {
            return if descended { Some(current) } else { None };
        }
        let Some((_d, place)) = state.iter().next() else {
            return if descended { Some(current) } else { None };
        };
        let Some(cid) = place.character_id else {
            return if descended { Some(current) } else { None };
        };
        let Some(Symbol::Sprite(child)) = doc.lookup_id(cid) else {
            return if descended { Some(current) } else { None };
        };
        current = child;
        descended = true;
    }
    if descended { Some(current) } else { None }
}

/// Pure-direct version (no wrapper descent). Use from
/// `find_effective_body_sprite` to avoid recursion ambiguity.
fn extract_slot_depths_direct(
    doc: &SwfDoc,
    body: &OwnedSprite,
    frame: u16,
) -> Vec<SlotDepth> {
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
                side: mount.side.clone(),
            });
        }
    }
    entries.sort_by_key(|e| e.depth);
    entries
}

/// Maximum wrapper-chain depth to descend before giving up. 4 is
/// generous for the canonical Dofus pattern (usually 1 level).
const MAX_WRAPPER_DESCENT: usize = 4;

/// Find the Symbol in the body's display tree whose top-level
/// placements contain the accessory mounts. Canonical Dofus body
/// exports wrap their mount-declaring body parts inside a chain of
/// unnamed single-placement sprites; we descend through them so the
/// caller can operate on the wrapper's depth space (where the band
/// split is meaningful).
///
/// Returns `(effective_symbol, accumulated_transform)`. The
/// transform is the product of every wrapper placement's matrix
/// that was descended through — apply it to the caller's transform
/// so the renderer hits the wrapper at the canonical position.
///
/// Stops descent when:
/// - The current sprite has mounts in its top-level placements.
/// - The current sprite has 0 or >1 placements (no clear wrapper).
/// - `MAX_WRAPPER_DESCENT` exhausted.
pub fn find_effective_body_symbol<'a>(
    doc: &'a SwfDoc,
    body_sym: &'a Symbol,
    frame: u16,
) -> (&'a Symbol, Affine) {
    let mut current_sym: &Symbol = body_sym;
    let mut xform = Affine::IDENTITY;
    for _ in 0..MAX_WRAPPER_DESCENT {
        let Symbol::Sprite(current) = current_sym else {
            return (current_sym, xform);
        };
        // If this level has mounts, we're at the canonical layer.
        if !extract_slot_depths_direct(doc, current, frame).is_empty() {
            return (current_sym, xform);
        }
        // No mounts here — try descending through a single-placement
        // wrapper. If there isn't exactly one placement at this
        // frame, we can't unambiguously descend; bail.
        let state = build_frame_state(current, frame);
        if state.len() != 1 {
            return (current_sym, xform);
        }
        let Some((_depth, place)) = state.iter().next() else {
            return (current_sym, xform);
        };
        let Some(cid) = place.character_id else {
            return (current_sym, xform);
        };
        let Some(child_sym) = doc.lookup_id(cid) else {
            return (current_sym, xform);
        };
        // Compose the wrapper's placement matrix into our running
        // transform so the renderer ends up at the same world
        // position the canonical walk would.
        let local = place.matrix.unwrap_or(Affine::IDENTITY);
        xform = xform * local;
        current_sym = child_sym;
    }
    (current_sym, xform)
}

/// Compute the band depth range for `band_index`. The body display
/// list is conceptually split into `slots.len() + 1` Z-ordered bands:
///
/// - band 0: depths <= slots[0].depth
/// - band i (0 < i < N): slots[i-1].depth < depths <= slots[i].depth
/// - band N: depths > slots[N-1].depth
///
/// **Upper bound is INCLUSIVE.** Canonical AS2 semantics (per
/// `render::sprite::render_symbol_into`): the body part that
/// declares the mount renders its OWN content FIRST, then the
/// accessory renders ON TOP. So the body part at `slots[k].depth`
/// must be in band[k] — the band immediately PRECEDING the
/// accessory's Z slot. Excluding it (the previous behaviour) drops
/// the body part's authored art from the atlas and leaves the
/// accessory floating at the wrong Z plane relative to neighbouring
/// body parts. This shows up as "capes rendering in front when
/// static" when the mount body part has any forward extent or any
/// non-trivial Z relationship with adjacent depths.
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
    BandRange { lo_exclusive: lo, hi_inclusive: hi }
}

/// Depth range for a band. Lower bound exclusive, upper bound
/// **inclusive** (canonical AS2: the mount body part renders BEFORE
/// its accessory, so it belongs in the band immediately preceding
/// the accessory's Z slot). `None` means unbounded on that side.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BandRange {
    pub lo_exclusive: Option<u16>,
    pub hi_inclusive: Option<u16>,
}

impl BandRange {
    /// Whole-range constant; equivalent to "no band filter".
    pub const ALL: BandRange = BandRange {
        lo_exclusive: None,
        hi_inclusive: None,
    };

    /// Test whether a depth falls inside this band.
    #[inline]
    pub fn contains(&self, depth: u16) -> bool {
        if let Some(lo) = self.lo_exclusive
            && depth <= lo
        {
            return false;
        }
        if let Some(hi) = self.hi_inclusive
            && depth > hi
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

/// Does the symbol with `cid` produce any visible pixels when
/// rendered (recursively)? Used to detect "trivial" bands —
/// canonical Dofus character bodies wrap accessory mounts in empty
/// placeholder sprites; bands containing only such placeholders bake
/// to zero pixels yet still cost full strip_w × strip_h atlas area.
/// Skipping them lets the atlas shrink ~5× for typical Dofus body
/// exports.
fn has_visible_content(doc: &SwfDoc, cid: u16, visited: &mut HashSet<u16>) -> bool {
    if !visited.insert(cid) {
        return false;
    }
    let Some(sym) = doc.lookup_id(cid) else {
        return false;
    };
    match sym {
        Symbol::Shape(_) | Symbol::Bitmap(_) | Symbol::MorphShape(_) => true,
        Symbol::Sprite(sp) => {
            for op in &sp.ops {
                if let OwnedOp::Place(p) = op {
                    if let Some(child_cid) = p.character_id {
                        if has_visible_content(doc, child_cid, visited) {
                            return true;
                        }
                    }
                }
            }
            false
        }
    }
}

/// Does any sprite reachable from `body` (recursively) match the
/// `mcToHide` accessory-toggle pattern? Used to decide whether the
/// body atlas needs to bake separate `hat_equipped=true/false`
/// variants. For canonical Dofus 1.29 only Iop's body has a toggle
/// sprite; for every other class this returns false and the JS
/// cache layer can collapse the `hatEquipped` dimension, halving
/// the body atlas cache footprint.
pub fn body_has_toggle_sprite(doc: &SwfDoc, body: &OwnedSprite) -> bool {
    let mut visited = HashSet::new();
    has_toggle_sprite_recursive(doc, body, &mut visited)
}

fn has_toggle_sprite_recursive(
    doc: &SwfDoc,
    sprite: &OwnedSprite,
    visited: &mut HashSet<u16>,
) -> bool {
    for op in &sprite.ops {
        if let OwnedOp::Place(p) = op {
            if let Some(cid) = p.character_id {
                if !visited.insert(cid) {
                    continue;
                }
                let Some(Symbol::Sprite(child)) = doc.lookup_id(cid) else {
                    continue;
                };
                if super::ctx::is_accessory_toggle_sprite(child) {
                    return true;
                }
                if has_toggle_sprite_recursive(doc, child, visited) {
                    return true;
                }
            }
        }
    }
    false
}

/// For each of the `slots.len() + 1` Z-ordered bands, return `true`
/// if that band's depth range contains any placement that produces
/// visible pixels. Bands marked `false` are "trivial" — they only
/// contain empty mount-placeholder sprites and can be omitted from
/// the atlas without visual effect. JS still uses `slots.len()` for
/// accessory Z-ordering; the present bands keep their LOGICAL
/// bandIndex so accessory zIndex assignments stay correct.
pub fn compute_band_presence(
    doc: &SwfDoc,
    body: &OwnedSprite,
    frame: u16,
    slots: &[SlotDepth],
) -> Vec<bool> {
    let mut out = vec![false; slots.len() + 1];
    let state = build_frame_state(body, frame);
    for (depth, place) in &state {
        let Some(cid) = place.character_id else {
            continue;
        };
        let mut visited = HashSet::new();
        if !has_visible_content(doc, cid, &mut visited) {
            continue;
        }
        // Find which band this depth falls into.
        for (i, present) in out.iter_mut().enumerate() {
            if band_range(slots, i).contains(*depth) {
                *present = true;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn band_range_three_slots() {
        let slots = vec![
            SlotDepth { slot: 0, depth: 5, side: None },
            SlotDepth { slot: 1, depth: 10, side: None },
            SlotDepth { slot: 2, depth: 15, side: None },
        ];
        assert_eq!(band_count(&slots), 4);

        // Canonical: mount depth lives in the band immediately
        // BEFORE its accessory's Z slot (upper bound INCLUSIVE).
        let b0 = band_range(&slots, 0);
        assert_eq!(b0, BandRange { lo_exclusive: None, hi_inclusive: Some(5) });
        assert!(b0.contains(1));
        assert!(b0.contains(4));
        assert!(b0.contains(5)); // slot[0]'s body part rendered in band 0
        assert!(!b0.contains(6));

        let b1 = band_range(&slots, 1);
        assert_eq!(b1, BandRange { lo_exclusive: Some(5), hi_inclusive: Some(10) });
        assert!(!b1.contains(5));  // slot[0]'s body part was in band 0
        assert!(b1.contains(6));
        assert!(b1.contains(10));  // slot[1]'s body part rendered in band 1
        assert!(!b1.contains(11));

        let b3 = band_range(&slots, 3);
        assert_eq!(b3, BandRange { lo_exclusive: Some(15), hi_inclusive: None });
        assert!(!b3.contains(15)); // slot[2]'s body part was in band 2
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
