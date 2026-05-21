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
    /// dropped on plus their estimated byte size (for live-bytes
    /// accounting at destroy time). Cleared by `tick_deferred_destroys`
    /// once old enough.
    static PENDING_TEXTURES: RefCell<Vec<(u32, webgpu_sys::GpuTexture, u64)>>
        = const { RefCell::new(Vec::new()) };
    static PENDING_BUFFERS: RefCell<Vec<(u32, webgpu_sys::GpuBuffer, u64)>>
        = const { RefCell::new(Vec::new()) };

    // Live byte accounting. Updated on `WebTexture::new` / `::destroy`
    // and on deferred-destroy tick. `live_*` = currently-allocated GPU
    // memory referenced by the Rust side. `created_*` and `destroyed_*`
    // are cumulative running totals. `pending_*` mirror queue size in
    // bytes (sum of byte_size of items still waiting in the deferred
    // queue).
    static LIVE_TEXTURE_BYTES: Cell<u64> = const { Cell::new(0) };
    static LIVE_BUFFER_BYTES: Cell<u64> = const { Cell::new(0) };
    static CREATED_TEXTURE_BYTES: Cell<u64> = const { Cell::new(0) };
    static CREATED_BUFFER_BYTES: Cell<u64> = const { Cell::new(0) };
    static DESTROYED_TEXTURE_BYTES: Cell<u64> = const { Cell::new(0) };
    static DESTROYED_BUFFER_BYTES: Cell<u64> = const { Cell::new(0) };

    // Counters for "non-byte-sized" GPU objects — bind groups,
    // texture views, samplers. These have NO JS-side `destroy()`
    // method (the GPU resource is freed via JS GC once all refs
    // drop), so we can't actively destroy them. But counting
    // create/drop gives us observability into whether wgpu Rust
    // state is holding them past their useful lifetime.
    //
    // If `live_*` for any of these climbs without bound during
    // stress, it points to a Rust-side leak (an Arc or Vec is
    // retaining the wrapper struct). If it stays bounded but fps
    // degrades, the slowdown is elsewhere (Pixi internal state,
    // browser GPU process pressure, etc.).
    static LIVE_BIND_GROUP_COUNT: Cell<u64> = const { Cell::new(0) };
    static CREATED_BIND_GROUP_COUNT: Cell<u64> = const { Cell::new(0) };
    static DROPPED_BIND_GROUP_COUNT: Cell<u64> = const { Cell::new(0) };
    static LIVE_TEXTURE_VIEW_COUNT: Cell<u64> = const { Cell::new(0) };
    static CREATED_TEXTURE_VIEW_COUNT: Cell<u64> = const { Cell::new(0) };
    static DROPPED_TEXTURE_VIEW_COUNT: Cell<u64> = const { Cell::new(0) };
    static LIVE_SAMPLER_COUNT: Cell<u64> = const { Cell::new(0) };
    static CREATED_SAMPLER_COUNT: Cell<u64> = const { Cell::new(0) };
    static DROPPED_SAMPLER_COUNT: Cell<u64> = const { Cell::new(0) };
}

/// Increment live + created texture byte counters. Call on every
/// `WebTexture::new` (or equivalent direct struct construction).
pub fn record_texture_created(byte_size: u64) {
    LIVE_TEXTURE_BYTES.with(|c| c.set(c.get().saturating_add(byte_size)));
    CREATED_TEXTURE_BYTES.with(|c| c.set(c.get().saturating_add(byte_size)));
}

/// Decrement live + increment destroyed texture byte counters. Call
/// from `WebTexture::destroy` (gated on a `destroyed` flag so multiple
/// destroy calls only count once) and from the deferred-destroy tick.
pub fn record_texture_destroyed(byte_size: u64) {
    LIVE_TEXTURE_BYTES.with(|c| c.set(c.get().saturating_sub(byte_size)));
    DESTROYED_TEXTURE_BYTES.with(|c| c.set(c.get().saturating_add(byte_size)));
}

pub fn record_buffer_created(byte_size: u64) {
    LIVE_BUFFER_BYTES.with(|c| c.set(c.get().saturating_add(byte_size)));
    CREATED_BUFFER_BYTES.with(|c| c.set(c.get().saturating_add(byte_size)));
}

pub fn record_buffer_destroyed(byte_size: u64) {
    LIVE_BUFFER_BYTES.with(|c| c.set(c.get().saturating_sub(byte_size)));
    DESTROYED_BUFFER_BYTES.with(|c| c.set(c.get().saturating_add(byte_size)));
}

pub fn record_bind_group_created() {
    LIVE_BIND_GROUP_COUNT.with(|c| c.set(c.get().saturating_add(1)));
    CREATED_BIND_GROUP_COUNT.with(|c| c.set(c.get().saturating_add(1)));
}

pub fn record_bind_group_dropped() {
    LIVE_BIND_GROUP_COUNT.with(|c| c.set(c.get().saturating_sub(1)));
    DROPPED_BIND_GROUP_COUNT.with(|c| c.set(c.get().saturating_add(1)));
}

pub fn record_texture_view_created() {
    LIVE_TEXTURE_VIEW_COUNT.with(|c| c.set(c.get().saturating_add(1)));
    CREATED_TEXTURE_VIEW_COUNT.with(|c| c.set(c.get().saturating_add(1)));
}

pub fn record_texture_view_dropped() {
    LIVE_TEXTURE_VIEW_COUNT.with(|c| c.set(c.get().saturating_sub(1)));
    DROPPED_TEXTURE_VIEW_COUNT.with(|c| c.set(c.get().saturating_add(1)));
}

pub fn record_sampler_created() {
    LIVE_SAMPLER_COUNT.with(|c| c.set(c.get().saturating_add(1)));
    CREATED_SAMPLER_COUNT.with(|c| c.set(c.get().saturating_add(1)));
}

pub fn record_sampler_dropped() {
    LIVE_SAMPLER_COUNT.with(|c| c.set(c.get().saturating_sub(1)));
    DROPPED_SAMPLER_COUNT.with(|c| c.set(c.get().saturating_add(1)));
}

/// Returns (live_bg, created_bg, dropped_bg,
///          live_tv, created_tv, dropped_tv,
///          live_sa, created_sa, dropped_sa).
/// Diagnostic snapshot for the non-byte-sized GPU object types.
pub fn object_counts() -> (u64, u64, u64, u64, u64, u64, u64, u64, u64) {
    (
        LIVE_BIND_GROUP_COUNT.with(|c| c.get()),
        CREATED_BIND_GROUP_COUNT.with(|c| c.get()),
        DROPPED_BIND_GROUP_COUNT.with(|c| c.get()),
        LIVE_TEXTURE_VIEW_COUNT.with(|c| c.get()),
        CREATED_TEXTURE_VIEW_COUNT.with(|c| c.get()),
        DROPPED_TEXTURE_VIEW_COUNT.with(|c| c.get()),
        LIVE_SAMPLER_COUNT.with(|c| c.get()),
        CREATED_SAMPLER_COUNT.with(|c| c.get()),
        DROPPED_SAMPLER_COUNT.with(|c| c.get()),
    )
}

/// Returns `(live_tex_bytes, live_buf_bytes, created_tex_bytes,
/// created_buf_bytes, destroyed_tex_bytes, destroyed_buf_bytes,
/// pending_tex_bytes, pending_buf_bytes)`. Pending values are summed
/// over the deferred-destroy queues (handles that have dropped but
/// haven't been destroy()'d yet).
pub fn byte_stats() -> (u64, u64, u64, u64, u64, u64, u64, u64) {
    let live_tex = LIVE_TEXTURE_BYTES.with(|c| c.get());
    let live_buf = LIVE_BUFFER_BYTES.with(|c| c.get());
    let created_tex = CREATED_TEXTURE_BYTES.with(|c| c.get());
    let created_buf = CREATED_BUFFER_BYTES.with(|c| c.get());
    let destroyed_tex = DESTROYED_TEXTURE_BYTES.with(|c| c.get());
    let destroyed_buf = DESTROYED_BUFFER_BYTES.with(|c| c.get());
    let pending_tex = PENDING_TEXTURES.with(|q| q.borrow().iter().map(|(_, _, sz)| *sz).sum::<u64>());
    let pending_buf = PENDING_BUFFERS.with(|q| q.borrow().iter().map(|(_, _, sz)| *sz).sum::<u64>());
    (
        live_tex,
        live_buf,
        created_tex,
        created_buf,
        destroyed_tex,
        destroyed_buf,
        pending_tex,
        pending_buf,
    )
}

/// Record a `GPUTexture` for deferred destruction. Called from
/// `WebTexture::drop`. `byte_size` is the estimated GPU memory for
/// live-bytes accounting at destroy time.
pub fn record_texture_drop(tex: &webgpu_sys::GpuTexture, byte_size: u64) {
    let frame = FRAME_COUNTER.with(|f| f.get());
    PENDING_TEXTURES.with(|q| {
        q.borrow_mut().push((frame, tex.clone(), byte_size));
    });
}

/// Record a `GPUBuffer` for deferred destruction. Called from
/// `WebBuffer::drop`.
pub fn record_buffer_drop(buf: &webgpu_sys::GpuBuffer, byte_size: u64) {
    let frame = FRAME_COUNTER.with(|f| f.get());
    PENDING_BUFFERS.with(|q| {
        q.borrow_mut().push((frame, buf.clone(), byte_size));
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
                let (_, tex, byte_size) = q.swap_remove(i);
                tex.destroy();
                record_texture_destroyed(byte_size);
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
                let (_, buf, byte_size) = q.swap_remove(i);
                buf.destroy();
                record_buffer_destroyed(byte_size);
                buffers_destroyed += 1;
                budget -= 1;
            } else {
                i += 1;
            }
        }
    });

    (textures_destroyed, buffers_destroyed)
}
