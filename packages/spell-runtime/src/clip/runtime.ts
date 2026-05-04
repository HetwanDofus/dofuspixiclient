/**
 * SpellRuntime — drives the per-spell clip tree at the canonical
 * Flash framerate (30 fps).
 *
 * The runtime owns:
 *   - The per-spell `SymbolRegistry` (library symbol lookup).
 *   - The root `SpellClip` (one for the whole spell instance).
 *   - A frame accumulator that converts screen-loop deltaMS into
 *     discrete Flash frames (so a 60 fps render still ticks the spell
 *     at exactly 30 logical frames/sec, matching the canonical SWF).
 *
 * The screen-loop calls `runtime.tick(dtMs)` every render frame; the
 * runtime does the integer-frame stepping internally and runs all
 * `onEnterFrame` handlers + frame scripts in document-pre-order
 * across the whole tree.
 */

import type { SpellCallbacks, SpellContext } from "../spell-interface.ts";
import type { SpellClip } from "./clip.ts";
import type { SymbolRegistry } from "./symbol-registry.ts";

/**
 * Canonical Dofus 1.29 SWF framerate.
 *
 * The authored loader.fla and per-spell SWFs all carry
 * `frameRate="20"` (visible in `assets/sources/fla/DOMDocument.xml`).
 * The shipping client used the optional TRIPLEFRAMERATE mode that
 * triples the stage to 60 fps while compensating motion code with
 * `speed /= 3` (see VisualEffectHandler.as:117) — same absolute wall
 * speed for projectile motion, but timeline-driven things play 3×
 * faster (a 106-frame burn = 1.77 s in TRIPLEFRAMERATE vs 5.3 s in
 * authored 20 fps mode).
 *
 * We tick at the TRIPLEFRAMERATE-canonical 60 fps for two reasons:
 *   1. Smooth visuals — at 60 fps a screen-refresh-aligned browser
 *      sees one Flash frame per render frame, matching the user's
 *      memory of the late-1.29 client.
 *   2. Burn timing matches user observation ("stays for some seconds"
 *      = 1.77 s, not the 5.3 s authored 20 fps mode produces).
 *
 * Per-spell motion speed is then set to the canonical TRIPLEFRAMERATE
 * value (e.g. spell 103 displayType-30 speed = 0.225, not 0.675).
 */
export const FLASH_FPS = 60;
const FRAME_DURATION_MS = 1000 / FLASH_FPS;

export interface SpellRuntimeInit {
  root: SpellClip;
  registry: SymbolRegistry;
  context: SpellContext;
  callbacks: SpellCallbacks;
}

export class SpellRuntime {
  readonly root: SpellClip;
  readonly registry: SymbolRegistry;
  readonly context: SpellContext;
  readonly callbacks: SpellCallbacks;

  private frameAccumulator = 0;
  private elapsedFrames = 0;
  /** Whether the spell has signalled completion. */
  private completed = false;

  constructor(init: SpellRuntimeInit) {
    this.root = init.root;
    this.registry = init.registry;
    this.context = init.context;
    this.callbacks = init.callbacks;
  }

  /**
   * Total Flash frames elapsed since the runtime started. Used by the
   * harness for projectile motion (displayType 30/31/40/41) and by
   * spells that need to know "when am I in absolute time?".
   */
  get framesElapsed(): number {
    return this.elapsedFrames;
  }

  /** Has `complete()` been signalled? */
  get isComplete(): boolean {
    return this.completed;
  }

  /**
   * Spell-side completion signal. Called by the per-spell module when
   * the canonical AS would have done `_parent.removeMovieClip()` on
   * the outermost clip — usually from a final-frame script on the
   * top-level timeline. Triggers `callbacks.onComplete`.
   */
  complete(): void {
    if (this.completed) {
      return;
    }
    this.completed = true;
    this.callbacks.onComplete();
  }

  /**
   * Spell-side hit signal. Wraps `callbacks.onHit` so per-spell code
   * can call it without holding a reference to the callback set.
   * Idempotent — successive calls are no-ops.
   */
  signalHit(): void {
    if (this.hitSignalled) {
      return;
    }
    this.hitSignalled = true;
    this.callbacks.onHit();
  }
  private hitSignalled = false;

  /**
   * Pump the runtime by `dtMs` of wall time. Steps an integer number
   * of Flash frames, clamping to a per-call budget so a multi-second
   * stutter (e.g. tab regaining focus) doesn't try to fast-forward
   * 200 frames in one call.
   */
  tick(dtMs: number): void {
    if (this.completed) {
      return;
    }
    this.frameAccumulator += dtMs;
    let safety = 0;
    while (this.frameAccumulator >= FRAME_DURATION_MS && safety < 8) {
      this.frameAccumulator -= FRAME_DURATION_MS;
      this.advanceOneFrame();
      safety++;
    }
    // Drop any backlog beyond the safety budget — the spell will
    // catch up over the next few ticks at real-time pace.
    if (this.frameAccumulator > FRAME_DURATION_MS * 4) {
      this.frameAccumulator = FRAME_DURATION_MS;
    }
  }

  /**
   * Walk the clip tree in pre-order and tick each clip exactly once,
   * then sweep removed clips. Snapshotting via `walk()` ensures clips
   * spawned mid-tick (e.g. attachMovie inside a frame script) only
   * start ticking on the NEXT frame — matches AS-2 semantics.
   */
  private advanceOneFrame(): void {
    this.elapsedFrames++;
    const snapshot = [...this.root.walk()];
    for (const clip of snapshot) {
      // A frame script run earlier in this iteration may have called
      // `complete()`, which synchronously fires onComplete →
      // scene.remove → actor.dispose → spell.destroy. After that the
      // remaining snapshot clips have destroyed containers; bail to
      // avoid spurious tickOneFrame work + collectGarbage on a torn
      // tree. `clip.tickOneFrame` also guards against destroyed
      // containers, but breaking here is cheaper.
      if (this.completed) break;
      clip.tickOneFrame(this.context);
    }
    if (!this.completed) {
      this.root.collectGarbage();
    }
  }
}
