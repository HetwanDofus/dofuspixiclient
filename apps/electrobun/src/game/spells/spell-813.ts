/**
 * Spell 813 — (Vladala / Sacrieur spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/813/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no library symbols, no
 * projectile motion, no duplicate/beam logic — just a single authored
 * 210-frame timeline (anim1) that plays at the target cell. The AS
 * scripts are frame actions inside DefineSprite_15 (the main animation
 * sprite):
 *
 *   - frame_7  (index 6):  SOMA.playSound("vlad_813")
 *   - frame_103 (index 102): SOMA.playSound("cc_lakam")
 *   - frame_115 (index 114): SOMA.playSound("cc_lakam")
 *   - frame_208 (index 207): stop()
 *
 * There are no librarySymbols — the entire spell is a single flat
 * timeline rendered as the "anim1" animation. We register "anim1" as
 * the sole symbol and drive frame scripts from it, playing sounds via a
 * stored callback reference and calling complete() after the stop()
 * frame has been reached.
 *
 * signalHit is fired at the canonical first impact sound (frame_7,
 * index 6) — the earliest moment the spell "lands" on the target.
 *
 * Main timeline: sound at frame 7, sounds at 103+115, stop at 208.
 * No librarySymbols. No attachMovie calls.
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
  width: 177.9,
  height: 269.6,
  offsetX: -82.15,
  offsetY: -206.45,
};

export class Spell813 extends RuntimeSpell {
  readonly spellId = 813;
  readonly displayType = SpellDisplayType.TargetCell;

  private playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 210-frame target-cell timeline ------------------
    // AS DefineSprite_15 carries frame actions at frames 7, 103, 115, 208.
    // No library symbols or clipEvents — pure authored timeline content.
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 210,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          6,
          (_clip) => {
            // AS DefineSprite_15/frame_7/DoAction.as
            // SOMA.playSound("vlad_813");
            // Also canonical first-contact frame → signalHit.
            this.playSound?.("vlad_813");
            this.runtime.signalHit();
          },
        ],
        [
          102,
          (_clip) => {
            // AS DefineSprite_15/frame_103/DoAction.as
            // SOMA.playSound("cc_lakam");
            this.playSound?.("cc_lakam");
          },
        ],
        [
          114,
          (_clip) => {
            // AS DefineSprite_15/frame_115/DoAction.as
            // SOMA.playSound("cc_lakam");
            this.playSound?.("cc_lakam");
          },
        ],
        [
          207,
          (clip) => {
            // AS DefineSprite_15/frame_208/DoAction.as
            // stop();
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
    // Store sound callback so frame scripts can call it.
    this.playSound = callbacks.playSound;

    // Attach the main anim1 timeline at root so it starts ticking.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
