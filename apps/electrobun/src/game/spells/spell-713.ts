/**
 * Spell 713 — Grina (Sram trap/ground effect).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/713/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile motion, no
 * caster-anchored content, no dual-timeline world-absolute layout. It is
 * a single animation anchored at the target cell. The AS main timeline
 * plays a sound; a single composite sprite (the outer DefineSprite_9)
 * drives the animation. A PlaceObject2 at frame 82 of DefineSprite_9 places
 * a child clip (DefineSprite_8) with an onClipEvent(enterFrame) that fades
 * out _parent._alpha by 2.3 per tick. The outer sprite stops and removes
 * itself at frame 133.
 *
 * Library symbols:
 *   - anim1 — the main 135-frame composite animation (animations[] only,
 *     no librarySymbols[] entry). Drives the whole visual. frame_133
 *     stops the clip and calls _parent.removeMovieClip() (→ complete()).
 *   - "fadeChild" (DefineSprite_8_26 placed via PlaceObject2 at frame_82
 *     of DefineSprite_9) — invisible container whose sole job is to run
 *     onClipEvent(enterFrame) that decrements _parent._alpha by 2.3 each
 *     tick. Registered as a SymbolDefinition with onEnterFrame handler.
 *
 * Main timeline: SOMA.playSound("grina_704"); (no stop, single frame).
 *
 * DefineSprite_5 and DefineSprite_3 appear in the scripts but they are
 * internal sub-sprites within the pre-rendered composite anim1 SVG frames
 * (DefineSprite_5 just picks a random trajectory label "traj1" and plays —
 * all three branches do the same thing; DefineSprite_3 picks a random
 * stop frame 1-3). These sub-sprites are fully captured in the composite
 * anim1 frames and do not need runtime clip wiring.
 *
 * The critical runtime behavior is the fade: at frame 82 a child clip is
 * placed on DefineSprite_9 (= the anim1 clip) and its onEnterFrame fires
 * each tick, subtracting 2.3 from the parent's _alpha (0-100 in AS → 0-1
 * in TS, so we subtract 2.3/100 per tick). This IS NOT captured in the
 * SVG frames and MUST be implemented here.
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
  width: 390.9,
  height: 224.75,
  offsetX: -198.15,
  offsetY: -175.9,
};

export class Spell713 extends RuntimeSpell {
  readonly spellId = 713;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- fadeChild — the PlaceObject2_8_26 child placed at frame 82 ----
    // AS: scripts/DefineSprite_9/frame_82/PlaceObject2_8_26/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // This is a zero-size container clip (DefineSprite_8) placed by the
    // authoring tool at frame 82 of the outer DefineSprite_9. Its only
    // purpose is to hold the enterFrame handler that fades the parent.
    // It has no visual content of its own.
    const fadeChildSym: SymbolDefinition = {
      name: "fadeChild",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: _parent._alpha -= 2.3;
        // AS alpha is 0-100; TS alpha is 0-1, so subtract 2.3/100.
        const parent = clip.parent;
        if (parent) {
          parent.alpha = Math.max(0, parent.alpha - 2.3 / 100);
        }
      },
    };

    // ---- anim1 — the main composite animation (135 frames) ----------
    // Sourced from animations[0] (no librarySymbols entry → no lib_ prefix).
    //
    // frameScripts:
    //   frame_82 (index 81): PlaceObject2_8_26 — attach fadeChild.
    //     AS: DefineSprite_9/frame_82 places the child with enterFrame handler.
    //   frame_133 (index 132): stop(); _parent.removeMovieClip();
    //     AS: DefineSprite_9/frame_133/DoAction.as
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 135,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          81,
          (clip, ctx) => {
            // AS: DefineSprite_9/frame_82 — PlaceObject2_8_26 places the
            // fade-driving child clip (onClipEvent enterFrame fades parent).
            clip.attach(fadeChildSym, "fadeChild", 26, ctx);
          },
        ],
        [
          132,
          (clip) => {
            // AS: DefineSprite_9/frame_133/DoAction.as
            // stop(); _parent.removeMovieClip();
            clip.stop();
            // Signal hit at the final removal frame — this is a TargetCell
            // spell so the harness does NOT fire signalHit automatically.
            // The canonical hit timing is when the effect resolves at the
            // target, which is effectively at this removal frame.
            this.runtime.signalHit();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(fadeChildSym);
    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: scripts/frame_1/DoAction.as
    // SOMA.playSound("grina_704");
    callbacks.playSound("grina_704");

    // Attach the main anim1 clip at the root so it starts ticking.
    // The outer DefineSprite_9 IS the anim1 symbol — it plays from
    // frame 1 and drives the whole spell.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
