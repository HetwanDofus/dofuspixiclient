/**
 * Spell 2009.
 *
 * Ported to the SpellClip / SpellRuntime composition layer.
 * Canonical AS: tools/combat-exporter/output/spell-anims/2009/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear).
 * The spell has a single `shoot` symbol, no `move`, no `duplicate`.
 * The harness rotates the container to face the target and attaches
 * `shoot` at the target-relative offset. The _rotation = 0 in shoot
 * frame_1 resets that rotation so the explosion renders upright.
 *
 * Symbols:
 *   - shoot — 84-frame explosion at target (animations[] only, bare key).
 *     frame_1:  _rotation = 0.
 *     frame_7:  SOMA.playSound("explosion") + signalHit.
 *     frame_70: _parent.removeMovieClip() → complete.
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
  width: 204.8,
  height: 129.6,
  offsetX: -102.35,
  offsetY: -68.1,
};

export class Spell2009 extends RuntimeSpell {
  readonly spellId = 2009;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // shoot is in animations[] only — use bare key, no lib_ prefix.
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
            // DefineSprite_18_shoot/frame_1/DoAction.as
            // _rotation = 0;
            clip.rotation = 0;
          },
        ],
        [
          6,
          () => {
            // DefineSprite_18_shoot/frame_7/DoAction.as
            // SOMA.playSound("explosion");
            this.runtime.signalHit();
          },
        ],
        [
          69,
          (clip) => {
            // DefineSprite_18_shoot/frame_70/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // No top-level sound or child attaches on the main timeline.
    // The harness handles attaching shoot for ProjectileLinear.
  }
}
