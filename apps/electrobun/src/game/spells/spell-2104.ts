/**
 * Spell 2104 — (Unknown spell name).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2104/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The manifest has both a `move` and a `shoot`
 * symbol (DefineSprite_11_move and DefineSprite_10_shoot), where `move` is driven
 * along a parabolic arc by the harness and `shoot` is attached at impact. This is
 * the canonical ProjectileBallistic pattern.
 *
 * Library symbols:
 *   - DefineSprite_9 (unnamed inner sprite, instance placed inside `move` and `shoot`
 *     at PlaceObject2 depth 2 — acts as a wobble decoration). onLoad seeds `a=10, i=0`.
 *     onEnterFrame: `_rotation = 90 + a * cos(i += π)` (fast π-step oscillation), `a /= 1.3`.
 *     frame_64: stop().
 *
 *   - `shoot` (DefineSprite_10_shoot, 93-frame impact animation with authored textures).
 *     frame_91: `_parent.removeMovieClip()` → spell complete.
 *     Contains an inner PlaceObject2 clip (DefineSprite_9) at depth 2 whose clip events
 *     are modelled via the anonymous inner symbol below.
 *
 *   - `move` (DefineSprite_11_move, projectile-in-flight container).
 *     Contains an inner PlaceObject2 clip (DefineSprite_9 variant) at depth 1 with
 *     different seed values: onLoad: `a=30, i=0`. onEnterFrame: `_rotation = 90 + a * cos(i += 0.6)`,
 *     `a /= 1.1`.
 *
 * The harness attaches `move` at caster, drives the arc, then attaches `shoot` at the
 * target and calls runtime.signalHit() automatically (displayType 30 — do NOT call it here).
 *
 * Main timeline: no SOMA.playSound was found in the provided scripts; onSpellStart is a
 * no-op (or plays silence). The `shoot` animation provides the visual closure at frame_91.
 *
 * NOTE on inner sprites: The PlaceObject2 clip events belong to an anonymous DefineSprite_9
 * that is statically placed inside `move` and `shoot` by the authored SWF timeline. We model
 * this by registering an inner symbol and attaching it from the frame_1 frameScript of each
 * container symbol — the canonical approach for static child clips that carry clip events.
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

// `shoot` is the only animation in the manifest with authored frame textures.
// Its bounds come from the animations[] entry (not librarySymbols — the manifest
// librarySymbols array is absent / empty, so NO lib_ prefix is used here).
const SHOOT_BOUNDS = {
  width: 29.75,
  height: 31.6,
  offsetX: -23.25,
  offsetY: -17.6,
};

export class Spell2104 extends RuntimeSpell {
  readonly spellId = 2104;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  // Hold refs so onSpellStart and frame scripts can reference them across methods.
  private innerMoveSym!: SymbolDefinition;
  private innerShootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- Inner sprite placed inside `move` (DefineSprite_11_move) ---------------
    // AS: DefineSprite_11_move/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_11_move/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // This anonymous sprite wobbles the projectile during flight.
    this.innerMoveSym = {
      name: "_inner_move_wobble",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_11_move/frame_1/PlaceObject2_5_1/onClipEvent(load):
        //   a = 30; i = 0;
        clip.vars.a = 30;
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_11_move/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame):
        //   _rotation = 90 + a * Math.cos(i += 0.6);
        //   a /= 1.1;
        let a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += 0.6;
        const rotDeg = 90 + a * Math.cos(i);
        clip.rotation = (rotDeg * Math.PI) / 180;
        a /= 1.1;
        clip.vars.a = a;
        clip.vars.i = i;
      },
    };

    // ---- Inner sprite placed inside `shoot` (DefineSprite_9) --------------------
    // AS: DefineSprite_9/frame_1/PlaceObject2_5_2/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_9/frame_1/PlaceObject2_5_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //     DefineSprite_9/frame_64/DoAction.as  → stop()
    // This anonymous sprite wobbles the impact animation.
    this.innerShootSym = {
      name: "_inner_shoot_wobble",
      totalFrames: 64,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_9/frame_1/PlaceObject2_5_2/onClipEvent(load):
        //   a = 10; i = 0;
        clip.vars.a = 10;
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_9/frame_1/PlaceObject2_5_2/onClipEvent(enterFrame):
        //   _rotation = 90 + a * Math.cos(i += 3.1415);
        //   a /= 1.3;
        let a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += 3.1415;
        const rotDeg = 90 + a * Math.cos(i);
        clip.rotation = (rotDeg * Math.PI) / 180;
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

    // ---- shoot — 93-frame impact animation (authored textures) -----------------
    // AS: DefineSprite_10_shoot/frame_91/DoAction.as: _parent.removeMovieClip(); stop();
    // The shoot symbol has the authored render frames from animations["shoot"].
    // It also statically contains the inner wobble sprite (DefineSprite_9) at depth 2,
    // which we attach from frame_1 script.
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
            // Canonical SWF places DefineSprite_9 (inner wobble) statically at
            // PlaceObject2 depth 2 when shoot plays frame_1. Attach it here.
            clip.attach(this.innerShootSym, "_wobble", 2, ctx);
          },
        ],
        [
          90,
          (clip) => {
            // AS DefineSprite_10_shoot/frame_91/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- move — projectile-in-flight container (no authored textures) -----------
    // DefineSprite_11_move has no authored frame content in the manifest animations.
    // It is a container-only symbol driven by the harness along the parabolic arc.
    // The canonical SWF statically places the inner wobble sprite at PlaceObject2
    // depth 1 when move is on frame_1.
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
            // Canonical SWF places DefineSprite_11_move's inner wobble sprite
            // (PlaceObject2_5_1) statically at depth 1 on frame_1.
            clip.attach(this.innerMoveSym, "_wobble", 1, ctx);
          },
        ],
      ]),
    };

    this.registry.register(this.innerMoveSym);
    this.registry.register(this.innerShootSym);
    this.registry.register(shootSym);
    this.registry.register(moveSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // No SOMA.playSound found in the canonical AS scripts for this spell.
    // The harness will attach `move` and drive the ballistic arc automatically.
  }
}
