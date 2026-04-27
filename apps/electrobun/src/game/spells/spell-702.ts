/**
 * Spell 702 — Grina (Sacrieur / Sram area-of-effect ground attack).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/702/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile, no caster-reference logic,
 * no dual-anchored world-absolute placement — all content renders at the
 * target cell. The canonical scripts contain no `move`/`shoot`/`duplicate`
 * symbols and no `_parent.cellFrom`/`_parent.cellTo` reads.
 *
 * Manifest has no `librarySymbols[]` entries — all five sprites are in
 * `animations[]` only. Texture keys therefore use bare names (NO `lib_`
 * prefix).
 *
 * Authored timeline structure (all from animations[]):
 *   - sprite_5  (6 frames)   — small glint/spark; frame_1 jumps to a
 *                              random still frame via gotoAndStop(random(8)+1).
 *   - sprite_6  (57 frames)  — mid-size hit burst composite.
 *   - sprite_8  (123 frames) — looping ground-slash composite. frame_1
 *                              jumps to a random frame in [2,101] to
 *                              de-sync instances; frame_121 loops back
 *                              to frame 2.
 *   - sprite_9  (120 frames) — large ground-crack composite; frame_118
 *                              stops (stopFrame hint matches).
 *   - sprite_11 (186 frames) — longest-lived composite. A clip placed
 *                              on frame_157 fades its parent's alpha by
 *                              3.33/tick via onEnterFrame. frame_184
 *                              calls `_parent._parent.removeMovieClip()`
 *                              — two hops up from the inner clip → the
 *                              outer mc / spell root → this.runtime.complete().
 *
 * signalHit: fired at sprite_6 frame_1 (first impact frame visible).
 * complete:  fired by sprite_11 frame_184 script (outermost removal).
 *
 * Main timeline frame_1: SOMA.playSound("grina_702").
 * All five sprites are implicitly placed on the main timeline at depth 1-5
 * and start ticking from the next runtime frame after onSpellStart attaches
 * them.
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

const SPRITE5_BOUNDS = {
  width: 159.45,
  height: 44.95,
  offsetX: -104.3,
  offsetY: 0.55,
};

const SPRITE6_BOUNDS = {
  width: 140.8,
  height: 188.7,
  offsetX: -55.5,
  offsetY: -65.2,
};

const SPRITE8_BOUNDS = {
  width: 122.95,
  height: 68.75,
  offsetX: -53.75,
  offsetY: -36.6,
};

const SPRITE9_BOUNDS = {
  width: 290.5,
  height: 162.4,
  offsetX: -129.85,
  offsetY: 19.6,
};

const SPRITE11_BOUNDS = {
  width: 195.75,
  height: 109.4,
  offsetX: -88.1,
  offsetY: -59.7,
};

export class Spell702 extends RuntimeSpell {
  readonly spellId = 702;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite5Sym!: SymbolDefinition;
  private sprite6Sym!: SymbolDefinition;
  private sprite8Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite11Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite5Anchor = calculateAnchor(SPRITE5_BOUNDS);
    const sprite6Anchor = calculateAnchor(SPRITE6_BOUNDS);
    const sprite8Anchor = calculateAnchor(SPRITE8_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE9_BOUNDS);
    const sprite11Anchor = calculateAnchor(SPRITE11_BOUNDS);

    // ---- sprite_5 — small glint spark (6 frames) ----------------
    // AS DefineSprite_5/frame_1/DoAction.as:
    //   gotoAndStop(random(8) + 1);
    // Jumps to a random still frame in [1,8]. Since the asset only has
    // 6 frames the effective range is [0,5] (0-based), but we port the
    // AS faithfully: gotoAndStop(random(8)+1) → gotoAndStop(N-1) where
    // N = floor(random*8)+1, so 0-based target = floor(random*8).
    this.sprite5Sym = {
      name: "sprite_5",
      totalFrames: 6,
      frames: textures.getFrames("sprite_5"),
      anchorX: sprite5Anchor.x,
      anchorY: sprite5Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_5/frame_1/DoAction.as: gotoAndStop(random(8) + 1)
            const target = Math.floor(Math.random() * 8);
            clip.gotoAndStop(target);
          },
        ],
      ]),
    };

    // ---- sprite_6 — mid-size hit burst (57 frames) ---------------
    // No frame scripts in the canonical AS for this symbol beyond playing
    // through. We use it to signal the hit on its first frame (frame_1 =
    // index 0), which is the canonical moment of impact visibility.
    this.sprite6Sym = {
      name: "sprite_6",
      totalFrames: 57,
      frames: textures.getFrames("sprite_6"),
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // Impact frame — signal hit to the combat sequencer.
            this.runtime.signalHit();
          },
        ],
      ]),
    };

    // ---- sprite_8 — looping ground-slash (123 frames) ------------
    // AS DefineSprite_8/frame_1/DoAction.as:
    //   gotoAndPlay(random(100) + 2);
    // AS DefineSprite_8/frame_121/DoAction.as:
    //   gotoAndPlay(2);
    this.sprite8Sym = {
      name: "sprite_8",
      totalFrames: 123,
      frames: textures.getFrames("sprite_8"),
      anchorX: sprite8Anchor.x,
      anchorY: sprite8Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_8/frame_1/DoAction.as: gotoAndPlay(random(100) + 2)
            const target = Math.floor(Math.random() * 100) + 2;
            clip.gotoAndPlay(target - 1);
          },
        ],
        [
          120,
          (clip) => {
            // AS DefineSprite_8/frame_121/DoAction.as: gotoAndPlay(2)
            clip.gotoAndPlay(1);
          },
        ],
      ]),
    };

    // ---- sprite_9 — large ground-crack (120 frames) --------------
    // AS DefineSprite_9/frame_118/DoAction.as:
    //   stop();
    this.sprite9Sym = {
      name: "sprite_9",
      totalFrames: 120,
      frames: textures.getFrames("sprite_9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      frameScripts: new Map([
        [
          117,
          (clip) => {
            // AS DefineSprite_9/frame_118/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_11 — longest-lived composite (186 frames) --------
    // AS DefineSprite_11/frame_157/PlaceObject2_10_69/CLIPACTIONRECORD
    //   onClipEvent(enterFrame).as:
    //   _parent._alpha -= 3.33;
    //   (the inner placed clip fades its direct parent = sprite_11 clip)
    //
    // AS DefineSprite_11/frame_184/DoAction.as:
    //   _parent._parent.removeMovieClip();
    //   Two hops: from the inner clip's perspective _parent = sprite_11,
    //   _parent._parent = the outer mc = our root → complete().
    //   We express the fade via an onEnterFrame on the sprite_11 clip
    //   itself (activated at frame_157) using a vars flag, since the
    //   canonical placed-object clip event has no direct SymbolDefinition
    //   equivalent — instead we track activation in frameScripts[156] and
    //   perform the fade from the sprite_11 onEnterFrame.
    this.sprite11Sym = {
      name: "sprite_11",
      totalFrames: 186,
      frames: textures.getFrames("sprite_11"),
      anchorX: sprite11Anchor.x,
      anchorY: sprite11Anchor.y,
      onEnterFrame: (clip) => {
        // AS DefineSprite_11/frame_157/PlaceObject2_10_69/
        //   CLIPACTIONRECORD onClipEvent(enterFrame).as:
        //   _parent._alpha -= 3.33;
        // The fade only starts once the inner placed clip becomes active
        // at frame_157. We gate on a vars flag set in frameScripts[156].
        if (clip.vars.fading) {
          clip.alpha = Math.max(0, clip.alpha - 3.33 / 100);
        }
      },
      frameScripts: new Map([
        [
          156,
          (clip) => {
            // frame_157: the canonical placed object (PlaceObject2_10_69)
            // becomes active here and its onClipEvent(load) fires, then
            // its onClipEvent(enterFrame) runs each tick. We activate the
            // fade flag at this frame to mirror that timing.
            clip.vars.fading = true;
          },
        ],
        [
          183,
          (clip) => {
            // AS DefineSprite_11/frame_184/DoAction.as:
            //   _parent._parent.removeMovieClip();
            // From the perspective of a script running IN sprite_11's
            // own timeline, _parent is the root, so _parent._parent
            // would be one level above the root — effectively the outer
            // mc. We call complete() to end the spell.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite5Sym);
    this.registry.register(this.sprite6Sym);
    this.registry.register(this.sprite8Sym);
    this.registry.register(this.sprite9Sym);
    this.registry.register(this.sprite11Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS frame_1/DoAction.as: SOMA.playSound("grina_702");
    callbacks.playSound("grina_702");

    // The main timeline implicitly places all five sprites as authored
    // children. Attach them so they start ticking from the next runtime
    // frame. Depths 1-5 mirror the canonical authored placement order.
    this.root.attach(this.sprite5Sym, "sprite5", 1, context);
    this.root.attach(this.sprite6Sym, "sprite6", 2, context);
    this.root.attach(this.sprite8Sym, "sprite8", 3, context);
    this.root.attach(this.sprite9Sym, "sprite9", 4, context);
    this.root.attach(this.sprite11Sym, "sprite11", 5, context);
  }
}
