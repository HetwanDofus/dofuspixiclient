/**
 * Spell 1003 — Licrounch (Ecaflip/neutral bite attack).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1003/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile motion, no
 * caster-side anchor, no beam — it is a single impact animation playing
 * at the target cell. No `librarySymbols[]` entries are present in the
 * manifest; all visual content is driven by two top-level `animations[]`
 * entries (`anim1` and `anim29`), which are composite multi-frame sprites
 * rendered directly.
 *
 * Canonical AS layout:
 *   - frame_1/DoAction.as          : SOMA.playSound("licrounch_1003")
 *   - DefineSprite_8               : outer container (171 frames).
 *       frame_1/DoAction.as        : SOMA.playSound("licrounch_1003")
 *       frame_133/DoAction.as      : this.end() → signalHit
 *       frame_133/PlaceObject2_7_27: onClipEvent(enterFrame) → _parent._alpha -= 5 (fade out)
 *       frame_169/DoAction.as      : _parent.removeMovieClip(); stop() → complete
 *   - DefineSprite_6               : sub-sprite (flash-in particle).
 *       frame_1/PlaceObject2_5_1:
 *         onClipEvent(load)        : _alpha = 0
 *         onClipEvent(enterFrame)  : random(15)==1 → v=1; if _alpha<100 & v==1 → _alpha+=30
 *   - DefineSprite_5               : sub-sprite (randomised start).
 *       frame_1/DoAction.as        : gotoAndPlay(random(5))
 *
 * The anim1 / anim29 animations in the manifest correspond to the two
 * composite rendered timelines. Since `librarySymbols` is empty, we use
 * bare names (no `lib_` prefix) and attach them as the main visual.
 *
 * The outer DefineSprite_8 drives the hit/complete signals:
 *   - frame 133 (0-based: 132) → signalHit
 *   - frame 169 (0-based: 168) → complete
 *
 * DefineSprite_6 is the flash-in sub-symbol: alpha starts at 0, randomly
 * triggers a v=1 flag, then ramps alpha +30 per frame until 100.
 *
 * DefineSprite_5 jumps to a random start frame on load via gotoAndPlay(random(5)).
 *
 * Because neither DefineSprite_5 nor DefineSprite_6 appears via attachMovie
 * in the AS scripts we have (they are placed on the DefineSprite_8 timeline
 * by PlaceObject2 tags, not by attachMovie), we register them as inline
 * symbols used by the anim8 (outer) container logic and attach them from
 * within the outer symbol's frame_1 script.
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

// Bounds for anim1 / anim29 — from manifest animations[] entries (identical bounds).
const ANIM_BOUNDS = {
  width: 131.55,
  height: 59.25,
  offsetX: -37.75,
  offsetY: -36.45,
};

export class Spell1003 extends RuntimeSpell {
  readonly spellId = 1003;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const animAnchor = calculateAnchor(ANIM_BOUNDS);

    // ---- DefineSprite_6 sub-symbol — flash-in particle ----------
    // Placed via PlaceObject2 inside DefineSprite_8's timeline (not via
    // attachMovie), but modelled here so the outer symbol can attach it.
    //
    // AS DefineSprite_6/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load):
    //   _alpha = 0;
    // AS DefineSprite_6/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame):
    //   if(random(15) == 1) { v = 1; }
    //   if(_alpha < 100 & v == 1) { _alpha = _alpha + 30; }
    const sprite6Sym: SymbolDefinition = {
      name: "sprite6",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_6/frame_1/PlaceObject2_5_1/onClipEvent(load)
        clip.alpha = 0;
        clip.vars.v = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_6/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame)
        if (Math.floor(Math.random() * 15) === 1) {
          clip.vars.v = 1;
        }
        const v = clip.vars.v as number;
        if (clip.alpha < 1 && v === 1) {
          // AS: _alpha < 100 → TS: alpha < 1; AS: _alpha += 30 → TS: alpha += 0.3
          clip.alpha = Math.min(1, clip.alpha + 30 / 100);
        }
      },
    };

    // ---- DefineSprite_5 sub-symbol — randomised start frame -----
    // AS DefineSprite_5/frame_1/DoAction.as:
    //   gotoAndPlay(random(5));
    //
    // Uses anim29 textures (the second composite animation). In canonical
    // AS this sprite plays from a random entry frame within the first 5.
    const sprite5Sym: SymbolDefinition = {
      name: "sprite5",
      totalFrames: 171,
      frames: textures.getFrames("anim29"),
      anchorX: animAnchor.x,
      anchorY: animAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_5/frame_1/DoAction.as: gotoAndPlay(random(5))
            // random(5) gives 0..4 in AS; gotoAndPlay(N) is 1-based in AS
            // but random(5) can be 0, so effective target is frames 0..4.
            // We call gotoAndPlay with the 0-based equivalent: random(5) + 0
            // (AS gotoAndPlay(0) == frame 1 in AS == index 0 here, but
            // AS gotoAndPlay(random(5)) where random(5) ∈ {0,1,2,3,4} means
            // frames 0-4 in AS. Frame 0 in AS = index 0 here.)
            const target = Math.floor(Math.random() * 5);
            clip.gotoAndPlay(target);
          },
        ],
      ]),
    };

    // ---- DefineSprite_8 — outer container (171 frames) ----------
    // Uses anim1 textures (the primary composite animation).
    //
    // frame_1/DoAction.as   : SOMA.playSound("licrounch_1003") — handled in onSpellStart
    // frame_133/DoAction.as  : this.end() → signalHit at 0-based index 132
    // frame_133/PlaceObject2_7_27/onClipEvent(enterFrame): _parent._alpha -= 5
    //   → fade out the OUTER container (this clip's parent = root) by 5/100 per frame
    // frame_169/DoAction.as  : _parent.removeMovieClip(); stop() → complete at 0-based 168
    const sprite8Sym: SymbolDefinition = {
      name: "sprite8",
      totalFrames: 171,
      frames: textures.getFrames("anim1"),
      anchorX: animAnchor.x,
      anchorY: animAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_8/frame_1/DoAction.as: SOMA.playSound("licrounch_1003")
            // Sound is played in onSpellStart; here we attach the sub-sprites
            // that are placed on this symbol's timeline by PlaceObject2 tags.
            clip.attach(sprite5Sym, "sprite5", 1, ctx);
            clip.attach(sprite6Sym, "sprite6", 2, ctx);
          },
        ],
        [
          132,
          (clip) => {
            // AS DefineSprite_8/frame_133/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
            // AS DefineSprite_8/frame_133/PlaceObject2_7_27/onClipEvent(enterFrame):
            //   _parent._alpha -= 5
            // The PlaceObject2 event fires every frame from here on. We
            // model this by installing an onEnterFrame on the clip itself
            // that decays the parent (root) alpha.
            clip.onEnterFrame = () => {
              // AS: _parent._alpha -= 5  → root alpha decrements by 5/100 per frame
              const root = clip.parent;
              if (root) {
                root.alpha = Math.max(0, root.alpha - 5 / 100);
              }
            };
          },
        ],
        [
          168,
          (clip) => {
            // AS DefineSprite_8/frame_169/DoAction.as: _parent.removeMovieClip(); stop()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite5Sym);
    this.registry.register(sprite6Sym);
    this.registry.register(sprite8Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS frame_1/DoAction.as: SOMA.playSound("licrounch_1003")
    callbacks.playSound("licrounch_1003");
    // Attach the outer sprite8 container which drives the full animation.
    this.root.attach(
      this.registry.resolve("sprite8")!,
      "sprite8",
      1,
      context,
    );
  }
}
