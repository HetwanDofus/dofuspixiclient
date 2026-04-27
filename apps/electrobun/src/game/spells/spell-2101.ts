/**
 * Spell 2101 — (Unknown name, likely a fire/explosion spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2101/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single `shoot` symbol
 * attached at the target cell. There is no `move` symbol, no caster-
 * anchored content, no `duplicate` symbol, and no `_parent.cellFrom`
 * references. The harness for ProjectileBallistic expects a `move`
 * symbol — none exists here — so this is a plain impact at target.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 *
 * The `animations[]` list contains a single entry `"shoot"` (84 frames).
 * The harness for displayType=11 places the root at the target cell;
 * `onSpellStart` attaches the `shoot` symbol at depth 1.
 *
 * `shoot` symbol (84 frames, DefineSprite_20_shoot):
 *   frame_1: _rotation = 0; SOMA.playSound("flamme_2022"); SOMA.playSound("pet");
 *   frame_70: _parent.removeMovieClip(); stop(); → signalHit + complete.
 *
 * Note: DoAction_2 files mirror DoAction exactly for both frames; they
 * appear to be duplicates from the exporter and carry no additional logic.
 *
 * Main timeline: no explicit sounds — sounds are fired from shoot/frame_1.
 * onSpellStart attaches the `shoot` symbol.
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

const SHOOT_BOUNDS = {
  width: 235.7,
  height: 236,
  offsetX: -133.25,
  offsetY: -152.75,
};

export class Spell2101 extends RuntimeSpell {
  readonly spellId = 2101;
  readonly displayType = SpellDisplayType.TargetCell;

  private shootSym!: SymbolDefinition;
  private spellCallbacks?: SpellCallbacks;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot — 84-frame fire/explosion impact at target --------
    // AS: DefineSprite_20_shoot/frame_1/DoAction.as
    //   _rotation = 0;
    //   SOMA.playSound("flamme_2022");
    //   SOMA.playSound("pet");
    // AS: DefineSprite_20_shoot/frame_70/DoAction.as
    //   _parent.removeMovieClip();
    //   stop();
    this.shootSym = {
      name: "shoot",
      totalFrames: 84,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_20_shoot/frame_1/DoAction.as
            // _rotation = 0  (already default, but canonical AS sets it explicitly)
            clip.rotation = 0;
            // Sounds are fired here in canonical AS; we use the stored
            // callbacks reference captured in onSpellStart.
            this.spellCallbacks?.playSound("flamme_2022");
            this.spellCallbacks?.playSound("pet");
          },
        ],
        [
          69,
          (clip) => {
            // AS DefineSprite_20_shoot/frame_70/DoAction.as
            // _parent.removeMovieClip(); stop();
            // signalHit at the impact/completion frame (displayType 11 —
            // harness does NOT auto-signal hit).
            this.runtime.signalHit();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Store callbacks so the shoot frame_1 script can fire sounds.
    this.spellCallbacks = callbacks;

    // Attach the shoot symbol at the root (target cell origin for
    // displayType=11). The harness has already placed root at the
    // target cell; shoot lives at local (0, 0).
    this.root.attach(this.shootSym, "shoot", 1, context);
  }
}
