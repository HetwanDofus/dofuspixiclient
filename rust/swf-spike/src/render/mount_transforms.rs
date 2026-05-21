//! Path B mount-transform extraction. Walks the body symbol's full
//! sub-tree per frame and records the accumulated affine matrix at
//! every `applyAccessory` mount placement. Pure CPU, no Vello
//! dispatch. JS uses this table to position accessory sprites per
//! game tick via `sprite.setFromMatrix(...)`.
//!
//! Output layout: flat `Vec<f32>` of length
//! `frame_count × max_slot × 6`. Each 6-tuple is `(a, b, c, d, tx, ty)`
//! — the canonical Vello/kurbo affine coefficient order. Translation
//! is in TWIP space (the body symbol's authored coordinate system);
//! the JS side multiplies `tx / ty` by `resolution / 20` to land in
//! pixel space. The linear part (`a, b, c, d`) is dimensionless and
//! passes through unscaled.
//!
//! Slots with no mount at a given frame land an identity matrix
//! (`a=1, b=0, c=0, d=1, tx=0, ty=0`) and a 0 in the parallel
//! `presence` array. JS uses the presence array (NOT the matrix
//! contents) as the source of truth for whether to render the
//! accessory — checking matrix-is-identity is a fragile heuristic
//! that can false-positive on legitimate identity placements.
//!
//! `apply_b_fix=true` negates `tx` for mounts whose `AccessoryMount`
//! declares `b_fix=true` — mirrors the body strip's bFix behaviour so
//! accessories track their body parts after the JS-flip.

use vello::kurbo::Affine;

use crate::swf_doc::{Symbol, SwfDoc};

use super::bounds::build_frame_state;

/// Number of 32-bit floats per mount matrix.
pub const FLOATS_PER_MATRIX: usize = 6;

/// Walk a body symbol over `[start, start + count)` frames and emit
/// (a) a dense table of mount transforms and (b) a parallel
/// per-(frame, slot) presence bitmap.
///
/// `matrices` length: `count * max_slot * 6`. Layout per (frame, slot):
///   `[a, b, c, d, tx, ty]` (kurbo/Vello affine coefficient order).
///   Identity where the slot has no mount at that frame — the JS
///   side MUST ignore matrix contents for absent slots.
///
/// `presence` length: `count * max_slot`. Each byte is 1 when the
///   body's display list places a mount of that slot at the frame,
///   0 otherwise. This is the canonical "should I draw the accessory"
///   signal — no false positives, no heuristics.
pub fn extract_mount_transforms(
    doc: &SwfDoc,
    body: &Symbol,
    start: u16,
    count: u16,
    apply_b_fix: bool,
    max_slot: u8,
) -> (Vec<f32>, Vec<u8>) {
    let total_floats = (count as usize) * (max_slot as usize) * FLOATS_PER_MATRIX;
    let total_presence = (count as usize) * (max_slot as usize);
    let mut matrices = vec![0.0_f32; total_floats];
    let mut presence = vec![0u8; total_presence];

    for frame_offset in 0..count {
        let frame = start.saturating_add(frame_offset);
        let base = (frame_offset as usize) * (max_slot as usize) * FLOATS_PER_MATRIX;
        let pbase = (frame_offset as usize) * (max_slot as usize);
        // Pre-fill the per-frame slice with identities so missing
        // slots show up as identity at the JS side. Presence pre-
        // fills to 0; `collect_frame` flips bytes to 1 as it visits.
        for slot in 0..(max_slot as usize) {
            let off = base + slot * FLOATS_PER_MATRIX;
            matrices[off] = 1.0;     // a
            matrices[off + 1] = 0.0; // b
            matrices[off + 2] = 0.0; // c
            matrices[off + 3] = 1.0; // d
            matrices[off + 4] = 0.0; // tx
            matrices[off + 5] = 0.0; // ty
        }
        collect_frame(
            doc,
            body,
            Affine::IDENTITY,
            frame,
            apply_b_fix,
            max_slot,
            &mut matrices[base..base + (max_slot as usize) * FLOATS_PER_MATRIX],
            &mut presence[pbase..pbase + (max_slot as usize)],
        );
    }
    (matrices, presence)
}

fn collect_frame(
    doc: &SwfDoc,
    sym: &Symbol,
    parent_transform: Affine,
    frame: u16,
    apply_b_fix: bool,
    max_slot: u8,
    out_frame: &mut [f32],
    presence_frame: &mut [u8],
) {
    let sprite = match sym {
        Symbol::Sprite(sp) => sp,
        _ => return,
    };
    let state = build_frame_state(sprite, frame);
    for (_depth, place) in state {
        let Some(cid) = place.character_id else { continue };

        // Apply bFix mirror to the placement's matrix BEFORE
        // composing it with the parent. The bFix flag negates the
        // placement's translation X so the eventual JS-flip lands the
        // body part — and its accessory — on the canonical side.
        let mut local = place.matrix.unwrap_or(Affine::IDENTITY);
        let mounts_at_cid = doc.accessory_mounts.get(&cid);
        if apply_b_fix
            && let Some(mounts) = mounts_at_cid
            && mounts.iter().any(|m| m.b_fix)
        {
            let coeffs = local.as_coeffs();
            local = Affine::new([
                coeffs[0],
                coeffs[1],
                coeffs[2],
                coeffs[3],
                -coeffs[4],
                coeffs[5],
            ]);
        }
        let world = parent_transform * local;

        if let Some(mounts) = mounts_at_cid {
            let coeffs = world.as_coeffs();
            for mount in mounts {
                if mount.slot >= max_slot {
                    continue;
                }
                let off = (mount.slot as usize) * FLOATS_PER_MATRIX;
                out_frame[off] = coeffs[0] as f32;
                out_frame[off + 1] = coeffs[1] as f32;
                out_frame[off + 2] = coeffs[2] as f32;
                out_frame[off + 3] = coeffs[3] as f32;
                out_frame[off + 4] = coeffs[4] as f32;
                out_frame[off + 5] = coeffs[5] as f32;
                presence_frame[mount.slot as usize] = 1;
            }
        }

        // Recurse into the child sprite at its propagated frame.
        // Mirrors `RenderCtx::child()` frame-propagation rule so
        // multi-frame sprite children loop modulo their own length.
        if let Some(child_sym) = doc.lookup_id(cid) {
            let child_frame = match child_sym {
                Symbol::Sprite(c) if c.num_frames > 1 => {
                    frame.checked_rem(c.num_frames).unwrap_or(0)
                }
                _ => 0,
            };
            collect_frame(
                doc,
                child_sym,
                world,
                child_frame,
                apply_b_fix,
                max_slot,
                out_frame,
                presence_frame,
            );
        }
    }
}
