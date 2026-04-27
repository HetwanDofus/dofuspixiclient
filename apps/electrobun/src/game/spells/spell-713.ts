/**
 * Spell 713 — Grinaspic (or similar earth/thorn spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/713/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no `move`, `shoot`, `duplicate`, or
 * dual-anchor logic in the canonical AS. The manifest has a single `anim1`
 * animation entry (no `librarySymbols[]`), and the AS scripts describe a
 * self-contained composite timeline anchored at the target cell. This is the
 * classic "impact at target" pattern.
 *
 * AS layout:
 *   - frame_1/DoAction.as: SOMA.playSound("grina_704")
 *   - DefineSprite_9 — outer container, 133-frame timeline:
 *       frame_133/DoAction.as: stop(); _parent.removeMovieClip();
 *       frame_82/PlaceObject2_8_26/onClipEvent(enterFrame): _parent._alpha -= 2.3
 *         (a child placed at frame 82 carries this clip event that fades its
 *          parent — i.e. the DefineSprite_9 container — by 2.3/100 per frame)
 *   - DefineSprite_3 — random-frame selector (3 variants):
 *       frame_1/DoAction.as: gotoAndStop(random(3) + 1)
 *   - DefineSprite_5 — trajectory sub-sprite:
 *       frame_1:   a = random(2); gotoAndStop("traj1"); play()
 *       frame_58:  stop()
 *       frame_118: stop()
 *       frame_178: stop()
 *
 * Since librarySymbols[] is empty in the manifest, `anim1` is the sole
 * animation and is rendered as a direct symbol. No lib_ prefix is used.
 *
 * The outer DefineSprite_9 drives the spell lifetime: frame 133 calls
 * _parent.removeMovieClip() → this.runtime.complete(). The fade-out clip
 * event on the child placed at frame 82 fades the parent (DefineSprite_9
 * symbol clip) starting from frame 82; we model that as an onEnterFrame on
 * the child that mutates its parent.
 *
 * signalHit is fired at the first meaningful impact frame — we choose frame
 * 13 of DefineSprite_9 as a reasonable early-impact moment consistent with
 * the `anim1` composite visual (the animation's `stopFrame=132` and
 * `fadingFrame=131` suggest the main impact is well within the first third
 * of the timeline). Since there is no canonical "this.end()" or explicit hit
 * frame in the AS scripts, we use the first frame of the outer sprite as the
 * hit signal (frame 0 of DefineSprite_9), which is idiomatic for TargetCell
 * impact spells.
 *
 * Library symbols: none (librarySymbols[] is empty).
 * Main timeline: SOMA.playSound("grina_704").
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
  width: 390.9,
  height: 224.75,
  offsetX: -198.15,
  offsetY: -175.9,
};

export class Spell713 extends RuntimeSpell {
  readonly spellId = 713;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- fader child — placed at frame 82 of the outer sprite ----
    // AS: DefineSprite_9/frame_82/PlaceObject2_8_26/CLIPACTIONRECORD
    //     onClipEvent(enterFrame).as
    //   _parent._alpha -= 2.3;
    //
    // This is a child with no visual content whose sole purpose is to
    // carry the enterFrame clip event that fades out its parent (the
    // anim1 outer sprite). We model it as a container-only symbol.
    const faderSym: SymbolDefinition = {
      name: "fader",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: DefineSprite_9/frame_82/PlaceObject2_8_26/onClipEvent(enterFrame)
        // _parent._alpha -= 2.3  (Flash alpha is 0-100, TS is 0-1)
        const parent = clip.parent;
        if (parent) {
          parent.alpha = Math.max(0, parent.alpha - 2.3 / 100);
        }
      },
    };

    // ---- anim1 — composite 135-frame outer sprite (DefineSprite_9) --
    // AS: DefineSprite_9/frame_133/DoAction.as: stop(); _parent.removeMovieClip();
    //
    // frame_1 (index 0): signal hit (first frame of impact visual)
    // frame_82 (index 81): attach fader child that starts fading the sprite
    // frame_133 (index 132): stop(); _parent.removeMovieClip() → complete()
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 135,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // First frame of impact — signal hit to combat system.
            // No canonical explicit "end()" call; TargetCell spells
            // conventionally signal hit at the start of the visual.
            this.runtime.signalHit();
          },
        ],
        [
          81,
          (clip, ctx) => {
            // AS: DefineSprite_9/frame_82 — a child (PlaceObject2_8_26)
            // is placed here carrying onClipEvent(enterFrame) that fades
            // _parent._alpha by 2.3 per frame. We attach our fader
            // container to model this.
            if (!clip.children.has("fader")) {
              clip.attach(faderSym, "fader", 26, ctx);
            }
          },
        ],
        [
          132,
          (clip) => {
            // AS: DefineSprite_9/frame_133/DoAction.as
            // stop(); _parent.removeMovieClip();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(faderSym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: frame_1/DoAction.as — SOMA.playSound("grina_704");
    callbacks.playSound("grina_704");

    // Attach the main composite animation (DefineSprite_9) as the root
    // child. For TargetCell the root container is already positioned at
    // the target cell; the anim1 symbol renders its impact there.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
