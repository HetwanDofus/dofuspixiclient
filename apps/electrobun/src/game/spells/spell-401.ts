/**
 * Spell 401 — Lakam (Eniripsa healing/support spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/401/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single animated composite
 * (anim1, 210 frames) plus runtime-spawned `point` particles. There is no
 * `move`/`shoot`/`duplicate` symbol and no caster-side content — everything
 * lands at the target cell. The outer DefineSprite_7 timeline:
 *   - frame_1: a PlaceObject2 clip-event handler seeds `_parent.t = 1` and
 *              runs an enterFrame loop that spawns `point` particles while
 *              t < 20 (every 3rd tick).
 *   - frame_22: SOMA.playSound("lakam_401a")
 *   - frame_145: SOMA.playSound("lakam_401b")
 *   - frame_208: this._end() → signalHit; _parent.removeMovieClip() → complete
 *
 * Library symbols:
 *   - lib_point — single-frame rotating star/point particle. frame_1/DoAction.as
 *     runs an inline `onEnterFrame` that drives an elliptical orbit with a
 *     gravity accumulator `p`. An inner PlaceObject2 child adds a 2°/frame
 *     spin. The particle removes itself once `t > 17`.
 *
 * Main timeline: no explicit sounds or attaches on the root — the outer
 * DefineSprite_7 (anim1) is the root symbol. We register anim1 with all
 * its frame scripts and attach it from onSpellStart.
 *
 * Note on structure: DefineSprite_7 IS the `anim1` animation listed in the
 * manifest. Its PlaceObject2_5_1 clip-event handlers run on a child clip that
 * drives the particle-spawn loop. We model this by storing `t` on the anim1
 * clip (its parent in AS terms) and running the spawn loop from the anim1
 * clip's `onEnterFrame` — which matches the AS semantics of the inner clip
 * reading `_parent.t`.
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

const POINT_BOUNDS = {
  width: 31.6,
  height: 33.8,
  offsetX: -9.9,
  offsetY: -20.55,
};

export class Spell401 extends RuntimeSpell {
  readonly spellId = 401;
  readonly displayType = SpellDisplayType.TargetCell;

  private pointSym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const pointAnchor = calculateAnchor(POINT_BOUNDS);

    // ---- lib_point — orbiting star particle ----------------------
    // AS: DefineSprite_3_point/frame_1/DoAction.as drives an inline
    // onEnterFrame. A nested PlaceObject2_2_1 child adds a 2°/frame
    // spin via its own clipEvents.
    //
    // The PlaceObject2_2_1 child only exists to apply a persistent
    // rotation to its clip — since we have no separate nested clip
    // concept for a single inner sprite, we fold the 2°/frame spin
    // into the point clip's own onEnterFrame (the net visual result
    // is identical because the only purpose of PlaceObject2_2_1 was
    // to rotate the point sprite itself).
    this.pointSym = {
      name: "point",
      totalFrames: 1,
      frames: textures.getFrames("lib_point"),
      anchorX: pointAnchor.x,
      anchorY: pointAnchor.y,

      // AS: DefineSprite_3_point/frame_1/PlaceObject2_2_1/
      //     CLIPACTIONRECORD onClipEvent(load).as
      //   _rotation = random(360);
      onLoad: (clip) => {
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      },

      // Combined enterFrame for both:
      //   DefineSprite_3_point/frame_1/PlaceObject2_2_1/
      //     CLIPACTIONRECORD onClipEvent(enterFrame).as  → spin 2°/frame
      //   DefineSprite_3_point/frame_1/DoAction.as       → orbit + gravity + removal
      onEnterFrame: (clip) => {
        // AS PlaceObject2_2_1 onClipEvent(enterFrame):
        //   _rotation = _rotation - 2;
        clip.rotation -= (2 * Math.PI) / 180;

        // AS DefineSprite_3_point/frame_1/DoAction.as inline onEnterFrame:
        //   if (t > 17) { removeMovieClip(this); }
        //   t = _parent.t / 12 + dec / 9;
        //   _X = rx * Math.cos(t);
        //   y = ry * Math.sin(t);
        //   y2 = y + (p += 0.16);
        //   _Y = _Y - (_Y - y2) / 5;
        //   if (y < 0) { _alpha = 100 + y * 10; }
        const rx = clip.vars.rx as number;
        const ry = clip.vars.ry as number;
        let p = clip.vars.p as number;
        let y2 = clip.vars.y2 as number;
        const dec = clip.vars.dec as number;

        // Read parent t (the anim1 clip holds t)
        const parentT = (clip.parent?.vars.t as number) ?? 0;

        const tOrbit = parentT / 12 + dec / 9;

        if (tOrbit > 17) {
          clip.remove();
          return;
        }

        const xPos = rx * Math.cos(tOrbit);
        const yOrbit = ry * Math.sin(tOrbit);
        p += 0.16;
        y2 = yOrbit + p;
        // AS: _Y = _Y - (_Y - y2) / 5  (smooth approach)
        clip.y = clip.y - (clip.y - y2) / 5;
        clip.x = xPos;

        if (yOrbit < 0) {
          // AS: _alpha = 100 + y * 10  (0-100 range → 0-1)
          clip.alpha = (100 + yOrbit * 10) / 100;
        } else {
          clip.alpha = 1;
        }

        clip.vars.p = p;
        clip.vars.y2 = y2;
      },
    };

    // ---- anim1 — outer timeline (DefineSprite_7, 210 frames) ----
    // This is the top-level composite animation. It owns:
    //   - A PlaceObject2_5_1 child that drives the particle spawn loop
    //     via clip events (load: seed t=1; enterFrame: spawn points)
    //   - frame_22:  playSound("lakam_401a")
    //   - frame_145: playSound("lakam_401b")
    //   - frame_208: signalHit + removeMovieClip (complete)
    //
    // We model the PlaceObject2_5_1 clip-event spawn loop directly on
    // the anim1 clip's own onEnterFrame (since we need access to the
    // callbacks for sounds and `t` lives on this clip per the AS
    // `_parent.t` convention).
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 210,
      frames: textures.getFrames("anim1"),
      anchorX: calculateAnchor({
        width: 30.7,
        height: 241.7,
        offsetX: -14.7,
        offsetY: -232.8,
      }).x,
      anchorY: calculateAnchor({
        width: 30.7,
        height: 241.7,
        offsetX: -14.7,
        offsetY: -232.8,
      }).y,

      // AS: DefineSprite_7/frame_1/PlaceObject2_5_1/
      //     CLIPACTIONRECORD onClipEvent(load).as
      //   _parent.t = 1;
      onLoad: (clip) => {
        clip.vars.t = 1;
      },

      // AS: DefineSprite_7/frame_1/PlaceObject2_5_1/
      //     CLIPACTIONRECORD onClipEvent(enterFrame).as
      //   if (_parent.t < 20 & _parent.t % 3 == 1) {
      //     _parent.attachMovie("point", "point" + _parent.t, _parent.t + 100);
      //     eval("_parent.point" + _parent.t).sz = 200 * Math.sin(_parent.t / 10);
      //     eval("_parent.point" + _parent.t).dec = _parent.t;
      //     eval("_parent.point" + _parent.t)._y = -200;
      //   }
      //   _parent.t = _parent.t + 1;
      onEnterFrame: (clip, ctx) => {
        const t = clip.vars.t as number;

        if (t < 20 && t % 3 === 1) {
          const instanceName = `point${t}`;
          const sz = 200 * Math.sin(t / 10);
          const child = clip.attach(
            this.pointSym,
            instanceName,
            t + 100,
            ctx,
          );
          // Seed the point vars that DoAction.as frame_1 sets:
          //   rx = 15; ry = 5; p = -50; _Y = -500; y2 = _Y;
          //   _xscale = sz; _yscale = sz
          // plus the caller-set sz, dec, _y = -200
          child.vars.rx = 15;
          child.vars.ry = 5;
          child.vars.p = -50;
          child.vars.y2 = -500;
          child.y = -200; // AS: _y = -200 overrides the DoAction _Y=-500 initial
          child.vars.dec = t;
          child.scaleX = sz / 100;
          child.scaleY = sz / 100;
        }

        clip.vars.t = t + 1;
      },

      frameScripts: new Map([
        // AS: DefineSprite_7/frame_22/DoAction.as
        //   SOMA.playSound("lakam_401a");
        [
          21,
          (_clip) => {
            this.soundCallback?.("lakam_401a");
          },
        ],
        // AS: DefineSprite_7/frame_145/DoAction.as
        //   SOMA.playSound("lakam_401b");
        [
          144,
          (_clip) => {
            this.soundCallback?.("lakam_401b");
          },
        ],
        // AS: DefineSprite_7/frame_208/DoAction.as
        //   this._end();           → signalHit
        //   _parent.removeMovieClip(); → complete
        //   stop();
        [
          207,
          (clip) => {
            this.runtime.signalHit();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.pointSym);
    this.registry.register(this.anim1Sym);
  }

  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback so frame scripts can call it.
    this.soundCallback = callbacks.playSound;
    // Attach the main composite animation at depth 1 on the root.
    // This mirrors the SWF's main timeline placing DefineSprite_7
    // at the target cell.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
