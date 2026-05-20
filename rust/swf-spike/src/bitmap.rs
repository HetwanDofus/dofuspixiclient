//! Decode SWF bitmap tags (DefineBitsLossless v1/v2 and DefineBitsJpeg2/3) into
//! straight RGBA8 (un-premultiplied) suitable for `peniko::Image`.

use anyhow::{anyhow, Result};
use std::io::Read;

use flate2::read::ZlibDecoder;

#[derive(Clone, Debug)]
pub struct DecodedBitmap {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

pub fn decode_lossless(tag: &swf::DefineBitsLossless<'_>) -> Result<DecodedBitmap> {
    decode_lossless_raw(tag.version, tag.format, tag.width, tag.height, tag.data.as_ref())
}

/// Raw-arg variant — used by the lazy path that stores SWF bytes (no &Tag) and
/// decodes on demand inside the shape flattener.
pub fn decode_lossless_raw(
    version: u8,
    format: swf::BitmapFormat,
    width_u16: u16,
    height_u16: u16,
    data_in: &[u8],
) -> Result<DecodedBitmap> {
    let mut decoder = ZlibDecoder::new(data_in);
    let mut decompressed = Vec::new();
    decoder.read_to_end(&mut decompressed)?;

    let w = u32::from(width_u16);
    let h = u32::from(height_u16);

    let pixels = match format {
        swf::BitmapFormat::ColorMap8 { num_colors } => {
            let palette_count = usize::from(num_colors) + 1;
            let bpp_palette_entry = if version >= 2 { 4 } else { 3 };
            let palette_bytes = palette_count * bpp_palette_entry;
            if decompressed.len() < palette_bytes {
                return Err(anyhow!("indexed bitmap: palette truncated"));
            }
            let palette = &decompressed[..palette_bytes];
            // Each row is padded to a multiple of 4 bytes.
            let row_pitch = ((w + 3) & !3) as usize;
            let pixel_bytes = &decompressed[palette_bytes..];
            if pixel_bytes.len() < row_pitch * h as usize {
                return Err(anyhow!("indexed bitmap: pixels truncated"));
            }
            let mut rgba = vec![0u8; (w * h * 4) as usize];
            for y in 0..h as usize {
                for x in 0..w as usize {
                    let idx = pixel_bytes[y * row_pitch + x] as usize;
                    let p = idx * bpp_palette_entry;
                    let dst = (y * w as usize + x) * 4;
                    rgba[dst] = palette[p];
                    rgba[dst + 1] = palette[p + 1];
                    rgba[dst + 2] = palette[p + 2];
                    rgba[dst + 3] = if version >= 2 { palette[p + 3] } else { 255 };
                }
            }
            unpremultiply_in_place(&mut rgba);
            rgba
        }
        swf::BitmapFormat::Rgb15 => {
            // Each pixel is 2 bytes; rows are padded to 4-byte multiples.
            let row_pitch = ((w * 2 + 3) & !3) as usize;
            if decompressed.len() < row_pitch * h as usize {
                return Err(anyhow!("rgb15 bitmap truncated"));
            }
            let mut rgba = vec![0u8; (w * h * 4) as usize];
            for y in 0..h as usize {
                for x in 0..w as usize {
                    let off = y * row_pitch + x * 2;
                    let pix = u16::from_be_bytes([decompressed[off], decompressed[off + 1]]);
                    let r = ((pix >> 10) & 0x1f) as u8;
                    let g = ((pix >> 5) & 0x1f) as u8;
                    let b = (pix & 0x1f) as u8;
                    let dst = (y * w as usize + x) * 4;
                    rgba[dst] = (r << 3) | (r >> 2);
                    rgba[dst + 1] = (g << 3) | (g >> 2);
                    rgba[dst + 2] = (b << 3) | (b >> 2);
                    rgba[dst + 3] = 255;
                }
            }
            rgba
        }
        swf::BitmapFormat::Rgb32 => {
            // Each pixel is 4 bytes: ARGB (or 0RGB if version 1, since no alpha).
            // Always premultiplied per SWF spec.
            let pixel_bytes = w as usize * h as usize * 4;
            if decompressed.len() < pixel_bytes {
                return Err(anyhow!("rgb32 bitmap truncated"));
            }
            let mut rgba = vec![0u8; pixel_bytes];
            for i in 0..(w as usize * h as usize) {
                let src = i * 4;
                // SWF Rgb32 layout: A R G B (big-endian).
                let a = if version >= 2 { decompressed[src] } else { 255 };
                let r = decompressed[src + 1];
                let g = decompressed[src + 2];
                let b = decompressed[src + 3];
                let dst = i * 4;
                rgba[dst] = r;
                rgba[dst + 1] = g;
                rgba[dst + 2] = b;
                rgba[dst + 3] = a;
            }
            unpremultiply_in_place(&mut rgba);
            rgba
        }
    };

    Ok(DecodedBitmap {
        width: w,
        height: h,
        rgba: pixels,
    })
}

/// JPEG with no alpha — DefineBitsJpeg2 (data is a regular JPEG byte stream
/// with the SWF "JFIF prefix" 0xFF 0xD9 0xFF 0xD8 hack stripped).
pub fn decode_jpeg2(data: &[u8]) -> Result<DecodedBitmap> {
    let cleaned = strip_jpeg_marker(data);
    let img = image::load_from_memory_with_format(&cleaned, image::ImageFormat::Jpeg)?;
    let rgba = img.to_rgba8();
    Ok(DecodedBitmap {
        width: rgba.width(),
        height: rgba.height(),
        rgba: rgba.into_raw(),
    })
}

/// JPEG with alpha — DefineBitsJpeg3.
pub fn decode_jpeg3(tag: &swf::DefineBitsJpeg3<'_>) -> Result<DecodedBitmap> {
    decode_jpeg3_raw(tag.data, tag.alpha_data)
}

pub fn decode_jpeg3_raw(jpeg: &[u8], alpha_zlib: &[u8]) -> Result<DecodedBitmap> {
    let cleaned = strip_jpeg_marker(jpeg);
    let img = image::load_from_memory_with_format(&cleaned, image::ImageFormat::Jpeg)?;
    let mut rgba = img.to_rgba8();

    if !alpha_zlib.is_empty() {
        let mut decoder = ZlibDecoder::new(alpha_zlib);
        let mut alpha = Vec::new();
        decoder.read_to_end(&mut alpha)?;
        for (i, px) in rgba.pixels_mut().enumerate() {
            if let Some(a) = alpha.get(i) {
                px[3] = *a;
            }
        }
        // DefineBitsJpeg3 stores **premultiplied** RGB (per SWF spec: "bitmaps
        // with alpha must use premultiplied alpha"; the JPEG-encoded RGB is
        // multiplied by the separate alpha channel before encoding). Without
        // this divide, peniko premultiplies again on sample → R·A² → ground
        // tiles render visibly darker than the original. Lossless2 was already
        // handled (`decode_lossless_raw` calls `unpremultiply_in_place`); this
        // closes the JPEG3 gap.
        let mut buf = rgba.into_raw();
        unpremultiply_in_place(&mut buf);
        return Ok(DecodedBitmap {
            width: img.width(),
            height: img.height(),
            rgba: buf,
        });
    }
    Ok(DecodedBitmap {
        width: rgba.width(),
        height: rgba.height(),
        rgba: rgba.into_raw(),
    })
}

fn strip_jpeg_marker(data: &[u8]) -> Vec<u8> {
    // SWF DefineBitsJpeg2 inserts a phantom EOI+SOI (FF D9 FF D8) BETWEEN
    // the JPEG tables-only header (DQT/DHT segments wrapped by SOI..EOI)
    // and the actual scan data. Image decoders see two SOIs and bail.
    // Search for the first occurrence anywhere and splice it out.
    let mut out = Vec::with_capacity(data.len());
    let mut i = 0;
    let mut stripped = false;
    while i < data.len() {
        if !stripped
            && i + 4 <= data.len()
            && data[i] == 0xFF
            && data[i + 1] == 0xD9
            && data[i + 2] == 0xFF
            && data[i + 3] == 0xD8
        {
            i += 4;
            stripped = true;
            continue;
        }
        out.push(data[i]);
        i += 1;
    }
    out
}

fn unpremultiply_in_place(rgba: &mut [u8]) {
    for chunk in rgba.chunks_exact_mut(4) {
        let a = chunk[3];
        if a == 0 || a == 255 {
            continue;
        }
        let scale = 255.0 / f32::from(a);
        chunk[0] = ((f32::from(chunk[0]) * scale).min(255.0)) as u8;
        chunk[1] = ((f32::from(chunk[1]) * scale).min(255.0)) as u8;
        chunk[2] = ((f32::from(chunk[2]) * scale).min(255.0)) as u8;
    }
}
