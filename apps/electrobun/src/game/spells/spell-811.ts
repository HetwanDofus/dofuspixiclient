/**
 * Spell 811 — Licorne (Eniripsa or similar class spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/811/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile, no caster reference,
 * no dual-anchor pattern, and no `move`/`shoot`/`duplicate` symbols. It is a
 * single impact animation anchored at the target cell. The manifest has only one
 * `animations[]` entry (`anim1`, 114 frames) and no `librarySymbols[]`.
 *
 * Canonical AS layout:
 *   - DefineSprite_6/frame_1/DoAction.as:
 *       gotoAndPlay(random(45) + 2);
 *       This is the inner anim clip that randomises its start frame (2..46).
 *
 *   - DefineSprite_17/frame_1/DoAction.as:
 *       SOMA.playSound("licrounch_1008");
 *       This is the outer wrapper sprite whose frame_1 plays the sound.
 *
 *   - DefineSprite_17/frame_112/DoAction.as:
 *       _parent.removeMovieClip();
 *       Outer wrapper removes itself (= spell complete) at frame 112.
 *
 * Since `librarySymbols` is empty in the manifest, we register the animation
 * using the bare `anim1` key (NO `lib_` prefix). The outer sprite (DefineSprite_17)
 * drives the 114-frame timeline; we attach it as the sole child in onSpellStart.
 *
 * signalHit is fired at frame 1 (frame_1 of DefineSprite_17, i.e. the moment the
 * impact sound plays), which is the canonical impact moment. complete() is fired
 * at frame 111 (AS frame_112, 0-based = 111).
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
  width: 117,
  height: 191.25,
  offsetX: -58.5,
  offsetY: -162.05,
};

export class Spell811 extends RuntimeSpell {
  readonly spellId = 811;
  readonly displayType = SpellDisplayType.TargetCell;

  private innerClipSym!: SymbolDefinition;
  private outerClipSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- DefineSprite_6 — inner animated clip --------------------
    // AS DefineSprite_6/frame_1/DoAction.as:
    //   gotoAndPlay(random(45) + 2);
    // Randomises start frame to somewhere in [2..46] (AS 1-based),
    // i.e. 0-based frames [1..45].
    this.innerClipSym = {
      name: "innerClip",
      totalFrames: 114,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_6/frame_1/DoAction.as:
            //   gotoAndPlay(random(45) + 2);
            // random(45) → Math.floor(Math.random() * 45), range [0..44]
            // + 2 → AS 1-based frame [2..46], 0-based [1..45]
            const startFrame = Math.floor(Math.random() * 45) + 1;
            clip.gotoAndPlay(startFrame);
          },
        ],
      ]),
    };

    // ---- DefineSprite_17 — outer wrapper timeline ----------------
    // AS DefineSprite_17/frame_1/DoAction.as:
    //   SOMA.playSound("licrounch_1008");
    // AS DefineSprite_17/frame_112/DoAction.as:
    //   _parent.removeMovieClip();
    //
    // The outer clip is a 114-frame container that:
    //   - plays the sound on entry (frame_1 → signalHit)
    //   - removes its parent (= spell complete) at frame_112 (0-based: 111)
    //
    // We treat it as a container that holds the inner clip as its
    // visual content. The inner clip's frame textures supply the rendering.
    this.outerClipSym = {
      name: "outerClip",
      totalFrames: 114,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_17/frame_1/DoAction.as:
            //   SOMA.playSound("licrounch_1008");
            // Sound is fired by onSpellStart directly; signal hit here
            // as the canonical impact moment.
            this.runtime.signalHit();
            // Attach the inner animated clip as child of the outer wrapper.
            clip.attach(this.innerClipSym, "innerClip", 1, ctx);
          },
        ],
        [
          111,
          (clip) => {
            // AS DefineSprite_17/frame_112/DoAction.as:
            //   _parent.removeMovieClip();
            // _parent here is the root (outer mc of the spell), so this
            // is the canonical spell completion trigger.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.innerClipSym);
    this.registry.register(this.outerClipSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS DefineSprite_17/frame_1/DoAction.as: SOMA.playSound("licrounch_1008");
    callbacks.playSound("licrounch_1008");

    // Attach the outer wrapper clip at the root so it starts ticking.
    this.root.attach(this.outerClipSym, "outerClip", 1, context);
  }
}
