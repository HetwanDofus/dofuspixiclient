// Copyright 2026 the Dofus recode project
// SPDX-License-Identifier: Apache-2.0 OR MIT

//! DOFUS: opt-in display-list recording on [`Scene`](crate::Scene).
//!
//! A recording-enabled Scene mirrors every drawing command it encodes
//! into a flat, owned [`Recording`]. The recording can then be replayed
//! into a *different* rasterizer — the immediate consumer is the
//! `cpu-bench` harness, which replays recordings into `vello_cpu` to
//! measure how fast the CPU renderer handles real SWF bake workloads
//! (the WebGPU-less fallback path for older machines).
//!
//! Recording is off by default (`Scene::new()` records nothing); the
//! per-op cost when disabled is a single `Option` check. Enable it with
//! [`Scene::enable_recording`](crate::Scene::enable_recording).
//!
//! Fidelity: fills, strokes, layers and plain `append` are captured
//! exactly. Instanced appends (`append_instanced*`, the slab path) and
//! glyph runs are NOT captured — they bump [`Recording::lossy`] so a
//! consumer can tell the recording is incomplete rather than silently
//! rendering a wrong image.

use std::sync::Arc;

use peniko::{
    BlendMode, Brush, Fill,
    kurbo::{Affine, BezPath, Stroke},
};

/// Tolerance used when converting an `impl Shape` into the recorded
/// `BezPath`. Only lossy for shapes that approximate themselves with
/// curves (circles/ellipses); `BezPath` inputs — everything the SWF
/// walker emits — round-trip exactly.
pub const RECORD_TOLERANCE: f64 = 0.001;

/// One recorded drawing command. Mirrors the corresponding
/// [`Scene`](crate::Scene) method's arguments, with borrows deep-cloned
/// into owned values.
#[derive(Clone, Debug)]
pub enum DisplayOp {
    /// [`Scene::fill`](crate::Scene::fill). Also covers
    /// [`Scene::draw_image`](crate::Scene::draw_image), which funnels
    /// through `fill` with an image brush.
    Fill {
        style: Fill,
        transform: Affine,
        brush: Brush,
        brush_transform: Option<Affine>,
        path: BezPath,
    },
    /// [`Scene::stroke`](crate::Scene::stroke) (non-zero width only;
    /// zero-width strokes draw nothing and are not recorded).
    Stroke {
        style: Stroke,
        transform: Affine,
        brush: Brush,
        brush_transform: Option<Affine>,
        path: BezPath,
    },
    /// [`Scene::push_layer`](crate::Scene::push_layer). A stroke-styled
    /// clip is recorded as `Fill::NonZero` and counted lossy (the SWF
    /// walker never emits one).
    PushLayer {
        clip_style: Fill,
        blend: BlendMode,
        alpha: f32,
        transform: Affine,
        clip: BezPath,
    },
    /// [`Scene::pop_layer`](crate::Scene::pop_layer).
    PopLayer,
    /// [`Scene::append`](crate::Scene::append) of a child scene that
    /// carried its own recording. The child's ops replay under
    /// `transform` (applied on the left of every child transform, the
    /// same composition `Encoding::append` uses).
    Append {
        rec: Arc<Recording>,
        transform: Option<Affine>,
    },
}

/// An owned display list captured from a recording-enabled Scene.
#[derive(Clone, Debug, Default)]
pub struct Recording {
    /// Recorded commands, in encode order.
    pub ops: Vec<DisplayOp>,
    /// Number of commands that could NOT be captured (instanced
    /// appends, glyph runs, appends of non-recording child scenes).
    /// Non-zero means a replay of this recording is incomplete.
    pub lossy: u32,
}

impl Recording {
    /// Total op count including nested appended recordings.
    pub fn deep_op_count(&self) -> usize {
        let mut n = self.ops.len();

        for op in &self.ops {
            if let DisplayOp::Append { rec, .. } = op {
                n += rec.deep_op_count();
            }
        }

        n
    }

    /// Total lossy count including nested appended recordings.
    pub fn deep_lossy(&self) -> u32 {
        let mut n = self.lossy;

        for op in &self.ops {
            if let DisplayOp::Append { rec, .. } = op {
                n += rec.deep_lossy();
            }
        }

        n
    }
}
