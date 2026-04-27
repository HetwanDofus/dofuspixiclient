/**
 * Spell 2062 — Unknown (simple impact animation).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2062/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no library symbols, no
 * projectile, no caster reference — a single authored animation (`anim1`,
 * 21 frames) plays at the target cell. The only script is
 * DefineSprite_2/frame_19/DoAction.as which calls
 * `_parent.removeMovieClip(); stop();` — i.e. removes the outer mc and
 * ends the spell at frame 19 (0-based: 18).
 *
 * There are no `librarySymbols[]` entries in the manifest; `anim1` is the
 * sole `animations[]` entry and drives all rendering.
 *
 * Library symbols: none (no attachMovie calls anywhere in the AS).
 *
 * Main timeline: no explicit frame_1 script — no sound, no child attaches
 * beyond the implicit placement of anim1 on the timeline.
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
  width: 235.05,
  height: 123.5,
  offsetX: -118.3,
  offsetY: -61.65,
};

export class Spell2062 extends RuntimeSpell {
  readonly spellId = 2062;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // anim1 is the sole animation — no lib_ prefix because it lives in
    // animations[] only, not librarySymbols[].
    //
    // AS DefineSprite_2/frame_19/DoAction.as:
    //   _parent.removeMovieClip();
    //   stop();
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 21,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          18,
          (clip) => {
            // AS DefineSprite_2/frame_19/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            // frame_19 → index 18 (0-based).
            // Signals hit at the impact frame (displayType 11, not
            // ballistic, so we must call signalHit ourselves).
            this.runtime.signalHit();
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
    // No SOMA.playSound in the canonical main timeline for this spell.
    // Attach anim1 at root so it starts playing from frame 1.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
