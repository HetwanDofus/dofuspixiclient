/**
 * Spell 207 — Crockette (Roublard / Rogue).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/207/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has a `move` symbol
 * and a `shoot` symbol — classic ballistic pattern. The harness attaches
 * `move`, drives it along a parabolic arc to the target, then attaches
 * `shoot` at landing and signals hit automatically.
 *
 * Library symbols:
 *   - plumes — feather particle. onLoad seeds scale, duration, vy/vx/vch/vr/amp.
 *              onEnterFrame: alpha fades after duree, Y moves upward with friction,
 *              rotation oscillates with decaying amplitude.
 *   - fumee  — smoke puff (66-frame). frame_1 sets random rotation. frame_13 does
 *              gotoAndPlay(_currentframe + random(21)) for random-phase looping.
 *              frame_64 removes self.
 *
 * Container symbols:
 *   - move   — empty container. frame_1 DoAction seeds an onEnterFrame that
 *              spawns `fumee` smoke puffs along the flight path.
 *              PlaceObject2_14_8 carries onClipEvent(enterFrame) — a sub-sprite
 *              whose yscale oscillates sinusoidally (treated as part of move's
 *              visual but since move has no frames array the runtime-side we
 *              model the oscillation directly on the move clip itself via a
 *              vars-driven onEnterFrame).
 *   - shoot  — 291-frame composite (from animations[]). frame_1 DoAction: _rotation=0.
 *              PlaceObject2_2_1 onClipEvent(load): t=70, _xscale=_yscale=t.
 *              frame_289 DoAction: _parent.removeMovieClip(); stop(); → complete().
 *
 * DefineSprite_2 (unnamed inner sprite of shoot?): frame_1 spawns 10 `plumes`
 * particles with random vx/vy overrides; frame_39 stops. This is the particle
 * spawner inside the shoot symbol — we model it as an inner SymbolDefinition
 * attached from shoot's frame_1.
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("crockette_207")
 *
 * Signal chain:
 *   - signalHit: fired automatically by harness on ballistic landing (displayType=30)
 *   - complete:  fired from shoot's frame_289 script (→ _parent.removeMovieClip)
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

// Bounds from manifest.json librarySymbols[]
const PLUMES_BOUNDS = {
  width: 21.75,
  height: 6.65,
  offsetX: -14,
  offsetY: -34.45,
};

const FUMEE_LIB_BOUNDS = {
  width: 20.15,
  height: 17.8,
  offsetX: -10.7,
  offsetY: -8.8,
};

// Bounds from manifest.json animations[] for shoot
const SHOOT_BOUNDS = {
  width: 92.9,
  height: 92.9,
  offsetX: -43.5,
  offsetY: -74.2,
};

export class Spell207 extends RuntimeSpell {
  readonly spellId = 207;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  // Symbols that need to be referenced across methods
  private plumesSym!: SymbolDefinition;
  private fumeeSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const plumesAnchor = calculateAnchor(PLUMES_BOUNDS);
    const fumeeAnchor = calculateAnchor(FUMEE_LIB_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- lib_plumes — feather drift particle --------------------
    // AS: DefineSprite_6_plumes/frame_1/PlaceObject2_5_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.plumesSym = {
      name: "plumes",
      totalFrames: 1,
      frames: textures.getFrames("lib_plumes"),
      anchorX: plumesAnchor.x,
      anchorY: plumesAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_6_plumes/frame_1/PlaceObject2_5_1/onClipEvent(load):
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
        // AS DefineSprite_6_plumes/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame):
        //   if(time++ > duree) { _alpha -= 3; }
        //   if(_Y < 0) {
        //     _Y = _Y + (vy += vch); _X += vx;
        //     vy *= 0.9; vx *= 0.9; amp *= 0.98;
        //     _rotation = amp * cos(a += vr);
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

    // ---- lib_fumee — smoke puff (66-frame animated sprite) ------
    // AS: DefineSprite_19_fumee
    //   frame_1/DoAction.as: _rotation = random(360)
    //   frame_13/DoAction.as: gotoAndPlay(_currentframe + random(21))
    //   frame_64/DoAction.as: this.removeMovieClip()
    this.fumeeSym = {
      name: "fumee",
      totalFrames: 66,
      frames: textures.getFrames("lib_fumee"),
      anchorX: fumeeAnchor.x,
      anchorY: fumeeAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_19_fumee/frame_1/DoAction.as:
        //   _rotation = random(360);
        // This is actually executed as a frame_1 script but also applies
        // on load via the frameScripts[0] path. We seed rotation here
        // as onLoad to ensure it fires on attach before the first tick.
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        // Carry vx/vy from parent attach site (set by move's onEnterFrame)
        // these are set externally before onLoad via clip.vars in the attach
        // transform — they'll already be on vars if set before onLoad fires.
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_19_fumee/frame_1/DoAction.as:
            //   _rotation = random(360);
            // Apply vx/vy drift if seeded by move's onEnterFrame spawn code.
            // The rotation was already set in onLoad; this reinforces it.
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
        [
          12,
          (clip) => {
            // AS DefineSprite_19_fumee/frame_13/DoAction.as:
            //   gotoAndPlay(_currentframe + random(21));
            // currentFrame is 0-based here; AS's _currentframe is 1-based.
            // AS: gotoAndPlay(13 + random(21)) → up to frame 33 (1-based)
            // In 0-based: currentFrame=12, so gotoAndPlay(12 + random(21))
            const jump = 12 + Math.floor(Math.random() * 21);
            clip.gotoAndPlay(Math.min(jump, 63));
          },
        ],
        [
          63,
          (clip) => {
            // AS DefineSprite_19_fumee/frame_64/DoAction.as:
            //   this.removeMovieClip();
            clip.remove();
          },
        ],
      ]),
    };

    // ---- DefineSprite_2 (inner particle spawner inside shoot) ----
    // AS DefineSprite_2/frame_1/DoAction.as: spawn 10 plumes particles
    // AS DefineSprite_2/frame_39/DoAction.as: stop()
    // This sprite is an internal child of "shoot" that spawns feather particles.
    const sprite2Sym: SymbolDefinition = {
      name: "sprite2",
      totalFrames: 39,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_2/frame_1/DoAction.as:
            //   c = 0; p = 0;
            //   while(p < 10) {
            //     this.attachMovie("plumes","plumes"+c, c);
            //     eval("this.plumes"+c).vx = 40*(Math.random()-0.5);
            //     eval("this.plumes"+c).vy = 40*(Math.random()-0.5);
            //     c++; p++;
            //   }
            for (let c = 0; c < 10; c++) {
              const child = clip.attach(
                this.plumesSym,
                `plumes${c}`,
                c,
                ctx,
              );
              // Override vx/vy after attach (post-onLoad override, canonical)
              child.vars.vx = 40 * (Math.random() - 0.5);
              child.vars.vy = 40 * (Math.random() - 0.5);
            }
          },
        ],
        [
          38,
          (clip) => {
            // AS DefineSprite_2/frame_39/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- move — empty container for ballistic motion + smoke trail ----
    // AS: DefineSprite_15_move/frame_1/DoAction.as
    //     DefineSprite_15_move/frame_1/PlaceObject2_14_8/onClipEvent(enterFrame)
    //
    // frame_1 DoAction seeds an onEnterFrame on `this` (the move clip itself)
    // that spawns fumee smoke at the current position each tick.
    // PlaceObject2_14_8 carries a sinusoidal yscale oscillation on a sub-sprite;
    // since move has no authored frames array we model this oscillation directly
    // on move clip's vars-driven onEnterFrame below.
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 2,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_15_move/frame_1/DoAction.as:
        //   xi = this._x; yi = this._y;
        //   nf = this._parent.level;
        //   c = 0;
        // Store initial position and counter in vars.
        clip.vars.xi = clip.x;
        clip.vars.yi = clip.y;
        clip.vars.c = 0;
        // Vars for PlaceObject2_14_8 sub-sprite sinusoidal scale:
        // onClipEvent(enterFrame): _yscale = 100 * Math.sin(i += Math.sin(a += 0.02))
        clip.vars.i = 0;
        clip.vars.a = 0;
      },
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_15_move/frame_1/DoAction.as onEnterFrame function:
        //   this._parent.attachMovie("fumee","fumee"+c, c+10);
        //   var _loc2_ = this._parent["fumee"+c];
        //   _loc2_._x = this._x; _loc2_._y = this._y;
        //   _loc2_.vx = this._x - xi + 20*(Math.random()-0.5);
        //   _loc2_.vy = this._y - yi + 20*(Math.random()-0.5);
        //   c++; xi = this._x; yi = this._y;
        const parent = clip.parent;
        if (parent) {
          let c = clip.vars.c as number;
          const xi = clip.vars.xi as number;
          const yi = clip.vars.yi as number;

          const smokeChild = parent.attach(
            this.fumeeSym,
            `fumee${c}`,
            c + 10,
            ctx,
          );
          smokeChild.x = clip.x;
          smokeChild.y = clip.y;
          // Override vx/vy on the smoke puff (set after onLoad)
          smokeChild.vars.vx = clip.x - xi + 20 * (Math.random() - 0.5);
          smokeChild.vars.vy = clip.y - yi + 20 * (Math.random() - 0.5);

          clip.vars.c = c + 1;
          clip.vars.xi = clip.x;
          clip.vars.yi = clip.y;
        }

        // AS DefineSprite_15_move/frame_1/PlaceObject2_14_8/onClipEvent(enterFrame):
        //   _yscale = 100 * Math.sin(i += Math.sin(a += 0.02));
        // We model this on the move clip itself (no sub-sprite needed since
        // the oscillation is a visual flourish on the projectile body).
        let a = clip.vars.a as number;
        let i = clip.vars.i as number;
        a += 0.02;
        i += Math.sin(a);
        clip.scaleY = Math.sin(i);
        clip.vars.a = a;
        clip.vars.i = i;
      },
    };

    // ---- shoot — 291-frame impact animation at target -----------
    // animations[] entry "shoot" with 291 frames (not a librarySymbol,
    // but the harness looks it up by name "shoot" in the registry).
    //
    // AS DefineSprite_3_shoot/frame_1/DoAction.as: _rotation = 0
    // AS DefineSprite_3_shoot/frame_1/PlaceObject2_2_1/onClipEvent(load):
    //   t = 70; _xscale = t; _yscale = t;
    // AS DefineSprite_3_shoot/frame_289/DoAction.as:
    //   _parent.removeMovieClip(); stop();
    //
    // The PlaceObject2_2_1 child is DefineSprite_2 (the plumes spawner).
    // Its onClipEvent(load) sets t=70, _xscale=_yscale=70 on THAT child.
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
            // AS DefineSprite_3_shoot/frame_1/DoAction.as:
            //   _rotation = 0;
            // Override harness-applied projectile-velocity rotation.
            clip.rotation = 0;

            // AS DefineSprite_3_shoot/frame_1 PlaceObject2_2_1 is DefineSprite_2
            // (the plumes spawner). Its onClipEvent(load) runs on attach:
            //   t = 70; _xscale = t; _yscale = t;
            // We attach sprite2 here; its onLoad will be fired by attach().
            const child = clip.attach(sprite2Sym, "sprite2", 1, ctx);
            // AS PlaceObject2_2_1/onClipEvent(load): t=70, _xscale=_yscale=t
            child.scaleX = 70 / 100;
            child.scaleY = 70 / 100;
            child.vars.t = 70;
          },
        ],
        [
          288,
          (clip) => {
            // AS DefineSprite_3_shoot/frame_289/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.plumesSym);
    this.registry.register(this.fumeeSym);
    this.registry.register(sprite2Sym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS frame_1/DoAction.as: SOMA.playSound("crockette_207");
    callbacks.playSound("crockette_207");
  }
}
