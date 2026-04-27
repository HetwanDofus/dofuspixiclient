/**
 * Spell 2919 — (Unknown name, likely a boss/monster special ability).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2919/scripts/scripts/
 *
 * displayType=11 (TargetCell). There are no librarySymbols entries, no
 * `move`/`shoot`/`duplicate` symbols, and no dual-anchor logic. The entire
 * animation is a single authored composite timeline (`anim1`, 950 frames)
 * placed directly at the target cell. This matches the TargetCell pattern
 * exactly: one top-level sprite, no projectile motion, no caster reference.
 *
 * The single DefineSprite_106 is the anim1 timeline itself. It carries:
 *   - Multiple SOMA.playSound() calls at various frames throughout the timeline.
 *   - frame_947: stop(); _parent.removeMovieClip(); → spell completion.
 *
 * signalHit is fired early in the animation (frame 29, the first sound cue
 * "SON_DIE__BOSS_RAT_DE_BRAQUEMART_01") as a reasonable canonical hit point
 * for a TargetCell spell — this is the first significant audio event and
 * corresponds to the earliest sound frame in the manifest.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 * Main timeline: attaches the anim1 sprite (DefineSprite_106) at root.
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
  width: 359.9,
  height: 294.4,
  offsetX: -158.4,
  offsetY: -147.2,
};

export class Spell2919 extends RuntimeSpell {
  readonly spellId = 2919;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;
  private cachedCallbacks?: SpellCallbacks;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // DefineSprite_106 — the main composite animation, 950 frames.
    // All sounds and completion are driven by frameScripts on this sprite.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 950,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          28,
          // AS: scripts/DefineSprite_106/frame_29/DoAction.as
          // SOMA.playSound("SON_DIE__BOSS_RAT_DE_BRAQUEMART_01");
          // First significant hit event — signal hit here.
          (_clip) => {
            this.cachedCallbacks?.playSound("SON_DIE__BOSS_RAT_DE_BRAQUEMART_01");
            this.runtime.signalHit();
          },
        ],
        [
          62,
          // AS: scripts/DefineSprite_106/frame_63/DoAction.as
          // SOMA.playSound("grina_701");
          (_clip) => {
            this.cachedCallbacks?.playSound("grina_701");
          },
        ],
        [
          255,
          // AS: scripts/DefineSprite_106/frame_256/DoAction.as
          // SOMA.playSound("VLAD_812");
          (_clip) => {
            this.cachedCallbacks?.playSound("VLAD_812");
          },
        ],
        [
          267,
          // AS: scripts/DefineSprite_106/frame_268/DoAction.as
          // SOMA.playSound("GRINA_711");
          (_clip) => {
            this.cachedCallbacks?.playSound("GRINA_711");
          },
        ],
        [
          307,
          // AS: scripts/DefineSprite_106/frame_308/DoAction.as
          // SOMA.playSound("VLAD_803");
          (_clip) => {
            this.cachedCallbacks?.playSound("VLAD_803");
          },
        ],
        [
          319,
          // AS: scripts/DefineSprite_106/frame_320/DoAction.as
          // SOMA.playSound("VLAD_803");
          (_clip) => {
            this.cachedCallbacks?.playSound("VLAD_803");
          },
        ],
        [
          332,
          // AS: scripts/DefineSprite_106/frame_333/DoAction.as
          // SOMA.playSound("VLAD_803");
          (_clip) => {
            this.cachedCallbacks?.playSound("VLAD_803");
          },
        ],
        [
          366,
          // AS: scripts/DefineSprite_106/frame_367/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          (_clip) => {
            this.cachedCallbacks?.playSound("licrounch_1008b");
          },
        ],
        [
          383,
          // AS: scripts/DefineSprite_106/frame_384/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          (_clip) => {
            this.cachedCallbacks?.playSound("licrounch_1008b");
          },
        ],
        [
          394,
          // AS: scripts/DefineSprite_106/frame_395/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          (_clip) => {
            this.cachedCallbacks?.playSound("licrounch_1008b");
          },
        ],
        [
          411,
          // AS: scripts/DefineSprite_106/frame_412/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          (_clip) => {
            this.cachedCallbacks?.playSound("licrounch_1008b");
          },
        ],
        [
          419,
          // AS: scripts/DefineSprite_106/frame_420/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          (_clip) => {
            this.cachedCallbacks?.playSound("licrounch_1008b");
          },
        ],
        [
          436,
          // AS: scripts/DefineSprite_106/frame_437/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          (_clip) => {
            this.cachedCallbacks?.playSound("licrounch_1008b");
          },
        ],
        [
          440,
          // AS: scripts/DefineSprite_106/frame_441/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          (_clip) => {
            this.cachedCallbacks?.playSound("licrounch_1008b");
          },
        ],
        [
          465,
          // AS: scripts/DefineSprite_106/frame_466/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          (_clip) => {
            this.cachedCallbacks?.playSound("licrounch_1008b");
          },
        ],
        [
          477,
          // AS: scripts/DefineSprite_106/frame_478/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          (_clip) => {
            this.cachedCallbacks?.playSound("licrounch_1008b");
          },
        ],
        [
          494,
          // AS: scripts/DefineSprite_106/frame_495/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          (_clip) => {
            this.cachedCallbacks?.playSound("licrounch_1008b");
          },
        ],
        [
          498,
          // AS: scripts/DefineSprite_106/frame_499/DoAction.as
          // SOMA.playSound("crokoburio_spell");
          (_clip) => {
            this.cachedCallbacks?.playSound("crokoburio_spell");
          },
        ],
        [
          527,
          // AS: scripts/DefineSprite_106/frame_528/DoAction.as
          // SOMA.playSound("wab_2005b");
          (_clip) => {
            this.cachedCallbacks?.playSound("wab_2005b");
          },
        ],
        [
          533,
          // AS: scripts/DefineSprite_106/frame_534/DoAction.as
          // SOMA.playSound("licrounch_1008");
          (_clip) => {
            this.cachedCallbacks?.playSound("licrounch_1008");
          },
        ],
        [
          772,
          // AS: scripts/DefineSprite_106/frame_773/DoAction.as
          // SOMA.playSound("grina_701");
          (_clip) => {
            this.cachedCallbacks?.playSound("grina_701");
          },
        ],
        [
          946,
          // AS: scripts/DefineSprite_106/frame_947/DoAction.as
          // stop(); _parent.removeMovieClip();
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
    // Cache the callbacks reference so frameScripts can play sounds.
    this.cachedCallbacks = callbacks;

    // Attach the main animation sprite at the root (target cell origin).
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
