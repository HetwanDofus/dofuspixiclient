/**
 * Spell 207 — Crockette (Osamodas).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/207/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has `move` and `shoot`
 * library symbols: `move` (DefineSprite_15_move) spawns `fumee` smoke
 * trails along the arc; `shoot` (DefineSprite_3_shoot) is the 291-frame
 * impact animation that ends with _parent.removeMovieClip(). The harness
 * drives the parabolic arc and calls signalHit automatically on landing.
 *
 * Library symbols:
 *   - lib_plumes — feather particle. onLoad seeds scale/duree/vy/vx/vch/vr/amp.
 *                  onEnterFrame fades after duree, oscillates and drifts upward.
 *   - lib_fumee  — 66-frame smoke puff. frame_1 sets random rotation; frame_13
 *                  random-skips forward; frame_64 removes self.
 *   - move       — container-only, 1-frame. frame_1 sets up onEnterFrame that
 *                  spawns fumee smoke at the move clip's current position each tick.
 *                  Also contains a sub-sprite (PlaceObject2_14_8) with a sinusoidal
 *                  yscale oscillator — modelled via the move clip's own onEnterFrame.
 *   - shoot      — 291-frame composite animation (isComposite). frame_1 resets
 *                  rotation to 0 (canonical override). frame_289 calls
 *                  _parent.removeMovieClip() + stop() → runtime.complete().
 *
 * Additionally, DefineSprite_2 (unnamed in librarySymbols, but called "plumes_mc"
 * internally) is a 39-frame container that spawns 10 `plumes` particles on
 * frame_1 and stops on frame_39. It is NOT in librarySymbols[], so it is
 * registered with frames: [] and driven by frameScripts only.
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("crockette_207").
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

const PLUMES_BOUNDS = {
  width: 21.75,
  height: 6.65,
  offsetX: -14,
  offsetY: -34.45,
};

const FUMEE_BOUNDS = {
  width: 20.15,
  height: 17.8,
  offsetX: -10.7,
  offsetY: -8.8,
};

const SHOOT_BOUNDS = {
  width: 92.9,
  height: 92.9,
  offsetX: -43.5,
  offsetY: -74.2,
};

export class Spell207 extends RuntimeSpell {
  readonly spellId = 207;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const plumesAnchor = calculateAnchor(PLUMES_BOUNDS);
    const fumeeAnchor = calculateAnchor(FUMEE_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- lib_plumes — feather/dust particle ----------------------------------------
    // AS: DefineSprite_6_plumes/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_6_plumes/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const plumesSym: SymbolDefinition = {
      name: "plumes",
      totalFrames: 1,
      frames: textures.getFrames("lib_plumes"),
      anchorX: plumesAnchor.x,
      anchorY: plumesAnchor.y,
      onLoad: (clip) => {
        // AS onClipEvent(load):
        //   t = 30 + random(30);
        //   _xscale = t; _yscale = t;
        //   duree = 60 + random(30);
        //   vy = -3 - 10 * Math.random();
        //   vx = -10 + 20 * Math.random();
        //   vch = 0.1 + 0.1 * Math.random();
        //   vr = 0.1 + 0.1 * Math.random();
        //   amp = 30 + random(70);
        //   a = 0; time = 0;
        const t = 30 + Math.floor(Math.random() * 30);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.duree = 60 + Math.floor(Math.random() * 30);
        clip.vars.vy = -3 - 10 * Math.random();
        clip.vars.vx = -10 + 20 * Math.random();
        clip.vars.vch = 0.1 + 0.1 * Math.random();
        clip.vars.vr = 0.1 + 0.1 * Math.random();
        clip.vars.amp = 30 + Math.floor(Math.random() * 70);
        clip.vars.a = 0;
        clip.vars.time = 0;
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame):
        //   if(time++ > duree) { _alpha = _alpha - 3; }
        //   if(_Y < 0) {
        //     _Y = _Y + (vy += vch);
        //     _X = _X + vx;
        //     vy *= 0.9; vx *= 0.9;
        //     amp *= 0.98;
        //     _rotation = amp * Math.cos(a += vr);
        //   }
        let time = clip.vars.time as number;
        const duree = clip.vars.duree as number;
        if (time++ > duree) {
          clip.alpha = Math.max(0, clip.alpha - 3 / 100);
        }
        clip.vars.time = time;

        if (clip.y < 0) {
          let vy = clip.vars.vy as number;
          let vx = clip.vars.vx as number;
          let amp = clip.vars.amp as number;
          let a = clip.vars.a as number;
          const vch = clip.vars.vch as number;
          const vr = clip.vars.vr as number;

          vy += vch;
          clip.y = clip.y + vy;
          clip.x = clip.x + vx;
          vy *= 0.9;
          vx *= 0.9;
          amp *= 0.98;
          a += vr;
          // AS rotation in degrees → radians
          clip.rotation = (amp * Math.cos(a) * Math.PI) / 180;

          clip.vars.vy = vy;
          clip.vars.vx = vx;
          clip.vars.amp = amp;
          clip.vars.a = a;
        }
      },
    };

    // ---- lib_fumee — smoke puff particle (66-frame) --------------------------------
    // AS: DefineSprite_19_fumee/frame_1/DoAction.as   → _rotation = random(360)
    //     DefineSprite_19_fumee/frame_13/DoAction.as  → gotoAndPlay(_currentframe + random(21))
    //     DefineSprite_19_fumee/frame_64/DoAction.as  → this.removeMovieClip()
    const fumeeSym: SymbolDefinition = {
      name: "fumee",
      totalFrames: 66,
      frames: textures.getFrames("lib_fumee"),
      anchorX: fumeeAnchor.x,
      anchorY: fumeeAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_19_fumee/frame_1/DoAction.as
            // _rotation = random(360)
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
        [
          12,
          (clip) => {
            // AS DefineSprite_19_fumee/frame_13/DoAction.as
            // gotoAndPlay(_currentframe + random(21))
            // _currentframe is 1-based (= 13 here), so 0-based = 12.
            // Target = (12 + 1) + random(21) - 1 in 0-based = 12 + random(21)
            const skip = Math.floor(Math.random() * 21);
            clip.gotoAndPlay(12 + skip);
          },
        ],
        [
          63,
          (clip) => {
            // AS DefineSprite_19_fumee/frame_64/DoAction.as
            // this.removeMovieClip()
            clip.remove();
          },
        ],
      ]),
    };

    // ---- DefineSprite_2 (plumes_mc) — unnamed 39-frame particle container ----------
    // Not in librarySymbols[], so no lib_ prefix. It is attached by the shoot
    // symbol's frame_1 area in canonical AS... actually looking at the scripts more
    // carefully: DefineSprite_2 spawns `plumes` particles. It appears to be
    // attached inside the shoot symbol (DefineSprite_3_shoot contains it as
    // PlaceObject2_2_1 with clip events). The onClipEvent(load) on PlaceObject2_2_1
    // sets t=70, xscale=yscale=70. DefineSprite_2/frame_1 spawns 10 plumes.
    // DefineSprite_2/frame_39 stops.
    // We model it as "plumes_mc" registered as a container symbol.
    const plumesMcSym: SymbolDefinition = {
      name: "plumes_mc",
      totalFrames: 39,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_3_shoot/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
        // t = 70; _xscale = t; _yscale = t;
        const t = 70;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_2/frame_1/DoAction.as
            // c = 0; p = 0;
            // while(p < 10) {
            //   this.attachMovie("plumes","plumes" + c, c);
            //   eval("this.plumes" + c).vx = 40 * (Math.random() - 0.5);
            //   eval("this.plumes" + c).vy = 40 * (Math.random() - 0.5);
            //   c++; p++;
            // }
            for (let c = 0; c < 10; c++) {
              const child = clip.attach(plumesSym, `plumes${c}`, c, ctx);
              child.vars.vx = 40 * (Math.random() - 0.5);
              child.vars.vy = 40 * (Math.random() - 0.5);
            }
          },
        ],
        [
          38,
          (clip) => {
            // AS DefineSprite_2/frame_39/DoAction.as
            // stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- move — projectile container (DefineSprite_15_move) ------------------------
    // frame_1 sets up an onEnterFrame that spawns fumee smoke at the move clip's
    // current world position every tick. It also contains a child (PlaceObject2_14_8)
    // with a sinusoidal yscale oscillator — we model this via the move clip's own
    // onEnterFrame since we cannot place authored sub-children; it runs as an extra
    // oscillation on the move clip itself.
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
            // AS DefineSprite_15_move/frame_1/DoAction.as
            // xi = this._x; yi = this._y; nf = this._parent.level; c = 0;
            // this.onEnterFrame = function() {
            //   this._parent.attachMovie("fumee","fumee" + c, c + 10);
            //   var f = this._parent["fumee" + c];
            //   f._x = this._x; f._y = this._y;
            //   f.vx = this._x - xi + 20*(Math.random()-0.5);
            //   f.vy = this._y - yi + 20*(Math.random()-0.5);
            //   c++; xi = this._x; yi = this._y;
            // };
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
            clip.vars.c = 0;
            // Also seed the sinusoidal oscillator vars for the sub-sprite
            // AS DefineSprite_15_move/frame_1/PlaceObject2_14_8/CLIPACTIONRECORD onClipEvent(enterFrame).as
            // _yscale = 100 * Math.sin(i += Math.sin(a += 0.02));
            clip.vars.osc_i = 0;
            clip.vars.osc_a = 0;
            clip.onEnterFrame = (mc, innerCtx) => {
              // Smoke trail: attach fumee to parent (the root/outer mc) at move's position
              const parent = mc.parent;
              if (!parent) {
                return;
              }
              const c = mc.vars.c as number;
              const xi = mc.vars.xi as number;
              const yi = mc.vars.yi as number;

              const smokeClip = parent.attach(
                fumeeSym,
                `fumee${c}`,
                c + 10,
                innerCtx,
                { x: mc.x, y: mc.y },
              );
              // Override x/y set by attach (they're already correct from transform),
              // and seed vx/vy on the smoke particle
              smokeClip.vars.vx =
                mc.x - xi + 20 * (Math.random() - 0.5);
              smokeClip.vars.vy =
                mc.y - yi + 20 * (Math.random() - 0.5);

              mc.vars.c = c + 1;
              mc.vars.xi = mc.x;
              mc.vars.yi = mc.y;

              // Sinusoidal yscale oscillator for the sub-sprite (PlaceObject2_14_8)
              // AS: _yscale = 100 * Math.sin(i += Math.sin(a += 0.02))
              let osc_a = mc.vars.osc_a as number;
              let osc_i = mc.vars.osc_i as number;
              osc_a += 0.02;
              osc_i += Math.sin(osc_a);
              mc.scaleY = Math.sin(osc_i); // 100% * sin → decimal
              mc.vars.osc_a = osc_a;
              mc.vars.osc_i = osc_i;
            };
          },
        ],
      ]),
    };

    // ---- shoot — 291-frame composite impact animation (DefineSprite_3_shoot) ------
    // Contains PlaceObject2_2_1 (= plumes_mc) with onClipEvent(load) setting scale 70%.
    // frame_1/DoAction.as: _rotation = 0 (canonical override of harness velocity angle).
    // frame_289/DoAction.as: _parent.removeMovieClip(); stop() → runtime.complete().
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 291,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_3_shoot/frame_1/DoAction.as
            // _rotation = 0  (override harness-applied projectile-velocity rotation)
            clip.rotation = 0;

            // The shoot sprite has PlaceObject2_2_1 which is DefineSprite_2
            // (the plumes_mc container). Attach it here to mirror the canonical
            // authored placement on the shoot timeline's frame_1.
            clip.attach(plumesMcSym, "plumes_mc", 2, ctx);
          },
        ],
        [
          288,
          (clip) => {
            // AS DefineSprite_3_shoot/frame_289/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(plumesSym);
    this.registry.register(fumeeSym);
    this.registry.register(plumesMcSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as
    // SOMA.playSound("crockette_207");
    callbacks.playSound("crockette_207");
  }
}
