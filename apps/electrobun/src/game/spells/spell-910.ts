/**
 * Spell 910 — Flèche de Feu (Cra fire arrow impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/910/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single `shoot` symbol
 * with a fully authored 84-frame SVG timeline anchored at the target
 * cell. No library symbols are attached at runtime — the `shoot`
 * timeline is the entire visual. No projectile motion, no particles.
 *
 * Canonical AS layout:
 *   - DefineSprite_15_shoot/frame_1/DoAction.as:
 *       SOMA.playSound("explosion");
 *   - DefineSprite_15_shoot/frame_1/DoAction_2.as:
 *       _rotation = 0;
 *   - DefineSprite_15_shoot/frame_70/DoAction.as:
 *       _parent.removeMovieClip(); stop();
 *
 * The harness (displayType=11) attaches `shoot` at the target cell.
 * shoot's frame_1 plays the explosion sound and resets rotation to 0.
 * At frame_70 the outer mc is removed and the spell completes.
 *
 * signalHit is fired at frame_1 (impact frame — the first visible
 * explosion frame), which is canonical for TargetCell impact spells.
 *
 * Library symbols: none (shoot has authored SVG frames, no runtime
 * attachMovie calls).
 *
 * Main timeline: no explicit frame_1 DoAction on the outer timeline;
 * sound is fired from inside shoot's frame_1. No onSpellStart override
 * needed beyond the default no-op.
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
  width: 205.1,
  height: 133.45,
  offsetX: -102.5,
  offsetY: -71.85,
};

export class Spell910 extends RuntimeSpell {
  readonly spellId = 910;
  readonly displayType = SpellDisplayType.TargetCell;

  private playExplosionSound?: () => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot — 84-frame impact explosion at target cell --------
    // The harness attaches this symbol at the target cell automatically
    // for displayType=11 (TargetCell). The symbol's frame_1 scripts
    // fire immediately on attach.
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 84,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_15_shoot/frame_1/DoAction.as
            // SOMA.playSound("explosion");
            if (this.playExplosionSound) {
              this.playExplosionSound();
            }
            // AS: DefineSprite_15_shoot/frame_1/DoAction_2.as
            // _rotation = 0;
            clip.rotation = 0;
            // Signal hit at the impact frame (canonical for TargetCell
            // impact spells — damage popup fires when explosion begins).
            this.runtime.signalHit();
          },
        ],
        [
          69,
          (clip) => {
            // AS: DefineSprite_15_shoot/frame_70/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.parent?.remove();
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // Capture the sound callback so it can be invoked from shoot's
    // frame_1 script (where the canonical SOMA.playSound("explosion")
    // fires). The harness will attach `shoot` after onSpellStart
    // returns, so the sound fires on the first tick.
    this.playExplosionSound = () => {
      callbacks.playSound("explosion");
    };
  }
}
