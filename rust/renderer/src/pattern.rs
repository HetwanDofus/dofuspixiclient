use vello::peniko::{Brush, Extend, ImageBrush};
use vello::kurbo::Affine;

/// Create a repeating image brush for pattern fills.
pub fn create_pattern_brush(image: &ImageBrush, pattern_transform: Affine) -> (Brush, Affine) {
    let img = image.clone()
        .with_x_extend(Extend::Repeat)
        .with_y_extend(Extend::Repeat);
    (Brush::Image(img), pattern_transform)
}
