/**
 * Spell 2019 — (Grass/Nature spell, likely Osamodas or Sadida class).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2019/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic).
 * The manifest exposes `move` (4-frame animated projectile) and `shoot`
 * (108-frame impact animation). The AS structure confirms the ballistic
 * pattern: `DefineSprite_15_shoot` (the shoot symbol) has frame_4 resetting
 * `_rotation = 0` — the canonical "upright impact" override seen in spell-103.
 * frame_106 calls `_parent.removeMovieClip()` to end the spell.
 *
 * The harness automatically:
 *   - attaches `move` at root, drives parabolic arc toward target
 *   - on landing, removes `move`, attaches `shoot` at target offset, calls signalHit()
 *
 * Additional symbols registered:
 *   - DefineSprite_15_shoot — 108-frame impact animation. frame_4 resets
 *     rotation to 0 (canonical AS: `_rotation = 0`). frame_106 removes
 *     parent + completes spell.
 *   - DefineSprite_8 — a grass/particle sub-symbol used inside shoot.
 *     frame_1: random 20% chance to gotoAndStop(60), else stay at frame 1.
 *     frame_34: stop().
 *   - DefineSprite_14 — a long (295-frame) composite sub-symbol used
 *     inside shoot. frame_295: stop().
 *   - DefineSprite_12 — a looping sub-symbol used inside shoot.
 *     frame_1: gotoAndPlay(random(30)+1), set alpha, t, xscale, yscale.
 *     frame_97: stop().
 *   - move — 4-frame animated projectile (grass tuft in flight). The harness
 *     drives its position along the arc; we register it with frame textures.
 *
 * Main timeline: SOMA.playSound("herbe"); (frame_1/DoAction.as)
 *
 * NOTE: DefineSprite_8, DefineSprite_14, DefineSprite_12 are sub-symbols
 * that are placed inside DefineSprite_15_shoot's composite timeline. Since
 * the manifest marks shoot as `isComposite: true`, these sub-symbols'
 * visuals are baked into shoot's SVG frames. However, the frame scripts
 * on shoot itself (frame_4 rotation reset, frame_106 removal) must be
 * ported as runtime handlers. The sub-symbol frame scripts only matter if
 * they are attached via `attachMovie` at runtime — examining the AS files,
 * they do not appear to be attached dynamically via attachMovie calls in the
 * provided scripts; they are placed on the authored timeline. Therefore we
 * register shoot as a single animated symbol with its frame textures and
 * the two canonical frame scripts.
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
  width: 63.6,
  height: 30.2,
  offsetX: -31.8,
  offsetY: -14.75,
};

const MOVE_BOUNDS = {
  width: 15.5,
  height: 5.3,
  offsetX: -9.7,
  offsetY: -2.7,
};

export class Spell2019 extends RuntimeSpell {
  readonly spellId = 2019;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);
    const moveAnchor = calculateAnchor(MOVE_BOUNDS);

    // ---- shoot — 108-frame impact animation at target ------------
    // AS: DefineSprite_15_shoot
    //
    // frame_4/DoAction.as:
    //   _rotation = 0;
    //   Resets the projectile-velocity angle that the harness applied
    //   when attaching shoot, so the impact stands upright regardless
    //   of arc angle.
    //
    // frame_106/DoAction.as:
    //   _parent.removeMovieClip();
    //   stop();
    //   Removes the outer mc and signals spell completion.
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 108,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          3,
          (clip) => {
            // AS: DefineSprite_15_shoot/frame_4/DoAction.as
            // _rotation = 0;
            clip.rotation = 0;
          },
        ],
        [
          105,
          (clip) => {
            // AS: DefineSprite_15_shoot/frame_106/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- move — 4-frame animated projectile (grass tuft in flight) --
    // AS: The `move` symbol is driven by the harness along the ballistic
    // arc. It has 4 authored frames of animation (the grass clump spinning
    // through the air). No frame scripts in the provided AS files for move
    // itself — the harness attaches it and drives its position each tick.
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 4,
      frames: textures.getFrames("move"),
      anchorX: moveAnchor.x,
      anchorY: moveAnchor.y,
    };

    this.registry.register(shootSym);
    this.registry.register(moveSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // AS: scripts/frame_1/DoAction.as
    // SOMA.playSound("herbe");
    callbacks.playSound("herbe");
  }
}
