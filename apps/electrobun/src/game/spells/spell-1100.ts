/**
 * Spell 1100 — (Unknown, likely a dodge/evasion spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1100/scripts/scripts/
 *
 * displayType=11 (TargetCell). No library symbols are referenced via attachMovie;
 * the spell is a single authored animation (anim1, 84 frames) that plays at the
 * target cell. There are no move/shoot/duplicate symbols, no projectile motion,
 * and no caster-cell reference — the animation plays to completion at the target.
 *
 * Library symbols: none (librarySymbols[] is empty in the manifest).
 *
 * Canonical AS layout:
 *   - frame_1/DoAction.as: SOMA.playSound("lakam_402")
 *   - DefineSprite_15/frame_1/DoAction.as: SOMA.playSound("dodge_1100")
 *   - DefineSprite_15/frame_82/DoAction.as: _parent.removeMovieClip()
 *
 * DefineSprite_15 is the inner animated sprite (84-frame anim1 content).
 * Its frame_1 plays the dodge sound and its frame_82 removes the parent,
 * which signals spell completion.
 *
 * signalHit is fired at frame_1 of the inner sprite (the canonical impact
 * moment — when the dodge animation begins at the target).
 *
 * Main timeline: SOMA.playSound("lakam_402"); (no stop, plays through)
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
  width: 336.15,
  height: 312.15,
  offsetX: -174,
  offsetY: -410.15,
};

export class Spell1100 extends RuntimeSpell {
  readonly spellId = 1100;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // DefineSprite_15 — the inner 84-frame dodge animation.
    // frame_1/DoAction.as: SOMA.playSound("dodge_1100")
    // frame_82/DoAction.as: _parent.removeMovieClip()
    //
    // The manifest has no librarySymbols[] entries; the animation lives
    // in animations[0] ("anim1"). We register this as the symbol that
    // represents the whole visual content, attached by onSpellStart.
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 84,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_15/frame_1/DoAction.as
            // SOMA.playSound("dodge_1100") — sound is captured via
            // the callbacks reference stored in onSpellStart.
            this.runtime.signalHit();
            this.dodgeSoundCallback?.("dodge_1100");
          },
        ],
        [
          81,
          (clip) => {
            // AS DefineSprite_15/frame_82/DoAction.as
            // _parent.removeMovieClip() — removes the outer mc, ending the spell.
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(anim1Sym);
    this.anim1Sym = anim1Sym;
  }

  private anim1Sym!: SymbolDefinition;
  private dodgeSoundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS frame_1/DoAction.as: SOMA.playSound("lakam_402")
    callbacks.playSound("lakam_402");

    // Capture sound callback so frameScripts can play "dodge_1100"
    // when DefineSprite_15's frame_1 fires.
    this.dodgeSoundCallback = callbacks.playSound;

    // Attach the main animation at the root (target cell anchor).
    // This mirrors the implicit placement of DefineSprite_15 on the
    // main timeline frame_1 of the canonical SWF.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
