/**
 * Spell 506 — (Wabbit-type spell, likely a Cra or similar class spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/506/scripts/scripts/
 *
 * This spell uses a single authored animation (anim1, 219 frames) with no
 * library symbols and no attachMovie calls. The main sprite (DefineSprite_9)
 * has three frame scripts:
 *   - frame_1  (index 0):  SOMA.playSound("many_503")
 *   - frame_19 (index 18): SOMA.playSound("cc_wabbit")
 *   - frame_196 (index 195): this.end() → signalHit; stop()
 *
 * displayType=11 (TargetCell): single impact at target cell, no projectile,
 * no caster reference, no library symbols, no attachMovie. The animation
 * plays entirely at the target cell.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 *
 * Main timeline: single anim1 symbol placed at root, driven by its own
 * frame scripts for sounds and completion.
 *
 * Sound schedule (from manifest + AS):
 *   frame 0  → "many_503"
 *   frame 18 → "cc_wabbit"
 *   frame 195 → signalHit + stop
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
  width: 118.1,
  height: 130.5,
  offsetX: -56.95,
  offsetY: -74.75,
};

export class Spell506 extends RuntimeSpell {
  readonly spellId = 506;
  readonly displayType = SpellDisplayType.TargetCell;

  private soundCallbacks?: SpellCallbacks;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — main impact animation (219 frames) --------------
    // AS DefineSprite_9 scripts:
    //   frame_1/DoAction.as:   SOMA.playSound("many_503");
    //   frame_19/DoAction.as:  SOMA.playSound("cc_wabbit");
    //   frame_196/DoAction.as: this.end(); stop();
    //
    // The sound on frame_1 is played from onSpellStart (before the
    // first tick). Subsequent sounds are fired from frameScripts.
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 219,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          18,
          (_clip, _ctx) => {
            // AS DefineSprite_9/frame_19/DoAction.as
            // SOMA.playSound("cc_wabbit");
            this.soundCallbacks?.playSound("cc_wabbit");
          },
        ],
        [
          195,
          (clip, _ctx) => {
            // AS DefineSprite_9/frame_196/DoAction.as
            // this.end(); stop();
            this.runtime.signalHit();
            clip.stop();
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
    // Store callbacks so frame scripts can fire sounds later.
    this.soundCallbacks = callbacks;

    // AS DefineSprite_9/frame_1/DoAction.as: SOMA.playSound("many_503");
    callbacks.playSound("many_503");

    // Attach the main animation at root so it starts ticking from
    // the next runtime frame.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
