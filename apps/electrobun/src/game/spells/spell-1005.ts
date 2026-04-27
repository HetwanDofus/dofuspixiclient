/**
 * Spell 1005 — Crockette (unknown class, target-cell impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1005/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no `move`/`shoot`/`duplicate` symbol,
 * no caster-reference, no dual-anchor logic. The spell is a single animated
 * composite (`anim1`) placed at the target cell. No `librarySymbols[]` in the
 * manifest — only `animations: [{name: "anim1", ...}]`. The content is driven
 * by two nested DefineSprite symbols:
 *
 *   - DefineSprite_23 — individual particle/sub-anim (156 frames):
 *       frame_1:  gotoAndPlay(random(90) + 2); set t, _alpha, _xscale, _yscale.
 *       frame_91: SOMA.playSound("crockette_1005").
 *       frame_148: stop().
 *
 *   - DefineSprite_24 — outer composite container (154+ frames):
 *       frame_100: this.end() → signalHit.
 *       frame_154: _parent.removeMovieClip(); stop() → complete.
 *
 * Because the manifest has no `librarySymbols[]`, the entire animation is a
 * single pre-composited `anim1` timeline. Both DefineSprite_23 and
 * DefineSprite_24 are internal to `anim1`; the exporter bakes them into the
 * per-frame SVGs. We model the outer container as a single `SymbolDefinition`
 * named `"anim1"` with the appropriate frame scripts for signalHit (frame 99,
 * 0-based = AS frame_100) and complete (frame 153, 0-based = AS frame_154).
 *
 * The sound at frame_91 of DefineSprite_23 is played by the AS engine as the
 * particle sub-anim advances; since the exporter marks it on the manifest at
 * frame 90 (0-based), we honour it from the main `anim1` frameScripts at
 * frame 89 (0-based = AS frame_90, which is the frame the combat-exporter
 * tagged). We play it once via a captured callbacks reference.
 *
 * Library symbols: none (manifest `librarySymbols` is absent / empty).
 * Main timeline: attach `anim1` at root, play through.
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
  width: 266.6,
  height: 268.05,
  offsetX: -133.85,
  offsetY: -162,
};

export class Spell1005 extends RuntimeSpell {
  readonly spellId = 1005;
  readonly displayType = SpellDisplayType.TargetCell;

  private playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — full composite animation at target cell ---------
    // Outer container: DefineSprite_24 (154 frames) which internally
    // contains DefineSprite_23 particles. The exporter bakes the whole
    // tree into per-frame SVGs so we treat this as one timeline.
    //
    // Key frame scripts (all 0-based):
    //   frame 89  (AS frame_90)  : sound tagged by manifest at frame 90
    //   frame 99  (AS frame_100) : this.end() → signalHit
    //   frame 153 (AS frame_154) : _parent.removeMovieClip() → complete
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 156,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          89,
          (_clip) => {
            // AS DefineSprite_23/frame_91/DoAction.as (manifest sound tag frame 90)
            // SOMA.playSound("crockette_1005");
            this.playSound?.("crockette_1005");
          },
        ],
        [
          99,
          (_clip) => {
            // AS DefineSprite_24/frame_100/DoAction.as
            // this.end(); → damage popup signal
            this.runtime.signalHit();
          },
        ],
        [
          153,
          (clip) => {
            // AS DefineSprite_24/frame_154/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture playSound for use in frame scripts (sounds emitted mid-timeline).
    this.playSound = callbacks.playSound;

    // Main timeline frame_1: attach the composite anim1 at root.
    // displayType=11 (TargetCell) — container is already positioned at
    // the target cell by the harness/spell-view; anim1 renders at (0,0)
    // relative to that anchor.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
