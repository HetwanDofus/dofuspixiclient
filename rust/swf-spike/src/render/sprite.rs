//! Sprite timeline walker. Builds the per-depth placement state at
//! `ctx.frame`, processes clip-mask layers, hands filtered placements
//! to `filter::apply`, and recurses into ordinary children via
//! `ctx.child(place, id)`.
//!
//! Shape-leaf rendering is in `render::render_shape_into`; this fn
//! is purely the timeline structure.

use vello::kurbo::{Affine, BezPath};
use vello::peniko::{BlendMode, Fill};

use crate::swf_doc::{OwnedSprite, Symbol};

use super::bounds::build_frame_state;
use super::clip::collect_mask_path;
use super::ctx::RenderCtx;

pub(super) fn render_sprite_into(ctx: &mut RenderCtx<'_>, sprite: &OwnedSprite) {
    let state = build_frame_state(sprite, ctx.frame);

    // Path B body-band filter. `band_filter` is `Some` only on the
    // entry call — `ctx.child()` clears it so nested sub-clip walks
    // render unconditionally. We capture it locally and clear on the
    // ctx so the children we recurse into via `ctx.child(...)` start
    // clean.
    let band_filter = ctx.band_filter.take();
    let disable_accessories = ctx.disable_accessories;

    // SWF clip-mask stack: each Place with clip_depth=N defines a
    // mask that applies to placements at depths in (this_place_depth,
    // N]. Push a Vello layer with the mask geometry and pop when
    // the current depth exceeds the mask's clip_depth.
    let mut clip_stack: Vec<u16> = Vec::new();

    for (depth, p) in &state {
        // Band filter (Path B): top-level body walk only. Drop
        // placements outside the requested depth band.
        if let Some(range) = band_filter
            && !range.contains(*depth)
        {
            continue;
        }
        // Pop any clips whose range has ended.
        while clip_stack.last().map(|&end| *depth > end).unwrap_or(false) {
            clip_stack.pop();
            ctx.scene.pop_layer();
        }

        let id = match p.character_id {
            Some(id) => id,
            None => continue,
        };
        let child_sym = match ctx.doc.lookup_id(id) {
            Some(s) => s,
            None => continue,
        };

        // Clip-mask: don't draw the mask itself; push a Vello clip
        // layer using its geometry.
        if let Some(clip_depth) = p.clip_depth
            && clip_depth > 0
            && clip_depth > *depth
        {
            let local_xform = p.matrix.unwrap_or(Affine::IDENTITY);
            let mask_frame = match child_sym {
                Symbol::Sprite(c) if c.num_frames > 1 => ctx.frame,
                _ => 0,
            };
            let mut mask_path = BezPath::new();
            collect_mask_path(
                ctx.doc,
                child_sym,
                local_xform,
                mask_frame,
                p.ratio.unwrap_or(0),
                &mut mask_path,
            );
            if mask_path.elements().len() >= 4 {
                ctx.scene.push_layer(
                    Fill::NonZero,
                    BlendMode::default(),
                    1.0,
                    ctx.transform,
                    &mask_path,
                );
                clip_stack.push(clip_depth);
            }
            continue;
        }

        // Canonical-AS2 bFix: if this body part's mount declared
        // `b_fix=true` AND the caller flagged the strip for the
        // SW/W/NE direction set, negate the placement's translation
        // X so the global JS-flip leaves the body part (and its
        // attached accessory) on the canonical side. We only
        // override the placement matrix WHEN bFix actually applies
        // — otherwise hats/weapons (no bFix) keep their authored
        // matrix.
        let b_fixed_place: Option<crate::swf_doc::OwnedPlace>;
        let active_place: &crate::swf_doc::OwnedPlace = if ctx.apply_b_fix {
            let bfix = ctx
                .doc
                .accessory_mounts
                .get(&id)
                .map(|mounts| mounts.iter().any(|m| m.b_fix))
                .unwrap_or(false);
            if bfix {
                let mut clone = p.clone();
                if let Some(m) = clone.matrix.as_mut() {
                    let coeffs = m.as_coeffs();
                    *m = vello::kurbo::Affine::new([
                        coeffs[0],
                        coeffs[1],
                        coeffs[2],
                        coeffs[3],
                        -coeffs[4],
                        coeffs[5],
                    ]);
                }
                b_fixed_place = Some(clone);
                b_fixed_place.as_ref().unwrap()
            } else {
                p
            }
        } else {
            p
        };

        // Ordinary or filtered placement: recurse via ctx.child().
        // For filtered, hand off to filter::apply which inherits
        // ratio + recolor from the child ctx (closes filter+morph
        // and filter+zone composability bugs).
        let mut child = ctx.child(active_place, id);
        if !active_place.filters.is_empty() {
            super::filter::apply(&mut child, child_sym, &active_place.filters);
        } else {
            super::render_symbol_into(&mut child, child_sym);
        }

        // Accessory composition: if this placement's character is a
        // declared `applyAccessory` mount AND the caller passed an
        // accessory entry for the mount's slot, render the accessory
        // SWF's symbol at the body part's world transform. The mount
        // declaration carries the canonical `side` string (e.g. "R",
        // "WR", "B") which the accessory frame resolver uses to pick
        // the right directional frame range.
        //
        // Path B: `disable_accessories=true` skips this block — the
        // accessory pass bakes accessories independently and the Pixi
        // compositor stacks them between body bands at runtime.
        if !disable_accessories
            && let Some(dict) = child.accessories
            && let Some(mounts) = child.doc.accessory_mounts.get(&id)
        {
            for mount in mounts {
                if let Some(entry) = dict.get(&mount.slot) {
                    super::render_accessory_at(&mut child, entry, mount);
                }
            }
        }
    }

    // Pop any remaining clips at sprite end.
    while !clip_stack.is_empty() {
        clip_stack.pop();
        ctx.scene.pop_layer();
    }
}
