/**
 * Spell 2106 — (Unknown name, likely a Cra/ranged spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2106/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). Detected because:
 *   - Has both `move` and `shoot` symbols (DefineSprite_10_move, DefineSprite_9_shoot).
 *   - `move` is a 2-frame container whose frame_1 places an authored child (PlaceObject2_4_1)
 *     with clip events — the harness drives `move` along a parabolic arc to the target.
 *   - `shoot` is a 93-frame composite (the `animations[]` entry named "shoot") that runs
 *     at the target on landing. frame_91 calls `_parent.removeMovieClip()` → spell complete.
 *   - The harness fires `runtime.signalHit()` automatically at landing for displayType 30/31;
 *     we must NOT call it again.
 *
 * Library symbols:
 *   - `move`  — container with one authored child (PlaceObject2_4_1). The child's clip events:
 *       onLoad: seeds oscillation amplitude `a=30`, phase `i=0`.
 *       onEnterFrame: `_rotation = 90 + a * cos(i += 0.6); a /= 1.1;` — wobbling rotation
 *       that decays toward 90°.
 *   - `shoot` — 93-frame composite (from animations[] "shoot"). The authored child
 *     (PlaceObject2_4_2 in DefineSprite_8) has clip events:
 *       onLoad: `a=10, i=0`.
 *       onEnterFrame: `_rotation = 90 + a * cos(i += PI); a /= 1.5;` — rapid alternating
 *       decay. DefineSprite_8/frame_64 calls `stop()`. DefineSprite_9_shoot/frame_91
 *       calls `_parent.removeMovieClip(); stop();` → spell complete.
 *
 * NOTE: The manifest has NO `librarySymbols[]` entries — only `animations[]` with a single
 * entry named "shoot". This means `move` is a pure container (no authored textures) and
 * `shoot` textures are fetched with `textures.getFrames("shoot")` (NO `lib_` prefix).
 * The inner authored child of `move` (DefineSprite_10_move/PlaceObject2_4_1) and the
 * inner child of DefineSprite_8 (PlaceObject2_4_2) are both placed on the timeline
 * at frame_1 — they are static children we model as sub-symbols registered here.
 *
 * Main timeline: no SOMA.playSound found in the scripts; onSpellStart is a no-op.
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

// Bounds from animations[] "shoot" entry (used for the shoot symbol's anchor).
const SHOOT_BOUNDS = {
  width: 37.25,
  height: 33.35,
  offsetX: -30.75,
  offsetY: -17.6,
};

export class Spell2106 extends RuntimeSpell {
  readonly spellId = 2106;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- moveChild — authored child inside `move` (PlaceObject2_4_1) ------
    // This child is placed on `move`'s timeline at frame_1. It has no
    // authored texture of its own — just clip events driving rotation.
    //
    // AS: DefineSprite_10_move/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
    //   a = 30;
    //   i = 0;
    //
    // AS: DefineSprite_10_move/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = 90 + a * Math.cos(i += 0.6);
    //   a /= 1.1;
    const moveChildSym: SymbolDefinition = {
      name: "moveChild",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_10_move/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.a = 30;
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_10_move/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const a = clip.vars.a as number;
        const i = (clip.vars.i as number) + 0.6;
        clip.vars.i = i;
        // AS: _rotation = 90 + a * Math.cos(i)  (degrees → radians)
        clip.rotation = ((90 + a * Math.cos(i)) * Math.PI) / 180;
        clip.vars.a = a / 1.1;
      },
    };

    // ---- move — 2-frame container; frame_1 attaches moveChild ---------
    // Harness attaches `move` at (0,0) on the root and drives it along
    // the parabolic arc. The `move` symbol itself has no authored visual;
    // all rendering comes from its child.
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 2,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_10_move/frame_1 — PlaceObject2_4_1 places
            // the child with its clip events. We model that as an attach.
            clip.attach(moveChildSym, "moveChild", 1, ctx);
          },
        ],
      ]),
    };

    // ---- shootInnerChild — authored child inside DefineSprite_8 -------
    // DefineSprite_8 is the inner clip inside `shoot` (PlaceObject2_4_2).
    // It has clip events on frame_1 and stops at frame_64.
    //
    // AS: DefineSprite_8/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(load).as
    //   a = 10;
    //   i = 0;
    //
    // AS: DefineSprite_8/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = 90 + a * Math.cos(i += 3.1415);
    //   a /= 1.5;
    //
    // AS: DefineSprite_8/frame_64/DoAction.as
    //   stop();
    const shootInnerSym: SymbolDefinition = {
      name: "shootInner",
      totalFrames: 64,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_8/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.a = 10;
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_8/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const a = clip.vars.a as number;
        const i = (clip.vars.i as number) + 3.1415;
        clip.vars.i = i;
        // AS: _rotation = 90 + a * Math.cos(i)  (degrees → radians)
        clip.rotation = ((90 + a * Math.cos(i)) * Math.PI) / 180;
        clip.vars.a = a / 1.5;
      },
      frameScripts: new Map([
        [
          63,
          (clip) => {
            // AS DefineSprite_8/frame_64/DoAction.as: stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- shoot — 93-frame composite; lands at target via harness --------
    // The `shoot` animation has authored textures in animations["shoot"].
    // frame_1 (index 0) places the inner DefineSprite_8 child.
    // frame_91 (index 90) calls `_parent.removeMovieClip(); stop();` →
    // removes the outer mc and signals spell completion.
    //
    // AS: DefineSprite_9_shoot/frame_91/DoAction.as
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
          0,
          (clip, ctx) => {
            // AS: DefineSprite_9_shoot/frame_1 — PlaceObject2_4_2 places
            // the DefineSprite_8 inner child (shootInner) with its clip events.
            clip.attach(shootInnerSym, "shootInner", 2, ctx);
          },
        ],
        [
          90,
          (clip) => {
            // AS DefineSprite_9_shoot/frame_91/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(moveChildSym);
    this.registry.register(moveSym);
    this.registry.register(shootInnerSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // No SOMA.playSound found in canonical AS scripts for this spell.
  }
}
