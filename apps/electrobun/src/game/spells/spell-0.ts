/**
 * Spell 0 — Generic Impact (default spell / placeholder).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 *
 * Canonical AS source: tools/combat-exporter/output/spell-anims/0/scripts/scripts/
 *
 * This spell has a single animation symbol "anim1" (94 frames, no librarySymbols).
 * The manifest lists no librarySymbols and no attachMovie calls — only a single
 * DefineSprite_15 with two frame scripts:
 *
 *   - frame_1/DoAction.as:  SOMA.playSound("gonfle")
 *   - frame_93/DoAction.as: stop(); _parent.removeMovieClip();
 *
 * displayType=11 (TargetCell): single impact at target cell, no projectile,
 * no caster reference, no move/shoot/duplicate symbols. The animation plays
 * at the target and signals completion at frame 93.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 *
 * Main timeline: plays "gonfle" sound on entry, runs 94-frame anim1 composite,
 * stops and removes at frame 93 (0-based: 92).
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
  height: 340.95,
  offsetX: -174,
  offsetY: -278.25,
};

export class Spell0 extends RuntimeSpell {
  readonly spellId = 0;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 94-frame composite impact animation ----------------
    // AS DefineSprite_15/frame_1/DoAction.as:  SOMA.playSound("gonfle")
    // AS DefineSprite_15/frame_93/DoAction.as: stop(); _parent.removeMovieClip();
    //
    // Note: sound is played from onSpellStart (main timeline frame_1 equivalent).
    // The symbol's frame_1 script in the canonical SWF fires the sound; we mirror
    // that in onSpellStart. Frame 93 (0-based: 92) stops the clip and removes the
    // outer mc, signalling completion.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 94,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_15/frame_1/DoAction.as: SOMA.playSound("gonfle")
            // Sound is fired from onSpellStart; nothing else needed here.
          },
        ],
        [
          92,
          (clip) => {
            // AS DefineSprite_15/frame_93/DoAction.as: stop(); _parent.removeMovieClip();
            clip.stop();
            this.runtime.signalHit();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS DefineSprite_15/frame_1/DoAction.as: SOMA.playSound("gonfle");
    callbacks.playSound("gonfle");

    // Attach the main animation at the root so it begins ticking.
    // For TargetCell displayType the root is already anchored at the target cell.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
