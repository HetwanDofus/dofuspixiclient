/**
 * Clip-runtime shared types.
 *
 * The runtime is a TypeScript-native composition layer for Dofus 1.29
 * spells — NOT a Flash emulator. Each Dofus spell is expressed as a
 * tree of `SpellClip` nodes (one per attached MovieClip in canonical
 * AS terms). Each clip carries:
 *
 *   - A Pixi-Container-backed transform (position, scale, rotation,
 *     alpha) using idiomatic TS units (decimal scale, radian rotation,
 *     0-1 alpha — NOT Flash's percent / degrees / 0-100).
 *   - A timeline (frame index + total frames + isPlaying), exactly one
 *     "Flash frame" advanced per runtime tick at the canonical 30 fps
 *     baseline.
 *   - Frame-script handlers (`frameScripts: Map<frameIndex, fn>`) that
 *     correspond to the canonical `DefineSprite_N/frame_M/DoAction.as`
 *     scripts.
 *   - Optional `onLoad` / `onEnterFrame` clip-event handlers that
 *     mirror canonical `onClipEvent(load)` / `onClipEvent(enterFrame)`.
 *   - A `vars` bag for AS dynamic locals (`p.vx`, `p.amplitude`, etc.)
 *     which AS-2 stores as clip properties.
 */

import type { Texture } from "pixi.js";

import type { SpellContext } from "../spell-interface.ts";
import type { SpellClip } from "./clip.ts";

/**
 * Per-frame DoAction script. Receives the executing clip and the
 * shared spell context. Same signature for clip-event handlers.
 */
export type FrameScript = (clip: SpellClip, ctx: SpellContext) => void;
export type ClipEventHandler = FrameScript;

/**
 * Static description of a library symbol (the things AS attaches via
 * `attachMovie(name, instanceName, depth)`). Created once per (spell,
 * symbolName) pair and registered into the per-spell `SymbolRegistry`.
 *
 * `frameScripts` and `onLoad`/`onEnterFrame` are the COMPILED handlers
 * for the symbol's authored timeline — for hand-ported spells we write
 * these by hand; the M3 AS-compiler will emit them mechanically from
 * `DoAction.as` / `onClipEvent(...)` source files.
 */
export interface SymbolDefinition {
  /** Stable name used by `attachMovie` / `clip.attach`. */
  readonly name: string;
  /**
   * Length of the authored timeline. Empty placeholder composites
   * (e.g. spell-103's `move` and `shoot`) still have a non-zero
   * timeline because frame_1 / frame_2 / ... carry attachMovie scripts
   * even when the visual content is just blank frames.
   */
  readonly totalFrames: number;
  /**
   * Per-frame textures. May be empty for "container-only" symbols
   * whose authored content is 0×0 placeholders — children attached at
   * runtime supply the real visual.
   */
  readonly frames: readonly Texture[];
  /**
   * Pixi anchor in [0,1]. Calculated from the canonical bounds
   * (offsetX / width). Fixed per symbol — frame-by-frame variation
   * comes from texture differences, not anchor changes.
   */
  readonly anchorX: number;
  readonly anchorY: number;
  /**
   * Runs once when a clip is instantiated from this symbol — mirrors
   * `onClipEvent(load)`. Use to seed `clip.vars` with AS init values.
   */
  readonly onLoad?: ClipEventHandler;
  /**
   * Runs every Flash frame (30 fps baseline) for the lifetime of the
   * clip — mirrors `onClipEvent(enterFrame)`. Use for per-particle
   * physics (drift, oscillation, fade, etc.).
   */
  readonly onEnterFrame?: ClipEventHandler;
  /**
   * Per-frame timeline scripts (mirrors `DefineSprite_N/frame_M/
   * DoAction.as`). Frame indices are 0-based — AS's `frame_1` lives
   * at index 0 here.
   */
  readonly frameScripts?: ReadonlyMap<number, FrameScript>;
}

/**
 * Spell-level metadata available to every clip via the shared
 * `SpellContext`. Mirrors what AS exposes on the outer `mc` for
 * displayType-based rendering (`_parent.cellFrom`, `_parent.cellTo`,
 * `_parent.angle`, `_parent.level`, `_parent.params`).
 */
export interface SpellRootData {
  cellFrom: { x: number; y: number };
  cellTo: { x: number; y: number };
  /** Angle from caster to target, in RADIANS (canonical AS uses degrees). */
  angle: number;
  level: number;
  /** Element params for multi-element spells (3000, 3001, 3002). */
  params?: { fire: boolean; water: boolean; earth: boolean; air: boolean };
}
