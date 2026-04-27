/**
 * Spell 2918 — Boss Rat de Braquemart / Composite Boss Spell.
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2918/scripts/scripts/
 *
 * This spell has a single animation ("anim1") in the manifest with 950 frames
 * and NO librarySymbols — this is a pure single-timeline composite animation
 * anchored at the target cell. The entire content is driven by DefineSprite_100,
 * which is a long 950-frame timeline that:
 *   - Plays sounds at specific frames (ported as frameScripts)
 *   - Calls stop() + _parent.removeMovieClip() at frame 947
 *
 * displayType=11 (TargetCell): single impact at target cell, no projectile,
 * no caster reference, no library symbols. The anim1 timeline IS the spell.
 *
 * Since librarySymbols is empty, textures use the bare "anim1" key (no lib_ prefix).
 *
 * The signalHit is fired at the first significant impact sound, which canonically
 * is the "SON_DIE__BOSS_RAT_DE_BRAQUEMART_01" sound at frame 29 (0-based: 28).
 * That is the primary "hit" moment of this boss spell.
 *
 * Completion: frame_947 (0-based: 946) calls stop() + _parent.removeMovieClip().
 *
 * Library symbols: none (librarySymbols array is empty).
 *
 * Main timeline: attaches DefineSprite_100 ("anim1") as a child, which carries
 * all the authored frame content and sound scripts. Since there is no separate
 * "librarySymbols" entry, DefineSprite_100 is rendered as the anim1 animation
 * directly via the root symbol.
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
  width: 348.15,
  height: 294.4,
  offsetX: -158.4,
  offsetY: -147.2,
};

export class Spell2918 extends RuntimeSpell {
  readonly spellId = 2918;
  readonly displayType = SpellDisplayType.TargetCell;

  private playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // DefineSprite_100 — the single composite timeline (950 frames).
    // Carries all sound cues and the completion script.
    // No librarySymbols entry → textures key is bare "anim1" (no lib_ prefix).
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 950,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      frameScripts: new Map([
        [
          // AS: DefineSprite_100/frame_29/DoAction.as → SOMA.playSound("SON_DIE__BOSS_RAT_DE_BRAQUEMART_01")
          // This is also the canonical "hit" frame — signal hit here.
          28,
          (_clip) => {
            this.playSound?.("SON_DIE__BOSS_RAT_DE_BRAQUEMART_01");
            this.runtime.signalHit();
          },
        ],
        [
          // AS: DefineSprite_100/frame_63/DoAction.as → SOMA.playSound("grina_701")
          62,
          (_clip) => {
            this.playSound?.("grina_701");
          },
        ],
        [
          // AS: DefineSprite_100/frame_256/DoAction.as → SOMA.playSound("VLAD_812")
          255,
          (_clip) => {
            this.playSound?.("VLAD_812");
          },
        ],
        [
          // AS: DefineSprite_100/frame_268/DoAction.as → SOMA.playSound("GRINA_711")
          267,
          (_clip) => {
            this.playSound?.("GRINA_711");
          },
        ],
        [
          // AS: DefineSprite_100/frame_308/DoAction.as → SOMA.playSound("VLAD_803")
          307,
          (_clip) => {
            this.playSound?.("VLAD_803");
          },
        ],
        [
          // AS: DefineSprite_100/frame_320/DoAction.as → SOMA.playSound("VLAD_803")
          319,
          (_clip) => {
            this.playSound?.("VLAD_803");
          },
        ],
        [
          // AS: DefineSprite_100/frame_333/DoAction.as → SOMA.playSound("VLAD_803")
          332,
          (_clip) => {
            this.playSound?.("VLAD_803");
          },
        ],
        [
          // AS: DefineSprite_100/frame_367/DoAction.as → SOMA.playSound("licrounch_1008b")
          366,
          (_clip) => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_100/frame_384/DoAction.as → SOMA.playSound("licrounch_1008b")
          383,
          (_clip) => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_100/frame_395/DoAction.as → SOMA.playSound("licrounch_1008b")
          394,
          (_clip) => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_100/frame_412/DoAction.as → SOMA.playSound("licrounch_1008b")
          411,
          (_clip) => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_100/frame_420/DoAction.as → SOMA.playSound("licrounch_1008b")
          419,
          (_clip) => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_100/frame_437/DoAction.as → SOMA.playSound("licrounch_1008b")
          436,
          (_clip) => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_100/frame_441/DoAction.as → SOMA.playSound("licrounch_1008b")
          440,
          (_clip) => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_100/frame_466/DoAction.as → SOMA.playSound("licrounch_1008b")
          465,
          (_clip) => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_100/frame_478/DoAction.as → SOMA.playSound("licrounch_1008b")
          477,
          (_clip) => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_100/frame_495/DoAction.as → SOMA.playSound("licrounch_1008b")
          494,
          (_clip) => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_100/frame_499/DoAction.as → SOMA.playSound("crokoburio_spell")
          498,
          (_clip) => {
            this.playSound?.("crokoburio_spell");
          },
        ],
        [
          // AS: DefineSprite_100/frame_528/DoAction.as → SOMA.playSound("wab_2005b")
          527,
          (_clip) => {
            this.playSound?.("wab_2005b");
          },
        ],
        [
          // AS: DefineSprite_100/frame_534/DoAction.as → SOMA.playSound("licrounch_1008")
          533,
          (_clip) => {
            this.playSound?.("licrounch_1008");
          },
        ],
        [
          // AS: DefineSprite_100/frame_773/DoAction.as → SOMA.playSound("grina_701")
          772,
          (_clip) => {
            this.playSound?.("grina_701");
          },
        ],
        [
          // AS: DefineSprite_100/frame_947/DoAction.as → stop(); _parent.removeMovieClip();
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
    // Capture sound callback so frameScripts can use it.
    this.playSound = callbacks.playSound;

    // Attach the anim1 symbol as the sole child of root.
    // This mirrors the canonical main-timeline placement of DefineSprite_100.
    const sym = this.registry.resolve("anim1");
    if (sym) {
      this.root.attach(sym, "anim1", 1, context);
    }
  }
}
