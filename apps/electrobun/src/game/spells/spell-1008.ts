/**
 * Spell 1008 — Licorne (Osamodas licorn attack).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1008/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile, no caster-side
 * content, no dual-anchor layout. The entire animation plays at the target
 * cell. There is a single composite animation (anim1, 312 frames) with no
 * librarySymbols entries — all rendering is driven by the bare "anim1"
 * timeline.
 *
 * The canonical outer sprite is DefineSprite_90 (312 frames). Its key frames:
 *   - frame_49  (index 48): playSound("licrounch_1008")
 *   - frame_79  (index 78): playSound("licrounch_1008b")
 *   - frame_88  (index 87): playSound("licrounch_1008b")
 *   - frame_154 (index 153): playSound("licrounch_1008b")
 *   - frame_163 (index 162): playSound("licrounch_1008b")
 *   - frame_229 (index 228): playSound("licrounch_1008b")
 *   - frame_238 (index 237): playSound("licrounch_1008b")
 *   - frame_250 (index 249): playSound("licrounch_1008b") + this.end() → signalHit
 *   - frame_310 (index 309): _parent.removeMovieClip() + stop() → complete
 *
 * Main timeline: no explicit SOMA.playSound — sounds are driven from within
 * DefineSprite_90's frame scripts. onSpellStart attaches the anim1 clip.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 * The single "anim1" animation provides all 312 frames of visual content.
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
  width: 79.65,
  height: 375.75,
  offsetX: -36.1,
  offsetY: -358.4,
};

export class Spell1008 extends RuntimeSpell {
  readonly spellId = 1008;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — main composite animation (312 frames) ----------
    // Corresponds to DefineSprite_90 in the canonical AS.
    // All sound cues and lifecycle signals are driven from frame scripts
    // inside this symbol.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 312,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          48,
          (_clip) => {
            // AS DefineSprite_90/frame_49/DoAction.as
            // SOMA.playSound("licrounch_1008");
            this.soundCallback?.("licrounch_1008");
          },
        ],
        [
          78,
          (_clip) => {
            // AS DefineSprite_90/frame_79/DoAction.as
            // SOMA.playSound("licrounch_1008b");
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          87,
          (_clip) => {
            // AS DefineSprite_90/frame_88/DoAction.as
            // SOMA.playSound("licrounch_1008b");
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          153,
          (_clip) => {
            // AS DefineSprite_90/frame_154/DoAction.as
            // SOMA.playSound("licrounch_1008b");
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          162,
          (_clip) => {
            // AS DefineSprite_90/frame_163/DoAction.as
            // SOMA.playSound("licrounch_1008b");
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          228,
          (_clip) => {
            // AS DefineSprite_90/frame_229/DoAction.as
            // SOMA.playSound("licrounch_1008b");
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          237,
          (_clip) => {
            // AS DefineSprite_90/frame_238/DoAction.as
            // SOMA.playSound("licrounch_1008b");
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          249,
          (_clip) => {
            // AS DefineSprite_90/frame_250/DoAction.as + DoAction_2.as
            // SOMA.playSound("licrounch_1008b");
            // this.end();  → signalHit (damage popup at target)
            this.soundCallback?.("licrounch_1008b");
            this.runtime.signalHit();
          },
        ],
        [
          309,
          (clip) => {
            // AS DefineSprite_90/frame_310/DoAction.as
            // _parent.removeMovieClip();
            // stop();
            clip.stop();
            clip.parent?.remove();
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
    // Capture the sound callback so frame scripts inside anim1 can use it.
    this.soundCallback = callbacks.playSound;

    // Attach anim1 at the root (target cell). The harness has already
    // positioned the root container at the target cell for displayType=11.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
