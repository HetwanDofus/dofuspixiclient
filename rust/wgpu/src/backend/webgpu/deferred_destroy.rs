//! Deferred-destroy queues for `WebTexture` and `WebBuffer`.
//!
//! Background
//! ==========
//! The patched WebGPU backend originally had `Drop` for `WebTexture`
//! and `WebBuffer` as a no-op. Reason: calling `GPUTexture.destroy()`
//! immediately on Rust-side drop tripped Chromium's "destroyed texture
//! used in a submit" validator — Rust scopes can drop intermediates
//! whose command buffers haven't actually executed on the GPU yet.
//!
//! Cost of the no-op: every Vello-internal staging texture/buffer
//! leaks for the renderer's lifetime. Multi-GB at stress-test scale.
//!
//! This module fixes that by queueing dropped handles instead of
//! destroying immediately. A JS-side ticker (typically the Pixi
//! shared ticker, called once per rAF) invokes
//! `tick_deferred_destroys(min_age_frames, max_destroys_per_tick)`
//! to actually call `GPUTexture.destroy()` / `GPUBuffer.destroy()`
//! on handles that were dropped at least `min_age_frames` ticks ago.
//!
//! With `min_age_frames = 2` and 60 fps ticks, every drop is delayed
//! ~33 ms before its destroy() fires — well past WebGPU's submission
//! completion window. `max_destroys_per_tick` caps the per-tick cost
//! so a burst of drops (anim transitions, cache evictions) doesn't
//! stall a single rAF tick by calling thousands of destroy()s.
//!
//! Behaviour
//! =========
//! - `record_texture_drop(t)` / `record_buffer_drop(b)`: called from
//!   `WebTexture::drop` / `WebBuffer::drop`. Pushes onto a thread-
//!   local queue with the current frame stamp.
//! - `tick_deferred_destroys(min_age, max_per_tick)`: increment the
//!   frame counter, then call `.destroy()` on up to `max_per_tick`
//!   entries whose age >= `min_age`. Older entries are popped from
//!   the queue. JS must call this every Pixi tick.

use alloc::vec::Vec;
use core::cell::{Cell, RefCell};

use super::webgpu_sys;

std::thread_local! {
    /// Monotonic frame counter. Advanced once per JS-side tick.
    static FRAME_COUNTER: Cell<u32> = const { Cell::new(0) };
    /// Pending GPUTexture destroys, stamped with the frame they were
    /// dropped on. Cleared by `tick_deferred_destroys` once old
    /// enough.
    static PENDING_TEXTURES: RefCell<Vec<(u32, webgpu_sys::GpuTexture)>>
        = const { RefCell::new(Vec::new()) };
    static PENDING_BUFFERS: RefCell<Vec<(u32, webgpu_sys::GpuBuffer)>>
        = const { RefCell::new(Vec::new()) };
}

/// Record a `GPUTexture` for deferred destruction. Called from
/// `WebTexture::drop`.
pub fn record_texture_drop(tex: &webgpu_sys::GpuTexture) {
    let frame = FRAME_COUNTER.with(|f| f.get());
    PENDING_TEXTURES.with(|q| {
        q.borrow_mut().push((frame, tex.clone()));
    });
}

/// Record a `GPUBuffer` for deferred destruction. Called from
/// `WebBuffer::drop`.
pub fn record_buffer_drop(buf: &webgpu_sys::GpuBuffer) {
    let frame = FRAME_COUNTER.with(|f| f.get());
    PENDING_BUFFERS.with(|q| {
        q.borrow_mut().push((frame, buf.clone()));
    });
}

/// Returns (textures_pending, buffers_pending) — diagnostic only.
pub fn pending_counts() -> (usize, usize) {
    let t = PENDING_TEXTURES.with(|q| q.borrow().len());
    let b = PENDING_BUFFERS.with(|q| q.borrow().len());
    (t, b)
}

/// Advance the frame counter and destroy pending entries that are
/// old enough. Returns (textures_destroyed, buffers_destroyed).
///
/// `min_age_frames`: only destroy entries this many ticks old or
/// more. Anything below 2 risks "destroyed texture used in submit"
/// validation errors — at 60 fps, 2 ticks ≈ 33 ms which is past the
/// browser's typical submission completion window.
///
/// `max_destroys_per_tick`: cap the number of destroy() calls per
/// tick (across both queues combined) so a burst doesn't stall a
/// single rAF. Pass `u32::MAX` for unlimited.
pub fn tick_deferred_destroys(
    min_age_frames: u32,
    max_destroys_per_tick: u32,
) -> (u32, u32) {
    let next = FRAME_COUNTER.with(|f| {
        let n = f.get().wrapping_add(1);
        f.set(n);
        n
    });

    let mut budget = max_destroys_per_tick;
    let mut textures_destroyed = 0u32;
    let mut buffers_destroyed = 0u32;

    PENDING_TEXTURES.with(|q| {
        let mut q = q.borrow_mut();
        let mut i = 0;
        while i < q.len() && budget > 0 {
            let age = next.wrapping_sub(q[i].0);
            if age >= min_age_frames {
                // swap_remove is O(1) and we don't rely on ordering.
                let (_, tex) = q.swap_remove(i);
                tex.destroy();
                textures_destroyed += 1;
                budget -= 1;
            } else {
                i += 1;
            }
        }
    });

    PENDING_BUFFERS.with(|q| {
        let mut q = q.borrow_mut();
        let mut i = 0;
        while i < q.len() && budget > 0 {
            let age = next.wrapping_sub(q[i].0);
            if age >= min_age_frames {
                let (_, buf) = q.swap_remove(i);
                buf.destroy();
                buffers_destroyed += 1;
                budget -= 1;
            } else {
                i += 1;
            }
        }
    });

    (textures_destroyed, buffers_destroyed)
}
