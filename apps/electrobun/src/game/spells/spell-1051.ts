/**
 * Spell 1051 — Sacrieur (unknown name, Sacrieur class).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1051/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no `move`/`shoot`/`duplicate`
 * symbol, no caster reference, and no world-absolute positioning. The
 * single animation plays at the target cell — classic TargetCell pattern.
 *
 * AS layout:
 *   - Main timeline (47 frames):
 *       frame_1/DoAction.as:   SOMA.playSound("sacrieur_1051")
 *       frame_1/DoAction_2.as: play()
 *       frame_1/PlaceObject2_1_1/onClipEvent(enterFrame): randomises _alpha,
 *           _xscale/_yscale, _rotation each frame on the root clip instance.
 *       frame_47/DoAction.as:  this.removeMovieClip() — spell complete.
 *
 *   - DefineSprite_6 (= "sprite_6" animation, 40 frames):
 *       frame_1/DoAction.as:   t = 20 + random(80); _xscale = _yscale = t
 *       frame_39/DoAction.as:  stop()
 *       This is the main visual sprite placed on the timeline at frame_1.
 *       It carries its own authored 40-frame texture sequence.
 *
 *   - DefineSprite_7 (container wrapping sprite_6):
 *       frame_1/PlaceObject2_6_1/onClipEvent(load): gotoAndPlay(random(20))
 *       This wrapper gives the inner sprite_6 a random start offset.
 *
 * Library symbols: none in `librarySymbols[]` (manifest shows empty array).
 * The animations[] list contains "sprite_6" — the single visual sequence.
 * DefineSprite_7 is the wrapping container; DefineSprite_6 is the content.
 *
 * Because the main timeline's PlaceObject2_1_1 onClipEvent(enterFrame)
 * runs on the root clip instance placed at depth 1, and DefineSprite_7
 * wraps DefineSprite_6, we model this as:
 *   - sprite7Sym: container symbol wrapping sprite6Sym, onLoad fires
 *     gotoAndPlay(random(20)) on itself so sprite_6 inside starts at a
 *     random frame.
 *   - sprite6Sym: the 40-frame visual, frame_1 randomises scale, frame_39
 *     stops.
 *   - root onEnterFrame: the PlaceObject2_1_1 clip event — randomises
 *     alpha, scale, rotation on the child at depth 1 each frame.
 *   - root frameScripts[46]: this.removeMovieClip() → runtime.complete().
 *
 * signalHit is fired at frame_47 (index 46) alongside completion since
 * there is no earlier canonical hit frame in the scripts.
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

const SPRITE6_BOUNDS = {
  width: 145.2,
  height: 102,
  offsetX: -7.9,
  offsetY: -51.1,
};

export class Spell1051 extends RuntimeSpell {
  readonly spellId = 1051;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite6Sym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite6Anchor = calculateAnchor(SPRITE6_BOUNDS);

    // ---- sprite_6 (DefineSprite_6) — 40-frame visual sprite --------
    // AS DefineSprite_6/frame_1/DoAction.as:
    //   t = 20 + random(80); _xscale = t; _yscale = t;
    // AS DefineSprite_6/frame_39/DoAction.as:
    //   stop();
    this.sprite6Sym = {
      name: "sprite_6",
      totalFrames: 40,
      frames: textures.getFrames("sprite_6"),
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_6/frame_1/DoAction.as
            const t = 20 + Math.floor(Math.random() * 80);
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
          },
        ],
        [
          38,
          (clip) => {
            // AS DefineSprite_6/frame_39/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_7 (DefineSprite_7) — container wrapping sprite_6 ---
    // AS DefineSprite_7/frame_1/PlaceObject2_6_1/onClipEvent(load):
    //   gotoAndPlay(random(20));
    // The onLoad fires on the sprite_7 clip itself — it jumps to a
    // random frame so sprite_6 (its child) starts at an offset position.
    // We model sprite_7 as a single-frame container with no visual frames.
    this.sprite7Sym = {
      name: "sprite_7",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_7/frame_1/PlaceObject2_6_1/onClipEvent(load)
        // The inner sprite_6 is placed as a child of sprite_7. We attach
        // it here (mirrors the authored PlaceObject2 at depth 6 inside
        // DefineSprite_7) and then jump sprite_7 to a random start frame.
        clip.attach(this.sprite6Sym, "sprite_6", 6, ctx);
        clip.gotoAndPlay(Math.floor(Math.random() * 20));
      },
    };

    this.registry.register(this.sprite6Sym);
    this.registry.register(this.sprite7Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS frame_1/DoAction.as: SOMA.playSound("sacrieur_1051");
    callbacks.playSound("sacrieur_1051");

    // AS frame_1/DoAction_2.as: play();
    // Root is already playing by default; this is a no-op but mirrors
    // the canonical explicit play() call.
    this.root.play();

    // Attach sprite_7 (which wraps sprite_6) at depth 1 on the root,
    // mirroring the PlaceObject2_1_1 authored placement on the main
    // timeline frame_1.
    this.root.attach(this.sprite7Sym, "sprite_7", 1, context);

    // AS frame_1/PlaceObject2_1_1/onClipEvent(enterFrame):
    //   _alpha = -20 + random(80);
    //   t = 10 * Math.random() + 90;
    //   _xscale = t;
    //   _yscale = t;
    //   _rotation = random(360);
    // This clip event runs every frame on the instance placed at depth 1
    // (sprite_7). We set it as the root's onEnterFrame since the harness
    // runs root.onEnterFrame each tick and the child (sprite_7) is the
    // one at depth 1 whose properties get randomised.
    this.root.onEnterFrame = (clip) => {
      // AS frame_1/PlaceObject2_1_1/onClipEvent(enterFrame)
      const child = clip.children.get("sprite_7");
      if (child) {
        child.alpha = (-20 + Math.floor(Math.random() * 80)) / 100;
        const t = 10 * Math.random() + 90;
        child.scaleX = t / 100;
        child.scaleY = t / 100;
        child.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      }
    };

    // Wire up the main timeline frame_47 completion on the root.
    // The root clip's timeline runs for 47 frames; frame_47 is index 46.
    // We use the root's frameScripts via a workaround: attach a synthetic
    // 47-frame "main" symbol definition is not needed — instead we
    // piggyback on the root's onEnterFrame accumulator by tracking the
    // frame count in root.vars, since root has no symbol and no
    // frameScripts of its own.
    //
    // Simpler approach: use root.vars to count frames, fire complete() at
    // frame 47 (index 46 in 0-based terms) from onEnterFrame.
    this.root.vars.mainFrame = 0;

    const originalEnterFrame = this.root.onEnterFrame!;
    this.root.onEnterFrame = (clip, ctx) => {
      // Run the original enterFrame (child alpha/scale/rotation randomise)
      originalEnterFrame(clip, ctx);

      // Advance the main timeline counter
      const mainFrame = (clip.vars.mainFrame as number) + 1;
      clip.vars.mainFrame = mainFrame;

      // AS frame_47/DoAction.as: this.removeMovieClip() — spell complete.
      // frame_47 is the 47th frame; at 60 fps ticking we reach it after
      // 46 increments (0-based index 46 = the 47th tick).
      if (mainFrame === 46) {
        // Signal hit here since there is no earlier canonical hit frame.
        this.runtime.signalHit();
        clip.remove();
        this.runtime.complete();
      }
    };
  }
}
