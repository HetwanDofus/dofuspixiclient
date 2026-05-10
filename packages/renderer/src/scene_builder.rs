use std::collections::HashMap;
use vello::kurbo::{Affine, Shape, Stroke};
use vello::peniko::{self, Color, Fill, Gradient};
use vello::Scene;

use crate::format::{DofAsset, DrawCommand, FillRule, StrokeWidthMode};
use crate::pattern::create_pattern_brush;

/// Per-animation render metadata for stable, jitter-free rendering.
/// All frames of an animation render into the same canvas size, with the
/// anchor (character world position) at a fixed pixel coordinate.
#[derive(Debug, Clone)]
pub struct AnimationRenderMeta {
    /// Uniform canvas width in pixels (encompasses all frames + accessories).
    pub canvas_width: u32,
    /// Uniform canvas height in pixels.
    pub canvas_height: u32,
    /// Anchor X in pixels — where the character's world position maps to
    /// within the canvas. The game engine draws the canvas at
    /// `(screen_x - anchor_x, screen_y - anchor_y)`.
    pub anchor_x: f64,
    /// Anchor Y in pixels.
    pub anchor_y: f64,
    /// Pass to `build_frame_scene` so content at scene coords > 0 lands
    /// inside the `canvas_width x canvas_height` texture instead of being
    /// clipped to the top-left. Equals `(-global_min_x, -global_min_y)`.
    pub bounds_offset_x: f64,
    pub bounds_offset_y: f64,
}

/// A pre-parsed accessory SVG scene ready for compositing.
pub struct AccessoryScene {
    pub slot_id: u8,
    pub scene: Scene,
    /// The accessory SVG's origin offset (from its atlas.json)
    pub offset_x: f64,
    pub offset_y: f64,
    /// Accessory frame dimensions in SVG units (from clip_rect)
    pub width: f64,
    pub height: f64,
}

/// Build a Vello Scene for a specific animation frame.
/// `accessories` contains pre-rendered accessory scenes keyed by slot_id.
/// Build a Vello Scene for a specific animation frame with accessories.
/// `bounds_offset` shifts the clip_offset so that negative accessory positions are visible.
pub fn build_frame_scene(
    asset: &DofAsset,
    animation_name: &str,
    frame_index: usize,
    player_colors: Option<&[u32; 3]>,
    resolution: f32,
    accessories: &[&AccessoryScene],
    bounds_offset: (f64, f64),
) -> Scene {
    let mut scene = Scene::new();

    let anim_idx = match asset.animation_map.get(animation_name) {
        Some(&idx) => idx,
        None => {
            eprintln!("Animation not found: {animation_name}");
            return scene;
        }
    };

    let anim = &asset.animations[anim_idx];
    let actual_frame_idx = frame_index % anim.frame_ids.len();
    let global_frame_id = anim.frame_ids[actual_frame_idx] as usize;

    if global_frame_id >= asset.frames.len() {
        eprintln!("Frame index out of range: {global_frame_id}");
        return scene;
    }

    let frame = &asset.frames[global_frame_id];

    // Build color replacement map if player colors provided
    let color_replacements = player_colors.map(|colors| {
        crate::color::build_color_replacements(&asset.color_zones, colors)
    });

    let scale = resolution as f64;

    let has_base = anim.base_frame_id != u32::MAX;
    let base_frame_opt = if has_base {
        asset.frames.get(anim.base_frame_id as usize)
    } else {
        None
    };

    // Each frame uses its OWN clip_offset to cancel out its atlas position.
    // For base+delta compositing, we compute a net-offset adjustment so both
    // layers share the same Flash coordinate system (the base's).
    let frame_clip_offset = Affine::translate((
        -(frame.clip_rect[0] as f64),
        -(frame.clip_rect[1] as f64),
    ));

    let (base_clip_offset, delta_clip_offset) = if let Some(base_frame) = base_frame_opt {
        let base_co = Affine::translate((
            -(base_frame.clip_rect[0] as f64),
            -(base_frame.clip_rect[1] as f64),
        ));
        // Net offset = clip_offset * offset_transform (translation part).
        // This maps Flash (0,0) to the frame's output origin.
        let base_net = compute_net_offset(base_frame, &asset.transforms);
        let delta_net = compute_net_offset(frame, &asset.transforms);
        // Adjustment aligns the delta's Flash coordinates with the base's.
        let adj = Affine::translate((base_net.0 - delta_net.0, base_net.1 - delta_net.1));
        (base_co, adj * frame_clip_offset)
    } else {
        (frame_clip_offset, frame_clip_offset)
    };

    // Get the frame's SVG offset transform (for accessory positioning)
    let frame_offset = asset.transforms.get(frame.frame_transform_id as usize)
        .copied()
        .unwrap_or(Affine::IDENTITY);

    // Build a map of accessory data by slot_id
    let acc_by_slot: HashMap<u8, &AccessoryScene> = accessories.iter()
        .map(|a| (a.slot_id, *a))
        .collect();

    // Render everything into a sub-scene at native SVG coordinates
    let mut sub = Scene::new();

    // Render base frame below if present (baseZOrder == 0 means "below")
    let has_base_below = has_base && anim.base_z_order == 0;
    let has_base_above = has_base && anim.base_z_order == 1;

    if has_base_below {
        if let Some(base_frame) = base_frame_opt {
            render_frame_parts(&mut sub, asset, base_frame, base_clip_offset, &color_replacements, resolution);
        }
    }

    // Render delta body parts interleaved with accessories at correct depth.
    // For base+delta, delta_clip_offset includes the adjustment so Flash coords align.
    render_frame_parts_with_accessories(
        &mut sub, asset, frame, delta_clip_offset, frame_offset,
        &color_replacements, resolution, &acc_by_slot,
    );

    // Render base frame above if present
    if has_base_above {
        if let Some(base_frame) = base_frame_opt {
            render_frame_parts(&mut sub, asset, base_frame, base_clip_offset, &color_replacements, resolution);
        }
    }

    // Apply scale + bounds_offset (shifts content so accessories at negative positions are visible)
    let (bx, by) = bounds_offset;
    scene.append(&sub, Some(Affine::translate((bx, by)) * Affine::scale(scale)));

    scene
}

/// Build an accessory scene at logical coordinates WITH clip_offset but WITHOUT
/// the outer composition scale. The clip_offset moves content to the accessory's
/// local origin; `render_accessory` then applies `main_clip_offset * frame_offset
/// * acc_local` to position it in the main character's frame, and the character's
/// scene is wrapped in `Affine::scale(resolution)` so everything picks up the
/// final zoom once.
///
/// `resolution` is the render resolution the accessory will ultimately compose
/// at — we pass it to `render_draw_command` so non-scaling strokes resolve to
/// `1 / resolution` logical units (they become exactly 1 screen pixel after the
/// outer scale). Passing 1.0 here leaves strokes at ~1 logical unit and they
/// render `resolution` pixels thick, which is why capes/shields looked chunky
/// at higher zooms while the character's own outlines stayed 1 px.
pub fn build_accessory_scene_unscaled(
    asset: &DofAsset,
    animation_name: &str,
    frame_index: usize,
    resolution: f32,
) -> Scene {
    let mut scene = Scene::new();

    let anim_idx = match asset.animation_map.get(animation_name) {
        Some(&idx) => idx,
        None => return scene,
    };
    let anim = &asset.animations[anim_idx];
    if anim.frame_ids.is_empty() {
        return scene;
    }
    let actual_frame_idx = frame_index % anim.frame_ids.len();
    let global_frame_id = anim.frame_ids[actual_frame_idx] as usize;
    let Some(frame) = asset.frames.get(global_frame_id) else {
        return scene;
    };

    // Use the accessory's own clip_offset to position at its local origin
    let clip_offset = Affine::translate((
        -(frame.clip_rect[0] as f64),
        -(frame.clip_rect[1] as f64),
    ));

    // Render body parts with clip_offset but NO scale (resolution=1.0)
    // Also handle base frames if the accessory animation has one
    let has_base = anim.base_frame_id != u32::MAX;
    let base_frame_opt = if has_base {
        asset.frames.get(anim.base_frame_id as usize)
    } else {
        None
    };

    // If base frame exists, use its clip_rect for the offset instead
    let clip_offset = if let Some(base_frame) = base_frame_opt {
        Affine::translate((
            -(base_frame.clip_rect[0] as f64),
            -(base_frame.clip_rect[1] as f64),
        ))
    } else {
        clip_offset
    };

    if has_base && anim.base_z_order == 0 {
        if let Some(base_frame) = base_frame_opt {
            render_frame_parts(&mut scene, asset, base_frame, clip_offset, &None, resolution);
        }
    }

    render_frame_parts(&mut scene, asset, frame, clip_offset, &None, resolution);

    if has_base && anim.base_z_order == 1 {
        if let Some(base_frame) = base_frame_opt {
            render_frame_parts(&mut scene, asset, base_frame, clip_offset, &None, resolution);
        }
    }

    scene
}

/// Render just the body parts of a frame (no accessories). Used for base frames.
fn render_frame_parts(
    scene: &mut Scene,
    asset: &DofAsset,
    frame: &crate::format::Frame,
    clip_offset: Affine,
    color_replacements: &Option<HashMap<u32, Color>>,
    resolution: f32,
) {
    for part_inst in &frame.parts {
        let body_part = match asset.body_parts.get(part_inst.body_part_id as usize) {
            Some(bp) => bp,
            None => continue,
        };
        let part_transform = match asset.transforms.get(part_inst.transform_id as usize) {
            Some(&t) => clip_offset * t,
            None => clip_offset,
        };
        for &cmd_id in &body_part.draw_command_ids {
            if let Some(cmd) = asset.draw_commands.get(cmd_id as usize) {
                render_draw_command(scene, asset, cmd, part_transform, color_replacements, resolution);
            }
        }
    }
}

/// Render body parts interleaved with accessories at correct depth.
fn render_frame_parts_with_accessories(
    scene: &mut Scene,
    asset: &DofAsset,
    frame: &crate::format::Frame,
    clip_offset: Affine,
    frame_offset: Affine,
    color_replacements: &Option<HashMap<u32, Color>>,
    resolution: f32,
    acc_by_slot: &HashMap<u8, &AccessoryScene>,
) {
    for (part_idx, part_inst) in frame.parts.iter().enumerate() {
        let body_part = match asset.body_parts.get(part_inst.body_part_id as usize) {
            Some(bp) => bp,
            None => continue,
        };
        let part_transform = match asset.transforms.get(part_inst.transform_id as usize) {
            Some(&t) => clip_offset * t,
            None => clip_offset,
        };
        for &cmd_id in &body_part.draw_command_ids {
            if let Some(cmd) = asset.draw_commands.get(cmd_id as usize) {
                render_draw_command(scene, asset, cmd, part_transform, color_replacements, resolution);
            }
        }
        let after_idx = part_idx + 1;
        for acc_slot in &frame.accessory_slots {
            if acc_slot.depth_index as usize == after_idx {
                render_accessory(scene, asset, acc_slot, acc_by_slot, clip_offset, frame_offset);
            }
        }
    }
    let part_count = frame.parts.len();
    for acc_slot in &frame.accessory_slots {
        if acc_slot.depth_index as usize >= part_count {
            render_accessory(scene, asset, acc_slot, acc_by_slot, clip_offset, frame_offset);
        }
    }
}

fn resolve_color(
    color: Color,
    zone_id: u8,
    replacements: &Option<HashMap<u32, Color>>,
) -> Color {
    if zone_id == 0 {
        return color;
    }
    if let Some(map) = replacements {
        let rgba = color.to_rgba8();
        let key = (rgba.r as u32) << 16 | (rgba.g as u32) << 8 | rgba.b as u32;
        if let Some(&replaced) = map.get(&key) {
            // Preserve the original alpha (baked fill-opacity/stroke-opacity)
            // since the replacement color always has alpha=255.
            let rep = replaced.to_rgba8();
            return Color::from_rgba8(rep.r, rep.g, rep.b, rgba.a);
        }
    }
    color
}

/// Stroke width resolution.
///
/// The scene rendered by `build_frame_scene` is wrapped in `Affine::scale(resolution)`,
/// and individual draw commands carry a `final_transform` that is applied to BOTH
/// the path geometry AND the stroke width (Vello strokes are in path-local units).
/// So a stored width of `w` rendered with a transform of scale `s` ends up at
/// `w * s * resolution` screen pixels.
///
/// - `Fixed`: use the stored width as-is. Stroke scales with the path transform AND
///   the scene scale — the canonical "this stroke is part of the artwork" mode.
/// - `Resolution`: Flash-twip legacy placeholder — stroke must always be exactly
///   1 screen pixel wide regardless of any transform. We compute `1 / (s * res)`
///   so the rendered width is `s * res * 1/(s*res) = 1` screen pixel.
/// - `NonScaling`: SVG `vector-effect="non-scaling-stroke"` semantics — the stroke
///   ignores the path's transform AND stays at the authored width in screen pixels.
///   Without dividing out `s`, a 0.7-px stroke nested in a `matrix(5.95, …)` user
///   transform renders ~4.16 px (the bug that made artworks/big monster portraits
///   look like comic-book ink drawings). With the divide it stays at the intended
///   ~0.7 px regardless of transform depth, matching SVG's native behavior.
///   We still floor at 1 screen pixel so sub-pixel hairlines remain visible.
#[inline]
fn resolve_stroke_width(
    width: f32,
    mode: StrokeWidthMode,
    transform: Affine,
    resolution: f32,
) -> f64 {
    match mode {
        StrokeWidthMode::Fixed => width as f64,
        StrokeWidthMode::Resolution => {
            // Always exactly 1 screen pixel: scene-unit width = 1 / (transform_scale * resolution)
            let s = transform_scale(transform).max(f64::EPSILON);
            1.0 / (s * resolution as f64)
        }
        StrokeWidthMode::NonScaling => {
            // Stroke ignores the path's transform. In scene units that means
            // dividing the authored width by the transform's scale; then floor
            // at 1 screen pixel (= 1/(s*res) scene units after dividing) so a
            // sub-pixel hairline stays visible at small render resolutions.
            let s = transform_scale(transform).max(f64::EPSILON);
            let scene_width = (width as f64) / s;
            let one_screen_px = 1.0 / (s * resolution as f64);
            scene_width.max(one_screen_px)
        }
    }
}

/// Uniform scale factor of an affine transform (geometric mean of the SVD
/// singular values via `sqrt(|det|)`). Matches SVG's effective scale for
/// `vector-effect="non-scaling-stroke"`, which divides the authored stroke
/// width by the geometric mean of the X and Y scales of the user-coord-system
/// to user-unit transform.
#[inline]
fn transform_scale(t: Affine) -> f64 {
    t.determinant().abs().sqrt()
}

/// Look up the clip mask path + transform for a 1-based id, or None
/// when the id is 0 / out of range. Used by `render_draw_command` to
/// optionally wrap a single draw in a `push_layer` / `pop_layer` pair
/// that confines rasterisation to the SWF clipDepth shape.
fn resolve_clip_mask<'a>(asset: &'a DofAsset, clip_mask_id: u32) -> Option<&'a vello::peniko::kurbo::BezPath> {
    if clip_mask_id == 0 {
        return None;
    }
    let idx = (clip_mask_id - 1) as usize;
    asset.clip_masks.get(idx).map(|m| &m.path)
}

fn clip_mask_transform(asset: &DofAsset, clip_mask_id: u32) -> Affine {
    if clip_mask_id == 0 {
        return Affine::IDENTITY;
    }
    let idx = (clip_mask_id - 1) as usize;
    asset
        .clip_masks
        .get(idx)
        .map(|m| m.transform)
        .unwrap_or(Affine::IDENTITY)
}

fn render_draw_command(
    scene: &mut Scene,
    asset: &DofAsset,
    cmd: &DrawCommand,
    part_transform: Affine,
    color_replacements: &Option<HashMap<u32, Color>>,
    resolution: f32,
) {
    let clip_id = cmd.clip_mask_id();
    // Push the SWF clipDepth mask as a layer when this command is
    // wrapped by one. Mask geometry is in the same user-space the
    // command's `transform` lives in, composed with `part_transform`
    // for the per-frame placement. Empty/invalid ids fall through to
    // an unclipped render.
    let clip_pushed = if let Some(mask_path) = resolve_clip_mask(asset, clip_id) {
        let mask_xform = part_transform * clip_mask_transform(asset, clip_id);
        // vello 0.8 push_layer signature is `(fill, blend, alpha,
        // transform, &shape)` — the `shape` itself acts as the clip
        // (vello restricts subsequent draws to the shape's interior).
        // Default fill rule + blend match what the atlas-cell rect-clip
        // already uses elsewhere in lib.rs (push_layer with Fill::default()
        // + BlendMode::default() + a rectangular shape).
        scene.push_layer(
            vello::peniko::Fill::default(),
            vello::peniko::BlendMode::default(),
            1.0,
            mask_xform,
            mask_path,
        );
        true
    } else {
        false
    };

    match cmd {
        DrawCommand::Fill { path_id, fill_rule, color, zone_id, transform, .. } => {
            if let Some(path) = asset.paths.get(*path_id as usize) {
                let final_transform = part_transform * *transform;
                let resolved_color = resolve_color(*color, *zone_id, color_replacements);
                let fill = match fill_rule {
                    FillRule::NonZero => Fill::NonZero,
                    FillRule::EvenOdd => Fill::EvenOdd,
                };
                scene.fill(fill, final_transform, resolved_color, None, path);
            }
        }
        DrawCommand::Stroke { path_id, color, zone_id, width, width_mode, line_cap, line_join, transform, .. } => {
            if let Some(path) = asset.paths.get(*path_id as usize) {
                let final_transform = part_transform * *transform;
                let resolved_color = resolve_color(*color, *zone_id, color_replacements);
                // Opacity is already baked into the color alpha by the compiler.
                let final_color = resolved_color;

                let stroke_width =
                    resolve_stroke_width(*width, *width_mode, final_transform, resolution);

                let stroke = Stroke::new(stroke_width)
                    .with_caps(*line_cap)
                    .with_join(*line_join);

                scene.stroke(&stroke, final_transform, final_color, None, path);
            }
        }
        DrawCommand::PatternFill { path_id, image_id, pattern_transform, transform, fill_rule, .. } => {
            if let Some(path) = asset.paths.get(*path_id as usize) {
                if let Some(image) = asset.images.get(*image_id as usize) {
                    let final_transform = part_transform * *transform;
                    let (brush, brush_transform) = create_pattern_brush(image, *pattern_transform);
                    let fill = match fill_rule {
                        FillRule::NonZero => Fill::NonZero,
                        FillRule::EvenOdd => Fill::EvenOdd,
                    };
                    scene.fill(fill, final_transform, &brush, Some(brush_transform), path);
                }
            }
        }
        DrawCommand::GradientFill { path_id, fill_rule, gradient_type, cx, cy, fx, fy, r, gradient_transform, stops, transform, .. } => {
            if let Some(path) = asset.paths.get(*path_id as usize) {
                let final_transform = part_transform * *transform;
                let fill = match fill_rule {
                    FillRule::NonZero => Fill::NonZero,
                    FillRule::EvenOdd => Fill::EvenOdd,
                };

                let grad_stops: Vec<peniko::ColorStop> = stops.clone();

                let brush = if *gradient_type == 0 {
                    // Radial gradient — match vello_svg's mapping (cx/cy as start radius 0,
                    // fx/fy as end radius r). `gradient_transform` is the gradientTransform.
                    Gradient::new_two_point_radial(
                        vello::kurbo::Point::new(*cx as f64, *cy as f64), 0_f32,
                        vello::kurbo::Point::new(*fx as f64, *fy as f64), *r,
                    ).with_stops(grad_stops.as_slice())
                } else {
                    // Linear gradient — raw x1/y1 → x2/y2 in gradient-local space.
                    // `gradient_transform` carries the SVG gradientTransform so vello
                    // can apply skew/non-uniform scale correctly.
                    Gradient::new_linear(
                        (*cx as f64, *cy as f64),
                        (*fx as f64, *fy as f64),
                    ).with_stops(grad_stops.as_slice())
                };

                scene.fill(fill, final_transform, &brush, Some(*gradient_transform), path);
            }
        }
    }

    // Pop the SWF clipDepth layer (mirrors the push above). Skipping
    // this when no layer was pushed keeps the layer stack balanced.
    if clip_pushed {
        scene.pop_layer();
    }
}

/// Compute the net offset for a frame: clip_offset * offset_transform (translation only).
/// This maps Flash (0,0) to the frame's output origin, canceling the atlas position.
pub fn compute_net_offset(frame: &crate::format::Frame, transforms: &[Affine]) -> (f64, f64) {
    let offset_transform = transforms.get(frame.frame_transform_id as usize)
        .copied()
        .unwrap_or(Affine::IDENTITY);
    let coeffs = offset_transform.as_coeffs();
    (
        coeffs[4] - frame.clip_rect[0] as f64,
        coeffs[5] - frame.clip_rect[1] as f64,
    )
}

/// Compute the local transform for an accessory given its slot transform and offsets.
fn compute_acc_local(raw: Affine, acc: &AccessoryScene) -> Affine {
    let coeffs = raw.as_coeffs();
    let (a, b, c, d, mtx, mty) = (coeffs[0], coeffs[1], coeffs[2], coeffs[3], coeffs[4], coeffs[5]);
    let pos_x = mtx + acc.offset_x;
    let pos_y = mty + acc.offset_y;

    let has_scale = (a - 1.0).abs() > 1e-6 || b.abs() > 1e-6
        || c.abs() > 1e-6 || (d - 1.0).abs() > 1e-6;

    if has_scale {
        let pivot_x = -acc.offset_x;
        let pivot_y = -acc.offset_y;
        let scale_rotate = Affine::new([a, b, c, d, 0.0, 0.0]);
        Affine::translate((pos_x, pos_y))
            * Affine::translate((pivot_x, pivot_y))
            * scale_rotate
            * Affine::translate((-pivot_x, -pivot_y))
    } else {
        Affine::translate((pos_x, pos_y))
    }
}

fn render_accessory(
    scene: &mut Scene,
    asset: &DofAsset,
    acc_slot: &crate::format::AccessorySlot,
    acc_by_slot: &HashMap<u8, &AccessoryScene>,
    clip_offset: Affine,
    frame_offset: Affine,
) {
    let acc = match acc_by_slot.get(&acc_slot.slot_id) {
        Some(a) => *a,
        None => return,
    };
    let raw = match asset.transforms.get(acc_slot.transform_id as usize) {
        Some(&t) => t,
        None => return,
    };

    let acc_local = compute_acc_local(raw, acc);
    let final_transform = clip_offset * frame_offset * acc_local;
    scene.append(&acc.scene, Some(final_transform));
}

/// Compute tight bounding box from actual path geometry for a single frame's body parts.
/// Walks every draw command, transforms each path's bbox, and takes the union.
fn compute_body_path_bounds(
    asset: &DofAsset,
    frame: &crate::format::Frame,
    clip_offset: Affine,
) -> Option<vello::kurbo::Rect> {
    let mut bbox: Option<vello::kurbo::Rect> = None;
    for part_inst in &frame.parts {
        let Some(body_part) = asset.body_parts.get(part_inst.body_part_id as usize) else { continue };
        let part_transform = match asset.transforms.get(part_inst.transform_id as usize) {
            Some(&t) => clip_offset * t,
            None => clip_offset,
        };
        for &cmd_id in &body_part.draw_command_ids {
            let Some(cmd) = asset.draw_commands.get(cmd_id as usize) else { continue };
            let (path_id, cmd_transform) = match cmd {
                DrawCommand::Fill { path_id, transform, .. } => (*path_id, *transform),
                DrawCommand::Stroke { path_id, transform, .. } => (*path_id, *transform),
                DrawCommand::PatternFill { path_id, transform, .. } => (*path_id, *transform),
                DrawCommand::GradientFill { path_id, transform, .. } => (*path_id, *transform),
            };
            let Some(path) = asset.paths.get(path_id as usize) else { continue };
            let full = part_transform * cmd_transform;
            // Transform the 4 corners of the path's bounding box
            let pb = path.bounding_box();
            let corners = [
                full * vello::kurbo::Point::new(pb.x0, pb.y0),
                full * vello::kurbo::Point::new(pb.x1, pb.y0),
                full * vello::kurbo::Point::new(pb.x0, pb.y1),
                full * vello::kurbo::Point::new(pb.x1, pb.y1),
            ];
            for p in &corners {
                bbox = Some(match bbox {
                    Some(b) => b.union(vello::kurbo::Rect::new(p.x, p.y, p.x, p.y)),
                    None => vello::kurbo::Rect::new(p.x, p.y, p.x, p.y),
                });
            }
        }
    }
    bbox
}

/// Compute the bounding box of the frame + all accessories in pixel space.
/// Uses tight path-level geometry instead of clip_rect for the character body.
/// Returns (min_x, min_y, width, height) in pixels.
pub fn compute_frame_bounds(
    asset: &DofAsset,
    animation_name: &str,
    frame_index: usize,
    resolution: f32,
    accessories: &[&AccessoryScene],
) -> (f64, f64, f64, f64) {
    let scale = resolution as f64;

    let anim_idx = match asset.animation_map.get(animation_name) {
        Some(&idx) => idx,
        None => return (0.0, 0.0, 1.0, 1.0),
    };
    let anim = &asset.animations[anim_idx];
    let actual_idx = frame_index % anim.frame_ids.len();
    let global_fid = anim.frame_ids[actual_idx] as usize;
    let Some(frame) = asset.frames.get(global_fid) else {
        return (0.0, 0.0, 1.0, 1.0);
    };

    let has_base = anim.base_frame_id != u32::MAX;
    let base_frame_opt = if has_base { asset.frames.get(anim.base_frame_id as usize) } else { None };

    let frame_clip_offset = Affine::translate((-(frame.clip_rect[0] as f64), -(frame.clip_rect[1] as f64)));
    let (base_clip_offset, clip_offset) = if let Some(base) = base_frame_opt {
        let base_co = Affine::translate((-(base.clip_rect[0] as f64), -(base.clip_rect[1] as f64)));
        let base_net = compute_net_offset(base, &asset.transforms);
        let delta_net = compute_net_offset(frame, &asset.transforms);
        let adj = Affine::translate((base_net.0 - delta_net.0, base_net.1 - delta_net.1));
        (base_co, adj * frame_clip_offset)
    } else {
        (frame_clip_offset, frame_clip_offset)
    };

    // Compute tight body bounds from actual path geometry
    let mut body_bbox: Option<vello::kurbo::Rect> = None;

    // Base frame body
    if let Some(base) = base_frame_opt {
        if let Some(bb) = compute_body_path_bounds(asset, base, base_clip_offset) {
            body_bbox = Some(match body_bbox { Some(b) => b.union(bb), None => bb });
        }
    }
    // Delta frame body
    if let Some(bb) = compute_body_path_bounds(asset, frame, clip_offset) {
        body_bbox = Some(match body_bbox { Some(b) => b.union(bb), None => bb });
    }

    // Scale to pixel space
    let (mut min_x, mut min_y, mut max_x, mut max_y) = if let Some(bb) = body_bbox {
        (bb.x0 * scale, bb.y0 * scale, bb.x1 * scale, bb.y1 * scale)
    } else {
        // Fallback to clip_rect if no paths found
        let (cw, ch) = if let Some(base) = base_frame_opt {
            (base.clip_rect[2] as f64 * scale, base.clip_rect[3] as f64 * scale)
        } else {
            (frame.clip_rect[2] as f64 * scale, frame.clip_rect[3] as f64 * scale)
        };
        (0.0, 0.0, cw, ch)
    };

    if accessories.is_empty() {
        return (min_x, min_y, max_x - min_x, max_y - min_y);
    }

    // Compute accessory bounds
    let frame_offset = asset.transforms.get(frame.frame_transform_id as usize)
        .copied().unwrap_or(Affine::IDENTITY);

    let acc_by_slot: HashMap<u8, &AccessoryScene> = accessories.iter()
        .map(|a| (a.slot_id, *a)).collect();

    for acc_slot in &frame.accessory_slots {
        let Some(acc) = acc_by_slot.get(&acc_slot.slot_id) else { continue };
        let Some(&raw) = asset.transforms.get(acc_slot.transform_id as usize) else { continue };

        let acc_local = compute_acc_local(raw, acc);
        let full = Affine::scale(scale) * clip_offset * frame_offset * acc_local;

        let corners = [
            full * vello::kurbo::Point::new(0.0, 0.0),
            full * vello::kurbo::Point::new(acc.width, 0.0),
            full * vello::kurbo::Point::new(0.0, acc.height),
            full * vello::kurbo::Point::new(acc.width, acc.height),
        ];
        for p in &corners {
            min_x = min_x.min(p.x);
            min_y = min_y.min(p.y);
            max_x = max_x.max(p.x);
            max_y = max_y.max(p.y);
        }
    }

    (min_x, min_y, max_x - min_x, max_y - min_y)
}

/// Compute per-animation render metadata for stable, jitter-free rendering.
///
/// Returns a uniform canvas size that encompasses every frame (including
/// base+delta composites and accessories), plus the anchor position within
/// that canvas. The game engine draws the canvas at
/// `(screen_x - anchor_x, screen_y - anchor_y)`.
pub fn compute_animation_render_meta(
    asset: &DofAsset,
    animation_name: &str,
    resolution: f32,
    accessories: &[&AccessoryScene],
) -> AnimationRenderMeta {
    let scale = resolution as f64;

    let anim_idx = match asset.animation_map.get(animation_name) {
        Some(&idx) => idx,
        None => {
            return AnimationRenderMeta {
                canvas_width: 1,
                canvas_height: 1,
                anchor_x: 0.0,
                anchor_y: 0.0,
                bounds_offset_x: 0.0,
                bounds_offset_y: 0.0,
            };
        }
    };
    let anim = &asset.animations[anim_idx];

    let has_base = anim.base_frame_id != u32::MAX;
    let base_frame_opt = if has_base {
        asset.frames.get(anim.base_frame_id as usize)
    } else {
        None
    };

    // Compute tight canvas size from actual path geometry across all frames.
    // Uses compute_frame_bounds which walks body-part paths for exact bounds.
    let mut global_min_x = f64::MAX;
    let mut global_min_y = f64::MAX;
    let mut global_max_x = f64::MIN;
    let mut global_max_y = f64::MIN;

    for (idx, _fid) in anim.frame_ids.iter().enumerate() {
        let (bmin_x, bmin_y, bw, bh) =
            compute_frame_bounds(asset, animation_name, idx, resolution, accessories);
        global_min_x = global_min_x.min(bmin_x);
        global_min_y = global_min_y.min(bmin_y);
        global_max_x = global_max_x.max(bmin_x + bw);
        global_max_y = global_max_y.max(bmin_y + bh);
    }

    // If no valid frames, fallback
    if global_min_x > global_max_x {
        global_min_x = 0.0; global_min_y = 0.0;
        global_max_x = 1.0; global_max_y = 1.0;
    }

    let canvas_width = ((global_max_x - global_min_x).ceil() as u32).max(1);
    let canvas_height = ((global_max_y - global_min_y).ceil() as u32).max(1);

    // The anchor is the character's world position (registration point) within
    // the tight canvas. The net offset gives the registration point in the
    // clip_offset coordinate system (where body content starts at 0,0).
    // Subtract global_min to get the anchor position within the tight canvas.
    let first_fid = anim.frame_ids.first().copied().unwrap_or(0) as usize;
    let (anchor_x, anchor_y) = if let Some(base_frame) = base_frame_opt {
        let net = compute_net_offset(base_frame, &asset.transforms);
        (net.0 * scale - global_min_x, net.1 * scale - global_min_y)
    } else if let Some(first_frame) = asset.frames.get(first_fid) {
        let net = compute_net_offset(first_frame, &asset.transforms);
        (net.0 * scale - global_min_x, net.1 * scale - global_min_y)
    } else {
        (-anim.offset_x as f64 * scale - global_min_x, -anim.offset_y as f64 * scale - global_min_y)
    };

    AnimationRenderMeta {
        canvas_width,
        canvas_height,
        anchor_x,
        anchor_y,
        bounds_offset_x: -global_min_x,
        bounds_offset_y: -global_min_y,
    }
}

/// Render an accessory as opaque content in the zone mask.
/// Accessories occlude zone markers behind them, preventing color bleed.
/// We append the accessory's actual scene — its opaque pixels occlude underlying markers.
/// The shader won't match these pixels as zones since real artwork never produces
/// pure (255,0,0), (0,255,0), or (0,0,255) colors.
fn render_accessory_as_black(
    scene: &mut Scene,
    asset: &DofAsset,
    acc_slot: &crate::format::AccessorySlot,
    acc_by_slot: &HashMap<u8, &AccessoryScene>,
    clip_offset: Affine,
    frame_offset: Affine,
) {
    // Reuse the same transform computation as render_accessory
    render_accessory(scene, asset, acc_slot, acc_by_slot, clip_offset, frame_offset);
}

/// Build a zone mask scene for a frame.
/// Zone-colored pixels render as markers (R=zone1, G=zone2, B=zone3).
/// Non-zone pixels render as opaque black (occludes underlying zone markers).
/// Accessories also render as opaque black, preventing color bleed.
pub fn build_zone_mask_scene(
    asset: &DofAsset,
    animation_name: &str,
    frame_index: usize,
    resolution: f32,
    accessories: &[&AccessoryScene],
) -> Scene {
    let mut scene = Scene::new();

    let anim_idx = match asset.animation_map.get(animation_name) {
        Some(&idx) => idx,
        None => return scene,
    };
    let anim = &asset.animations[anim_idx];
    let actual_frame_idx = frame_index % anim.frame_ids.len();
    let global_frame_id = anim.frame_ids[actual_frame_idx] as usize;
    let Some(frame) = asset.frames.get(global_frame_id) else { return scene };

    let scale = resolution as f64;
    let has_base = anim.base_frame_id != u32::MAX;
    let base_frame_opt = if has_base {
        asset.frames.get(anim.base_frame_id as usize)
    } else {
        None
    };

    let frame_clip_offset = Affine::translate((-(frame.clip_rect[0] as f64), -(frame.clip_rect[1] as f64)));
    let (base_clip_offset, delta_clip_offset) = if let Some(base_frame) = base_frame_opt {
        let base_co = Affine::translate((-(base_frame.clip_rect[0] as f64), -(base_frame.clip_rect[1] as f64)));
        let base_net = compute_net_offset(base_frame, &asset.transforms);
        let delta_net = compute_net_offset(frame, &asset.transforms);
        let adj = Affine::translate((base_net.0 - delta_net.0, base_net.1 - delta_net.1));
        (base_co, adj * frame_clip_offset)
    } else {
        (frame_clip_offset, frame_clip_offset)
    };

    let frame_offset = asset.transforms.get(frame.frame_transform_id as usize)
        .copied()
        .unwrap_or(Affine::IDENTITY);

    let acc_by_slot: HashMap<u8, &AccessoryScene> = accessories.iter()
        .map(|a| (a.slot_id, *a))
        .collect();

    let mut sub = Scene::new();
    let has_base_below = has_base && anim.base_z_order == 0;
    let has_base_above = has_base && anim.base_z_order == 1;

    if has_base_below {
        if let Some(base_frame) = base_frame_opt {
            render_zone_mask_parts(&mut sub, asset, base_frame, base_clip_offset, resolution);
        }
    }
    render_zone_mask_parts_with_accessories(
        &mut sub, asset, frame, delta_clip_offset, frame_offset, resolution, &acc_by_slot,
    );
    if has_base_above {
        if let Some(base_frame) = base_frame_opt {
            render_zone_mask_parts(&mut sub, asset, base_frame, base_clip_offset, resolution);
        }
    }

    scene.append(&sub, Some(Affine::scale(scale)));
    scene
}

/// Render zone mask body parts interleaved with accessories at correct depth.
/// Accessories render as opaque black to occlude zone markers and prevent color bleed.
fn render_zone_mask_parts_with_accessories(
    scene: &mut Scene,
    asset: &DofAsset,
    frame: &crate::format::Frame,
    clip_offset: Affine,
    frame_offset: Affine,
    resolution: f32,
    acc_by_slot: &HashMap<u8, &AccessoryScene>,
) {
    for (part_idx, part_inst) in frame.parts.iter().enumerate() {
        let Some(body_part) = asset.body_parts.get(part_inst.body_part_id as usize) else { continue };
        let part_transform = match asset.transforms.get(part_inst.transform_id as usize) {
            Some(&t) => clip_offset * t,
            None => clip_offset,
        };
        for &cmd_id in &body_part.draw_command_ids {
            if let Some(cmd) = asset.draw_commands.get(cmd_id as usize) {
                render_zone_mask_command(scene, asset, cmd, part_transform, resolution);
            }
        }
        // Insert accessories as opaque black at their depth positions
        let after_idx = part_idx + 1;
        for acc_slot in &frame.accessory_slots {
            if acc_slot.depth_index as usize == after_idx {
                render_accessory_as_black(scene, asset, acc_slot, acc_by_slot, clip_offset, frame_offset);
            }
        }
    }
    // Accessories with depth >= part_count render after all body parts
    let part_count = frame.parts.len();
    for acc_slot in &frame.accessory_slots {
        if acc_slot.depth_index as usize >= part_count {
            render_accessory_as_black(scene, asset, acc_slot, acc_by_slot, clip_offset, frame_offset);
        }
    }
}

fn render_zone_mask_parts(
    scene: &mut Scene,
    asset: &DofAsset,
    frame: &crate::format::Frame,
    clip_offset: Affine,
    resolution: f32,
) {
    for part_inst in &frame.parts {
        let Some(body_part) = asset.body_parts.get(part_inst.body_part_id as usize) else { continue };
        let part_transform = match asset.transforms.get(part_inst.transform_id as usize) {
            Some(&t) => clip_offset * t,
            None => clip_offset,
        };
        for &cmd_id in &body_part.draw_command_ids {
            if let Some(cmd) = asset.draw_commands.get(cmd_id as usize) {
                render_zone_mask_command(scene, asset, cmd, part_transform, resolution);
            }
        }
    }
}

fn render_zone_mask_command(
    scene: &mut Scene,
    asset: &DofAsset,
    cmd: &DrawCommand,
    part_transform: Affine,
    resolution: f32,
) {
    match cmd {
        DrawCommand::Fill { path_id, fill_rule, zone_id, transform, color, .. } => {
            if let Some(path) = asset.paths.get(*path_id as usize) {
                let final_transform = part_transform * *transform;
                let fill = match fill_rule {
                    FillRule::NonZero => Fill::NonZero,
                    FillRule::EvenOdd => Fill::EvenOdd,
                };
                // Zone pixels → marker color; non-zone → opaque black (occludes markers behind)
                let mask_color = match zone_id {
                    1 => Color::from_rgba8(255, 0, 0, color.to_rgba8().a),
                    2 => Color::from_rgba8(0, 255, 0, color.to_rgba8().a),
                    3 => Color::from_rgba8(0, 0, 255, color.to_rgba8().a),
                    _ => Color::from_rgba8(0, 0, 0, color.to_rgba8().a),
                };
                scene.fill(fill, final_transform, mask_color, None, path);
            }
        }
        DrawCommand::Stroke { path_id, zone_id, width, width_mode, line_cap, line_join, transform, color, .. } => {
            if let Some(path) = asset.paths.get(*path_id as usize) {
                let final_transform = part_transform * *transform;
                let stroke_width =
                    resolve_stroke_width(*width, *width_mode, final_transform, resolution);
                let stroke = Stroke::new(stroke_width).with_caps(*line_cap).with_join(*line_join);
                let mask_color = match zone_id {
                    1 => Color::from_rgba8(255, 0, 0, color.to_rgba8().a),
                    2 => Color::from_rgba8(0, 255, 0, color.to_rgba8().a),
                    3 => Color::from_rgba8(0, 0, 255, color.to_rgba8().a),
                    _ => Color::from_rgba8(0, 0, 0, color.to_rgba8().a),
                };
                scene.stroke(&stroke, final_transform, mask_color, None, path);
            }
        }
        DrawCommand::PatternFill { path_id, fill_rule, transform, .. } => {
            // Patterns are never zone-colored — render as opaque black
            if let Some(path) = asset.paths.get(*path_id as usize) {
                let final_transform = part_transform * *transform;
                let fill = match fill_rule {
                    FillRule::NonZero => Fill::NonZero,
                    FillRule::EvenOdd => Fill::EvenOdd,
                };
                scene.fill(fill, final_transform, Color::from_rgba8(0, 0, 0, 255), None, path);
            }
        }
        DrawCommand::GradientFill { path_id, fill_rule, transform, .. } => {
            if let Some(path) = asset.paths.get(*path_id as usize) {
                let final_transform = part_transform * *transform;
                let fill = match fill_rule {
                    FillRule::NonZero => Fill::NonZero,
                    FillRule::EvenOdd => Fill::EvenOdd,
                };
                scene.fill(fill, final_transform, Color::from_rgba8(0, 0, 0, 255), None, path);
            }
        }
    }
}

/// Dump per-frame diagnostic data for debugging shift issues.
pub fn dump_frame_diagnostics(
    asset: &DofAsset,
    animation_name: &str,
    resolution: f32,
    accessories: &[&AccessoryScene],
) {
    let scale = resolution as f64;
    let anim_idx = match asset.animation_map.get(animation_name) {
        Some(&idx) => idx,
        None => { eprintln!("Animation not found"); return; }
    };
    let anim = &asset.animations[anim_idx];
    let has_base = anim.base_frame_id != u32::MAX;
    let base_frame_opt = if has_base { asset.frames.get(anim.base_frame_id as usize) } else { None };

    eprintln!("ANIM offset=({:.2},{:.2})", anim.offset_x, anim.offset_y);
    if let Some(base) = base_frame_opt {
        let base_net = compute_net_offset(base, &asset.transforms);
        eprintln!("BASE frame_id={} clip_rect=[{},{},{},{}] net_offset=({:.2},{:.2}) trim=({:.2},{:.2})",
            anim.base_frame_id,
            base.clip_rect[0], base.clip_rect[1], base.clip_rect[2], base.clip_rect[3],
            base_net.0, base_net.1,
            base.offset_x, base.offset_y);
    }

    let acc_by_slot: std::collections::HashMap<u8, &AccessoryScene> = accessories.iter()
        .map(|a| (a.slot_id, *a)).collect();

    for (i, &fid) in anim.frame_ids.iter().enumerate() {
        let Some(frame) = asset.frames.get(fid as usize) else { continue };
        let delta_net = compute_net_offset(frame, &asset.transforms);

        let frame_clip_offset = vello::kurbo::Affine::translate((
            -(frame.clip_rect[0] as f64), -(frame.clip_rect[1] as f64),
        ));
        let clip_offset = if let Some(base) = base_frame_opt {
            let base_net = compute_net_offset(base, &asset.transforms);
            let adj = vello::kurbo::Affine::translate((base_net.0 - delta_net.0, base_net.1 - delta_net.1));
            adj * frame_clip_offset
        } else {
            frame_clip_offset
        };

        let frame_offset = asset.transforms.get(frame.frame_transform_id as usize)
            .copied().unwrap_or(vello::kurbo::Affine::IDENTITY);
        let fo_coeffs = frame_offset.as_coeffs();

        // Compute where origin (0,0) maps in pixel space via clip_offset
        let co_coeffs = clip_offset.as_coeffs();

        eprint!("  f{:02} fid={:4} clip=[{:6.1},{:6.1},{:5.1},{:5.1}] net=({:7.2},{:7.2}) trim=({:6.2},{:6.2}) co_xy=({:7.2},{:7.2}) fo_xy=({:7.2},{:7.2})",
            i, fid,
            frame.clip_rect[0], frame.clip_rect[1], frame.clip_rect[2], frame.clip_rect[3],
            delta_net.0, delta_net.1,
            frame.offset_x, frame.offset_y,
            co_coeffs[4], co_coeffs[5],
            fo_coeffs[4], fo_coeffs[5],
        );

        // Show per-accessory slot final position
        for acc_slot in &frame.accessory_slots {
            let Some(acc) = acc_by_slot.get(&acc_slot.slot_id) else { continue };
            let Some(&raw) = asset.transforms.get(acc_slot.transform_id as usize) else { continue };
            let acc_local = compute_acc_local(raw, acc);
            let full = vello::kurbo::Affine::scale(scale) * clip_offset * frame_offset * acc_local;
            let origin = full * vello::kurbo::Point::new(0.0, 0.0);
            eprint!(" acc{}=({:6.1},{:6.1})", acc_slot.slot_id, origin.x, origin.y);
        }
        eprintln!();
    }
}

/// Build scenes for all frames of an animation (useful for testing).
pub fn build_all_frames(
    asset: &DofAsset,
    animation_name: &str,
    player_colors: Option<&[u32; 3]>,
    resolution: f32,
    accessories: &[&AccessoryScene],
) -> Vec<Scene> {
    let anim_idx = match asset.animation_map.get(animation_name) {
        Some(&idx) => idx,
        None => return Vec::new(),
    };

    let anim = &asset.animations[anim_idx];
    let frame_count = anim.frame_ids.len();

    (0..frame_count)
        .map(|i| build_frame_scene(asset, animation_name, i, player_colors, resolution, accessories, (0.0, 0.0)))
        .collect()
}

