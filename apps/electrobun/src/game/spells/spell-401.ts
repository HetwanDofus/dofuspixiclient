/**
 * Spell 401 — Lakam (Sadida vine/nature spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/401/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single authored composite
 * timeline (anim1, 210 frames) anchored at the target cell, with a
 * runtime-spawned `point` particle system. No `move` or `shoot` symbols;
 * no caster-side content; no dual-timeline structure → TargetCell.
 *
 * The outer sprite (DefineSprite_7) is the main animated timeline:
 *   - frame_1 (PlaceObject2_5_1): onClipEvent(load) seeds `t = 1` on
 *     the parent. onClipEvent(enterFrame) spawns `point` particles every
 *     3rd tick while t < 20, setting sz and dec on each spawned point.
 *   - frame_22 (DoAction): SOMA.playSound("lakam_401a")
 *   - frame_145 (DoAction): SOMA.playSound("lakam_401b")
 *   - frame_208 (DoAction): this._end() → signalHit; _parent.removeMovieClip()
 *     → spell complete; stop().
 *
 * Library symbols:
 *   - lib_point — single-frame spark/glyph particle. frame_1/DoAction.as
 *     sets rx/ry/p/y2 + scale from `sz`, then assigns onEnterFrame inline
 *     (orbital ellipse with gravity well, removes when t > 17).
 *     PlaceObject2_2_1/onClipEvent(load): random initial rotation.
 *     PlaceObject2_2_1/onClipEvent(enterFrame): spin −2°/frame.
 *
 * Main timeline (anim1): single composite animation; no extra children to
 * attach in onSpellStart beyond the anim1 symbol itself. The outer mc
 * (DefineSprite_7) IS the anim1 timeline — we model it as a registered
 * SymbolDefinition for "anim1" attached at root in onSpellStart.
 *
 * Sound timing (from manifest.sounds):
 *   - frame 21 (0-based) → "lakam_401a"  (AS frame_22)
 *   - frame 144 (0-based) → "lakam_401b" (AS frame_145)
 *
 * signalHit: fired at AS frame_208 (0-based index 207), the canonical
 * `this._end()` call.
 * complete(): fired at the same frame via `_parent.removeMovieClip()`.
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

const ANIM1_BOUNDS = {
  width: 30.7,
  height: 241.7,
  offsetX: -14.7,
  offsetY: -232.8,
};

export class Spell401 extends RuntimeSpell {
  readonly spellId = 401;
  readonly displayType = SpellDisplayType.TargetCell;

  // Stored so onSpellStart can capture the sound callback for
  // frame-script-driven sounds (lakam_401a, lakam_401b).
  private _playSound: ((id: string) => void) | null = null;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const pointAnchor = calculateAnchor(POINT_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- lib_point — orbital spark particle ----------------------
    // Combines:
    //   DefineSprite_3_point/frame_1/PlaceObject2_2_1/onClipEvent(load)
    //   DefineSprite_3_point/frame_1/PlaceObject2_2_1/onClipEvent(enterFrame)
    //   DefineSprite_3_point/frame_1/DoAction.as
    //
    // The canonical AS places a sub-clip (PlaceObject2_2_1) inside the
    // point symbol that handles its own rotation via clip events. We
    // model the point clip itself as carrying both the sub-clip spin
    // (via onLoad/onEnterFrame on the point clip itself, since we have
    // no nested sub-clip layer) and the frame_1 DoAction orbital logic.
    //
    // frame_1/DoAction.as sets rx/ry/p/y2, scales by sz, then assigns
    // this.onEnterFrame = function(){ ... } which runs every frame.
    // We port the orbital logic into onEnterFrame on the point clip.
    // The PlaceObject2 spin is folded into onEnterFrame as well (−2°/frame
    // applied to the point clip's rotation, matching the sub-clip spin).
    const pointSym: SymbolDefinition = {
      name: "point",
      totalFrames: 1,
      frames: textures.getFrames("lib_point"),
      anchorX: pointAnchor.x,
      anchorY: pointAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_3_point/frame_1/PlaceObject2_2_1/
        //    CLIPACTIONRECORD onClipEvent(load).as
        //   _rotation = random(360);
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_3_point/frame_1/DoAction.as
            //   rx = 15; ry = 5; p = -50; _Y = -500; y2 = _Y;
            //   _xscale = sz; _yscale = sz;
            clip.vars.rx = 15;
            clip.vars.ry = 5;
            clip.vars.p = -50;
            // _Y = -500 is the initial position (before orbital physics
            // snap it toward y2 on first enterFrame).
            clip.y = -500;
            clip.vars.y2 = -500;
            // sz was set on the clip by the outer mc before attach was
            // called — read it from vars (the outer mc did
            // `point.sz = 200 * Math.sin(t/10)` via eval).
            const sz = (clip.vars.sz as number | undefined) ?? 100;
            clip.scaleX = sz / 100;
            clip.scaleY = sz / 100;
            // t local to the point (distinct from parent's t counter).
            // Initialised here; the onEnterFrame recomputes it from
            // _parent.t / 12 + dec / 9.
            clip.vars.t_local = 0;
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS DefineSprite_3_point/frame_1/PlaceObject2_2_1/
        //    CLIPACTIONRECORD onClipEvent(enterFrame).as
        //   _rotation = _rotation - 2;
        clip.rotation -= (2 * Math.PI) / 180;

        // AS DefineSprite_3_point/frame_1/DoAction.as — inline onEnterFrame:
        //   if(t > 17) { removeMovieClip(this); }
        //   t = _parent.t / 12 + dec / 9;
        //   _X = rx * Math.cos(t);
        //   y = ry * Math.sin(t);
        //   y2 = y + (p += 0.16);
        //   _Y = _Y - (_Y - y2) / 5;
        //   if(y < 0) { _alpha = 100 + y * 10; }
        const parentT = (clip.parent?.vars.t as number) ?? 0;
        const dec = (clip.vars.dec as number) ?? 0;
        const rx = clip.vars.rx as number;
        const ry = clip.vars.ry as number;
        let p = clip.vars.p as number;
        let y2 = clip.vars.y2 as number;

        const t = parentT / 12 + dec / 9;
        clip.vars.t_local = t;

        if (t > 17) {
          clip.remove();
          return;
        }

        const xPos = rx * Math.cos(t);
        const y = ry * Math.sin(t);
        p += 0.16;
        y2 = y + p;
        const currentY = clip.y;
        clip.x = xPos;
        clip.y = currentY - (currentY - y2) / 5;

        clip.vars.p = p;
        clip.vars.y2 = y2;

        if (y < 0) {
          // AS: _alpha = 100 + y * 10  (y is negative here, so alpha fades)
          // Convert 0-100 AS alpha to 0-1 TS alpha.
          clip.alpha = (100 + y * 10) / 100;
        } else {
          clip.alpha = 1;
        }
      },
    };

    // ---- anim1 — main animated outer sprite (DefineSprite_7) -----
    // This is the composite 210-frame timeline. It contains:
    //   - A PlaceObject2 sub-clip (index 5, depth 1) whose clip events
    //     drive the particle spawner (modelled via onLoad/onEnterFrame
    //     on the anim1 clip itself, since it's the only child behaviour).
    //   - frame_22 (0-based 21): SOMA.playSound("lakam_401a")
    //   - frame_145 (0-based 144): SOMA.playSound("lakam_401b")
    //   - frame_208 (0-based 207): this._end() + _parent.removeMovieClip() + stop()
    const anim1Frames = textures.getFrames("anim1");
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 210,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_7/frame_1/PlaceObject2_5_1/
        //    CLIPACTIONRECORD onClipEvent(load).as
        //   _parent.t = 1;
        // "this" in the clip event refers to the sub-clip (PlaceObject2_5_1),
        // but `_parent` is the anim1 clip (DefineSprite_7). We seed t on
        // the anim1 clip itself.
        clip.vars.t = 1;
      },
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_7/frame_1/PlaceObject2_5_1/
        //    CLIPACTIONRECORD onClipEvent(enterFrame).as
        //   if(_parent.t < 20 & _parent.t % 3 == 1)
        //   {
        //      _parent.attachMovie("point","point" + _parent.t, _parent.t + 100);
        //      eval("_parent.point" + _parent.t).sz = 200 * Math.sin(_parent.t / 10);
        //      eval("_parent.point" + _parent.t).dec = _parent.t;
        //      eval("_parent.point" + _parent.t)._y = -200;
        //   }
        //   _parent.t = _parent.t + 1;
        const t = clip.vars.t as number;
        if (t < 20 && t % 3 === 1) {
          const instanceName = `point${t}`;
          const depth = t + 100;
          const sz = 200 * Math.sin(t / 10);
          // We pre-seed sz and dec into vars before attach so the
          // point's frame_1 DoAction can read them immediately.
          // We temporarily stash them; attach() → onLoad → frameScripts[0]
          // will read clip.vars.sz and clip.vars.dec.
          const pointClip = clip.attach(pointSym, instanceName, depth, ctx);
          pointClip.vars.sz = sz;
          pointClip.vars.dec = t;
          // Re-apply scale now that sz is known (frame_1 already ran
          // during attach, so we need to update the scale here).
          pointClip.scaleX = sz / 100;
          pointClip.scaleY = sz / 100;
          // Canonical: eval("_parent.point" + t)._y = -200
          pointClip.y = -200;
        }
        clip.vars.t = t + 1;
      },
      frameScripts: new Map([
        [
          21,
          (_clip) => {
            // AS DefineSprite_7/frame_22/DoAction.as
            //   SOMA.playSound("lakam_401a");
            if (this._playSound) {
              this._playSound("lakam_401a");
            }
          },
        ],
        [
          144,
          (_clip) => {
            // AS DefineSprite_7/frame_145/DoAction.as
            //   SOMA.playSound("lakam_401b");
            if (this._playSound) {
              this._playSound("lakam_401b");
            }
          },
        ],
        [
          207,
          (clip) => {
            // AS DefineSprite_7/frame_208/DoAction.as
            //   this._end();            → signalHit
            //   _parent.removeMovieClip(); → spell complete
            //   stop();
            this.runtime.signalHit();
            clip.parent?.remove();
            this.runtime.complete();
            clip.stop();
          },
        ],
      ]),
    };

    this.registry.register(pointSym);
    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture the sound callback so frame scripts can fire sounds.
    this._playSound = callbacks.playSound;

    // Attach the main outer sprite at root. This mirrors the SWF main
    // timeline placing DefineSprite_7 (anim1) as the sole child.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
