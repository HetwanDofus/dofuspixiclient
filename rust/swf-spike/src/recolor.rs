//! Canonical flat-replace recolor for the SWF zone-tinting path.
//!
//! Mirrors the AS2 `GlobalSpriteHandler.applyColor` exactly: the zone's
//! ColorTransform is `{ra:0, rb:R, ga:0, gb:G, ba:0, bb:B, aa:100, ab:0}`
//! — multiplier 0, offset = target — so every fill in the zone becomes the
//! flat target colour with its authored alpha preserved. Shading comes
//! from separate authored overlay shapes, not from the zone fill itself.
//! (The previous HSL-preserve-lightness variant was a non-canonical
//! deviation inherited from the dofasset renderer.)

use vello::peniko::Color;

/// Replace `orig` with the flat `target` colour, keeping `orig`'s alpha.
/// `target` is 0xRRGGBB.
pub fn recolor_to_zone(orig: Color, target_rgb: u32) -> Color {
    let rgba = orig.to_rgba8();
    let tr = ((target_rgb >> 16) & 0xff) as u8;
    let tg = ((target_rgb >> 8) & 0xff) as u8;
    let tb = (target_rgb & 0xff) as u8;
    Color::from_rgba8(tr, tg, tb, rgba.a)
}

/// Player's three zone colours. None = leave fills as-authored (canonical
/// `-1` sentinel; `0` is a REAL colour — flat black). RGB packed as
/// 0xRRGGBB.
#[derive(Clone, Copy, Default, Debug)]
pub struct PlayerColors(pub [Option<u32>; 3]);

impl PlayerColors {
    pub fn lookup(&self, zone: u8) -> Option<u32> {
        if zone == 0 {
            return None;
        }
        self.0.get((zone - 1) as usize).copied().flatten()
    }
}
