/**
 * Spell 2923 — Boss Rat de Braquemart / Grina / Vlad composite attack.
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2923/scripts/scripts/
 *
 * displayType=11 (TargetCell). There are no librarySymbols, no `move`/`shoot`/
 * `duplicate` attachMovie calls, no caster-reference scripts, and no projectile
 * motion. The spell is a single composite animation (`anim1`, 950 frames) with
 * per-frame sound cues driven by `DefineSprite_106` frame scripts, ending at
 * frame_947 with `stop(); _parent.removeMovieClip();`. The container is anchored
 * at the target cell — classic TargetCell impact pattern.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest.json).
 *
 * Main timeline: a single `anim1` animation registered as `DefineSprite_106`
 * (950 frames). Frame scripts fire sounds at various canonical frames and
 * frame_947 stops + removes the parent (spell complete). signalHit is fired
 * at frame_29 (first audible impact sound "SON_DIE__BOSS_RAT_DE_BRAQUEMART_01").
 *
 * Sound schedule (canonical frame → 0-based index):
 *   frame_29  (idx 28)  → SON_DIE__BOSS_RAT_DE_BRAQUEMART_01
 *   frame_63  (idx 62)  → grina_701
 *   frame_256 (idx 255) → VLAD_812
 *   frame_268 (idx 267) → GRINA_711
 *   frame_308 (idx 307) → VLAD_803
 *   frame_320 (idx 319) → VLAD_803
 *   frame_333 (idx 332) → VLAD_803
 *   frame_367 (idx 366) → licrounch_1008b
 *   frame_384 (idx 383) → licrounch_1008b
 *   frame_395 (idx 394) → licrounch_1008b
 *   frame_412 (idx 411) → licrounch_1008b
 *   frame_420 (idx 419) → licrounch_1008b
 *   frame_437 (idx 436) → licrounch_1008b
 *   frame_441 (idx 440) → licrounch_1008b
 *   frame_466 (idx 465) → licrounch_1008b
 *   frame_478 (idx 477) → licrounch_1008b
 *   frame_495 (idx 494) → licrounch_1008b
 *   frame_499 (idx 498) → crokoburio_spell
 *   frame_528 (idx 527) → wab_2005b
 *   frame_534 (idx 533) → licrounch_1008
 *   frame_773 (idx 772) → grina_701
 *   frame_947 (idx 946) → stop(); _parent.removeMovieClip()
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
  height: 395.55,
  offsetX: -158.4,
  offsetY: -248.35,
};

export class Spell2923 extends RuntimeSpell {
  readonly spellId = 2923;
  readonly displayType = SpellDisplayType.TargetCell;

  private playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // DefineSprite_106 — the single composite animation timeline (950 frames).
    // Textures come from the top-level animations[] entry "anim1" (no lib_ prefix
    // since librarySymbols[] is empty in the manifest).
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 950,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // AS: DefineSprite_106/frame_29/DoAction.as — SOMA.playSound("SON_DIE__BOSS_RAT_DE_BRAQUEMART_01")
          // Also used as the canonical first-impact frame → signalHit.
          28,
          (_clip) => {
            this.playSound?.("SON_DIE__BOSS_RAT_DE_BRAQUEMART_01");
            this.runtime.signalHit();
          },
        ],
        [
          // AS: DefineSprite_106/frame_63/DoAction.as — SOMA.playSound("grina_701")
          62,
          (_clip) => {
            this.playSound?.("grina_701");
          },
        ],
        [
          // AS: DefineSprite_106/frame_256/DoAction.as — SOMA.playSound("VLAD_812")
          255,
          (_clip) => {
            this.playSound?.("VLAD_812");
          },
        ],
        [
          // AS: DefineSprite_106/frame_268/DoAction.as — SOMA.playSound("GRINA_711")
          267,
          (_clip) => {
            this.playSound?.("GRINA_711");
          },
        ],
        [
          // AS: DefineSprite_106/frame_308/DoAction.as — SOMA.playSound("VLAD_803")
          307,
          (_clip) => {
            this.playSound?.("VLAD_803");
          },
        ],
        [
          // AS: DefineSprite_106/frame_320/DoAction.as — SOMA.playSound("VLAD_803")
          319,
          (_clip) => {
            this.playSound?.("VLAD_803");
          },
        ],
        [
          // AS: DefineSprite_106/frame_333/DoAction.as — SOMA.playSound("VLAD_803")
          332,
          (_clip) => {
            this.playSound?.("VLAD_803");
          },
        ],
        [
          // AS: DefineSprite_106/frame_367/DoAction.as — SOMA.playSound("licrounch_1008b")
          366,
          (_clip) => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_106/frame_384/DoAction.as — SOMA.playSound("licrounch_1008b")
          383,
          (_clip) => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_106/frame_395/DoAction.as — SOMA.playSound("licrounch_1008b")
          394,
          (_clip) => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_106/frame_412/DoAction.as — SOMA.playSound("licrounch_1008b")
          411,
          (_clip) => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_106/frame_420/DoAction.as — SOMA.playSound("licrounch_1008b")
          419,
          (_clip) => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_106/frame_437/DoAction.as — SOMA.playSound("licrounch_1008b")
          436,
          (_clip) => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_106/frame_441/DoAction.as — SOMA.playSound("licrounch_1008b")
          440,
          (_clip) => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_106/frame_466/DoAction.as — SOMA.playSound("licrounch_1008b")
          465,
          (_clip) => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_106/frame_478/DoAction.as — SOMA.playSound("licrounch_1008b")
          477,
          (_clip) => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_106/frame_495/DoAction.as — SOMA.playSound("licrounch_1008b")
          494,
          (_clip) => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_106/frame_499/DoAction.as — SOMA.playSound("crokoburio_spell")
          498,
          (_clip) => {
            this.playSound?.("crokoburio_spell");
          },
        ],
        [
          // AS: DefineSprite_106/frame_528/DoAction.as — SOMA.playSound("wab_2005b")
          527,
          (_clip) => {
            this.playSound?.("wab_2005b");
          },
        ],
        [
          // AS: DefineSprite_106/frame_534/DoAction.as — SOMA.playSound("licrounch_1008")
          533,
          (_clip) => {
            this.playSound?.("licrounch_1008");
          },
        ],
        [
          // AS: DefineSprite_106/frame_773/DoAction.as — SOMA.playSound("grina_701")
          772,
          (_clip) => {
            this.playSound?.("grina_701");
          },
        ],
        [
          // AS: DefineSprite_106/frame_947/DoAction.as — stop(); _parent.removeMovieClip();
          946,
          (clip) => {
            clip.stop();
            clip.parent?.remove();
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
    // Capture the sound callback so frame scripts (which run inside the
    // SpellClip tick loop, after onSpellStart returns) can fire sounds.
    this.playSound = callbacks.playSound;

    // Attach the single composite animation at depth 1 on the root.
    // The main timeline implicitly places DefineSprite_106 on frame_1;
    // we reproduce that here so the animation starts ticking immediately.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
