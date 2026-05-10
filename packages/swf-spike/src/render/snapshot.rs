//! Resolved placement tree handed from `AvmRenderer::build_snapshot`
//! to `render::render_snapshot`. Captures every AVM1 runtime override
//! (effective transforms with `_xscale/_yscale/_rotation`, alpha
//! composed with `_alpha`, dynamic `attachMovie` placements, removed
//! sprites = empty subtrees) so the renderer never needs to read
//! engine state — it just walks the tree and emits Vello commands.
//!
//! Why a tree rather than per-tick mutation: tests can hand-craft
//! snapshots without instantiating an AvmEngine, and AVM1 changes
//! never break the renderer (snapshot is the contract).

use vello::kurbo::Affine;
use vello::peniko::{BlendMode, Compose, Fill, Mix};
use vello::kurbo::Rect;

use crate::swf_doc::{OwnedBlendMode, OwnedColorTransform, OwnedFilter, Symbol};

use super::ctx::RenderCtx;
use super::render_shape;

/// A flattened, resolved view of one sprite's per-depth placements at
/// a given AVM1 tick. Depth-sorted; `child` snapshots represent the
/// nested sprite tree at the same tick.
#[derive(Debug, Clone, Default)]
pub struct PlacedSnapshot {
    pub placements: Vec<ResolvedPlace>,
}

/// One resolved placement. Transforms and color xforms are already
/// composed with the parent's; the renderer applies them directly.
#[derive(Debug, Clone)]
pub struct ResolvedPlace {
    pub depth: u16,
    pub character_id: u16,
    /// World-space transform: every AVM1 override has been folded in.
    pub world_transform: Affine,
    /// Composed color transform: parent's CXFORM ∘ placement
    /// CXFORM ∘ runtime `_alpha` override.
    pub color_xform: OwnedColorTransform,
    pub ratio: u16,
    pub clip_depth: Option<u16>,
    pub filters: Vec<OwnedFilter>,
    pub blend_mode: Option<OwnedBlendMode>,
    pub name: Option<String>,
    /// Sprite's `current_frame` at tick time (1-based as AVM1
    /// reports it; `current_frame.saturating_sub(1)` for renderer
    /// frame indices). Used by filter rendering which has to
    /// re-walk the timeline statically.
    pub current_frame: u16,
    /// For sprite children: their resolved snapshot (built
    /// recursively at tick time). For shapes/morphs/bitmaps: None.
    /// For sprites that were `removeMovieClip`'d: an empty
    /// PlacedSnapshot so the renderer still walks the right tree
    /// shape but emits nothing.
    pub child: Option<Box<PlacedSnapshot>>,
}

/// One open clip-mask region during a snapshot render.
struct MaskCtx<'a> {
    end_depth: u16,
    mask: &'a ResolvedPlace,
    mask_sym: &'a Symbol,
}

/// Render a resolved snapshot. Mirrors the structure of
/// `render_sprite_into` but reads everything from the snapshot
/// (no AVM1 state lookups), and adds two AVM1-only features the
/// stateless tile path doesn't need:
///
/// 1. **DestIn alpha mask** — Flash uses the mask's full render
///    (gradients, strokes, multi-shape, etc.) as the clip alpha,
///    not just its silhouette. Two nested layers + DestIn blend
///    give true alpha clipping.
///
/// 2. **Per-placement blend modes** — Multiply, Screen, Add (Plus),
///    Difference, etc. Each is a `push_layer` with a custom
///    BlendMode that applies on pop.
pub fn render_snapshot(ctx: &mut RenderCtx<'_>, snap: &PlacedSnapshot) {
    let big_clip = Rect::new(
        -65535.0 * 20.0,
        -65535.0 * 20.0,
        65535.0 * 20.0,
        65535.0 * 20.0,
    );
    let mut clip_stack: Vec<MaskCtx<'_>> = Vec::new();

    for place in &snap.placements {
        // Pop any clips whose range has ended.
        while clip_stack
            .last()
            .map(|m| place.depth > m.end_depth)
            .unwrap_or(false)
        {
            let m = clip_stack.pop().unwrap();
            apply_mask_pop(ctx, &m, &big_clip);
        }

        let Some(child_sym) = ctx.doc.lookup_id(place.character_id) else {
            continue;
        };

        // Open a clip-mask region. We push the OUTER layer here that
        // collects masked content; the INNER DestIn layer + mask
        // geometry are emitted on pop (apply_mask_pop).
        if let Some(clip_depth) = place.clip_depth
            && clip_depth > 0
            && clip_depth > place.depth
        {
            ctx.scene.push_layer(
                Fill::NonZero,
                BlendMode::default(),
                1.0,
                Affine::IDENTITY,
                &big_clip,
            );
            clip_stack.push(MaskCtx {
                end_depth: clip_depth,
                mask: place,
                mask_sym: child_sym,
            });
            continue;
        }

        // Per-placement BlendMode. Wraps the rendered subtree in a
        // layer that composites with the requested op on pop.
        let blend_layer = blend_to_peniko(place.blend_mode);
        let needs_layer = blend_layer.is_some();
        if needs_layer {
            ctx.scene.push_layer(
                Fill::NonZero,
                blend_layer.unwrap(),
                1.0,
                Affine::IDENTITY,
                &big_clip,
            );
        }

        // Filter rendering. AVM1-driven nested children below the
        // filter aren't re-ticked; render_filtered walks the
        // timeline statically. For Dofus content this is fine —
        // filters are typically applied to leaf-ish content.
        // Filtered placement: hand off to filter::apply with ctx
        // values overridden to the snapshot's pre-composed
        // transform / color_xform / ratio / frame. The filter path
        // inherits ctx.recolor_target + ctx.player_colors so a
        // future filtered+zoned subtree composes correctly (the
        // AVM1 spell path doesn't set zones, so currently a no-op).
        if !place.filters.is_empty()
            && matches!(child_sym, Symbol::Sprite(_) | Symbol::Shape(_) | Symbol::MorphShape(_))
        {
            let saved_xform = ctx.transform;
            let saved_cx = ctx.color_xform;
            let saved_frame = ctx.frame;
            let saved_ratio = ctx.ratio;
            ctx.transform = place.world_transform;
            ctx.color_xform = place.color_xform;
            ctx.frame = match child_sym {
                Symbol::Sprite(_) => place.current_frame.saturating_sub(1),
                _ => 0,
            };
            ctx.ratio = place.ratio;
            super::filter::apply(ctx, child_sym, &place.filters);
            ctx.transform = saved_xform;
            ctx.color_xform = saved_cx;
            ctx.frame = saved_frame;
            ctx.ratio = saved_ratio;
            if needs_layer {
                ctx.scene.pop_layer();
            }
            continue;
        }

        // Render the symbol with already-composed world_transform
        // + color_xform. No need to go through render_symbol_into
        // (which would re-compose) — emit directly.
        render_resolved_symbol(ctx, child_sym, place);

        if needs_layer {
            ctx.scene.pop_layer();
        }
    }

    // Tail cleanup: any clip-mask layers still open get their masks
    // drawn + the outer layer popped.
    while let Some(m) = clip_stack.pop() {
        apply_mask_pop(ctx, &m, &big_clip);
    }
}

/// Render the symbol of a single resolved placement. Doesn't go
/// through the timeline-walking `render_symbol_into` because the
/// transforms are already composed; we'd re-compose with identity
/// otherwise.
fn render_resolved_symbol(
    ctx: &mut RenderCtx<'_>,
    sym: &Symbol,
    place: &ResolvedPlace,
) {
    match sym {
        Symbol::Shape(shape) => {
            render_shape(
                ctx.scene,
                ctx.doc,
                shape,
                place.world_transform,
                place.color_xform,
            );
        }
        Symbol::Sprite(_) => {
            // Recurse into the child snapshot. None means "no
            // resolved children" (e.g. an empty placeholder); we
            // simply skip rendering its body.
            if let Some(child_snap) = &place.child {
                render_snapshot(ctx, child_snap);
            }
        }
        Symbol::MorphShape(ms) => {
            let interp = ctx.cache.morph_frame(ms, place.ratio);
            render_shape(
                ctx.scene,
                ctx.doc,
                &interp,
                place.world_transform,
                place.color_xform,
            );
        }
        Symbol::Bitmap(_) => {
            // Bitmaps placed directly in a timeline are unusual for
            // Dofus content; render path handles them via shape fills.
        }
    }
}

/// Close out one clip-mask region. Push an inner DestIn layer, draw
/// the mask geometry into it, then pop both layers. The DestIn pop
/// multiplies the outer layer's accumulated content by the mask's
/// rendered alpha.
fn apply_mask_pop(ctx: &mut RenderCtx<'_>, m: &MaskCtx<'_>, big_clip: &Rect) {
    let dest_in = BlendMode::new(Mix::Normal, Compose::DestIn);
    ctx.scene
        .push_layer(Fill::NonZero, dest_in, 1.0, Affine::IDENTITY, big_clip);

    render_resolved_symbol(ctx, m.mask_sym, m.mask);

    ctx.scene.pop_layer(); // DestIn pop → applies mask alpha to outer.
    ctx.scene.pop_layer(); // outer SrcOver pop → composites with main scene.
}

/// Map our `OwnedBlendMode` to peniko's `BlendMode`. Returns None
/// for Normal/Layer (no layer needed) and the layer-equivalent for
/// the rest. Same mapping as the original
/// `render_avm1::blend_to_peniko`.
fn blend_to_peniko(mode: Option<OwnedBlendMode>) -> Option<BlendMode> {
    let mode = mode?;
    match mode {
        OwnedBlendMode::Normal | OwnedBlendMode::Layer => None,
        OwnedBlendMode::Multiply => Some(BlendMode::new(Mix::Multiply, Compose::SrcOver)),
        OwnedBlendMode::Screen => Some(BlendMode::new(Mix::Screen, Compose::SrcOver)),
        OwnedBlendMode::Lighten => Some(BlendMode::new(Mix::Lighten, Compose::SrcOver)),
        OwnedBlendMode::Darken => Some(BlendMode::new(Mix::Darken, Compose::SrcOver)),
        OwnedBlendMode::Difference => Some(BlendMode::new(Mix::Difference, Compose::SrcOver)),
        // SWF Add = additive blending: peniko's Plus composes as
        // `src + dst` clamped — exactly the additive look Dofus
        // particle systems want.
        OwnedBlendMode::Add => Some(BlendMode::new(Mix::Normal, Compose::Plus)),
        OwnedBlendMode::Overlay => Some(BlendMode::new(Mix::Overlay, Compose::SrcOver)),
        OwnedBlendMode::HardLight => Some(BlendMode::new(Mix::HardLight, Compose::SrcOver)),
    }
}
