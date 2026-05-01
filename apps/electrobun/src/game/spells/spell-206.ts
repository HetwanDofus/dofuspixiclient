/**
 * Spell 206 — Croque-mitaine (Sram/Croque-mitaine dodge spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 *
 * Canonical AS source:
 *   tools/combat-exporter/output/spell-anims/206/scripts/scripts/
 *
 * Structure:
 *   - Single animation `anim1` (216 frames, no librarySymbols).
 *   - DefineSprite_24 is the sole authored sprite, mapped to `anim1`.
 *   - Frame scripts on DefineSprite_24:
 *       frame_1   (index 0):   SOMA.playSound("dodge_607c")
 *       frame_70  (index 69):  SOMA.playSound("crockette_206")
 *       frame_79  (index 78):  SOMA.playSound("herbe")
 *       frame_100 (index 99):  this.end()  → signalHit
 *       frame_157 (index 156): SOMA.playSound("dodge_607")
 *       frame_214 (index 213): _parent.removeMovieClip() → complete
 *
 * displayType = TargetCell (11):
 *   No `move`, `shoot`, `duplicate`, or dual-anchor patterns.
 *   No caster references. Single impact animation plays at the target
 *   cell. This is the standard single-timeline impact pattern.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 *   `anim1` is the only animation. It is registered as a plain
 *   SymbolDefinition using `textures.getFrames("anim1")` (no lib_
 *   prefix) and attached from onSpellStart. The frame scripts port
 *   all six DoAction.as files 1:1.
 *
 * Sounds are played from within frameScripts by capturing the
 * callbacks reference in onSpellStart.
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
  width: 50.2,
  height: 389.25,
  offsetX: -25.8,
  offsetY: -214.5,
};

export class Spell206 extends RuntimeSpell {
  readonly spellId = 206;
  readonly displayType = SpellDisplayType.TargetCell;

  private playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — main 216-frame impact timeline ------------------
    // Canonical sprite: DefineSprite_24 mapped to anim1.
    // Sounds are played via the captured callbacks.playSound reference
    // stored in this.playSound during onSpellStart.
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 216,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_24/frame_1/DoAction.as
            // SOMA.playSound("dodge_607c");
            this.playSound?.("dodge_607c");
          },
        ],
        [
          69,
          (_clip) => {
            // AS DefineSprite_24/frame_70/DoAction.as
            // SOMA.playSound("crockette_206");
            this.playSound?.("crockette_206");
          },
        ],
        [
          78,
          (_clip) => {
            // AS DefineSprite_24/frame_79/DoAction.as
            // SOMA.playSound("herbe");
            this.playSound?.("herbe");
          },
        ],
        [
          99,
          (_clip) => {
            // AS DefineSprite_24/frame_100/DoAction.as
            // this.end(); → signal hit (damage popup at target)
            this.runtime.signalHit();
          },
        ],
        [
          156,
          (_clip) => {
            // AS DefineSprite_24/frame_157/DoAction.as
            // SOMA.playSound("dodge_607");
            this.playSound?.("dodge_607");
          },
        ],
        [
          213,
          (clip) => {
            // AS DefineSprite_24/frame_214/DoAction.as
            // _parent.removeMovieClip(); → spell complete
            clip.remove();
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
    // Capture callbacks.playSound so frameScripts can use it.
    this.playSound = callbacks.playSound;

    // Attach the main timeline sprite at depth 1 on the root.
    // The harness has positioned root at the target cell (TargetCell).
    // frame_1 (index 0) fires immediately upon attach and plays the
    // entry sound "dodge_607c".
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
