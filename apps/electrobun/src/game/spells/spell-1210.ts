/**
 * Spell 1210 — Vague de Panda (Pandawa).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1210/scripts/scripts/
 *
 * displayType=40 (BeamLine). The spell has a `duplicate` symbol (DefineSprite_18_duplicate)
 * that the harness drops periodically along the caster→target line. The `duplicate` symbol
 * is a 273-frame composite with authored SVG frames in animations[]. There is NO `shoot`
 * symbol, so this is a pure BeamLine (40) not BeamLineAlt (41).
 *
 * Library symbols (all sub-sprites are baked into the composite `duplicate` animation;
 * DefineSprite_5, _8, _14, _17 are internal sub-symbols whose frame_1 scripts just do
 * `gotoAndStop(random(2) + 2)` — these are authored children placed statically inside the
 * pre-rendered `duplicate` composite SVG frames. DefineSprite_10 is an internal rotation
 * randomizer. None of these are `attachMovie`'d by AS at runtime; they are authored
 * placements inside the duplicate sprite's timeline. The harness handles dropping the
 * `duplicate` clips along the beam line.
 *
 * The `duplicate` symbol itself (DefineSprite_18_duplicate) has three scripts:
 *   - frame_1:  if(abs(angle)>90) flip xscale; if(angle<0) gotoAndPlay(148)
 *   - frame_127: _parent.removeMovieClip() — end of the "positive angle" path
 *   - frame_271: _parent.removeMovieClip() — end of the "negative angle" path
 *
 * signalHit: fired by the harness (BeamLine, displayType 40) automatically when the last
 * duplicate has been dropped along the line.
 * complete(): fired from frame_127 or frame_271 of the final (longest-lived) duplicate clip,
 * whichever fires last. We fire it once idempotently from both.
 *
 * Main timeline: SOMA.playSound("panda_vague"); (no stop — the harness drives the beam).
 *
 * Animations:
 *   - duplicate (273 frames) — the beam segment visual. In animations[], NOT librarySymbols[].
 *     Use textures.getFrames("duplicate") (no lib_ prefix).
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

const DUPLICATE_BOUNDS = {
  width: 134.95,
  height: 119.8,
  offsetX: -58.7,
  offsetY: -57.35,
};

export class Spell1210 extends RuntimeSpell {
  readonly spellId = 1210;
  readonly displayType = SpellDisplayType.BeamLine;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const duplicateAnchor = calculateAnchor(DUPLICATE_BOUNDS);

    // ---- duplicate — beam segment visual (273-frame composite) ----
    // The harness (BeamLine/displayType 40) attaches instances of this
    // symbol periodically along the caster→target line. Each instance
    // must run the canonical frame_1, frame_127, and frame_271 scripts
    // from DefineSprite_18_duplicate.
    //
    // AS DefineSprite_18_duplicate/frame_1/DoAction.as:
    //   if(Math.abs(_parent.angle) > 90) { _xscale = -_xscale; }
    //   if(_parent.angle < 0) { gotoAndPlay(148); }
    //
    // AS DefineSprite_18_duplicate/frame_127/DoAction.as:
    //   _parent.removeMovieClip();
    //
    // AS DefineSprite_18_duplicate/frame_271/DoAction.as:
    //   _parent.removeMovieClip();
    const duplicateSym: SymbolDefinition = {
      name: "duplicate",
      totalFrames: 273,
      frames: textures.getFrames("duplicate"),
      anchorX: duplicateAnchor.x,
      anchorY: duplicateAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_18_duplicate/frame_1/DoAction.as
            // _parent.angle is stored in degrees on root.vars by the harness.
            const root = clip.parent;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            if (Math.abs(angleDeg) > 90) {
              clip.scaleX = -clip.scaleX;
            }
            if (angleDeg < 0) {
              // AS gotoAndPlay(148) → 0-based index 147
              clip.gotoAndPlay(147);
            }
          },
        ],
        [
          126,
          (clip) => {
            // AS DefineSprite_18_duplicate/frame_127/DoAction.as
            // _parent.removeMovieClip() — end of positive-angle play path.
            clip.remove();
            this.runtime.complete();
          },
        ],
        [
          270,
          (clip) => {
            // AS DefineSprite_18_duplicate/frame_271/DoAction.as
            // _parent.removeMovieClip() — end of negative-angle play path.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(duplicateSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("panda_vague");
    callbacks.playSound("panda_vague");
  }
}
