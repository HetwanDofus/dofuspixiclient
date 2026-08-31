import { ExternalStore } from "./game-store";

/**
 * One-per-second sample of the render pipeline, published by `Engine`.
 *
 * This is the data the old green `position:fixed` overlay printed as a single
 * line of text; it now feeds the admin panel in the letterbox gutter
 * (`hud/debug/AdminPanel.tsx`). The cadence is deliberately 1 Hz — the sample
 * is taken inside the FPS accumulator that already ran once a second, so
 * nothing new happens per frame and React never re-renders on the hot path.
 */
export interface PerfState {
  /** Frames counted over the last second. 0 before the first sample. */
  fps: number;
  /** Wall-clock of the last sample, 0 when none has been taken yet. */
  sampledAt: number;
  /** Scene numbers, null while the battlefield/atlas isn't up yet. */
  scene: PerfSceneSample | null;
}

export interface PerfSceneSample {
  /** Actors currently rendered on the map (players, NPCs, monster groups). */
  actors: number;
  /** Duration of the last world-actor update pass, ms. */
  updateMs: number;
  /** Occupied / total LRU slots in the Vello frame atlas. */
  atlasSlots: number;
  atlasMaxSlots: number;
  /** Vello rasterisations on the last frame — 0 means the cache served all. */
  renders: number;
  /** GPU queue build time on the last frame, ms. */
  queueMs: number;
  /** GPU flush (submit) time on the last frame, ms. */
  flushMs: number;
  /** Atlas cache hits on the last frame. */
  hits: number;
}

const initialState: PerfState = {
  fps: 0,
  sampledAt: 0,
  scene: null,
};

export const perfStore = new ExternalStore<PerfState>(initialState);
