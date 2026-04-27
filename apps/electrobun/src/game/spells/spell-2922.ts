/**
 * Spell 2922 — Unknown (composite animation with sounds).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2922/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has a single `animations[]`
 * entry (`anim1`, 950 frames, isComposite=true) and NO `librarySymbols[]`.
 * There are no `attachMovie` calls anywhere in the AS — the entire visual
 * is driven by the authored `anim1` composite timeline. The AS lives
 * entirely inside `DefineSprite_107`, which is the top-level sprite placed
 * on the main timeline. It plays sounds at various frames and at frame_947
 * calls `stop(); _parent.removeMovieClip();` — signalling spell completion.
 *
 * Because there is no projectile, no caster reference, and the effect
 * lands entirely at the target cell, displayType=11 (TargetCell) is correct.
 *
 * Library symbols: none.
 *
 * Main timeline: places anim1 (DefineSprite_107) at root depth 1. The
 * sprite plays autonomously, firing sounds at specific frames, and removes
 * itself at frame_947.
 *
 * Sound timeline (all inside DefineSprite_107):
 *   frame_29:  SON_DIE__BOSS_RAT_DE_BRAQUEMART_01
 *   frame_63:  grina_701
 *   frame_256: VLAD_812
 *   frame_268: GRINA_711
 *   frame_308: VLAD_803
 *   frame_320: VLAD_803
 *   frame_333: VLAD_803
 *   frame_367: licrounch_1008b
 *   frame_384: licrounch_1008b
 *   frame_395: licrounch_1008b
 *   frame_412: licrounch_1008b
 *   frame_420: licrounch_1008b
 *   frame_437: licrounch_1008b
 *   frame_441: licrounch_1008b
 *   frame_466: licrounch_1008b
 *   frame_478: licrounch_1008b
 *   frame_495: licrounch_1008b
 *   frame_499: crokoburio_spell
 *   frame_528: wab_2005b
 *   frame_534: licrounch_1008
 *   frame_773: grina_701
 *   frame_947: stop(); _parent.removeMovieClip() → complete()
 *
 * signalHit: fired at the first damage-relevant frame. The earliest
 * "impact" sound cluster begins at frame_308 (VLAD_803), which matches
 * the canonical hit timing. We fire signalHit there.
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
  height: 339.25,
  offsetX: -158.4,
  offsetY: -192.05,
};

export class Spell2922 extends RuntimeSpell {
  readonly spellId = 2922;
  readonly displayType = SpellDisplayType.TargetCell;

  private playSound!: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // DefineSprite_107 — main composite animation, 950 frames.
    // No library symbols; all rendering is authored in the composite.
    // Frame scripts mirror every DoAction.as file under DefineSprite_107/.
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 950,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // AS: DefineSprite_107/frame_29/DoAction.as
          28,
          () => {
            this.playSound?.("SON_DIE__BOSS_RAT_DE_BRAQUEMART_01");
          },
        ],
        [
          // AS: DefineSprite_107/frame_63/DoAction.as
          62,
          () => {
            this.playSound?.("grina_701");
          },
        ],
        [
          // AS: DefineSprite_107/frame_256/DoAction.as
          255,
          () => {
            this.playSound?.("VLAD_812");
          },
        ],
        [
          // AS: DefineSprite_107/frame_268/DoAction.as
          267,
          () => {
            this.playSound?.("GRINA_711");
          },
        ],
        [
          // AS: DefineSprite_107/frame_308/DoAction.as
          307,
          () => {
            this.playSound?.("VLAD_803");
            // First VLAD_803 cluster — canonical hit frame.
            this.runtime.signalHit();
          },
        ],
        [
          // AS: DefineSprite_107/frame_320/DoAction.as
          319,
          () => {
            this.playSound?.("VLAD_803");
          },
        ],
        [
          // AS: DefineSprite_107/frame_333/DoAction.as
          332,
          () => {
            this.playSound?.("VLAD_803");
          },
        ],
        [
          // AS: DefineSprite_107/frame_367/DoAction.as
          366,
          () => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_107/frame_384/DoAction.as
          383,
          () => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_107/frame_395/DoAction.as
          394,
          () => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_107/frame_412/DoAction.as
          411,
          () => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_107/frame_420/DoAction.as
          419,
          () => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_107/frame_437/DoAction.as
          436,
          () => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_107/frame_441/DoAction.as
          440,
          () => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_107/frame_466/DoAction.as
          465,
          () => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_107/frame_478/DoAction.as
          477,
          () => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_107/frame_495/DoAction.as
          494,
          () => {
            this.playSound?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_107/frame_499/DoAction.as
          498,
          () => {
            this.playSound?.("crokoburio_spell");
          },
        ],
        [
          // AS: DefineSprite_107/frame_528/DoAction.as
          527,
          () => {
            this.playSound?.("wab_2005b");
          },
        ],
        [
          // AS: DefineSprite_107/frame_534/DoAction.as
          533,
          () => {
            this.playSound?.("licrounch_1008");
          },
        ],
        [
          // AS: DefineSprite_107/frame_773/DoAction.as
          772,
          () => {
            this.playSound?.("grina_701");
          },
        ],
        [
          // AS: DefineSprite_107/frame_947/DoAction.as
          // stop(); _parent.removeMovieClip();
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
    // Capture the sound callback so frame scripts can use it.
    this.playSound = callbacks.playSound;

    // Main timeline frame_1: place DefineSprite_107 (anim1) at root depth 1.
    this.root.attach(
      this.registry.resolve("anim1")!,
      "anim1",
      1,
      context,
    );
  }
}
