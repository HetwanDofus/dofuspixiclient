/**
 * Spell 2921 — Boss Rat de Braquemart / Composite Attack animation.
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2921/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has:
 *   - A single `animations[]` entry ("anim1", 950 frames, isComposite=true).
 *   - No `librarySymbols[]` entries — no attachMovie calls anywhere in the AS.
 *   - One DefineSprite_104 which is the main animation container. All AS scripts
 *     inside it are SOMA.playSound(...) calls at specific frames, plus a final
 *     frame_947 that does stop() + _parent.removeMovieClip().
 *   - No projectile, no caster reference, no cellFrom/cellTo positioning.
 *     This is a pure impact animation at the target cell → TargetCell (11).
 *
 * Library symbols: none (librarySymbols[] is empty).
 *
 * Main timeline: attaches the anim1 sprite (DefineSprite_104) as the sole
 * child. The sprite plays through ~947 frames firing sounds at canonical
 * frames, then removes itself and signals completion.
 *
 * Sound schedule (canonical AS frame → 0-based index in frameScripts):
 *   frame_29  → "SON_DIE__BOSS_RAT_DE_BRAQUEMART_01"
 *   frame_63  → "grina_701"
 *   frame_256 → "VLAD_812"
 *   frame_268 → "GRINA_711"
 *   frame_308 → "VLAD_803"
 *   frame_320 → "VLAD_803"
 *   frame_333 → "VLAD_803"
 *   frame_367 → "licrounch_1008b"
 *   frame_384 → "licrounch_1008b"
 *   frame_395 → "licrounch_1008b"
 *   frame_412 → "licrounch_1008b"
 *   frame_420 → "licrounch_1008b"
 *   frame_437 → "licrounch_1008b"
 *   frame_441 → "licrounch_1008b"
 *   frame_466 → "licrounch_1008b"
 *   frame_478 → "licrounch_1008b"
 *   frame_495 → "licrounch_1008b"
 *   frame_499 → "crokoburio_spell"
 *   frame_528 → "wab_2005b"
 *   frame_534 → "licrounch_1008"
 *   frame_773 → "grina_701"
 *   frame_947 → stop() + _parent.removeMovieClip() → complete()
 *
 * signalHit is fired at the first significant impact sound (frame_29,
 * the death-rattle of the boss rat) — this is the canonical damage moment
 * for a TargetCell spell with no explicit this.end() call in AS.
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
  width: 316.8,
  height: 318.9,
  offsetX: -158.4,
  offsetY: -171.7,
};

export class Spell2921 extends RuntimeSpell {
  readonly spellId = 2921;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // DefineSprite_104 — the sole animation container. 950 frames of composite
    // sprite data. All AS actions inside are SOMA.playSound(...) at specific
    // frames, with frame_947 doing stop() + _parent.removeMovieClip().
    // Textures come from the bare "anim1" key (animations[] entry, no lib_ prefix).
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 950,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          28,
          // AS: DefineSprite_104/frame_29/DoAction.as → SOMA.playSound("SON_DIE__BOSS_RAT_DE_BRAQUEMART_01")
          // Also the canonical hit frame for this spell (first damage-moment sound).
          (_clip) => {
            this.soundCallback?.("SON_DIE__BOSS_RAT_DE_BRAQUEMART_01");
            this.runtime.signalHit();
          },
        ],
        [
          62,
          // AS: DefineSprite_104/frame_63/DoAction.as → SOMA.playSound("grina_701")
          (_clip) => {
            this.soundCallback?.("grina_701");
          },
        ],
        [
          255,
          // AS: DefineSprite_104/frame_256/DoAction.as → SOMA.playSound("VLAD_812")
          (_clip) => {
            this.soundCallback?.("VLAD_812");
          },
        ],
        [
          267,
          // AS: DefineSprite_104/frame_268/DoAction.as → SOMA.playSound("GRINA_711")
          (_clip) => {
            this.soundCallback?.("GRINA_711");
          },
        ],
        [
          307,
          // AS: DefineSprite_104/frame_308/DoAction.as → SOMA.playSound("VLAD_803")
          (_clip) => {
            this.soundCallback?.("VLAD_803");
          },
        ],
        [
          319,
          // AS: DefineSprite_104/frame_320/DoAction.as → SOMA.playSound("VLAD_803")
          (_clip) => {
            this.soundCallback?.("VLAD_803");
          },
        ],
        [
          332,
          // AS: DefineSprite_104/frame_333/DoAction.as → SOMA.playSound("VLAD_803")
          (_clip) => {
            this.soundCallback?.("VLAD_803");
          },
        ],
        [
          366,
          // AS: DefineSprite_104/frame_367/DoAction.as → SOMA.playSound("licrounch_1008b")
          (_clip) => {
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          383,
          // AS: DefineSprite_104/frame_384/DoAction.as → SOMA.playSound("licrounch_1008b")
          (_clip) => {
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          394,
          // AS: DefineSprite_104/frame_395/DoAction.as → SOMA.playSound("licrounch_1008b")
          (_clip) => {
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          411,
          // AS: DefineSprite_104/frame_412/DoAction.as → SOMA.playSound("licrounch_1008b")
          (_clip) => {
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          419,
          // AS: DefineSprite_104/frame_420/DoAction.as → SOMA.playSound("licrounch_1008b")
          (_clip) => {
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          436,
          // AS: DefineSprite_104/frame_437/DoAction.as → SOMA.playSound("licrounch_1008b")
          (_clip) => {
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          440,
          // AS: DefineSprite_104/frame_441/DoAction.as → SOMA.playSound("licrounch_1008b")
          (_clip) => {
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          465,
          // AS: DefineSprite_104/frame_466/DoAction.as → SOMA.playSound("licrounch_1008b")
          (_clip) => {
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          477,
          // AS: DefineSprite_104/frame_478/DoAction.as → SOMA.playSound("licrounch_1008b")
          (_clip) => {
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          494,
          // AS: DefineSprite_104/frame_495/DoAction.as → SOMA.playSound("licrounch_1008b")
          (_clip) => {
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          498,
          // AS: DefineSprite_104/frame_499/DoAction.as → SOMA.playSound("crokoburio_spell")
          (_clip) => {
            this.soundCallback?.("crokoburio_spell");
          },
        ],
        [
          527,
          // AS: DefineSprite_104/frame_528/DoAction.as → SOMA.playSound("wab_2005b")
          (_clip) => {
            this.soundCallback?.("wab_2005b");
          },
        ],
        [
          533,
          // AS: DefineSprite_104/frame_534/DoAction.as → SOMA.playSound("licrounch_1008")
          (_clip) => {
            this.soundCallback?.("licrounch_1008");
          },
        ],
        [
          772,
          // AS: DefineSprite_104/frame_773/DoAction.as → SOMA.playSound("grina_701")
          (_clip) => {
            this.soundCallback?.("grina_701");
          },
        ],
        [
          946,
          // AS: DefineSprite_104/frame_947/DoAction.as → stop(); _parent.removeMovieClip();
          (clip) => {
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
    // Capture sound callback for use inside frameScripts (sounds fire
    // from within the DefineSprite_104 timeline, not from the main timeline).
    this.soundCallback = callbacks.playSound;

    // The main timeline implicitly places DefineSprite_104 (our anim1) as
    // its sole authored content. Attach it to root so it starts ticking.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
