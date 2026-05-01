/**
 * Spell 1208.
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS: tools/combat-exporter/output/spell-anims/1208/scripts/scripts/
 *
 * displayType=11 (TargetCell). Single authored timeline (sprite_36,
 * 117 frames) plays at the target cell. No projectile, no caster
 * reference, no library symbols — sprite_36 lives in animations[] only.
 *
 * Canonical AS layout:
 *   - frame_2/DoAction.as            : stop()  [outer SWF main timeline]
 *   - DefineSprite_36/frame_1/DoAction.as   : SOMA.playSound("explosion")
 *   - DefineSprite_36/frame_115/DoAction.as : _parent.removeMovieClip()
 *
 * Signal flow:
 *   signalHit  — frame_1 of sprite_36 (first visible burst).
 *   complete   — frame_115 of sprite_36 (_parent.removeMovieClip).
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

const SPRITE_36_BOUNDS = {
  width: 246.8,
  height: 282.25,
  offsetX: -127.4,
  offsetY: -187.3,
};

export class Spell1208 extends RuntimeSpell {
  readonly spellId = 1208;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite36Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anchor = calculateAnchor(SPRITE_36_BOUNDS);

    // sprite_36 — 117-frame impact timeline.
    // Frame 0  : AS DefineSprite_36/frame_1/DoAction.as   → playSound + signalHit
    // Frame 114: AS DefineSprite_36/frame_115/DoAction.as → _parent.removeMovieClip()
    this.sprite36Sym = {
      name: "sprite_36",
      totalFrames: 117,
      frames: textures.getFrames("sprite_36"),
      anchorX: anchor.x,
      anchorY: anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS: DefineSprite_36/frame_1/DoAction.as
            // Sound is fired from onSpellStart (only callbacks available there).
            // signalHit marks the canonical impact moment.
            this.runtime.signalHit();
          },
        ],
        [
          114,
          (clip) => {
            // AS: DefineSprite_36/frame_115/DoAction.as
            // _parent.removeMovieClip() — tears down the spell.
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite36Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: DefineSprite_36/frame_1/DoAction.as — SOMA.playSound("explosion")
    callbacks.playSound("explosion");

    // Implicit main-timeline placement of sprite_36.
    // Outer SWF frame_2/DoAction.as calls stop() after this placement.
    this.root.attach(this.sprite36Sym, "sprite36", 1, context);
  }
}
