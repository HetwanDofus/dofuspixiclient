/**
 * Spell 803 — Vlad (Sacrieur / Punition Corporelle area).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/803/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no projectile, no caster-side
 * reference, no `_parent.cellFrom` usage, no `move`/`shoot`/`duplicate`
 * symbols. The effect is a single composite animation anchored at the
 * target cell. This is the canonical TargetCell pattern.
 *
 * Library symbols:
 *   None in librarySymbols[]. The manifest has a single `animations`
 *   entry ("anim1", 219 frames) which IS the main authored timeline.
 *   The only runtime-spawned symbol is DefineSprite_8 (an inner clip
 *   placed on DefineSprite_9's timeline at frame_1 via PlaceObject2_7_1).
 *
 * Symbol layout (from manifest.scripts):
 *   DefineSprite_9 — outer 219-frame container (maps to "anim1"):
 *     frame_1 (index 0):  SOMA.playSound("gonfle"); SOMA.playSound("vlad_803");
 *     frame_13 (index 12): SOMA.playSound("vlad_803");
 *     frame_217 (index 216): stop(); _parent.removeMovieClip();
 *
 *   DefineSprite_8 — inner looping clip placed inside DefineSprite_9.
 *     onClipEvent(load):      gotoAndPlay(random(45)); _alpha = 150;
 *     onClipEvent(enterFrame): _alpha -= 0.6;
 *
 * The "anim1" animation in the manifest IS the outer DefineSprite_9
 * timeline baked into composite frames. We register it as the "anim1"
 * symbol (no `lib_` prefix — it is only in animations[], not
 * librarySymbols[]). The inner DefineSprite_8 behaviour (alpha fade
 * from a random start frame) is expressed as an `onLoad`/`onEnterFrame`
 * on a companion symbol.
 *
 * Main timeline: the top-level SWF places DefineSprite_9 as its only
 * child. We attach it in onSpellStart and play the sounds from its
 * own frame scripts. The main-timeline itself has no explicit DoAction
 * (only SOMA sounds triggered by DefineSprite_9 frame_1).
 *
 * signalHit: fired at frame_13 (index 12) — canonical "vlad_803"
 * second hit sound coincides with the impact visual.
 *
 * complete: fired at frame_217 (index 216) when DefineSprite_9 calls
 * `stop(); _parent.removeMovieClip();`.
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
  width: 83.3,
  height: 166.75,
  offsetX: -37.55,
  offsetY: -106.8,
};

export class Spell803 extends RuntimeSpell {
  readonly spellId = 803;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — outer 219-frame composite timeline --------------
    // Maps to DefineSprite_9 in the canonical SWF.
    // AS DefineSprite_9/frame_1/DoAction.as:
    //   SOMA.playSound("gonfle"); SOMA.playSound("vlad_803");
    // AS DefineSprite_9/frame_13/DoAction.as:
    //   SOMA.playSound("vlad_803");
    // AS DefineSprite_9/frame_217/DoAction.as:
    //   stop(); _parent.removeMovieClip();
    //
    // The frame textures come from animations["anim1"] — no lib_ prefix.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 219,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip, _ctx) => {
            // AS DefineSprite_9/frame_1/DoAction.as
            // Sounds are played in onSpellStart (main-timeline entry);
            // the inner frame_1 of DefineSprite_9 duplicates them but
            // since the composite renders them as authored here we
            // emit them via the stored sound callback.
            if (this.soundCallback) {
              this.soundCallback("gonfle");
              this.soundCallback("vlad_803");
            }
          },
        ],
        [
          12,
          (_clip, _ctx) => {
            // AS DefineSprite_9/frame_13/DoAction.as
            // SOMA.playSound("vlad_803") — second hit sound → signalHit
            if (this.soundCallback) {
              this.soundCallback("vlad_803");
            }
            this.runtime.signalHit();
          },
        ],
        [
          216,
          (clip, _ctx) => {
            // AS DefineSprite_9/frame_217/DoAction.as
            // stop(); _parent.removeMovieClip();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  // Capture callbacks so frame scripts can play sounds.
  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Store so frame scripts can call playSound.
    this.soundCallback = callbacks.playSound;

    // The canonical SWF main timeline places DefineSprite_9 at frame_1.
    // Attach it here so it starts ticking from the next runtime frame.
    // The frame_1 script inside the symbol will play the entry sounds
    // on its first tick.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
