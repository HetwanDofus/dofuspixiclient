/**
 * Spell 213 — Croque-mitaine.
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/213/scripts/scripts/
 *
 * displayType=11 (TargetCell). No move/shoot/duplicate symbols — pure
 * impact animation at the target cell. The single authored composite
 * timeline `anim1` (306 frames) plays at the target, and its frame_304
 * script removes the parent and signals spell completion.
 *
 * librarySymbols[] is EMPTY in the manifest — all texture keys use the
 * bare name from animations[] (no "lib_" prefix).
 *
 * Symbol hierarchy (all container-only except the outer anim1):
 *
 *   anim1 (DefineSprite_13, 306 frames, composite texture sequence):
 *     frame_304/DoAction.as → _parent.removeMovieClip() → complete().
 *     Internally places DefineSprite_3/9/10/11/12 on its authored timeline;
 *     those are modelled as container-only sub-symbols with clip-event handlers.
 *
 *   sprite9 (DefineSprite_9):
 *     onLoad: random scale [80,130]%.
 *
 *   sprite10 (DefineSprite_10):
 *     onLoad: random rotation, alpha [40,90], phase i.
 *     onEnterFrame: xscale = 100*sin(i += 0.1).
 *
 *   sprite11 (DefineSprite_11):
 *     onEnterFrame: alpha = random(170).
 *
 *   sprite3 (DefineSprite_3):
 *     onLoad: v = 0.
 *     onEnterFrame: gravity + bounce physics; resets when Y > 0.
 *
 *   sprite12 (DefineSprite_12):
 *     Two instances (depths 1 + 5) with identical load/enterFrame.
 *     onLoad: seed st/i/p/v2/rotation/alpha; parent alpha = 10.
 *     onEnterFrame: spiral motion, fade parent alpha in/out, removeMovieClip when faded.
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("crockette_213").
 * Hit signal: frame 2 (index 1) of anim1 — first impact frame for TargetCell.
 * Completion: frame 304 (index 303) of anim1.
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
  width: 48,
  height: 46.1,
  offsetX: -22.6,
  offsetY: -18.55,
};

export class Spell213 extends RuntimeSpell {
  readonly spellId = 213;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    // ---- sprite9 (DefineSprite_9) — randomly-scaled sub-sprite --
    const sprite9Sym: SymbolDefinition = {
      name: "sprite9",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_9/frame_1/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(load).as
        // t = 80 + random(50); _xscale = t; _yscale = t;
        const t = 80 + Math.floor(Math.random() * 50);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
      },
    };

    // ---- sprite10 (DefineSprite_10) — oscillating glow sub-sprite
    const sprite10Sym: SymbolDefinition = {
      name: "sprite10",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
        // _rotation = random(360) - 90; _alpha = random(50) + 40; i = Math.random() * 6;
        const rotDeg = Math.floor(Math.random() * 360) - 90;
        clip.rotation = (rotDeg * Math.PI) / 180;
        clip.alpha = (Math.floor(Math.random() * 50) + 40) / 100;
        clip.vars.i = Math.random() * 6;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _xscale = 100 * Math.sin(i += 0.1);
        let i = clip.vars.i as number;
        i += 0.1;
        clip.vars.i = i;
        clip.scaleX = (100 * Math.sin(i)) / 100;
      },
    };

    // ---- sprite11 (DefineSprite_11) — random-alpha flicker ------
    const sprite11Sym: SymbolDefinition = {
      name: "sprite11",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS DefineSprite_11/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _alpha = random(170);
        clip.alpha = Math.floor(Math.random() * 170) / 100;
      },
    };

    // ---- sprite3 (DefineSprite_3) — bouncing particle -----------
    const sprite3Sym: SymbolDefinition = {
      name: "sprite3",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
        // v = 0;
        clip.vars.v = 0;
        // vx is used in enterFrame but not initialised in onLoad —
        // seed as 0 so the first bounce sets a real value.
        clip.vars.vx = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _Y = _Y + v; _X = _X + vx; v += 0.6;
        // if (_Y > 0) { _Y = 0; v = -5 * Math.random(); vx = -2.5 * Math.random() + 1.25; }
        let v = clip.vars.v as number;
        const vx = clip.vars.vx as number;
        clip.y += v;
        clip.x += vx;
        v += 0.6;
        if (clip.y > 0) {
          clip.y = 0;
          v = -5 * Math.random();
          clip.vars.vx = -2.5 * Math.random() + 1.25;
        }
        clip.vars.v = v;
      },
    };

    // ---- sprite12 (DefineSprite_12) — rising/fading spiral ------
    // Two instances placed at depths 1 and 5 share identical scripts.
    // We register one symbol definition; the parent (anim1) would attach
    // it twice under different instance names. Since this is a container-only
    // sub-sprite on the composite authored timeline, we model it with
    // clip-event handlers only.
    const sprite12Sym: SymbolDefinition = {
      name: "sprite12",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_12/frame_1/PlaceObject2_11_1 (and _11_5)
        //    CLIPACTIONRECORD onClipEvent(load).as
        // st = 0; i = 0; p = 0;
        // v2 = 0.05 + 0.05 * Math.random();
        // _rotation = random(360);
        // _alpha = 120;
        // _parent._alpha = 10;
        // v = 0.5 + 0.5 * Math.random();
        clip.vars.st = 0;
        clip.vars.i = 0;
        clip.vars.p = 0;
        clip.vars.v2 = 0.05 + 0.05 * Math.random();
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        clip.alpha = 120 / 100;
        if (clip.parent) {
          clip.parent.alpha = 10 / 100;
        }
        clip.vars.v = 0.5 + 0.5 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_12/frame_1/PlaceObject2_11_1 (and _11_5)
        //    CLIPACTIONRECORD onClipEvent(enterFrame).as
        // if (_Y > -80 & _parent._alpha < 100) { _parent._alpha += 6; }
        // if (_Y < -80) {
        //   _parent._alpha -= 6;
        //   if (_parent._alpha < 0) { _parent._visible = 0; st = 1; _parent.removeMovieClip(); }
        // }
        // _rotation += 1.3;
        // _Y = 5 * Math.cos(i) + (p -= v);
        // _X = 25 * Math.sin(i += v2);
        // if (Math.cos(i) < 0) { _alpha = 80 * Math.cos(i) + 100; }
        let i = clip.vars.i as number;
        let p = clip.vars.p as number;
        const v = clip.vars.v as number;
        const v2 = clip.vars.v2 as number;
        const parent = clip.parent;

        if (clip.y > -80 && parent !== null && parent.alpha < 100 / 100) {
          parent.alpha = Math.min(parent.alpha + 6 / 100, 100 / 100);
        }

        if (clip.y < -80) {
          if (parent !== null) {
            parent.alpha = parent.alpha - 6 / 100;
            if (parent.alpha < 0) {
              parent.visible = false;
              clip.vars.st = 1;
              parent.remove();
            }
          }
        }

        // _rotation += 1.3 degrees
        clip.rotation += (1.3 * Math.PI) / 180;

        // _Y = 5 * Math.cos(i) + (p -= v)
        p -= v;
        clip.vars.p = p;
        clip.y = 5 * Math.cos(i) + p;

        // _X = 25 * Math.sin(i += v2)
        i += v2;
        clip.vars.i = i;
        clip.x = 25 * Math.sin(i);

        // if (Math.cos(i) < 0) { _alpha = 80 * Math.cos(i) + 100; }
        if (Math.cos(i) < 0) {
          clip.alpha = (80 * Math.cos(i) + 100) / 100;
        }
      },
    };

    // ---- anim1 (DefineSprite_13) — 306-frame composite outer mc --
    // No librarySymbols entry → texture key is bare "anim1" (no lib_ prefix).
    // frame_304/DoAction.as: _parent.removeMovieClip() → complete().
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 306,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          1,
          (_clip) => {
            // Signal hit at the second frame of the impact animation.
            // TargetCell displayType — harness does not fire signalHit.
            this.runtime.signalHit();
          },
        ],
        [
          303,
          (clip) => {
            // AS DefineSprite_13/frame_304/DoAction.as: _parent.removeMovieClip()
            // anim1 is the direct child of root; removing its parent = root.
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite9Sym);
    this.registry.register(sprite10Sym);
    this.registry.register(sprite11Sym);
    this.registry.register(sprite3Sym);
    this.registry.register(sprite12Sym);
    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("crockette_213");
    callbacks.playSound("crockette_213");

    // Attach the main composite animation as the sole child of root.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
