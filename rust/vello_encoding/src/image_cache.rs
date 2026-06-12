// Copyright 2022 the Vello Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

use guillotiere::{AllocId, AtlasAllocator, size2};
use peniko::ImageData;
use std::collections::HashMap;

const DEFAULT_ATLAS_SIZE: i32 = 1024;
const MAX_ATLAS_SIZE: i32 = 8192;
/// Atlas edge adopted on the FIRST pin. Pinned coordinates are baked
/// into SubLibrary sub-bytes, so the atlas can never grow afterwards
/// (`bump_size` refuses) — and the 1024² default holds only a couple
/// of upscaled tile bitmaps (~640 px each). Failing pins zero the draw
/// data and the tile renders blank (map holes / missing background).
/// 4096² (64 MB RGBA8) holds a full map's bitmaps with headroom; the
/// per-map pinned reset keeps it from filling across map changes.
const PINNED_ATLAS_SIZE: i32 = 4096;

#[derive(Default)]
pub struct Images<'a> {
    pub width: u32,
    pub height: u32,
    pub images: &'a [(ImageData, u32, u32)],
}

pub struct ImageCache {
    atlas: AtlasAllocator,
    /// Combined map: blob id → (x, y). Covers both pinned and per-frame.
    map: HashMap<u64, (u32, u32)>,
    /// All allocated images; first `pinned_count` are pinned (persistent).
    images: Vec<(ImageData, u32, u32)>,
    pinned_count: usize,
    /// Atlas allocation IDs for per-frame entries (drained on `clear`).
    per_frame_allocs: Vec<AllocId>,
}

impl Default for ImageCache {
    fn default() -> Self {
        Self::new()
    }
}

impl ImageCache {
    pub(crate) fn new() -> Self {
        Self {
            atlas: AtlasAllocator::new(size2(DEFAULT_ATLAS_SIZE, DEFAULT_ATLAS_SIZE)),
            map: HashMap::default(),
            images: Vec::default(),
            pinned_count: 0,
            per_frame_allocs: Vec::default(),
        }
    }

    pub(crate) fn images(&self) -> Images<'_> {
        Images {
            width: self.atlas.size().width as u32,
            height: self.atlas.size().height as u32,
            images: &self.images,
        }
    }

    pub(crate) fn bump_size(&mut self) -> bool {
        let new_size = self.atlas.size().width * 2;
        if new_size > MAX_ATLAS_SIZE {
            return false;
        }
        if self.pinned_count > 0 {
            // Rebuilding the atlas would shift pinned positions and
            // invalidate atlas coordinates baked into SubLibrary subs;
            // refuse the bump and let the caller fall back.
            return false;
        }
        self.atlas = AtlasAllocator::new(size2(new_size, new_size));
        self.map.clear();
        self.images.clear();
        self.per_frame_allocs.clear();
        true
    }

    pub(crate) fn clear(&mut self) {
        for id in self.per_frame_allocs.drain(..) {
            self.atlas.deallocate(id);
        }
        self.images.truncate(self.pinned_count);
        self.map.clear();
        for (img, x, y) in &self.images[..self.pinned_count] {
            self.map.insert(img.data.id(), (*x, *y));
        }
    }

    pub(crate) fn get_or_insert(&mut self, image: &ImageData) -> Option<(u32, u32)> {
        if let Some(pos) = self.map.get(&image.data.id()) {
            return Some(*pos);
        }
        let alloc = self
            .atlas
            .allocate(size2(image.width as _, image.height as _))?;
        let x = alloc.rectangle.min.x as u32;
        let y = alloc.rectangle.min.y as u32;
        self.images.push((image.clone(), x, y));
        self.per_frame_allocs.push(alloc.id);
        self.map.insert(image.data.id(), (x, y));
        Some((x, y))
    }

    /// Reserve a permanent atlas slot for `image`. The returned `(x, y)`
    /// is stable until [`reset_pinned`](Self::reset_pinned) — `clear()`
    /// will not free the slot. Used by `Renderer::intern_sub` so
    /// SubLibrary sub-bytes can embed atlas coordinates that stay valid
    /// across frames.
    pub fn add_pinned_image(&mut self, image: &ImageData) -> Option<(u32, u32)> {
        // A map hit only counts if the entry is PINNED. A per-frame
        // entry for the same blob would hand out coordinates that
        // `clear()` frees next frame, leaving the baked sub-bytes
        // pointing at recycled atlas space.
        if let Some(pos) = self.map.get(&image.data.id()) {
            let id = image.data.id();
            if self.images[..self.pinned_count]
                .iter()
                .any(|(img, _, _)| img.data.id() == id)
            {
                return Some(*pos);
            }
        }
        // First pin: rebuild the allocator at the pinned size while no
        // baked coordinate exists yet. Per-frame entries are re-resolved
        // every frame, so dropping them here is free.
        if self.pinned_count == 0 && self.atlas.size().width < PINNED_ATLAS_SIZE {
            self.rebuild(PINNED_ATLAS_SIZE);
        }
        let alloc = self
            .atlas
            .allocate(size2(image.width as _, image.height as _))?;
        let x = alloc.rectangle.min.x as u32;
        let y = alloc.rectangle.min.y as u32;
        self.images.insert(self.pinned_count, (image.clone(), x, y));
        self.pinned_count += 1;
        self.map.insert(image.data.id(), (x, y));
        Some((x, y))
    }

    pub fn pinned_count(&self) -> usize {
        self.pinned_count
    }

    pub fn atlas_size(&self) -> u32 {
        self.atlas.size().width as u32
    }

    /// Drop every pinned slot (and all per-frame entries) — valid only
    /// when the caller also discards everything that baked pinned
    /// coordinates (the SubLibrary). Called on map change so pins from
    /// past maps can't fill the atlas and starve the current one.
    pub fn reset_pinned(&mut self) {
        let size = self.atlas.size().width;
        self.rebuild(size);
    }

    fn rebuild(&mut self, size: i32) {
        self.atlas = AtlasAllocator::new(size2(size, size));
        self.map.clear();
        self.images.clear();
        self.per_frame_allocs.clear();
        self.pinned_count = 0;
    }
}
