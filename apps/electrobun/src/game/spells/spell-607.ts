/**
 * Spell 607 — Dodge (Sacrieur or similar class).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/607/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has a single authored animation
 * (`anim1`, 126 frames) placed at the target cell. There are no library
 * symbols, no `attachMovie` calls, no projectile motion — just a flat
 * timeline driving an impact animation with three sound cues and a final
 * removal. DisplayType TargetCell is the correct choice: single impact at
 * target cell, no projectile, no caster reference.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 *
 * Main timeline (DefineSprite_11):
 *   - frame_1   (index 0):   SOMA.playSound("dodge_607")
 *   - frame_55  (index 54):  SOMA.playSound("dodge_607b")
 *   - frame_103 (index 102): SOMA.playSound("dodge_607c")
 *   - frame_124 (index 123): _parent.removeMovieClip() → spell complete
 *
 * The manifest's `sounds[]` array confirms these three sound frames.
 * signalHit is fired at frame_55 (the second sound cue marks the impact).
 *
 * Texture key: "anim1" (bare name, NOT "lib_anim1" — this entry lives in
 * animations[], not librarySymbols[]).
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
  width: 55.2,
  height: 36.15,
  offsetX: -20.55,
  offsetY: -70.05,
};

export class Spell607 extends RuntimeSpell {
  readonly spellId = 607;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;
  private soundCallbacks?: SpellCallbacks;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 126-frame impact animation at target cell -------
    // This is the sole authored timeline. The AS scripts belong to
    // DefineSprite_11 which wraps this animation. Frame scripts port
    // all DoAction.as entries 1:1.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 126,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_11/frame_1/DoAction.as
            // SOMA.playSound("dodge_607");
            this.soundCallbacks?.playSound("dodge_607");
          },
        ],
        [
          54,
          (_clip) => {
            // AS DefineSprite_11/frame_55/DoAction.as
            // SOMA.playSound("dodge_607b");
            this.soundCallbacks?.playSound("dodge_607b");
            // Frame 55 is the midpoint impact cue — signal hit here.
            this.runtime.signalHit();
          },
        ],
        [
          102,
          (_clip) => {
            // AS DefineSprite_11/frame_103/DoAction.as
            // SOMA.playSound("dodge_607c");
            this.soundCallbacks?.playSound("dodge_607c");
          },
        ],
        [
          123,
          (clip) => {
            // AS DefineSprite_11/frame_124/DoAction.as
            // _parent.removeMovieClip();
            clip.remove();
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
    // Capture callbacks so frame scripts can play sounds at runtime.
    this.soundCallbacks = callbacks;

    // Attach the main animation clip at the root so it starts ticking.
    // In canonical AS, DefineSprite_11 is placed on the main timeline
    // at frame_1 — we mirror that here.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
