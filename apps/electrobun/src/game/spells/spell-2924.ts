/**
 * Spell 2924 — (Boss Rat de Braquemart / Grina / Vlad composite attack).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2924/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no library symbols, no
 * `attachMovie` calls, no projectile motion, and no `move`/`shoot`/`duplicate`
 * symbols. The entire visual is a single authored composite animation (`anim1`,
 * 1021 frames) placed at the target cell. There is one inner sprite
 * (DefineSprite_225, 1021 frames) that drives all timeline sounds and the
 * final `stop(); _parent.removeMovieClip()` at frame 1017, and an outer
 * container (DefineSprite_224) whose frame_240 just calls `stop()` — this
 * outer stop does not affect completion (the inner sprite's frame 1017
 * drives it).
 *
 * librarySymbols: [] — no library symbols; no `lib_` prefix needed anywhere.
 *
 * Main timeline: single `anim1` animation in `animations[]`. The harness
 * places the container at the target cell (TargetCell). We attach `anim1`
 * as a child of root in `onSpellStart`, giving it all its frame scripts
 * (sound playbacks + the final removal/completion script).
 *
 * signalHit: fired at the first meaningful impact sound group, frame 319
 * (first VLAD_803 burst), which is the canonical "hit" moment of this
 * multi-phase attack.
 *
 * complete: fired from frameScripts[1016] (= AS frame_1017) which does
 * `stop(); _parent.removeMovieClip()`.
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
  width: 344.6,
  height: 359.9,
  offsetX: -158.4,
  offsetY: -212.7,
};

export class Spell2924 extends RuntimeSpell {
  readonly spellId = 2924;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // DefineSprite_225 is the inner animated sprite driving all sounds and
    // completion. It is the content of `anim1`. We model it as the anim1
    // symbol directly, carrying all frame scripts from the canonical AS files.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 1021,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          28,
          (_clip) => {
            // AS DefineSprite_225/frame_29/DoAction.as
            // SOMA.playSound("SON_DIE__BOSS_RAT_DE_BRAQUEMART_01");
            this._playSound("SON_DIE__BOSS_RAT_DE_BRAQUEMART_01");
          },
        ],
        [
          62,
          (_clip) => {
            // AS DefineSprite_225/frame_63/DoAction.as
            // SOMA.playSound("grina_701");
            this._playSound("grina_701");
          },
        ],
        [
          255,
          (_clip) => {
            // AS DefineSprite_225/frame_256/DoAction.as
            // SOMA.playSound("VLAD_812");
            this._playSound("VLAD_812");
          },
        ],
        [
          267,
          (_clip) => {
            // AS DefineSprite_225/frame_268/DoAction.as
            // SOMA.playSound("GRINA_711");
            this._playSound("GRINA_711");
          },
        ],
        [
          318,
          (_clip) => {
            // AS DefineSprite_225/frame_319/DoAction.as
            // SOMA.playSound("VLAD_803");
            // This is the canonical first hit of the VLAD_803 burst — signal hit here.
            this._playSound("VLAD_803");
            this.runtime.signalHit();
          },
        ],
        [
          322,
          (_clip) => {
            // AS DefineSprite_225/frame_323/DoAction.as
            // SOMA.playSound("VLAD_803");
            this._playSound("VLAD_803");
          },
        ],
        [
          327,
          (_clip) => {
            // AS DefineSprite_225/frame_328/DoAction.as
            // SOMA.playSound("VLAD_803");
            this._playSound("VLAD_803");
          },
        ],
        [
          332,
          (_clip) => {
            // AS DefineSprite_225/frame_333/DoAction.as
            // SOMA.playSound("VLAD_803");
            this._playSound("VLAD_803");
          },
        ],
        [
          337,
          (_clip) => {
            // AS DefineSprite_225/frame_338/DoAction.as
            // SOMA.playSound("VLAD_803");
            this._playSound("VLAD_803");
          },
        ],
        [
          341,
          (_clip) => {
            // AS DefineSprite_225/frame_342/DoAction.as
            // SOMA.playSound("VLAD_803");
            this._playSound("VLAD_803");
          },
        ],
        [
          346,
          (_clip) => {
            // AS DefineSprite_225/frame_347/DoAction.as
            // SOMA.playSound("VLAD_803");
            this._playSound("VLAD_803");
          },
        ],
        [
          354,
          (_clip) => {
            // AS DefineSprite_225/frame_355/DoAction.as
            // SOMA.playSound("VLAD_803");
            this._playSound("VLAD_803");
          },
        ],
        [
          360,
          (_clip) => {
            // AS DefineSprite_225/frame_361/DoAction.as
            // SOMA.playSound("VLAD_803");
            this._playSound("VLAD_803");
          },
        ],
        [
          451,
          (_clip) => {
            // AS DefineSprite_225/frame_452/DoAction.as
            // SOMA.playSound("licrounch_1008b");
            this._playSound("licrounch_1008b");
          },
        ],
        [
          468,
          (_clip) => {
            // AS DefineSprite_225/frame_469/DoAction.as
            // SOMA.playSound("licrounch_1008b");
            this._playSound("licrounch_1008b");
          },
        ],
        [
          479,
          (_clip) => {
            // AS DefineSprite_225/frame_480/DoAction.as
            // SOMA.playSound("licrounch_1008b");
            this._playSound("licrounch_1008b");
          },
        ],
        [
          489,
          (_clip) => {
            // AS DefineSprite_225/frame_490/DoAction.as
            // SOMA.playSound("crokoburio_spell");
            this._playSound("crokoburio_spell");
          },
        ],
        [
          497,
          (_clip) => {
            // AS DefineSprite_225/frame_498/DoAction.as
            // SOMA.playSound("licrounch_1008b");
            this._playSound("licrounch_1008b");
          },
        ],
        [
          504,
          (_clip) => {
            // AS DefineSprite_225/frame_505/DoAction.as
            // SOMA.playSound("licrounch_1008b");
            this._playSound("licrounch_1008b");
          },
        ],
        [
          510,
          (_clip) => {
            // AS DefineSprite_225/frame_511/DoAction.as
            // SOMA.playSound("LAKAM_404");
            this._playSound("LAKAM_404");
          },
        ],
        [
          521,
          (_clip) => {
            // AS DefineSprite_225/frame_522/DoAction.as
            // SOMA.playSound("licrounch_1008b");
            this._playSound("licrounch_1008b");
          },
        ],
        [
          525,
          (_clip) => {
            // AS DefineSprite_225/frame_526/DoAction.as
            // SOMA.playSound("licrounch_1008b");
            this._playSound("licrounch_1008b");
          },
        ],
        [
          550,
          (_clip) => {
            // AS DefineSprite_225/frame_551/DoAction.as
            // SOMA.playSound("licrounch_1008b");
            this._playSound("licrounch_1008b");
          },
        ],
        [
          814,
          (_clip) => {
            // AS DefineSprite_225/frame_815/DoAction.as
            // SOMA.playSound("grina_701");
            this._playSound("grina_701");
          },
        ],
        [
          1016,
          (clip) => {
            // AS DefineSprite_225/frame_1017/DoAction.as
            // stop();
            // _parent.removeMovieClip();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  // Captured sound callback for use from frameScripts.
  private _playSound: (id: string) => void = (_id) => {};

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture the sound callback so frameScripts can use it.
    this._playSound = callbacks.playSound;

    // Attach the composite anim1 timeline as a child of root so it
    // starts ticking from the next runtime frame.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
