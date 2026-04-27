/**
 * Spell 3003 — Flèche de Recul / multi-element arrow (Cra).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/3003/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The manifest has both a `move`
 * symbol (DefineSprite_21_move) and a `shoot` symbol (DefineSprite_20_shoot),
 * which is the definitive signature for a ballistic projectile. The harness
 * attaches `move`, drives it along a parabolic arc, then attaches `shoot` at
 * the impact point and calls runtime.signalHit() automatically — we must NOT
 * call signalHit() ourselves.
 *
 * Library / authored symbols:
 *   - DefineSprite_19 ("effet") — 66-frame animated impact burst.
 *       PlaceObject2_4_2 carries clip events on the embedded child:
 *         onLoad:       a = 10; i = 0
 *         onEnterFrame: _rotation = 90 + a * cos(i += π); a /= 1.3
 *       frame_66: stop()  → effect freezes on last frame.
 *
 *   - DefineSprite_21_move ("move") — container-only (no frames).
 *       PlaceObject2_4_1 carries clip events on the embedded child:
 *         onLoad:       a = 30; i = 0
 *         onEnterFrame: _rotation = 90 + a * cos(i += 0.6); a /= 1.1
 *       The harness drives the parabolic arc on the `move` instance.
 *
 *   - DefineSprite_20_shoot ("shoot") — 93-frame animated arrow/impact.
 *       frame_91: _parent.removeMovieClip(); stop()
 *       → kills the outer mc and signals spell completion.
 *
 * Main timeline: no SOMA.playSound found in the manifest scripts, so
 * onSpellStart is a no-op (no sound, no extra attaches beyond what the
 * harness provides).
 *
 * NOTE on DefineSprite_19 ("effet"): the canonical `move` symbol for
 * displayType-30 spells typically attaches `effet` to its parent on its
 * second frame (see spell-103). The manifest scripts for 3003 do NOT show
 * a frame_2 DoAction on DefineSprite_21_move, so the effet composite is
 * instead the animated content INSIDE the shoot symbol (the 93-frame
 * `shoot` animation in animations[] IS the composed shoot+effet visual).
 * DefineSprite_19 with its wobble clip-event child is registered so it can
 * be resolved if AS inside move/shoot calls attachMovie("effet",...); in
 * practice the shoot timeline drives itself.
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

// ---- Bounds from manifest.json animations[] entry for "shoot" ----
const SHOOT_BOUNDS = {
  width: 34.5,
  height: 30.75,
  offsetX: -23.25,
  offsetY: -14.1,
};

export class Spell3003 extends RuntimeSpell {
  readonly spellId = 3003;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- "effet" — DefineSprite_19, 66-frame wobble composite ----
    //
    // The DefineSprite_19 sprite has a child placed via PlaceObject2_4_2
    // that carries two clip events. There is no explicit library-symbol
    // name in the manifest for DefineSprite_19, so we register it as
    // "effet" (the conventional name used by spell-103 and the harness).
    //
    // AS DefineSprite_19/frame_1/PlaceObject2_4_2/onClipEvent(load):
    //   a = 10; i = 0;
    //
    // AS DefineSprite_19/frame_1/PlaceObject2_4_2/onClipEvent(enterFrame):
    //   _rotation = 90 + a * Math.cos(i += 3.1415);
    //   a /= 1.3;
    //
    // AS DefineSprite_19/frame_66/DoAction.as:
    //   stop();
    const effetChildSym: SymbolDefinition = {
      name: "_effetChild",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_19/frame_1/PlaceObject2_4_2/onClipEvent(load)
        clip.vars.a = 10;
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_19/frame_1/PlaceObject2_4_2/onClipEvent(enterFrame)
        const a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += Math.PI; // AS: i += 3.1415
        clip.rotation = ((90 + a * Math.cos(i)) * Math.PI) / 180;
        clip.vars.a = a / 1.3;
        clip.vars.i = i;
      },
    };

    const effetSym: SymbolDefinition = {
      name: "effet",
      totalFrames: 66,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip, ctx) => {
        // Place the wobble child (PlaceObject2_4_2) at depth 2 inside effet.
        clip.attach(effetChildSym, "child2", 2, ctx);
      },
      frameScripts: new Map([
        [
          65,
          (clip) => {
            // AS DefineSprite_19/frame_66/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- "move" — DefineSprite_21_move, container-only -----------
    //
    // The move symbol has a child placed via PlaceObject2_4_1 that
    // carries two clip events (a slow oscillating wobble, a = 30,
    // increment 0.6 per frame, decay 1.1).
    //
    // AS DefineSprite_21_move/frame_1/PlaceObject2_4_1/onClipEvent(load):
    //   a = 30; i = 0;
    //
    // AS DefineSprite_21_move/frame_1/PlaceObject2_4_1/onClipEvent(enterFrame):
    //   _rotation = 90 + a * Math.cos(i += 0.6);
    //   a /= 1.1;
    const moveChildSym: SymbolDefinition = {
      name: "_moveChild",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_21_move/frame_1/PlaceObject2_4_1/onClipEvent(load)
        clip.vars.a = 30;
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_21_move/frame_1/PlaceObject2_4_1/onClipEvent(enterFrame)
        const a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += 0.6;
        clip.rotation = ((90 + a * Math.cos(i)) * Math.PI) / 180;
        clip.vars.a = a / 1.1;
        clip.vars.i = i;
      },
    };

    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip, ctx) => {
        // Place the wobble child (PlaceObject2_4_1) at depth 1 inside move.
        clip.attach(moveChildSym, "child1", 1, ctx);
      },
    };

    // ---- "shoot" — DefineSprite_20_shoot, 93-frame impact --------
    //
    // The shoot animation has 93 authored frames (the "shoot" entry in
    // animations[]). frame_91 removes the parent mc and stops.
    //
    // AS DefineSprite_20_shoot/frame_91/DoAction.as:
    //   _parent.removeMovieClip();
    //   stop();
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 93,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          90,
          (clip) => {
            // AS DefineSprite_20_shoot/frame_91/DoAction.as:
            //   _parent.removeMovieClip(); stop()
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(effetChildSym);
    this.registry.register(effetSym);
    this.registry.register(moveChildSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // No SOMA.playSound found in the canonical AS main timeline scripts.
    // The harness (ProjectileBallistic) attaches "move" automatically.
  }
}
