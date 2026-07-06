//! vello_cpu feasibility bench for the no-WebGPU fallback path.
//!
//! `replay` re-issues a `vello::record::Recording` into a
//! `vello_cpu::RenderContext`; `bench` walks real class-sprite SWF
//! variants through the standard swf-spike renderer and times CPU
//! rasterization. The native CLI (`main.rs`) and the browser harness
//! (`cpu-bench-wasm`) share both modules — `web_time::Instant` resolves
//! to `std::time` natively and `performance.now()` under wasm.

pub mod bench;
pub mod replay;
