/**
 * Spell 2920 — Unknown (long composite animation).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2920/scripts/scripts/
 *
 * displayType=11 (TargetCell). Rationale: there is a single animation
 * (`anim1`) in the manifest with no `librarySymbols`, no `move`/`shoot`/
 * `duplicate` symbols, and no caster-reference logic in any script. All
 * scripts are sound-play or the terminal `stop(); _parent.removeMovieClip();`
 * pattern — the canonical "impact at target cell" shape. The entire
 * animation is driven by one authored composite timeline (`anim1`, 950
 * frames) attached directly to the root.
 *
 * Library symbols: none (manifest `librarySymbols` is absent/empty).
 *
 * Main timeline (`anim1` symbol registered as the sole child):
 *   - Attached at root in onSpellStart.
 *   - Multiple frame scripts play sounds at canonical frames (ported
 *     1:1 from DefineSprite_103/frame_N/DoAction.as files).
 *   - frame_947 (index 946): stop(); _parent.removeMovieClip() →
 *     clip.remove() + this.runtime.complete().
 *
 * signalHit: fired at the first meaningful impact sound frame (frame_29,
 * index 28 — "SON_DIE__BOSS_RAT_DE_BRAQUEMART_01"), matching the
 * canonical first hit indicator in the animation.
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
  width: 330.75,
  height: 355.9,
  offsetX: -158.4,
  offsetY: -208.7,
};

export class Spell2920 extends RuntimeSpell {
  readonly spellId = 2920;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // anim1 — 950-frame composite animation at the target cell.
    // Canonical: animations[0] in manifest.json (no librarySymbols).
    // Textures accessed via bare name (no lib_ prefix) since this is
    // an `animations[]` entry, not a `librarySymbols[]` entry.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 950,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // AS: DefineSprite_103/frame_29/DoAction.as
          // SOMA.playSound("SON_DIE__BOSS_RAT_DE_BRAQUEMART_01");
          28,
          (_clip, _ctx) => {
            this.soundCallback?.("SON_DIE__BOSS_RAT_DE_BRAQUEMART_01");
            // First hit signal — canonical first impact indicator.
            this.runtime.signalHit();
          },
        ],
        [
          // AS: DefineSprite_103/frame_63/DoAction.as
          // SOMA.playSound("grina_701");
          62,
          (_clip, _ctx) => {
            this.soundCallback?.("grina_701");
          },
        ],
        [
          // AS: DefineSprite_103/frame_256/DoAction.as
          // SOMA.playSound("VLAD_812");
          255,
          (_clip, _ctx) => {
            this.soundCallback?.("VLAD_812");
          },
        ],
        [
          // AS: DefineSprite_103/frame_268/DoAction.as
          // SOMA.playSound("GRINA_711");
          267,
          (_clip, _ctx) => {
            this.soundCallback?.("GRINA_711");
          },
        ],
        [
          // AS: DefineSprite_103/frame_308/DoAction.as
          // SOMA.playSound("VLAD_803");
          307,
          (_clip, _ctx) => {
            this.soundCallback?.("VLAD_803");
          },
        ],
        [
          // AS: DefineSprite_103/frame_320/DoAction.as
          // SOMA.playSound("VLAD_803");
          319,
          (_clip, _ctx) => {
            this.soundCallback?.("VLAD_803");
          },
        ],
        [
          // AS: DefineSprite_103/frame_333/DoAction.as
          // SOMA.playSound("VLAD_803");
          332,
          (_clip, _ctx) => {
            this.soundCallback?.("VLAD_803");
          },
        ],
        [
          // AS: DefineSprite_103/frame_367/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          366,
          (_clip, _ctx) => {
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_103/frame_384/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          383,
          (_clip, _ctx) => {
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_103/frame_395/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          394,
          (_clip, _ctx) => {
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_103/frame_412/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          411,
          (_clip, _ctx) => {
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_103/frame_420/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          419,
          (_clip, _ctx) => {
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_103/frame_437/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          436,
          (_clip, _ctx) => {
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_103/frame_441/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          440,
          (_clip, _ctx) => {
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_103/frame_466/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          465,
          (_clip, _ctx) => {
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_103/frame_478/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          477,
          (_clip, _ctx) => {
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_103/frame_495/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          494,
          (_clip, _ctx) => {
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          // AS: DefineSprite_103/frame_499/DoAction.as
          // SOMA.playSound("crokoburio_spell");
          498,
          (_clip, _ctx) => {
            this.soundCallback?.("crokoburio_spell");
          },
        ],
        [
          // AS: DefineSprite_103/frame_528/DoAction.as
          // SOMA.playSound("wab_2005b");
          527,
          (_clip, _ctx) => {
            this.soundCallback?.("wab_2005b");
          },
        ],
        [
          // AS: DefineSprite_103/frame_534/DoAction.as
          // SOMA.playSound("licrounch_1008");
          533,
          (_clip, _ctx) => {
            this.soundCallback?.("licrounch_1008");
          },
        ],
        [
          // AS: DefineSprite_103/frame_773/DoAction.as
          // SOMA.playSound("grina_701");
          772,
          (_clip, _ctx) => {
            this.soundCallback?.("grina_701");
          },
        ],
        [
          // AS: DefineSprite_103/frame_947/DoAction.as
          // stop();
          // _parent.removeMovieClip();
          946,
          (clip, _ctx) => {
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture callbacks.playSound for use from within frameScripts
    // (sounds are triggered at specific frames throughout the animation).
    this.soundCallback = callbacks.playSound;

    // Attach the main composite timeline at the root.
    // The manifest has a single animations[] entry ("anim1") which
    // corresponds to the authored main timeline. We attach it here so
    // the runtime starts ticking it from the next frame.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
