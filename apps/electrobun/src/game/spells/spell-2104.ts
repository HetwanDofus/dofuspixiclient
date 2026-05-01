/**
 * Spell 2104.
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2104/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has a `move` symbol
 * (DefineSprite_11_move) and a `shoot` symbol (DefineSprite_10_shoot),
 * which is the canonical ballistic pattern. The harness attaches `move`,
 * drives a parabolic arc to the target, then attaches `shoot` at impact
 * and fires signalHit automatically.
 *
 * Library symbols:
 *   - "sprite9" (DefineSprite_9, characterId=9) — 66-frame animated clip.
 *     It is placed inside BOTH `move` (via DefineSprite_11_move's
 *     PlaceObject2_5_1 with a=30/i+=0.6 handlers) and inside `shoot`
 *     (via DefineSprite_10_shoot's placement with a=10/i+=3.1415 handlers).
 *
 *     The manifest lists a SINGLE librarySymbols entry named "sprite9".
 *     The canonical AS scripts show two distinct CLIPACTIONRECORD contexts:
 *       • DefineSprite_9/frame_1/PlaceObject2_5_2 → a=10, i+=3.1415
 *         (this child is placed INSIDE sprite9 at depth 2 within shoot)
 *       • DefineSprite_11_move/frame_1/PlaceObject2_5_1 → a=30, i+=0.6
 *         (sprite9 placed inside move at depth 1)
 *
 *     Because both placement contexts share characterId=9 but differ in
 *     their clip-event seeds, we register:
 *       - "sprite9" — canonical registration with the a=10/i+=3.1415 handlers
 *         (from DefineSprite_9's own PlaceObject2_5_2 CLIPACTIONRECORD — these
 *         are the handlers that run on the instance placed inside shoot)
 *       - "sprite9_move" — second registration for the instance placed inside
 *         move, with a=30/i+=0.6 handlers from DefineSprite_11_move's
 *         PlaceObject2_5_1 CLIPACTIONRECORD
 *
 *   - "move" — container-only. frame_1 attaches sprite9_move at depth 1.
 *     The harness drives it along the ballistic arc.
 *
 *   - "shoot" — 93-frame composite with pre-rendered SVG frames.
 *     frame_1 attaches sprite9 (the a=10 variant) at depth 2.
 *     frame_64 of the inner sprite9 calls stop().
 *     frame_91 of shoot calls _parent.removeMovieClip() → complete().
 *
 * Main timeline: no SOMA.playSound found in the canonical scripts.
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

// Bounds for sprite9 from manifest librarySymbols[0]
const SPRITE9_BOUNDS = {
  width: 30.3,
  height: 32.2,
  offsetX: -23.75,
  offsetY: -18.1,
};

// Placement matrix from manifest librarySymbols[0].placements[0].matrix
const SPRITE9_MATRIX = {
  scaleX: 0.981719970703125,
  scaleY: 0.981719970703125,
  translateX: 0.05,
  translateY: 0.15,
};

// Bounds for the shoot animation (from manifest animations[0])
const SHOOT_BOUNDS = {
  width: 29.75,
  height: 31.6,
  offsetX: -23.25,
  offsetY: -17.6,
};

export class Spell2104 extends RuntimeSpell {
  readonly spellId = 2104;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite9Anchor = calculateAnchor(SPRITE9_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- "sprite9" — the canonical librarySymbols entry --------
    // Placed inside `shoot` (DefineSprite_10_shoot) via PlaceObject2.
    // The CLIPACTIONRECORD handlers come from:
    //   DefineSprite_9/frame_1/PlaceObject2_5_2/CLIPACTIONRECORD onClipEvent(load).as
    //   DefineSprite_9/frame_1/PlaceObject2_5_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // DefineSprite_9/frame_64/DoAction.as: stop()
    const sprite9Sym: SymbolDefinition = {
      name: "sprite9",
      totalFrames: 66,
      frames: textures.getFrames("lib_sprite9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_9/frame_1/PlaceObject2_5_2/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.a = 10;
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_9/frame_1/PlaceObject2_5_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        //   _rotation = 90 + a * Math.cos(i += 3.1415); a /= 1.3;
        let a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += 3.1415;
        clip.rotation = ((90 + a * Math.cos(i)) * Math.PI) / 180;
        a /= 1.3;
        clip.vars.a = a;
        clip.vars.i = i;
      },
      frameScripts: new Map([
        [
          63,
          (clip) => {
            // AS DefineSprite_9/frame_64/DoAction.as: stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- "sprite9_move" — second instance context for `move` ----
    // Placed inside `move` (DefineSprite_11_move) via PlaceObject2_5_1.
    // Different clip-event seeds: a=30, i increments by 0.6 (slower oscillation).
    // CLIPACTIONRECORD handlers from:
    //   DefineSprite_11_move/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    //   DefineSprite_11_move/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const sprite9MoveSym: SymbolDefinition = {
      name: "sprite9_move",
      totalFrames: 66,
      frames: textures.getFrames("lib_sprite9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_11_move/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.a = 30;
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_11_move/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        //   _rotation = 90 + a * Math.cos(i += 0.6); a /= 1.1;
        let a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += 0.6;
        clip.rotation = ((90 + a * Math.cos(i)) * Math.PI) / 180;
        a /= 1.1;
        clip.vars.a = a;
        clip.vars.i = i;
      },
    };

    // ---- "move" — container-only projectile clip ----------------
    // The harness attaches this at root and drives it along the ballistic arc.
    // frame_1 places the sprite9_move instance at depth 1 with the
    // placement matrix from manifest librarySymbols[0].placements[0].
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_11_move/frame_1 — PlaceObject2_5_1 places
            // characterId=9 at depth 1 with placement matrix.
            const child = clip.attach(sprite9MoveSym, "sprite9", 1, ctx, {
              x: SPRITE9_MATRIX.translateX,
              y: SPRITE9_MATRIX.translateY,
            });
            child.scaleX = SPRITE9_MATRIX.scaleX;
            child.scaleY = SPRITE9_MATRIX.scaleY;
          },
        ],
      ]),
    };

    // ---- "shoot" — 93-frame composite at impact -----------------
    // Has pre-rendered SVG frames (from animations[0] "shoot").
    // frame_1 places characterId=9 (sprite9, a=10 variant) at depth 2.
    // frame_91/DoAction.as: _parent.removeMovieClip(); stop(); → complete()
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 93,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_10_shoot/frame_1 — PlaceObject2 places
            // DefineSprite_9 (sprite9) at depth 2 with placement matrix.
            const child = clip.attach(sprite9Sym, "sprite9", 2, ctx, {
              x: SPRITE9_MATRIX.translateX,
              y: SPRITE9_MATRIX.translateY,
            });
            child.scaleX = SPRITE9_MATRIX.scaleX;
            child.scaleY = SPRITE9_MATRIX.scaleY;
          },
        ],
        [
          90,
          (clip) => {
            // AS DefineSprite_10_shoot/frame_91/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite9Sym);
    this.registry.register(sprite9MoveSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // No SOMA.playSound found in the canonical AS scripts for this spell.
  }
}
