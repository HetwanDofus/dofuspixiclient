/**
 * Spell 2040 — (Unknown Cra/projectile spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2040/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). The manifest has a `move` symbol
 * (DefineSprite_10_move) with a wobble clip event and a `shoot` symbol
 * (DefineSprite_9_shoot, 93 frames, full texture atlas) with frame_91 doing
 * `_parent.removeMovieClip()`. There is also DefineSprite_8 (an unnamed inner
 * sprite used inside `shoot`) with its own wobble clip event and a `stop()` at
 * frame_64. The harness attaches `move` (for the linear projectile flight) and
 * `shoot` at the target offset. The `shoot` outer timeline has authored frame
 * textures in the `shoot` animation.
 *
 * Canonical AS layout:
 *   - DefineSprite_10_move — the "move" projectile symbol. PlaceObject2_4_1 has
 *     clip events: onLoad seeds `a=30, i=0`; onEnterFrame wobbles
 *     `_rotation = 90 + a * cos(i += 0.6); a /= 1.1`.
 *   - DefineSprite_9_shoot — the "shoot" impact symbol (93 frames, full texture).
 *     frame_91/DoAction.as: `_parent.removeMovieClip(); stop();` → spell complete.
 *   - DefineSprite_8 — an inner child of `shoot` (placed on its timeline as
 *     PlaceObject2_4_2). onLoad seeds `a=10, i=0`; onEnterFrame wobbles
 *     `_rotation = 90 + a * cos(i += PI); a /= 1.5`. stop() at frame_64.
 *
 * Library symbols: none in `librarySymbols[]` — both `move` and `shoot` appear
 * only in `animations[]`. DefineSprite_8 is an inner authored child of `shoot`
 * (placed as a static PlaceObject in the `shoot` timeline), not independently
 * attachMovie'd; its clip events are modelled as an onLoad/onEnterFrame on the
 * `shoot` symbol itself since the runtime cannot split authored inner placements
 * from the parent composite.
 *
 * NOTE: Because `shoot` is a composite animation in the manifest (isComposite=true)
 * with 93 authored frames, we pass `textures.getFrames("shoot")` directly (no
 * `lib_` prefix — it is in `animations[]`, not `librarySymbols[]`).
 *
 * signalHit: For displayType=20 (ProjectileLinear) the harness does NOT fire
 * signalHit automatically (that is only done for displayType 30/31). We fire it
 * from the shoot symbol's first frame (frame_1 / frameScripts index 0) — the
 * canonical "projectile has landed, impact animation starts" moment.
 *
 * complete(): fired from shoot's frame_91 script (AS frame_91 = index 90 in
 * 0-based, but the AS file says `frame_91` which is the 91st frame, i.e. index
 * 90). Wait — the AS script is `DefineSprite_9_shoot/frame_91/DoAction.as` and
 * `frameCount` is 93, so this is 0-based index 90. Confirmed.
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

// `shoot` bounds come from animations[] entry (no lib_ prefix).
const SHOOT_BOUNDS = {
  width: 37.95,
  height: 31.6,
  offsetX: -31.45,
  offsetY: -17.6,
};

export class Spell2040 extends RuntimeSpell {
  readonly spellId = 2040;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    // ---- move — projectile-flight container ----------------------
    // DefineSprite_10_move has a placed child (PlaceObject2_4_1) whose
    // clip events drive a wobble rotation on the move clip itself.
    // We model the wobble as onLoad/onEnterFrame on the `move` symbol
    // since the child's events conceptually drive the whole move mc's
    // visual rotation in flight.
    // frames: [] — move is a container-only symbol (no authored textures
    // in animations[] for "move").
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      // AS: DefineSprite_10_move/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        clip.vars.a = 30;
        clip.vars.i = 0;
      },
      // AS: DefineSprite_10_move/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      //   _rotation = 90 + a * Math.cos(i += 0.6);
      //   a /= 1.1;
      onEnterFrame: (clip) => {
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

    // ---- shoot — 93-frame impact animation -----------------------
    // DefineSprite_9_shoot has authored frame textures (animations["shoot"]).
    // It also contains a placed inner child (PlaceObject2_4_2 = DefineSprite_8)
    // whose clip events drive a faster wobble rotation on the shoot clip.
    // We model DefineSprite_8's clip events as onLoad/onEnterFrame on `shoot`
    // since the runtime doesn't split inner authored placements.
    //
    // frame_64/DoAction.as (inner DefineSprite_8): stop() → we stop the
    // inner wobble by zeroing `a` so rotation converges (the outer shoot
    // timeline still plays to frame 91 which fires complete).
    //
    // frame_91/DoAction.as: _parent.removeMovieClip(); stop(); → complete.
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);
    const shootFrames = textures.getFrames("shoot");

    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 93,
      frames: shootFrames,
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      // AS: DefineSprite_8/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(load).as
      //   a = 10; i = 0;
      onLoad: (clip) => {
        // Signal hit as soon as the shoot clip is instantiated (projectile arrived).
        this.runtime.signalHit();
        clip.vars.a = 10;
        clip.vars.i = 0;
      },
      // AS: DefineSprite_8/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
      //   _rotation = 90 + a * Math.cos(i += 3.1415);
      //   a /= 1.5;
      onEnterFrame: (clip) => {
        let a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += 3.1415;
        const rotDeg = 90 + a * Math.cos(i);
        clip.rotation = (rotDeg * Math.PI) / 180;
        a /= 1.5;
        clip.vars.a = a;
        clip.vars.i = i;
      },
      frameScripts: new Map([
        [
          // AS: DefineSprite_8/frame_64/DoAction.as → stop()
          // The inner DefineSprite_8 child stops at its own frame 64.
          // We model this by zeroing `a` so the wobble dies out
          // (equivalent effect: rotation converges to 90° and stays).
          63,
          (clip) => {
            clip.vars.a = 0;
          },
        ],
        [
          // AS: DefineSprite_9_shoot/frame_91/DoAction.as
          //   _parent.removeMovieClip(); stop();
          // frame_91 → 0-based index 90
          90,
          (clip) => {
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
    _context: SpellContext,
  ): void {
    // The canonical main timeline has no SOMA.playSound call and no
    // explicit child attaches beyond what the harness drives for
    // displayType=20 (ProjectileLinear). Nothing to do here.
  }
}
