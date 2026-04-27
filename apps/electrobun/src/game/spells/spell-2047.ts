/**
 * Spell 2047 — (Cra linear projectile).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2047/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). Evidence:
 *   - Has a `shoot` symbol (90-frame composite) and a `move` symbol with a
 *     clip-event-driven oscillation — classic linear projectile pattern.
 *   - The `move` symbol's PlaceObject2_15_1 clip events drive a rotation
 *     wobble on the projectile while it travels to the target (caster-side
 *     rotation). No parabolic arc math → NOT ballistic.
 *   - No `duplicate` symbol → NOT beam.
 *   - No `_parent.cellFrom`/`_parent.cellTo` world-anchor positioning → NOT
 *     WorldAbsolute.
 *
 * Library symbols:
 *   - `move` — single-frame container with an oscillating-rotation clip-event
 *     child (PlaceObject2_15_1). onLoad seeds `a=30, i=0`. onEnterFrame
 *     drives `_rotation = 90 + a*cos(i += 0.6); a /= 1.1`.
 *     No authored textures (container-only, frames: []).
 *   - `shoot` — 90-frame impact composite. frame_88 calls
 *     `_parent.removeMovieClip(); stop();` which tears down the spell and
 *     signals completion. The harness attaches `shoot` at the target on
 *     landing, so we signal hit in the harness (displayType 20 → harness
 *     does NOT fire signalHit automatically; we fire it from the first
 *     frame of shoot, frame_1). Actually for ProjectileLinear the harness
 *     attaches shoot at target-offset but does not call signalHit —
 *     we call it from frame_0 of shoot (frame_1 canonical).
 *
 * Main timeline: no explicit SOMA.playSound found in provided scripts;
 * onSpellStart is a no-op (no sound script supplied).
 *
 * Textures: `shoot` is in `animations[]` (not `librarySymbols[]`), so use
 * `textures.getFrames("shoot")` — no `lib_` prefix.
 * `move` is also in `animations[]` (container-only, no frames needed).
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

const SHOOT_BOUNDS = {
  width: 223.6,
  height: 41.1,
  offsetX: 1.55,
  offsetY: -24.95,
};

export class Spell2047 extends RuntimeSpell {
  readonly spellId = 2047;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- move — oscillating projectile container ----------------
    // AS: DefineSprite_16_move/frame_1/PlaceObject2_15_1
    // The move symbol itself is a container whose authored child
    // (PlaceObject2_15_1) carries the clip events for the wobble.
    // We model the child's clip events directly on the move symbol
    // since the runtime attaches move as a single unit.
    //
    // AS PlaceObject2_15_1/CLIPACTIONRECORD onClipEvent(load):
    //   a = 30; i = 0;
    // AS PlaceObject2_15_1/CLIPACTIONRECORD onClipEvent(enterFrame):
    //   _rotation = 90 + a * Math.cos(i += 0.6);
    //   a /= 1.1;
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_16_move/frame_1/PlaceObject2_15_1/onClipEvent(load)
        clip.vars.a = 30;
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_16_move/frame_1/PlaceObject2_15_1/onClipEvent(enterFrame)
        let a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += 0.6;
        // AS: _rotation = 90 + a * Math.cos(i)  (degrees → radians)
        clip.rotation = ((90 + a * Math.cos(i)) * Math.PI) / 180;
        a /= 1.1;
        clip.vars.a = a;
        clip.vars.i = i;
      },
    };

    // ---- shoot — 90-frame impact composite at target ------------
    // AS: DefineSprite_14_shoot/frame_88/DoAction.as:
    //   _parent.removeMovieClip(); stop();
    //
    // For ProjectileLinear the harness does NOT call signalHit
    // automatically, so we fire it on the first frame of shoot
    // (frame_1 canonical = frameScripts index 0).
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 90,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // frame_1: projectile reached target — signal hit.
            this.runtime.signalHit();
          },
        ],
        [
          87,
          (clip) => {
            // AS DefineSprite_14_shoot/frame_88/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // No SOMA.playSound found in provided canonical AS scripts.
    // Harness (ProjectileLinear) handles attaching move + shoot.
  }
}
