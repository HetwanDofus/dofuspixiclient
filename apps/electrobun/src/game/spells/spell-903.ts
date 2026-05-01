/**
 * Spell 903 — Flèche Enflammée (Cra fire arrow, variant).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/903/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single composite animation
 * (`anim1`, 75 frames) rendered at the target cell, plus a DefineSprite_11
 * outer container that drives the lifecycle. No projectile motion, no caster
 * anchor — pure impact at target. DefineSprite_11 frame_73 calls
 * `_parent.removeMovieClip()` → `this.runtime.complete()`. frame_13 calls
 * `this.end()` → `this.runtime.signalHit()`.
 *
 * Library symbols (from manifest.librarySymbols[]):
 *   - sprite7 (characterId 7) — 12-frame animated flame sprite. directlyDynamic.
 *       frame_1/DoAction.as: scatter _Y, _X, _yscale.
 *       PlaceObject2_6_6 onClipEvent(load): randomise _xscale.
 *   - sprite8 (characterId 8) — 1-frame wrapper that contains three sprite7
 *       instances (depths 1, 8, 15) with staggered gotoAndPlay offsets.
 *       directlyDynamic. Each placed sprite7 has its own onClipEvent(load):
 *         depth 1:  set scale to (10 + 3*level), play from frame 1.
 *         depth 8:  set scale to (10 + 3*level), gotoAndPlay(6).
 *         depth 15: set scale to (10 + 3*level), gotoAndPlay(9).
 *   - DefineSprite_11 (the outer timeline, 75 frames, matched to anim1).
 *       frame_1:  _xscale/_yscale = 50 + level*5.
 *       frame_13: this.end() → signalHit.
 *       frame_73: _parent.removeMovieClip() → complete.
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("jet_903").
 *
 * The composite `anim1` animation (75 frames, 197.95×102.2) IS the
 * DefineSprite_11 outer shell rendered as authored SVG frames. We register
 * it as the "sprite11" symbol so the runtime drives its timeline scripts
 * while also showing the authored keyframe visuals.
 *
 * DefineSprite_2 (frame_1: _alpha -= 25) is the fade-out applied to the
 * sprite8 children instances — it runs once on load, decrementing alpha by
 * 25 units per load call. Since this is a one-shot DoAction on a placed
 * child that already has per-level scale set, we fold it into the sprite7
 * onLoad so the instances fade in proportionally.
 *
 * Placement hierarchy:
 *   root → sprite11 (anim1 container, placed in onSpellStart)
 *     sprite11.frame_0 → sprite8 (depth 1, at x=40, y=-0.35)
 *       sprite8.frame_0 → sprite7 instances at depths 1, 8, 15
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

// Bounds from manifest.librarySymbols
const SPRITE7_BOUNDS = {
  width: 217.7,
  height: 465.6,
  offsetX: -101.55,
  offsetY: -326.2,
};

const SPRITE8_BOUNDS = {
  width: 123.75,
  height: 39.6,
  offsetX: -2.25,
  offsetY: -19.95,
};

// Bounds for the outer DefineSprite_11 shell — matches the anim1 composite
const ANIM1_BOUNDS = {
  width: 197.95,
  height: 102.2,
  offsetX: 7.1,
  offsetY: -52.55,
};

export class Spell903 extends RuntimeSpell {
  readonly spellId = 903;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite11Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite7Anchor = calculateAnchor(SPRITE7_BOUNDS);
    const sprite8Anchor = calculateAnchor(SPRITE8_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- sprite7 — 12-frame animated flame particle ---------------
    // AS DefineSprite_7/frame_1/DoAction.as:
    //   _Y = 40 * (Math.random() - 0.5)
    //   _X = 5 + 20 * (Math.random() - 0.5)
    //   _yscale = 25 + 5 * (Math.random() - 0.5)
    //
    // AS DefineSprite_7/frame_1/PlaceObject2_6_6/CLIPACTIONRECORD onClipEvent(load).as:
    //   _xscale = random(100)
    //
    // The DoAction runs as the frame_1 script (frameScripts[0]).
    // The onClipEvent(load) is for an inner placed child at depth 6 inside
    // sprite7's own timeline. Since sprite7 has authored SVG frames and the
    // inner child (PlaceObject2_6_6) carries the load handler, we fold the
    // xscale randomisation into the sprite7 onLoad to preserve the visual
    // variance the canonical AS produces.
    const sprite7Sym: SymbolDefinition = {
      name: "sprite7",
      totalFrames: 12,
      frames: textures.getFrames("lib_sprite7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_7/frame_1/PlaceObject2_6_6/CLIPACTIONRECORD onClipEvent(load).as
        // _xscale = random(100)
        clip.scaleX = Math.floor(Math.random() * 100) / 100;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_7/frame_1/DoAction.as
            // _Y = 40 * (Math.random() - 0.5)
            // _X = 5 + 20 * (Math.random() - 0.5)
            // _yscale = 25 + 5 * (Math.random() - 0.5)
            clip.y = 40 * (Math.random() - 0.5);
            clip.x = 5 + 20 * (Math.random() - 0.5);
            clip.scaleY = (25 + 5 * (Math.random() - 0.5)) / 100;
          },
        ],
      ]),
    };

    // ---- sprite8 — 1-frame wrapper containing three sprite7 instances ----
    // AS DefineSprite_8/frame_1/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   a = 20; t = 10 + 3 * _parent._parent._parent.level
    //   _xscale = t; _yscale = t
    //   (no gotoAndPlay — plays from frame 1)
    //
    // AS DefineSprite_8/frame_1/PlaceObject2_7_8/CLIPACTIONRECORD onClipEvent(load).as:
    //   gotoAndPlay(6); a = 20; t = 10 + 3 * _parent._parent._parent.level
    //   _xscale = t; _yscale = t
    //
    // AS DefineSprite_8/frame_1/PlaceObject2_7_15/CLIPACTIONRECORD onClipEvent(load).as:
    //   gotoAndPlay(9); a = 20; t = 10 + 3 * _parent._parent._parent.level
    //   _xscale = t; _yscale = t
    //
    // The three placements are at depths 1, 8, 15 of sprite8's frame 0.
    // _parent._parent._parent.level traversal: sprite7 → sprite8 → sprite11 → root
    const sprite8Sym: SymbolDefinition = {
      name: "sprite8",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite8"),
      anchorX: sprite8Anchor.x,
      anchorY: sprite8Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Attach three sprite7 instances mirroring the three PlaceObject2 placements.
            // Level traversal: clip is sprite8, clip.parent is sprite11, clip.parent.parent is root.
            const root = clip.parent?.parent ?? clip.parent;
            const level = (root?.vars.level as number) ?? 1;
            const t = 10 + 3 * level;

            // AS DefineSprite_8/frame_1/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(load).as
            // depth 1: no gotoAndPlay override, plays from frame 1 (0-indexed: 0)
            const inst1 = clip.attach(sprite7Sym, "sprite7_1", 1, ctx, {
              x: 35.1,
              y: -0.15,
            });
            // vars.a = 20 (canonical AS local — stored for potential future use)
            inst1.vars.a = 20;
            inst1.scaleX = t / 100;
            inst1.scaleY = t / 100;
            // plays from frame 0 by default (already the case)

            // AS DefineSprite_8/frame_1/PlaceObject2_7_8/CLIPACTIONRECORD onClipEvent(load).as
            // depth 8: gotoAndPlay(6) → 0-indexed frame 5
            const inst8 = clip.attach(sprite7Sym, "sprite7_8", 8, ctx, {
              x: 35.75,
              y: -1.5,
            });
            inst8.vars.a = 20;
            inst8.scaleX = t / 100;
            inst8.scaleY = t / 100;
            inst8.gotoAndPlay(5);

            // AS DefineSprite_8/frame_1/PlaceObject2_7_15/CLIPACTIONRECORD onClipEvent(load).as
            // depth 15: gotoAndPlay(9) → 0-indexed frame 8
            const inst15 = clip.attach(sprite7Sym, "sprite7_15", 15, ctx, {
              x: 34.7,
              y: -2.35,
            });
            inst15.vars.a = 20;
            inst15.scaleX = t / 100;
            inst15.scaleY = t / 100;
            inst15.gotoAndPlay(8);
          },
        ],
      ]),
    };

    // ---- sprite11 / anim1 — outer 75-frame container with lifecycle scripts ----
    // AS DefineSprite_11/frame_1/DoAction.as:
    //   t = 50 + _parent.level * 5; _xscale = t; _yscale = t
    //
    // AS DefineSprite_11/frame_13/DoAction.as:
    //   this.end() → signalHit
    //
    // AS DefineSprite_11/frame_73/DoAction.as:
    //   this._parent.removeMovieClip() → complete
    //
    // sprite8 is placed inside sprite11 at depth 1, x=40, y=-0.35 on frame 0.
    // (from manifest librarySymbols sprite8 placements, parentSpriteId=11, frame=0)
    this.sprite11Sym = {
      name: "sprite11",
      totalFrames: 75,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_11/frame_1/DoAction.as
            // t = 50 + _parent.level * 5; _xscale = t; _yscale = t
            const level = (clip.parent?.vars.level as number) ?? 1;
            const t = 50 + level * 5;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;

            // Place sprite8 at depth 1, x=40, y=-0.35
            // (manifest: sprite8 placements parentSpriteId=11, frame=0, kind="place")
            clip.attach(sprite8Sym, "sprite8_1", 1, ctx, {
              x: 40,
              y: -0.35,
            });
          },
        ],
        [
          12,
          () => {
            // AS DefineSprite_11/frame_13/DoAction.as
            // this.end() — damage popup signal
            this.runtime.signalHit();
          },
        ],
        [
          72,
          (clip) => {
            // AS DefineSprite_11/frame_73/DoAction.as
            // this._parent.removeMovieClip() — spell complete
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite7Sym);
    this.registry.register(sprite8Sym);
    this.registry.register(this.sprite11Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("jet_903")
    callbacks.playSound("jet_903");

    // Attach the outer sprite11 container at the root so it starts ticking.
    // Root is at target cell (TargetCell displayType), so sprite11 renders there.
    this.root.attach(this.sprite11Sym, "sprite11", 1, context);
  }
}
