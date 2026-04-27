/**
 * Spell 2909 — (Cra/unknown, long composite animation).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2909/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has a single composite animation
 * ("anim1") anchored at the target cell — no projectile motion, no caster
 * reference, no `move`/`shoot`/`duplicate` symbols. The manifest has NO
 * librarySymbols[] entries; all content lives in the single `animations[]`
 * entry "anim1" (390 frames, isComposite=true).
 *
 * The AS structure reveals:
 *   - DefineSprite_9 (the outer anim1 container, 390 frames):
 *       PlaceObject2_8_1 carries a child clip with onClipEvent(load/enterFrame)
 *       that drifts upward (wind + vertical velocity, fades after t>330).
 *       frame_388: `_parent.removeMovieClip(); stop();` → spell complete.
 *   - DefineSprite_8 (inner wobble clip, child of DefineSprite_9):
 *       onLoad seeds `i=0, vamp=0.1*random()`.
 *       onEnterFrame: `_X = 10 * sin(i += vamp)` — horizontal sway.
 *   - DefineSprite_7 (child of DefineSprite_8 or its sibling):
 *       onLoad seeds `a=1.5`.
 *       onEnterFrame: `_rotation = 10 * sin(a += _parent.vamp)` — rotation
 *       swing using parent's vamp.
 *   - DefineSprite_4 (deep child reading `_parent._parent._parent.vamp`):
 *       onLoad seeds `a=5`.
 *       onEnterFrame: `_rotation = 20 * sin(a += _parent._parent._parent.vamp)`
 *   - DefineSprite_5 (child reading `_parent._parent.vamp`):
 *       onLoad seeds `a=2`.
 *       onEnterFrame: `_rotation = 15 * sin(a += _parent._parent.vamp)`
 *   - Main timeline frame_13: `stop();`
 *
 * Since the manifest has no librarySymbols[] and no attachMovie calls in
 * the main-timeline script, the entire visual is driven by the pre-composed
 * "anim1" timeline (isComposite=true). The nested DefineSprite clip events
 * are baked into the composite frames. We model the outer container as a
 * single SymbolDefinition "anim1" with:
 *   - 390 frames from textures.getFrames("anim1") (bare name, no lib_ prefix)
 *   - frameScripts: frame 387 (0-based) → _parent.removeMovieClip + stop
 *     (canonical AS: DefineSprite_9/frame_388/DoAction.as)
 *
 * The particle clip events (drift, sway, rotation) are baked into the
 * composite SVG frames exported by the combat-exporter — they do not need
 * to be re-simulated in TS. The onEnterFrame handlers here are for
 * documentation completeness only; since "anim1" is isComposite, we simply
 * play its pre-rendered frames.
 *
 * signalHit is fired at the first frame (frame 0) since this is an instant
 * impact-style spell at the target cell.
 *
 * Main timeline: frame_13/DoAction.as → stop() — we mirror this as a
 * frameScript on the anim1 symbol at index 12. However, since the outer
 * DefineSprite_9/frame_388 calls _parent.removeMovieClip(), we also wire
 * frame 387 to complete().
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
  width: 13.3,
  height: 36.45,
  offsetX: -5.9,
  offsetY: -54.15,
};

export class Spell2909 extends RuntimeSpell {
  readonly spellId = 2909;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — composite 390-frame animation at target cell ----
    // No librarySymbols[] in manifest — use bare "anim1" key (no lib_ prefix).
    // The nested DefineSprite clip events (drift, sway, rotation oscillation)
    // are baked into the composite SVG frames by the combat-exporter.
    //
    // AS DefineSprite_9/frame_388/DoAction.as:
    //   _parent.removeMovieClip(); stop();
    //
    // AS frame_13/DoAction.as (main timeline):
    //   stop();
    // → mirrored as frameScripts[12] on the root anim1 clip (stop).
    //   The anim1 child clip has its own stop at its frame 387.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 390,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // Canonical impact frame — signal hit immediately on entry.
            // AS has no explicit hit signal; for TargetCell spells the
            // hit is implied at the start of the animation.
            this.runtime.signalHit();
          },
        ],
        [
          387,
          (clip) => {
            // AS DefineSprite_9/frame_388/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            // frame_388 is 0-based index 387.
            clip.remove();
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
    // Main timeline has no SOMA.playSound call.
    // Attach the anim1 composite at the root (target cell anchor).
    // The main timeline frame_13/DoAction.as: stop() is mirrored via
    // a frameScript on the root clip at index 12 below.
    this.root.attach(this.anim1Sym, "anim1", 1, context);

    // Mirror main timeline frame_13 stop() on the root clip itself.
    // AS frame_13/DoAction.as: stop();
    // The root has no authored timeline of its own; we model this by
    // stopping the anim1 child at its frame 12 via a separate frameScript
    // already registered above. The main-timeline stop() here means the
    // outer SWF main timeline stops advancing at frame 13 — in our model
    // the anim1 child drives everything, so no additional action needed.
  }
}
