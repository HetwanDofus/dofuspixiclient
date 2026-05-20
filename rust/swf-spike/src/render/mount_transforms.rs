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
//! (`a=1, b=0, c=0, d=1, tx=0, ty=0`). JS only consults entries for
//! slots that actually have an accessory equipped, so the identity
//! filler is harmless.
//!
//! `apply_b_fix=true` negates `tx` for mounts whose `AccessoryMount`
//! declares `b_fix=true` — mirrors the body strip's bFix behaviour so
//! accessories track their body parts after the JS-flip.

use vello::kurbo::Affine;

use crate::swf_doc::{Symbol, SwfDoc};

use super::bounds::build_frame_state;

/// Number of 32-bit floats per mount matrix.
pub const FLOATS_PER_MATRIX: usize = 6;

/// Walk a body symbol over `[start, start + count)` frames and emit a
/// dense table of mount transforms. Returns `Vec<f32>` of length
/// `count as usize * max_slot as usize * 6`. Identity matrix where a
/// slot has no mount at that frame.
pub fn extract_mount_transforms(
    doc: &SwfDoc,
    body: &Symbol,
    start: u16,
    count: u16,
    apply_b_fix: bool,
    max_slot: u8,
) -> Vec<f32> {
    let total = (count as usize) * (max_slot as usize) * FLOATS_PER_MATRIX;
    let mut out = vec![0.0_f32; total];

    for frame_offset in 0..count {
        let frame = start.saturating_add(frame_offset);
        let base = (frame_offset as usize) * (max_slot as usize) * FLOATS_PER_MATRIX;
        // Pre-fill the per-frame slice with identities so missing
        // slots show up as identity at the JS side.
        for slot in 0..(max_slot as usize) {
            let off = base + slot * FLOATS_PER_MATRIX;
            out[off] = 1.0;     // a
            out[off + 1] = 0.0; // b
            out[off + 2] = 0.0; // c
            out[off + 3] = 1.0; // d
            out[off + 4] = 0.0; // tx
            out[off + 5] = 0.0; // ty
        }
        collect_frame(
            doc,
            body,
            Affine::IDENTITY,
            frame,
            apply_b_fix,
            max_slot,
            &mut out[base..base + (max_slot as usize) * FLOATS_PER_MATRIX],
        );
    }
    out
}

fn collect_frame(
    doc: &SwfDoc,
    sym: &Symbol,
    parent_transform: Affine,
    frame: u16,
    apply_b_fix: bool,
    max_slot: u8,
    out_frame: &mut [f32],
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
            );
        }
    }
}
