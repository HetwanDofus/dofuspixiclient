use std::collections::HashMap;
use vello::kurbo::{Affine, BezPath, Point};
use vello::peniko::{Blob, Color, ImageAlphaType, ImageBrush, ImageData, ImageFormat, ColorStop};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FillRule {
    NonZero,
    EvenOdd,
}

#[derive(Debug, Clone, Copy)]
pub enum StrokeWidthMode {
    /// Width is in scene units; scales naturally with the scene transform.
    Fixed,
    /// Legacy `stroke-width="__RESOLUTION__"` placeholder. Width is stored as 1.0.
    /// Flash-twip semantics: effective = max(width, 1 / resolution).
    Resolution,
    /// `vector-effect="non-scaling-stroke"`. Original SVG width is preserved.
    /// Flash-twip semantics: effective = max(width, 1 / resolution).
    NonScaling,
}

#[derive(Debug, Clone)]
pub enum DrawCommand {
    Fill {
        path_id: u32,
        fill_rule: FillRule,
        color: Color,
        zone_id: u8,
        transform: Affine,
        /// 1-based id into `DofAsset.clip_masks`, or 0 = no mask.
        /// See `ClipMask` for the wrapping semantics.
        clip_mask_id: u32,
    },
    Stroke {
        path_id: u32,
        fill_rule: FillRule,
        color: Color,
        zone_id: u8,
        width_mode: StrokeWidthMode,
        width: f32,
        opacity: f32,
        line_cap: vello::kurbo::Cap,
        line_join: vello::kurbo::Join,
        transform: Affine,
        clip_mask_id: u32,
    },
    PatternFill {
        path_id: u32,
        fill_rule: FillRule,
        image_id: u16,
        pattern_transform: Affine,
        transform: Affine,
        clip_mask_id: u32,
    },
    GradientFill {
        path_id: u32,
        fill_rule: FillRule,
        gradient_type: u8, // 0 = radial, 1 = linear
        cx: f32,
        cy: f32,
        fx: f32,
        fy: f32,
        r: f32,
        gradient_transform: Affine,
        stops: Vec<ColorStop>,
        transform: Affine,
        clip_mask_id: u32,
    },
}

impl DrawCommand {
    /// Convenience accessor — every variant carries this field.
    pub fn clip_mask_id(&self) -> u32 {
        match *self {
            DrawCommand::Fill { clip_mask_id, .. }
            | DrawCommand::Stroke { clip_mask_id, .. }
            | DrawCommand::PatternFill { clip_mask_id, .. }
            | DrawCommand::GradientFill { clip_mask_id, .. } => clip_mask_id,
        }
    }
}

/// SWF clipDepth mask geometry. Drawn into a `push_layer` clip before
/// rasterising any DrawCommand whose `clip_mask_id` matches this entry's
/// `id`. The transform is applied to the mask path *before* it's used as
/// the clip — composing it with the scene transform mimics SVG's
/// clip-path behaviour where a `transform` attribute on `<clipPath>`
/// applies in user-space.
#[derive(Debug, Clone)]
pub struct ClipMask {
    pub id: u32,
    pub path: BezPath,
    pub transform: Affine,
}

#[derive(Debug, Clone)]
pub struct BodyPart {
    pub draw_command_ids: Vec<u32>,
}

#[derive(Debug, Clone)]
pub struct PartInstance {
    pub body_part_id: u16,
    pub transform_id: u32,
}

#[derive(Debug, Clone)]
pub struct AccessorySlot {
    pub slot_id: u8,
    pub depth_index: u8,
    pub transform_id: u32,
    /// Accessory-local frame name captured from the AS2
    /// `applyAccessory(mc, slot, side, …)` call. Empty means "no override —
    /// fall back to the direction truth table in `resolve_accessory_anim`".
    pub side: String,
}

#[derive(Debug, Clone)]
pub struct Frame {
    pub clip_rect: [f32; 4],
    pub offset_x: f32,
    pub offset_y: f32,
    pub frame_transform_id: u32,
    pub parts: Vec<PartInstance>,
    pub accessory_slots: Vec<AccessorySlot>,
}

#[derive(Debug, Clone)]
pub struct Animation {
    pub name: String,
    pub fps: u16,
    pub offset_x: f32,
    pub offset_y: f32,
    pub frame_ids: Vec<u32>,
    /// Global frame ID for the base frame, or u32::MAX if none
    pub base_frame_id: u32,
    /// 0 = below (base renders first), 1 = above
    pub base_z_order: u8,
}

#[derive(Debug, Clone)]
pub struct OriginalColor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

/// How the runtime should interpret `player_colors[]` when replacing colors
/// inside a given zone. Stays forward-compatible: older binaries without the
/// byte default to Player (0).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TintMode {
    Player = 0,
    Guild = 1,
    AlignmentLevel = 2,
    Spell = 3,
}

impl TintMode {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => TintMode::Guild,
            2 => TintMode::AlignmentLevel,
            3 => TintMode::Spell,
            _ => TintMode::Player,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ColorZone {
    pub zone_id: u8,
    pub player_color_index: u8,
    pub tint_mode: TintMode,
    pub original_colors: Vec<OriginalColor>,
}

pub struct DofAsset {
    pub asset_id: u32,
    pub paths: Vec<BezPath>,
    pub draw_commands: Vec<DrawCommand>,
    pub body_parts: Vec<BodyPart>,
    pub transforms: Vec<Affine>,
    pub images: Vec<ImageBrush>,
    pub color_zones: Vec<ColorZone>,
    pub animations: Vec<Animation>,
    pub frames: Vec<Frame>,
    /// Indexed by `clip_mask_id - 1` (1-based to keep 0 as "no mask").
    pub clip_masks: Vec<ClipMask>,
    pub animation_map: HashMap<String, usize>,
}

struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    fn at(data: &'a [u8], offset: usize) -> Self {
        Self { data, pos: offset }
    }

    fn u8(&mut self) -> u8 {
        let v = self.data[self.pos];
        self.pos += 1;
        v
    }

    fn u16(&mut self) -> u16 {
        let v = u16::from_le_bytes([self.data[self.pos], self.data[self.pos + 1]]);
        self.pos += 2;
        v
    }

    fn u32(&mut self) -> u32 {
        let v = u32::from_le_bytes([
            self.data[self.pos], self.data[self.pos + 1],
            self.data[self.pos + 2], self.data[self.pos + 3],
        ]);
        self.pos += 4;
        v
    }

    fn f32(&mut self) -> f32 {
        let v = f32::from_le_bytes([
            self.data[self.pos], self.data[self.pos + 1],
            self.data[self.pos + 2], self.data[self.pos + 3],
        ]);
        self.pos += 4;
        v
    }

    fn affine(&mut self) -> Affine {
        let a = self.f32() as f64;
        let b = self.f32() as f64;
        let c = self.f32() as f64;
        let d = self.f32() as f64;
        let tx = self.f32() as f64;
        let ty = self.f32() as f64;
        // Affine::new takes [a, b, c, d, e, f] where the matrix is:
        // | a c e |
        // | b d f |
        // SVG matrix(a,b,c,d,tx,ty) maps to:
        // | a c tx |
        // | b d ty |
        Affine::new([a, b, c, d, tx, ty])
    }

    fn bytes(&mut self, len: usize) -> &'a [u8] {
        let slice = &self.data[self.pos..self.pos + len];
        self.pos += len;
        slice
    }
}

fn read_fill_rule(v: u8) -> FillRule {
    if v == 1 { FillRule::EvenOdd } else { FillRule::NonZero }
}

fn read_cap(v: u8) -> vello::kurbo::Cap {
    match v {
        1 => vello::kurbo::Cap::Round,
        2 => vello::kurbo::Cap::Square,
        _ => vello::kurbo::Cap::Butt,
    }
}

fn read_join(v: u8) -> vello::kurbo::Join {
    match v {
        1 => vello::kurbo::Join::Round,
        2 => vello::kurbo::Join::Bevel,
        _ => vello::kurbo::Join::Miter,
    }
}

fn decode_png_to_image(png_bytes: &[u8]) -> ImageBrush {
    let img = image::load_from_memory(png_bytes)
        .expect("Failed to decode PNG")
        .to_rgba8();
    let (w, h) = img.dimensions();
    let data = img.into_raw();
    ImageBrush::new(ImageData {
        data: Blob::new(std::sync::Arc::new(data)),
        format: ImageFormat::Rgba8,
        alpha_type: ImageAlphaType::Alpha,
        width: w,
        height: h,
    })
}

pub fn load(data: &[u8]) -> DofAsset {
    let mut r = Reader::new(data);

    // Header
    let magic = r.bytes(4);
    assert_eq!(magic, b"DASF", "Invalid magic bytes");
    let version = r.u16();
    let _asset_type = r.u16();
    let asset_id = r.u32();
    let section_count = r.u16();
    let _flags = r.u16();
    let _reserved = r.u32();

    // Format v2 added a per-DrawCommand `clip_mask_id: u32` field and a
    // new ClipMaskTable section. v1 binaries (every dofasset compiled
    // before the SWF clipDepth work landed) don't carry either. We
    // detect the version up front and read both layouts so the runtime
    // can boot v1 sprites without forcing a global re-extract.
    let has_clip_masks = version >= 2;

    // Section directory
    let mut sections: HashMap<u16, (usize, usize)> = HashMap::new();
    for _ in 0..section_count {
        let stype = r.u16();
        let offset = r.u32() as usize;
        let length = r.u32() as usize;
        sections.insert(stype, (offset, length));
    }

    // Parse paths (section 0)
    let paths = if let Some(&(offset, _)) = sections.get(&0) {
        let mut r = Reader::at(data, offset);
        let count = r.u32();
        let mut paths = Vec::with_capacity(count as usize);
        for _ in 0..count {
            let seg_count = r.u16();
            let mut bp = BezPath::new();
            for _ in 0..seg_count {
                let seg_type = r.u8();
                match seg_type {
                    0 => { // MoveTo
                        let x = r.f32() as f64;
                        let y = r.f32() as f64;
                        bp.move_to(Point::new(x, y));
                    }
                    1 => { // LineTo
                        let x = r.f32() as f64;
                        let y = r.f32() as f64;
                        bp.line_to(Point::new(x, y));
                    }
                    2 => { // QuadTo
                        let cx = r.f32() as f64;
                        let cy = r.f32() as f64;
                        let x = r.f32() as f64;
                        let y = r.f32() as f64;
                        bp.quad_to(Point::new(cx, cy), Point::new(x, y));
                    }
                    3 => { // CubicTo
                        let c1x = r.f32() as f64;
                        let c1y = r.f32() as f64;
                        let c2x = r.f32() as f64;
                        let c2y = r.f32() as f64;
                        let x = r.f32() as f64;
                        let y = r.f32() as f64;
                        bp.curve_to(Point::new(c1x, c1y), Point::new(c2x, c2y), Point::new(x, y));
                    }
                    4 => { // Close
                        bp.close_path();
                    }
                    _ => {}
                }
            }
            paths.push(bp);
        }
        paths
    } else {
        Vec::new()
    };

    // Parse draw commands (section 1)
    let draw_commands = if let Some(&(offset, _)) = sections.get(&1) {
        let mut r = Reader::at(data, offset);
        let count = r.u32();
        let mut cmds = Vec::with_capacity(count as usize);
        for _ in 0..count {
            let cmd_type = r.u8();
            let path_id = r.u32();
            let fill_rule = read_fill_rule(r.u8());
            let transform = r.affine();
            // Format v2 added clip_mask_id immediately after the
            // transform — common to every variant, mirrors the TS
            // writer's layout (binary-writer.ts). v1 binaries skip it.
            let clip_mask_id = if has_clip_masks { r.u32() } else { 0 };

            match cmd_type {
                0 => {
                    let cr = r.u8(); let cg = r.u8(); let cb = r.u8(); let ca = r.u8();
                    let zone_id = r.u8();
                    cmds.push(DrawCommand::Fill {
                        path_id, fill_rule,
                        color: Color::from_rgba8(cr, cg, cb, ca),
                        zone_id, transform, clip_mask_id,
                    });
                }
                1 => {
                    let cr = r.u8(); let cg = r.u8(); let cb = r.u8(); let ca = r.u8();
                    let zone_id = r.u8();
                    let width_mode = match r.u8() {
                        1 => StrokeWidthMode::Resolution,
                        2 => StrokeWidthMode::NonScaling,
                        _ => StrokeWidthMode::Fixed,
                    };
                    let width = r.f32();
                    let opacity = r.f32();
                    let line_cap = read_cap(r.u8());
                    let line_join = read_join(r.u8());
                    cmds.push(DrawCommand::Stroke {
                        path_id, fill_rule,
                        color: Color::from_rgba8(cr, cg, cb, ca),
                        zone_id, width_mode, width, opacity,
                        line_cap, line_join, transform, clip_mask_id,
                    });
                }
                2 => {
                    let image_id = r.u16();
                    let pattern_transform = r.affine();
                    cmds.push(DrawCommand::PatternFill {
                        path_id, fill_rule, image_id, pattern_transform, transform, clip_mask_id,
                    });
                }
                3 => {
                    let gradient_type = r.u8();
                    let cx = r.f32();
                    let cy = r.f32();
                    let fx = r.f32();
                    let fy = r.f32();
                    let radius = r.f32();
                    let gradient_transform = r.affine();
                    let stop_count = r.u8();
                    let mut stops = Vec::with_capacity(stop_count as usize);
                    for _si in 0..stop_count {
                        let offset = r.f32();
                        let sr = r.u8(); let sg = r.u8(); let sb = r.u8(); let sa = r.u8();
                        stops.push(ColorStop {
                            offset,
                            color: Color::from_rgba8(sr, sg, sb, sa).into(),
                        });
                    }
                    cmds.push(DrawCommand::GradientFill {
                        path_id, fill_rule, gradient_type, cx, cy, fx, fy, r: radius,
                        gradient_transform, stops, transform, clip_mask_id,
                    });
                }
                _ => {}
            }
        }
        cmds
    } else {
        Vec::new()
    };

    // Parse body parts (section 2)
    let body_parts = if let Some(&(offset, _)) = sections.get(&2) {
        let mut r = Reader::at(data, offset);
        let count = r.u16();
        let mut parts = Vec::with_capacity(count as usize);
        for _ in 0..count {
            let cmd_count = r.u16();
            let mut ids = Vec::with_capacity(cmd_count as usize);
            for _ in 0..cmd_count {
                ids.push(r.u32());
            }
            parts.push(BodyPart { draw_command_ids: ids });
        }
        parts
    } else {
        Vec::new()
    };

    // Parse transforms (section 3)
    let transforms = if let Some(&(offset, _)) = sections.get(&3) {
        let mut r = Reader::at(data, offset);
        let count = r.u32();
        let mut ts = Vec::with_capacity(count as usize);
        for _ in 0..count {
            ts.push(r.affine());
        }
        ts
    } else {
        Vec::new()
    };

    // Parse images (section 4)
    let images = if let Some(&(offset, _)) = sections.get(&4) {
        let mut r = Reader::at(data, offset);
        let count = r.u16();
        let mut imgs = Vec::with_capacity(count as usize);
        for _ in 0..count {
            let _width = r.u32();
            let _height = r.u32();
            let data_len = r.u32() as usize;
            let png_bytes = r.bytes(data_len);
            imgs.push(decode_png_to_image(png_bytes));
        }
        imgs
    } else {
        Vec::new()
    };

    // Parse color zones (section 5)
    let color_zones = if let Some(&(offset, _)) = sections.get(&5) {
        let mut r = Reader::at(data, offset);
        let zone_count = r.u8();
        let mut zones = Vec::with_capacity(zone_count as usize);
        for _ in 0..zone_count {
            let zone_id = r.u8();
            let player_color_index = r.u8();
            let tint_mode = TintMode::from_u8(r.u8());
            let color_count = r.u16();
            let mut colors = Vec::with_capacity(color_count as usize);
            for _ in 0..color_count {
                let cr = r.u8(); let cg = r.u8(); let cb = r.u8();
                colors.push(OriginalColor { r: cr, g: cg, b: cb });
            }
            zones.push(ColorZone {
                zone_id,
                player_color_index,
                tint_mode,
                original_colors: colors,
            });
        }
        zones
    } else {
        Vec::new()
    };

    // Parse strings (section 6)
    let string_table: Vec<String> = if let Some(&(offset, _)) = sections.get(&6) {
        let mut r = Reader::at(data, offset);
        let count = r.u16();
        let mut entries = Vec::with_capacity(count as usize);
        for _ in 0..count {
            let str_offset = r.u32() as usize;
            let str_len = r.u16() as usize;
            entries.push((str_offset, str_len));
        }
        // Now read the blob
        let blob_start = r.pos;
        entries.iter().map(|&(off, len)| {
            let start = blob_start + off;
            let s = &data[start..start + len];
            String::from_utf8_lossy(s).to_string()
        }).collect()
    } else {
        Vec::new()
    };

    // Parse animations (section 7)
    let animations = if let Some(&(offset, _)) = sections.get(&7) {
        let mut r = Reader::at(data, offset);
        let count = r.u16();
        let mut anims = Vec::with_capacity(count as usize);
        for _ in 0..count {
            let name_id = r.u16() as usize;
            let fps = r.u16();
            let offset_x = r.f32();
            let offset_y = r.f32();
            let frame_count = r.u16();
            let base_frame_id = r.u32();
            let base_z_order = r.u8();
            let mut frame_ids = Vec::with_capacity(frame_count as usize);
            for _ in 0..frame_count {
                frame_ids.push(r.u32());
            }
            let name = string_table.get(name_id).cloned().unwrap_or_default();
            anims.push(Animation { name, fps, offset_x, offset_y, frame_ids, base_frame_id, base_z_order });
        }
        anims
    } else {
        Vec::new()
    };

    // Parse frames (section 8)
    let frames = if let Some(&(offset, _)) = sections.get(&8) {
        let mut r = Reader::at(data, offset);
        let count = r.u32();
        let mut frs = Vec::with_capacity(count as usize);
        for _ in 0..count {
            let clip_rect = [r.f32(), r.f32(), r.f32(), r.f32()];
            let offset_x = r.f32();
            let offset_y = r.f32();
            let frame_transform_id = r.u32();
            let part_count = r.u16();
            let acc_count = r.u8();
            let mut parts = Vec::with_capacity(part_count as usize);
            for _ in 0..part_count {
                let body_part_id = r.u16();
                let transform_id = r.u32();
                parts.push(PartInstance { body_part_id, transform_id });
            }
            let mut accs = Vec::with_capacity(acc_count as usize);
            for _ in 0..acc_count {
                let slot_id = r.u8();
                let depth_index = r.u8();
                let transform_id = r.u32();
                // AS2 `applyAccessory(..., side, ...)` frame name: u8 len +
                // utf8 bytes. Empty means no override — the runtime's
                // direction truth table resolves which accessory frame shows.
                let side_len = r.u8() as usize;
                let side_bytes = r.bytes(side_len);
                let side = std::str::from_utf8(side_bytes)
                    .unwrap_or("")
                    .to_string();
                accs.push(AccessorySlot {
                    slot_id,
                    depth_index,
                    transform_id,
                    side,
                });
            }
            frs.push(Frame { clip_rect, offset_x, offset_y, frame_transform_id, parts, accessory_slots: accs });
        }
        frs
    } else {
        Vec::new()
    };

    // Parse clip masks (section 10 — added in format v2). Layout
    // mirrors `writeClipMaskTable` in TS:
    //   u32 count
    //   per mask:
    //     u32 id, f32×6 transform, u32 segCount, segments (path-table
    //     encoding: u8 type, f32×{2,2,4,6,0} coords)
    //
    // v1 binaries don't have section 10 — `clip_masks` stays empty and
    // every draw command's `clip_mask_id` is forced to 0 above, so
    // render_draw_command's `resolve_clip_mask` is a no-op for them.
    let clip_masks = if !has_clip_masks {
        Vec::new()
    } else if let Some(&(offset, _)) = sections.get(&10) {
        let mut r = Reader::at(data, offset);
        let count = r.u32();
        let mut masks = Vec::with_capacity(count as usize);
        for _ in 0..count {
            let id = r.u32();
            let transform = r.affine();
            let seg_count = r.u32();
            let mut bp = BezPath::new();
            for _ in 0..seg_count {
                let seg_type = r.u8();
                match seg_type {
                    0 => {
                        let x = r.f32() as f64;
                        let y = r.f32() as f64;
                        bp.move_to(Point::new(x, y));
                    }
                    1 => {
                        let x = r.f32() as f64;
                        let y = r.f32() as f64;
                        bp.line_to(Point::new(x, y));
                    }
                    2 => {
                        let cx = r.f32() as f64;
                        let cy = r.f32() as f64;
                        let x = r.f32() as f64;
                        let y = r.f32() as f64;
                        bp.quad_to(Point::new(cx, cy), Point::new(x, y));
                    }
                    3 => {
                        let c1x = r.f32() as f64;
                        let c1y = r.f32() as f64;
                        let c2x = r.f32() as f64;
                        let c2y = r.f32() as f64;
                        let x = r.f32() as f64;
                        let y = r.f32() as f64;
                        bp.curve_to(Point::new(c1x, c1y), Point::new(c2x, c2y), Point::new(x, y));
                    }
                    4 => {
                        bp.close_path();
                    }
                    _ => {}
                }
            }
            masks.push(ClipMask { id, path: bp, transform });
        }
        masks
    } else {
        Vec::new()
    };

    // Build animation name lookup
    let mut animation_map = HashMap::new();
    for (i, anim) in animations.iter().enumerate() {
        animation_map.insert(anim.name.clone(), i);
    }

    DofAsset {
        asset_id, paths, draw_commands, body_parts, transforms,
        images, color_zones, animations, frames, clip_masks, animation_map,
    }
}
