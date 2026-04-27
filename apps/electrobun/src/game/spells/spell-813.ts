/**
 * Spell 813 — Vlad (unknown class, target-cell impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/813/scripts/scripts/
 *
 * displayType=11 (TargetCell). There are no library symbols, no attachMovie calls,
 * no projectile motion, no dual-anchored logic. The spell is a single flat
 * `anim1` animation played at the target cell. The DefineSprite_15 scripts
 * correspond to the main animation timeline:
 *
 *   - frame_7  (index 6):  SOMA.playSound("vlad_813")
 *   - frame_103 (index 102): SOMA.playSound("cc_lakam")  ← signalHit (first impact)
 *   - frame_115 (index 114): SOMA.playSound("cc_lakam")
 *   - frame_208 (index 207): stop()  ← spell complete
 *
 * Library symbols: none (librarySymbols[] is absent / empty in manifest).
 * Main timeline: single `anim1` animation, 210 frames, placed at target.
 *
 * Sound timing matches manifest sounds[] entries (frames 6, 102, 114 — 0-based).
 * signalHit fires at frame_103 (index 102) — the first "cc_lakam" hit sound,
 * which is the canonical impact moment.
 * complete() fires at frame_208 (index 207) — the stop() frame.
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

  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // anim1 — main impact animation, 210 frames at target cell.
    // No librarySymbols entry — uses the bare "anim1" texture key.
    // DefineSprite_15 frame scripts map directly onto this symbol's timeline.
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
            // AS: DefineSprite_15/frame_7/DoAction.as
            // SOMA.playSound("vlad_813");
            this.soundCallback?.("vlad_813");
          },
        ],
        [
          102,
          (_clip) => {
            // AS: DefineSprite_15/frame_103/DoAction.as
            // SOMA.playSound("cc_lakam");
            // This is the first impact frame — signal hit here.
            this.soundCallback?.("cc_lakam");
            this.runtime.signalHit();
          },
        ],
        [
          114,
          (_clip) => {
            // AS: DefineSprite_15/frame_115/DoAction.as
            // SOMA.playSound("cc_lakam");
            this.soundCallback?.("cc_lakam");
          },
        ],
        [
          207,
          (clip) => {
            // AS: DefineSprite_15/frame_208/DoAction.as
            // stop();
            // This is the canonical end of the animation — signal complete.
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
    // Capture sound callback so frame scripts inside anim1 can use it.
    this.soundCallback = callbacks.playSound;

    // Main timeline frame_1: attach anim1 at the root (target cell).
    // The harness has already positioned the root container at cellTo.
    this.root.attach(
      this.registry.resolve("anim1")!,
      "anim1",
      1,
      context,
    );
  }
}
