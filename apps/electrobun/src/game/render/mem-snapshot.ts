/**
 * Memory snapshot — gathers every tracked counter that could leak across
 * map changes (live GPU textures, instance ids, sprite states, sub-system
 * caches, JS heap usage). Used by `loadMapFromData` to log a per-map
 * delta and exposed on `window.__memSnapshot()` so the user can probe
 * mid-session from DevTools.
 *
 * Not a replacement for the watchdog HUD — that one is per-tick and
 * shows aggregates. This one is per-event (map change) and shows
 * fine-grained sub-counters so we can trace which cache is the source
 * of unbounded growth.
 */

import { getCharacterSpriteLoader } from "@/game/assets/character-sprite";

import { getFighterPortraitRenderer } from "./fighter-portrait-renderer";
import { getHudVelloAtlas } from "./hud-vello-atlas";
import { getSpellIconRenderer } from "./spell-icon-renderer";
import {
  getLiveRenderTextureIdCount,
  getLiveSpellInstanceCount,
  getLoadedSwfBundleCount,
  getSwfLoadStats,
} from "./vello-loader";

import type { AtlasLoader } from "./atlas-loader";
import type { PickingSystem } from "./picking-system";
import type { PlayerStripRenderer } from "./player-strip-renderer";
import type { TileSpriteRenderer } from "./tile-sprite-renderer";

interface PerfWithMemory extends Performance {
  memory?: {
    usedJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

export interface MemSources {
  atlasLoader: AtlasLoader | null;
  tileSpriteRenderer: TileSpriteRenderer | null;
  playerStripRenderer: PlayerStripRenderer | null;
  pickingSystem: PickingSystem | null;
}

export type MemSnapshot = Record<string, number>;

/**
 * Build a flat string→number map of every tracked counter. Flat layout
 * is on purpose — `diffMemSnapshot` only has to walk one Map and the
 * output formatter doesn't need to know any schema.
 */
export function takeMemSnapshot(sources: MemSources): MemSnapshot {
  const snap: MemSnapshot = {};
  // Vello-side GPU textures + spell instances + bundles.
  snap["vello.liveTextureIds"] = getLiveRenderTextureIdCount();
  snap["vello.liveSpellInstances"] = getLiveSpellInstanceCount();
  snap["vello.loadedBundles"] = getLoadedSwfBundleCount();
  const swf = getSwfLoadStats();
  snap["vello.swfLoad.active"] = swf.active;
  snap["vello.swfLoad.queued"] = swf.queued;

  // CharacterSpriteLoader (global singleton, drained on map change).
  const csl = getCharacterSpriteLoader().getStats();
  snap["char.cache"] = csl.cache;
  snap["char.pending"] = csl.pending;
  snap["char.applyEnd"] = csl.applyEnd;
  snap["char.assetBundles"] = csl.assetBundles;
  snap["char.assetPending"] = csl.assetPending;

  if (sources.atlasLoader) {
    const a = sources.atlasLoader.getStats();
    snap["atlas.staticBase"] = a.staticBase;
    snap["atlas.liveSources"] = a.liveSources;
    snap["atlas.retiredSources"] = a.retiredSources;
    snap["atlas.pendingAnimations"] = a.pendingAnimations;
    snap["atlas.animationsByKey"] = a.animationsByKey;
    snap["atlas.inFlightChunks"] = a.inFlightChunks;
  }

  if (sources.tileSpriteRenderer) {
    const t = sources.tileSpriteRenderer.getStats();
    snap["tile.states"] = t.states;
    snap["tile.cache"] = t.tileCache;
    snap["tile.refs"] = t.cacheRefs;
  }

  if (sources.playerStripRenderer) {
    const p = sources.playerStripRenderer.getStats();
    snap["strip.players"] = p.players;
    snap["strip.slots"] = p.slots;
  }

  if (sources.pickingSystem) {
    const pk = sources.pickingSystem.getStats();
    snap["pick.pickable"] = pk.pickable;
    snap["pick.alphaMaps"] = pk.alphaMaps;
    snap["pick.pendingExtract"] = pk.pendingExtractions;
    snap["pick.failedSources"] = pk.failedSources;
  }

  const fpr = getFighterPortraitRenderer().getStats();
  snap["portrait.canvasCache"] = fpr.canvasCache;
  snap["portrait.pendingRenders"] = fpr.pendingRenders;
  snap["portrait.pendingLoads"] = fpr.pendingLoads;
  snap["portrait.bundleNames"] = fpr.bundleNames;
  snap["portrait.naturalDims"] = fpr.naturalDims;

  const sir = getSpellIconRenderer().getStats();
  snap["spellicon.canvasCache"] = sir.canvasCache;
  snap["spellicon.pendingRenders"] = sir.pendingRenders;
  snap["spellicon.pendingSubBundles"] = sir.pendingSubBundles;
  snap["spellicon.loadedSubBundles"] = sir.loadedSubBundles;
  snap["spellicon.subscribers"] = sir.subscribers;

  const hud = getHudVelloAtlas().getStats();
  snap["hudAtlas.width"] = hud.width;
  snap["hudAtlas.height"] = hud.height;
  snap["hudAtlas.bytes"] = hud.bytes;

  const perf = performance as PerfWithMemory;
  const mem = perf.memory;
  if (mem) {
    snap["js.heapUsedMB"] = Math.round(mem.usedJSHeapSize / (1024 * 1024));
    snap["js.heapLimitMB"] = Math.round(mem.jsHeapSizeLimit / (1024 * 1024));
  }

  return snap;
}

/**
 * Subtract `before` from `after`. Keys present only in one snapshot
 * appear as their full value (treating absent as 0). Returns only keys
 * whose delta is non-zero — leaks pop out of the report directly.
 */
export function diffMemSnapshot(
  before: MemSnapshot,
  after: MemSnapshot,
): MemSnapshot {
  const out: MemSnapshot = {};
  const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const d = (after[k] ?? 0) - (before[k] ?? 0);
    if (d !== 0) out[k] = d;
  }
  return out;
}

/** One-line `key=value, key=value` formatter. Sorted by key for stability. */
export function formatMemSnapshot(snap: MemSnapshot): string {
  const keys = Object.keys(snap).sort();
  return keys.map((k) => `${k}=${snap[k]}`).join(" ");
}

/**
 * Format only the leak-suspicious keys: any positive delta on counters
 * that *should* stay flat across map changes. The threshold is "any
 * growth at all" — the floor was already at the baseline when we took
 * the `before` snapshot. Pre-sorted by descending delta so the worst
 * offender shows first.
 */
export function formatLeakReport(diff: MemSnapshot): string {
  const growth = Object.entries(diff).filter(([, v]) => v > 0);
  if (growth.length === 0) return "(no growth)";
  growth.sort((a, b) => b[1] - a[1]);
  return growth.map(([k, v]) => `${k}+${v}`).join(" ");
}
