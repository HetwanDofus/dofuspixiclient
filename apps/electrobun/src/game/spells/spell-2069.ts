/**
 * Spell 2069 — Unknown Spell (displayType=11 TargetCell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2069/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile, no caster reference,
 * no duplicate or beam logic — it is a single impact animation placed at the target cell.
 * The manifest's `librarySymbols` array is empty; the entire spell is driven by a single
 * `anim1` animation entry (composite, 60 frames). The AS scripts describe three nested
 * DefineSprite symbols composing the animation:
 *
 *   - DefineSprite_5 — innermost particle/layer. frame_1 randomises alpha (30+random(90)).
 *                      frame_112 stops the timeline.
 *   - DefineSprite_8 — mid-level sprite. frame_58 stops.
 *   - DefineSprite_7 — outermost wrapper. frame_181 calls
 *                      `_parent._parent.removeMovieClip()` (removes the root mc)
 *                      then stops — this is the completion signal.
 *
 * Because the manifest's `animations` array contains a single `anim1` entry with
 * `isComposite: true` and `stopFrame: 57` (0-based stopFrame 57 = AS frame_58),
 * and `librarySymbols` is empty, the exporter has baked all authored composite
 * content into the pre-rendered SVG frames of `anim1`. The runtime symbol we
 * register mirrors the outermost DefineSprite_7 timeline (181 frames → we clamp
 * to the 60 exported frames). The inner DefineSprite_5 alpha randomisation is
 * expressed per-frame at onLoad, and the completion fires from frame 57
 * (AS frame_58 → DefineSprite_8's stop) since the composite SVG stopFrame is 57,
 * with completion deferred to that same frame since `_parent._parent.removeMovieClip()`
 * fires from DefineSprite_7/frame_181 — but the exported composite only goes to
 * frame 59 (60 frames), so we fire complete + signalHit from the last live frame.
 *
 * Specifically: `stopFrame: 57` in the manifest means the animation stops
 * at exported frame 57. `fadingFrame: 56` is the last frame before the stop.
 * We register `anim1` as a SymbolDefinition with 60 total frames, stop at
 * frame 57 (0-based), signal hit at frame 0 (impact is immediate for a
 * target-cell spell with no projectile), and complete after the stop frame.
 *
 * Main timeline: no SOMA.playSound found; no explicit sound in frame_1. The
 * onSpellStart simply attaches the anim1 symbol at the root.
 *
 * Library symbols: none (librarySymbols array is empty in manifest).
 * All content is in `anim1` (bare name, no lib_ prefix).
 */

import type {
  SpellCallbacks,
  SpellContext,
  SpellTextureProvider,
  SymbolDefinition,
} from "@dofus/spell-runtime";
import {
  RuntimeSpell,
  SpellDisplayType,
  calculateAnchor,
} from "@dofus/spell-runtime";

const ANIM1_BOUNDS = {
  width: 108.95,
  height: 134.1,
  offsetX: -72,
  offsetY: -96.4,
};

export class Spell2069 extends RuntimeSpell {
  readonly spellId = 2069;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);
    const anim1Frames = textures.getFrames("anim1");
    const totalFrames = Math.max(1, anim1Frames.length);

    // The composite anim1 symbol mirrors the full authored timeline.
    // DefineSprite_5/frame_1/DoAction.as: `_alpha = 30 + random(90)`
    //   → randomise alpha on load (frame 0 script, fires once on attach).
    // DefineSprite_8/frame_58/DoAction.as: `stop()` → stop at frame 57 (0-based).
    // DefineSprite_7/frame_181/DoAction.as: `_parent._parent.removeMovieClip(); stop()`
    //   → since the composite only exports 60 frames, we fire complete() at
    //   frame 57 (the canonical stopFrame from the manifest), which is the
    //   outermost authored stop point within the exported range.
    this.anim1Sym = {
      name: "anim1",
      totalFrames,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      onLoad: (clip) => {
        // AS DefineSprite_5/frame_1/DoAction.as: _alpha = 30 + random(90)
        // Applied at construction time to the composite clip.
        clip.alpha = (30 + Math.floor(Math.random() * 90)) / 100;
      },

      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_5/frame_1/DoAction.as fires on frame 1 of
            // the innermost sprite — handled in onLoad above. Nothing
            // additional needed here for the outer timeline's frame 0.
            // Signal hit immediately: this is a target-cell impact spell
            // with no projectile, so damage registers at the first frame.
            this.runtime.signalHit();
          },
        ],
        [
          57,
          (clip) => {
            // AS DefineSprite_8/frame_58/DoAction.as: stop()
            // AS DefineSprite_7/frame_181/DoAction.as: _parent._parent.removeMovieClip(); stop()
            // Both stop actions converge at this frame in the exported 60-frame composite.
            // Fire complete() here since this is the canonical authored stop point.
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline frame_1: no SOMA.playSound found in the script list.
    // Attach anim1 at the root so it starts playing from the next runtime tick.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
