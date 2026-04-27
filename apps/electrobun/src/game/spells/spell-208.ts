/**
 * Spell 208 — Boule de Feu / Renvoi de Sort (Osamodas rock throw).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/208/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic).
 *   - Has both `move` and `shoot` symbols (harness expects them).
 *   - `move` (DefineSprite_15) contains a PlaceObject2_14_8 child whose
 *     onEnterFrame oscillates _yscale, plus a frame_1 DoAction that wires
 *     an onEnterFrame callback on `move` itself to trail `fumee` smoke particles.
 *   - `shoot` (DefineSprite_26) contains a PlaceObject2_25_1 child (sprite_25)
 *     that spawns `plumes` feather particles and accumulates `pierres` stone chips.
 *     frame_1 resets _rotation to -_parent.angle (upright override).
 *     frame_97 removes _parent (outer mc) + stop → spell complete.
 *   - The harness fires signalHit automatically at landing; do NOT call it again.
 *
 * Library symbols:
 *   - lib_fumee  (36-frame smoke puff) — frame_1 randomises rotation; frame_8
 *     jumps forward random(7) frames; frame_36 removes self.
 *   - lib_plumes (1-frame feather)     — onLoad seeds random drift; onEnterFrame
 *     fades + drifts while _Y < 0, oscillating rotation.
 *   - lib_pierres (1-frame stone chip) — onLoad seeds ballistic vars; onEnterFrame
 *     drives outward scatter + angle-driven drift + alpha fade.
 *
 * Container symbols (no authored visual frames):
 *   - move  (DefineSprite_15) — 1-frame container. frame_1 wires smoke trail.
 *   - shoot (DefineSprite_26) — 97-frame container. frame_1 places sprite_25
 *     inner composite; frame_97 completes.
 *
 * The inner sprite_25 (DefineSprite_25) is a sub-symbol that lives inside
 * `shoot`. It has its own authored timeline (20 frames, stops at 20) and a
 * PlaceObject2_23_2 clip that accumulates `pierres` over time. It also spawns
 * 10 `plumes` on frame_1. We model it as a nested SymbolDefinition.
 *
 * Main timeline: no SOMA.playSound in the visible scripts; onSpellStart is
 * minimal (the harness handles move/shoot attachment for displayType 30).
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

// ---------------------------------------------------------------------------
// Manifest bounds for calculateAnchor
// ---------------------------------------------------------------------------

const FUMEE_BOUNDS = {
  width: 20.15,
  height: 17.8,
  offsetX: -10.7,
  offsetY: -8.8,
};

const PLUMES_BOUNDS = {
  width: 21.75,
  height: 6.65,
  offsetX: -14,
  offsetY: -34.45,
};

const PIERRES_BOUNDS = {
  width: 16.15,
  height: 20.5,
  offsetX: -8.15,
  offsetY: -8.6,
};

export class Spell208 extends RuntimeSpell {
  readonly spellId = 208;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  // Keep references so nested symbol defs can cross-reference each other
  private fumeeSym!: SymbolDefinition;
  private plumesSym!: SymbolDefinition;
  private pierresSym!: SymbolDefinition;
  private sprite25Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const fumeeAnchor = calculateAnchor(FUMEE_BOUNDS);
    const plumesAnchor = calculateAnchor(PLUMES_BOUNDS);
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);

    // ---- lib_fumee — 36-frame smoke puff -------------------------------
    // frame_1:  AS DefineSprite_22_fumee/frame_1/DoAction.as
    //   _rotation = random(360);
    // frame_8:  AS DefineSprite_22_fumee/frame_8/DoAction.as
    //   gotoAndPlay(_currentframe + random(7));
    // frame_36: AS DefineSprite_22_fumee/frame_36/DoAction.as
    //   this.removeMovieClip();
    this.fumeeSym = {
      name: "fumee",
      totalFrames: 36,
      frames: textures.getFrames("lib_fumee"),
      anchorX: fumeeAnchor.x,
      anchorY: fumeeAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_22_fumee/frame_1/DoAction.as
            const deg = Math.floor(Math.random() * 360);
            clip.rotation = (deg * Math.PI) / 180;
          },
        ],
        [
          7,
          (clip) => {
            // AS DefineSprite_22_fumee/frame_8/DoAction.as
            // gotoAndPlay(_currentframe + random(7))
            // _currentframe is 1-based in AS; here clip.currentFrame is 0-based.
            // After tickOneFrame advances to frame index 7, currentFrame == 7.
            // AS equivalent: gotoAndPlay(8 + random(7)) → gotoAndPlay(8..14)
            // 0-based: gotoAndPlay(7 + random(7)) → indices 7..13
            const jump = Math.floor(Math.random() * 7);
            clip.gotoAndPlay(7 + jump);
          },
        ],
        [
          35,
          (clip) => {
            // AS DefineSprite_22_fumee/frame_36/DoAction.as
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_plumes — feather particle ---------------------------------
    // AS DefineSprite_18_plumes/frame_1/PlaceObject2_17_1/
    //   CLIPACTIONRECORD onClipEvent(load).as
    //   CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.plumesSym = {
      name: "plumes",
      totalFrames: 1,
      frames: textures.getFrames("lib_plumes"),
      anchorX: plumesAnchor.x,
      anchorY: plumesAnchor.y,
      onLoad: (clip) => {
        // AS onClipEvent(load):
        //   if(random(2) == 1) { _xscale = -_xscale; }
        //   t = 40 + random(60);
        //   _xscale = t;  _yscale = t;
        //   duree = 40 + random(30);
        //   vy = -5 - 15 * Math.random();
        //   vx = -10 + 20 * Math.random();
        //   vch = 0.2 + 0.3 * Math.random();
        //   vr = 0.1 + 0.3 * Math.random();
        //   amp = 30 + random(70);
        //   time = 0;  a = 0;
        if (Math.floor(Math.random() * 2) === 1) {
          clip.scaleX = -clip.scaleX;
        }
        const t = 40 + Math.floor(Math.random() * 60);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.duree = 40 + Math.floor(Math.random() * 30);
        clip.vars.vy = -5 - 15 * Math.random();
        clip.vars.vx = -10 + 20 * Math.random();
        clip.vars.vch = 0.2 + 0.3 * Math.random();
        clip.vars.vr = 0.1 + 0.3 * Math.random();
        clip.vars.amp = 30 + Math.floor(Math.random() * 70);
        clip.vars.time = 0;
        clip.vars.a = 0;
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame):
        //   if(time++ > duree) { _alpha -= 10; }
        //   if(_Y < 0) {
        //     _Y = _Y + (vy += vch);
        //     _X += vx;
        //     vy *= 0.9;  vx *= 0.9;
        //     amp *= 0.98;
        //     _rotation = amp * Math.cos(a += vr);
        //   }
        let time = clip.vars.time as number;
        const duree = clip.vars.duree as number;
        if (time > duree) {
          clip.alpha = Math.max(0, clip.alpha - 10 / 100);
        }
        clip.vars.time = time + 1;

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

    // ---- lib_pierres — stone chip particle -----------------------------
    // AS DefineSprite_6_pierres/frame_1/PlaceObject2_5_1/
    //   CLIPACTIONRECORD onClipEvent(load).as
    //   CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // NOTE: The pierres clip is placed as PlaceObject2_5_1 inside
    // DefineSprite_6_pierres. The parent traversal in the AS is deep:
    //   _parent._parent._parent._parent._parent.angle
    // Walking from the pierres clip:
    //   pierres clip → pierres symbol wrapper (PlaceObject2 child of sprite_6)
    //   → sprite_6 (pierres symbol instance inside sprite_25)
    //   → sprite_25 (inside shoot)
    //   → shoot (root child)
    //   → root (has vars.angle set by harness)
    // So we walk clip.parent?.parent?.parent?.parent to reach root.
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,
      onLoad: (clip) => {
        // AS onClipEvent(load):
        //   vd = 30 + random(30);
        //   gotoAndPlay(random(4) + 1);
        //   vx = 15 * (Math.random() - 0.5);
        //   vy = 15 * (Math.random() - 0.5);
        //   an = _parent._parent._parent._parent._parent.angle + 3.1415;
        //   v2x = Math.cos(an) * 2;
        //   v2y = Math.sin(an) * 5;
        //   _parent._x = 20 * (Math.random() - 0.5);
        //   _parent._y = 10 * (Math.random() - 0.5);
        //   t = 60 + 40 * Math.random();
        //   v = -10;
        //   _xscale = t;  _yscale = t;
        //   vr = 60 * (-0.5 + Math.random());
        //   tps = 0;
        clip.vars.vd = 30 + Math.floor(Math.random() * 30);
        // gotoAndPlay(random(4) + 1) → gotoAndPlay(1..4) → 0-based 0..3
        clip.gotoAndPlay(Math.floor(Math.random() * 4));
        clip.vars.vx = 15 * (Math.random() - 0.5);
        clip.vars.vy = 15 * (Math.random() - 0.5);
        // Walk up 5 levels to reach root.vars.angle (stored in degrees by harness)
        const root =
          clip.parent?.parent?.parent?.parent ??
          clip.parent?.parent?.parent ??
          clip.parent?.parent ??
          clip.parent;
        const angleDeg = (root?.vars.angle as number) ?? 0;
        const an = (angleDeg * Math.PI) / 180 + Math.PI;
        clip.vars.v2x = Math.cos(an) * 2;
        clip.vars.v2y = Math.sin(an) * 5;
        // _parent._x / _parent._y — scatter the pierres symbol container
        if (clip.parent) {
          clip.parent.x = 20 * (Math.random() - 0.5);
          clip.parent.y = 10 * (Math.random() - 0.5);
        }
        const t = 60 + 40 * Math.random();
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.t = t;
        clip.vars.v = -10;
        clip.vars.vr = 60 * (-0.5 + Math.random());
        clip.vars.tps = 0;
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame):
        //   if(_alpha < 10) { removeMovieClip(_parent); }
        //   _parent._x += vx;  _parent._y += vy;
        //   _rotation = _rotation + vr;
        //   if(tps++ < vd) { vx /= 1.2; vy /= 1.2; v /= 1.2; }
        //   if(tps++ > vd) { _Y += (v2y *= 1.2); _X += (v2x *= 1.2); _alpha -= 10; }
        if (clip.alpha < 10 / 100) {
          if (clip.parent) {
            clip.parent.remove();
          }
          return;
        }
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        let v = clip.vars.v as number;
        let v2x = clip.vars.v2x as number;
        let v2y = clip.vars.v2y as number;
        let tps = clip.vars.tps as number;
        const vd = clip.vars.vd as number;
        const vr = clip.vars.vr as number;

        if (clip.parent) {
          clip.parent.x += vx;
          clip.parent.y += vy;
        }
        // AS rotation in degrees → delta in radians
        clip.rotation += (vr * Math.PI) / 180;

        // First tps++ < vd check
        if (tps < vd) {
          vx /= 1.2;
          vy /= 1.2;
          v /= 1.2;
        }
        tps++;
        // Second tps++ > vd check (note: tps has already been incremented once above)
        if (tps > vd) {
          v2y *= 1.2;
          v2x *= 1.2;
          clip.y += v2y;
          clip.x += v2x;
          clip.alpha = Math.max(0, clip.alpha - 10 / 100);
        }
        tps++;

        clip.vars.vx = vx;
        clip.vars.vy = vy;
        clip.vars.v = v;
        clip.vars.v2x = v2x;
        clip.vars.v2y = v2y;
        clip.vars.tps = tps;
      },
    };

    // ---- sprite_25 (DefineSprite_25) — inner impact composite ----------
    // Lives inside `shoot`. Has:
    //   frame_1 DoAction: spawn 10 plumes; init c=0, p=0.
    //   frame_1 PlaceObject2_23_2 onEnterFrame: accumulate pierres particles.
    //   frame_20 DoAction: stop().
    //
    // The PlaceObject2_23_2 child is an internal sub-clip whose onEnterFrame
    // drives pierres spawning. We model this via a dedicated "inner_23" symbol
    // that we attach in sprite_25's frame_1, whose onEnterFrame mirrors the
    // PlaceObject2_23_2 clip event.
    const inner23Sym: SymbolDefinition = {
      name: "inner_23",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_25/frame_1/PlaceObject2_23_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // if(c < _parent._parent._parent.level * 3) {
        //   c += 1;
        //   this.attachMovie("pierres","pierres" + c, c);
        //   c += 1;
        //   this.attachMovie("pierres","pierres" + c, c);
        // }
        // _parent of inner_23 is sprite_25; _parent._parent is shoot; _parent._parent._parent is root
        const root = clip.parent?.parent?.parent;
        const level = (root?.vars.level as number) ?? 1;
        let c = (clip.vars.c as number) ?? 0;
        if (c < level * 3) {
          c += 1;
          clip.attach(this.pierresSym, `pierres${c}`, c, ctx);
          c += 1;
          clip.attach(this.pierresSym, `pierres${c}`, c, ctx);
        }
        clip.vars.c = c;
      },
    };

    this.sprite25Sym = {
      name: "sprite_25",
      totalFrames: 20,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_25/frame_1/DoAction.as
            // c = 0; p = 0;
            // while(p < 10) {
            //   this.attachMovie("plumes","plumes" + c, c);
            //   eval("this.plumes" + c).vx = 40 * (Math.random() - 0.5);
            //   eval("this.plumes" + c).vy = 40 * (Math.random() - 0.5);
            //   c++; p++;
            // }
            clip.vars.c_plumes = 0;
            let c = 0;
            for (let p = 0; p < 10; p++) {
              const child = clip.attach(
                this.plumesSym,
                `plumes${c}`,
                c,
                ctx
              );
              child.vars.vx = 40 * (Math.random() - 0.5);
              child.vars.vy = 40 * (Math.random() - 0.5);
              c++;
            }
            // Also attach the inner_23 clip-event-bearing sub-clip
            const inner = clip.attach(inner23Sym, "inner_23", 100, ctx);
            inner.vars.c = 0;
          },
        ],
        [
          19,
          (clip) => {
            // AS DefineSprite_25/frame_20/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- move — container for projectile flight --------------------
    // AS DefineSprite_15_move/frame_1/DoAction.as:
    //   xi = this._x;  yi = this._y;  nf = this._parent.level;
    //   this.onEnterFrame = function() {
    //     this._parent.attachMovie("fumee","fumee"+c, c+10);
    //     _loc2_ = this._parent["fumee"+c];
    //     _loc2_._x = this._x; _loc2_._y = this._y;
    //     _loc2_.vx = ...; _loc2_.vy = ...;
    //     c++; xi = this._x; yi = this._y;
    //   }
    //
    // AS DefineSprite_15_move/frame_1/PlaceObject2_14_8/onClipEvent(enterFrame):
    //   _yscale = 100 * Math.sin(i += Math.sin(a += 0.02));
    //
    // The inner PlaceObject2_14_8 sub-clip drives a yscale oscillation.
    // We model it as an "inner_move_oscillator" symbol.
    const innerMoveOscSym: SymbolDefinition = {
      name: "inner_move_osc",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        clip.vars.i = 0;
        clip.vars.a = 0;
      },
      onEnterFrame: (clip) => {
        // AS: _yscale = 100 * Math.sin(i += Math.sin(a += 0.02));
        let a = clip.vars.a as number;
        let i = clip.vars.i as number;
        a += 0.02;
        i += Math.sin(a);
        // AS _yscale in percent → decimal; apply to parent (the move clip)
        if (clip.parent) {
          clip.parent.scaleY = Math.sin(i);
        }
        clip.vars.a = a;
        clip.vars.i = i;
      },
    };

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
            // xi = this._x;  yi = this._y;
            // this.onEnterFrame = function() { smoke trail ... }
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
            clip.vars.c = 0;

            // Attach the inner oscillator sub-clip
            clip.attach(innerMoveOscSym, "osc", 8, ctx);

            // Wire onEnterFrame directly on the move clip to trail fumee smoke
            clip.onEnterFrame = (mv, mvCtx) => {
              // AS this.onEnterFrame inside DefineSprite_15_move/frame_1/DoAction.as:
              //   this._parent.attachMovie("fumee","fumee"+c, c+10);
              //   _loc2_ = this._parent["fumee"+c];
              //   _loc2_._x = this._x; _loc2_._y = this._y;
              //   _loc2_.vx = this._x - xi + 20*(Math.random()-0.5);
              //   _loc2_.vy = this._y - yi + 20*(Math.random()-0.5);
              //   c++; xi = this._x; yi = this._y;
              const parent = mv.parent;
              if (!parent) {
                return;
              }
              let c = mv.vars.c as number;
              const xi = mv.vars.xi as number;
              const yi = mv.vars.yi as number;

              const smoke = parent.attach(
                this.fumeeSym,
                `fumee${c}`,
                c + 10,
                mvCtx
              );
              smoke.x = mv.x;
              smoke.y = mv.y;
              smoke.vars.vx = mv.x - xi + 20 * (Math.random() - 0.5);
              smoke.vars.vy = mv.y - yi + 20 * (Math.random() - 0.5);

              c++;
              mv.vars.c = c;
              mv.vars.xi = mv.x;
              mv.vars.yi = mv.y;
            };
          },
        ],
      ]),
    };

    // ---- shoot — 97-frame impact composite at target ---------------
    // AS DefineSprite_26_shoot/frame_1/DoAction.as:
    //   _rotation = -_parent.angle;   (degrees → radians, negated)
    // AS DefineSprite_26_shoot/frame_1/PlaceObject2_25_1/onClipEvent(load):
    //   t = 60; _xscale = t; _yscale = t;
    // AS DefineSprite_26_shoot/frame_97/DoAction.as:
    //   _parent.removeMovieClip(); stop();
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 97,
      frames: textures.getFrames("shoot"),
      anchorX: calculateAnchor({
        width: 102,
        height: 102,
        offsetX: -53,
        offsetY: -93.7,
      }).x,
      anchorY: calculateAnchor({
        width: 102,
        height: 102,
        offsetX: -53,
        offsetY: -93.7,
      }).y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_26_shoot/frame_1/DoAction.as:
            //   _rotation = -_parent.angle;
            // _parent.angle is in degrees (harness stores degrees on root.vars.angle)
            const root = clip.parent;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            clip.rotation = ((-angleDeg) * Math.PI) / 180;

            // AS DefineSprite_26_shoot/frame_1/PlaceObject2_25_1/onClipEvent(load):
            //   t = 60; _xscale = t; _yscale = t;
            // The PlaceObject2_25_1 is sprite_25 placed on shoot's timeline.
            // Attach it here and apply its load-time transform.
            const sp25 = clip.attach(this.sprite25Sym, "sprite_25", 1, ctx);
            sp25.scaleX = 60 / 100;
            sp25.scaleY = 60 / 100;
          },
        ],
        [
          96,
          (clip) => {
            // AS DefineSprite_26_shoot/frame_97/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.fumeeSym);
    this.registry.register(this.plumesSym);
    this.registry.register(this.pierresSym);
    this.registry.register(this.sprite25Sym);
    this.registry.register(innerMoveOscSym);
    this.registry.register(moveSym);
    this.registry.register(innerMoveOscSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // No SOMA.playSound found in the extracted main timeline scripts.
    // The harness (displayType=30) handles attaching move + shoot.
  }
}
