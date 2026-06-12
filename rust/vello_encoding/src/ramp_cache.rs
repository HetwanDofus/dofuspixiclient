// Copyright 2022 the Vello Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

use std::collections::HashMap;

use peniko::color::cache_key::CacheKey;
use peniko::color::{HueDirection, Srgb};
use peniko::{ColorStop, ColorStops};

const N_SAMPLES: usize = 512;
const RAMP_CAP: usize = 1024;
const EVICT_AGE: u64 = 2;
/// Sentinel `last_used` epoch for ramps that must survive `maintain()` —
/// used by `Renderer::intern_sub` so a sub baked into the SubLibrary
/// retains its resolved `ramp_id` across frames.
const PINNED_EPOCH: u64 = u64::MAX;

/// Data and dimensions for a set of resolved gradient ramps.
#[derive(Copy, Clone, Debug, Default)]
pub struct Ramps<'a> {
    pub data: &'a [u32],
    pub width: u32,
    pub height: u32,
}

#[derive(Default)]
pub struct RampCache {
    epoch: u64,
    map: HashMap<CacheKey<ColorStops>, (u32, u64)>,
    data: Vec<u32>,
}

impl RampCache {
    pub(crate) fn maintain(&mut self) {
        self.epoch = self.epoch.saturating_add(1);
        if self.map.len() > RAMP_CAP {
            let now = self.epoch;
            self.map
                .retain(|_, v| v.1 == PINNED_EPOCH || v.1 + EVICT_AGE >= now);
        }
    }

    pub(crate) fn add(&mut self, stops: &[ColorStop]) -> u32 {
        self.add_internal(stops, false)
    }

    /// Insert (or refresh) `stops` with a permanent pin. The returned
    /// ramp id stays valid for the lifetime of the cache — `maintain()`
    /// will not evict it. Used by `Renderer::intern_sub` so resolved
    /// `ramp_id` values baked into SubLibrary sub-bytes stay correct.
    pub fn add_pinned(&mut self, stops: &[ColorStop]) -> u32 {
        self.add_internal(stops, true)
    }

    fn add_internal(&mut self, stops: &[ColorStop], pin: bool) -> u32 {
        let key = CacheKey(stops.into());
        let epoch = if pin { PINNED_EPOCH } else { self.epoch };
        if let Some(entry) = self.map.get_mut(&key) {
            if entry.1 != PINNED_EPOCH {
                entry.1 = epoch;
            }
            return entry.0;
        }
        if self.map.len() < RAMP_CAP {
            let id = (self.data.len() / N_SAMPLES) as u32;
            self.data.extend(make_ramp(stops));
            self.map.insert(key, (id, epoch));
            return id;
        }
        let mut reuse: Option<(CacheKey<ColorStops>, u32)> = None;
        for (k, (id, e)) in &self.map {
            if *e == PINNED_EPOCH {
                continue;
            }
            if *e + EVICT_AGE < self.epoch {
                reuse = Some((k.clone(), *id));
                break;
            }
        }
        if let Some((old_key, id)) = reuse {
            self.map.remove(&old_key);
            let start = id as usize * N_SAMPLES;
            for (dst, src) in self.data[start..start + N_SAMPLES]
                .iter_mut()
                .zip(make_ramp(stops))
            {
                *dst = src;
            }
            self.map.insert(key, (id, epoch));
            id
        } else {
            let id = (self.data.len() / N_SAMPLES) as u32;
            self.data.extend(make_ramp(stops));
            self.map.insert(key, (id, epoch));
            id
        }
    }

    /// Drop everything, pinned ramps included — valid only when the
    /// caller also discards the SubLibrary bytes that baked `ramp_id`s.
    /// Called on map change so pinned ramps can't accumulate without
    /// bound (the data vec appends past `RAMP_CAP` when no unpinned
    /// entry is evictable). Per-frame ramps re-add on the next resolve.
    pub fn reset(&mut self) {
        self.map.clear();
        self.data.clear();
    }

    pub fn ramps(&self) -> Ramps<'_> {
        Ramps {
            data: &self.data,
            width: N_SAMPLES as u32,
            height: (self.data.len() / N_SAMPLES) as u32,
        }
    }
}

fn make_ramp(stops: &[ColorStop]) -> impl Iterator<Item = u32> + '_ {
    let mut last_u = 0.0;
    let mut last_c = stops[0].color.to_alpha_color::<Srgb>();
    let mut this_u = last_u;
    let mut this_c = last_c;
    let mut j = 0;
    (0..N_SAMPLES).map(move |i| {
        let u = (i as f32) / (N_SAMPLES - 1) as f32;
        while u > this_u {
            last_u = this_u;
            last_c = this_c;
            if let Some(s) = stops.get(j + 1) {
                this_u = s.offset;
                this_c = s.color.to_alpha_color::<Srgb>();
                j += 1;
            } else {
                break;
            }
        }
        let du = this_u - last_u;
        let c = if du < 1e-9 {
            this_c
        } else {
            last_c.lerp(this_c, (u - last_u) / du, HueDirection::default())
        };
        c.premultiply().to_rgba8().to_u32()
    })
}
