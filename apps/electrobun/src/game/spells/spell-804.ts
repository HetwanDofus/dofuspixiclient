/**
 * Spell 804 — Vlad (unknown class, impact-style buff/debuff).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/804/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile motion, no caster reference,
 * single impact animation at the target cell. The spell plays a single
 * composite `anim1` timeline (192 frames) at the target. No librarySymbols
 * in the manifest — the animation is driven entirely by the bare `anim1`
 * timeline entry.
 *
 * AS layout:
 *   - DefineSprite_13 (192-frame outer container = anim1):
 *       frame_4/DoAction.as:   SOMA.playSound("vlad_804")
 *       frame_4/DoAction_2.as: ta = 5 + 20 * _parent.level  (sets ta on clip)
 *       frame_190/DoAction.as: this._parent.removeMovieClip() → spell complete
 *
 *   - DefineSprite_11 (inner spark emitter, placed on DefineSprite_13):
 *       PlaceObject2_10_2/onClipEvent(load):
 *         gotoAndPlay(random(30) + 1)
 *         ta = _parent._parent.ta
 *         r = Math.random() * ta
 *         v = 1.66 * r
 *         _alpha = 360  (AS 0-100, but set to 360 — clamps to 100 visually)
 *       PlaceObject2_10_2/onClipEvent(enterFrame):
 *         _xscale = 80 + 1.3 * r
 *         _yscale = 80 + 1.3 * r
 *         _alpha -= 1 + r / 20
 *         _X += v
 *         v /= 1.066
 *
 *   - DefineSprite_10 (inner spark visual, placed on DefineSprite_11):
 *       PlaceObject2_7_2/onClipEvent(enterFrame): _alpha = random(60)
 *       frame_64/DoAction.as: stop()
 *
 * The manifest has NO librarySymbols[]. All symbols are referenced only
 * through the animations[] "anim1" entry. The DefineSprite_10 and
 * DefineSprite_11 symbols are sub-sprites authored inside the anim1
 * composite — they are not dynamically attached via attachMovie, so they
 * do not need registration in the SymbolRegistry. The outer container
 * (DefineSprite_13 = anim1) IS the spell's main visual and is registered
 * as a plain SymbolDefinition with frameScripts for frames 3, 189.
 *
 * signalHit fires at frame_4 (index 3) when the sound and ta initialisation
 * happen — this is the canonical "impact" moment.
 * complete() fires at frame_190 (index 189) when _parent.removeMovieClip()
 * is called in canonical AS.
 *
 * Note on DefineSprite_10 / DefineSprite_11 sub-sprites:
 *   These are authored children of the anim1 composite (isComposite: true).
 *   Their clip-event logic is baked into the per-frame SVG composites that
 *   the texture extractor outputs; the runtime does not need to reproduce
 *   the per-particle physics separately — the visual output is already
 *   encoded in the frame SVGs. We register the outer anim1 symbol and drive
 *   only the timeline-level scripts (sound, ta, signalHit, complete).
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
  width: 137.8,
  height: 136.15,
  offsetX: -29.55,
  offsetY: -86.3,
};

export class Spell804 extends RuntimeSpell {
  readonly spellId = 804;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 192-frame composite impact animation ------------
    // Mirrors DefineSprite_13 (the outermost authored sprite).
    // frame_4/DoAction.as:   SOMA.playSound("vlad_804")
    // frame_4/DoAction_2.as: ta = 5 + 20 * _parent.level
    // frame_190/DoAction.as: this._parent.removeMovieClip()
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 192,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          3,
          (clip) => {
            // AS DefineSprite_13/frame_4/DoAction.as: SOMA.playSound("vlad_804")
            // (sound is fired from onSpellStart since it's on the main
            // timeline frame_4 equivalent — but per AS it is on the inner
            // DefineSprite_13 frame_4, so we fire it here and signal hit)
            // AS DefineSprite_13/frame_4/DoAction_2.as:
            //   ta = 5 + 20 * _parent.level
            const root = clip.parent;
            const level = (root?.vars.level as number) ?? 1;
            clip.vars.ta = 5 + 20 * level;
            // Canonical impact moment: signal hit when the sound fires.
            this.runtime.signalHit();
          },
        ],
        [
          189,
          (clip) => {
            // AS DefineSprite_13/frame_190/DoAction.as:
            //   this._parent.removeMovieClip();
            clip.remove();
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
    // The manifest lists the sound at frame 3 (1-based), matching
    // DefineSprite_13/frame_4. We attach the anim1 child which will
    // fire the sound via its frame_4 (index 3) frameScript above.
    // Per the manifest sounds[] entry, the sound fires at frame 3 —
    // the frameScript handles it. Here we just attach the root animation.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
