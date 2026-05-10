//! SWF → Vello rendering spike.
//!
//! Goal: render Dofus 1.29 map 7411 (cells from psql) by reading the original
//! `g*.swf` / `o*.swf` tile sheets directly with Ruffle's `swf` parser and
//! drawing into Vello, with player sprite 10 walking on top — no SVG step,
//! no `.dofasset` middle layer.

pub mod avm1;
pub mod bitmap;
pub mod morph;
pub mod recolor;
pub mod render;
pub mod render_avm1;
pub mod shape;
pub mod swf_doc;
pub mod wgpu_filters;

// Headless wgpu init uses pollster::block_on, which can't run on wasm32.
// The WASM bridge in `vello-wasm` brings its own device/queue and skips this
// entry path entirely.
#[cfg(not(target_arch = "wasm32"))]
pub mod headless;
