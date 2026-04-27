/**
 * Spell 2011 — Larve Tir (Sadida larva spit).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2011/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has a `move` symbol
 * (DefineSprite_8_move) that the harness drives along a parabolic arc,
 * and a `shoot` symbol (DefineSprite_4_shoot) that the harness attaches
 * at the target on landing, then fires signalHit automatically.
 *
 * Library symbols:
 *   - lib_fumee  — 48-frame smoke trail particle. frame_1 seeds random
 *                  scale [50,100]%, random start frame [0,29], divides
 *                  vx/vy by (3+rand). onEnterFrame drifts with 1/1.067
 *                  friction. frame_46 removes self.
 *   - lib_fumee2 — 51-frame bigger smoke particle. frame_1 seeds random
 *                  scale [80,100]%, random start frame [0,44], doubles
 *                  vx/vy. onEnterFrame drifts with 1/1.1 friction.
 *                  frame_49 removes self.
 *   - move       — container-only. frame_1 seeds xi/yi/nf and installs
 *                  an onEnterFrame that continuously spawns `fumee`
 *                  smoke particles trailing behind the projectile as it
 *                  arcs through the air.
 *   - shoot      — 93-frame authored animation at target. frame_1 resets
 *                  _rotation=0, spawns 3 fumee2 smoke puffs, seeds c/xi/
 *                  yi/nf. frame_37 spawns 9 more fumee2 puffs (impact
 *                  burst). frame_91 calls _parent.removeMovieClip →
 *                  complete().
 *
 * Main timeline: SOMA.playSound("larve_tir"); (no stop() — harness drives)
 *
 * DefineSprite_13 (frame_1: `_rotation = random(360)`) appears to be an
 * internal rotation randomiser inside some of the authored frames of the
 * shoot timeline; it is not independently attachMovie'd and is handled
 * purely by the authored shoot animation frames, so no separate symbol
 * registration is needed.
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

const FUMEE_BOUNDS = {
  width: 2.35,
  height: 5.5,
  offsetX: -3.05,
  offsetY: 0,
};

const FUMEE2_BOUNDS = {
  width: 13.25,
  height: 9.8,
  offsetX: -8.45,
  offsetY: -7.3,
};

const SHOOT_BOUNDS = {
  width: 132.8,
  height: 88.75,
  offsetX: -77.4,
  offsetY: -75.2,
};

export class Spell2011 extends RuntimeSpell {
  readonly spellId = 2011;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  private fumeeSym!: SymbolDefinition;
  private fumee2Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const fumeeAnchor = calculateAnchor(FUMEE_BOUNDS);
    const fumee2Anchor = calculateAnchor(FUMEE2_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- lib_fumee — smoke trail particle during flight ----------
    // AS: DefineSprite_15_fumee/frame_1/DoAction.as
    //     DefineSprite_15_fumee/frame_46/DoAction.as
    this.fumeeSym = {
      name: "fumee",
      totalFrames: 48,
      frames: textures.getFrames("lib_fumee"),
      anchorX: fumeeAnchor.x,
      anchorY: fumeeAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_15_fumee/frame_1/DoAction.as:
            //   t = 50 * Math.random() + 50
            //   gotoAndPlay(random(30))
            //   _xscale = t; _yscale = t
            //   vx /= 3 + 3 * Math.random()
            //   vy /= 3 + random(3)
            //   onEnterFrame: _X += vx; _Y += vy; vx /= 1.067; vy /= 1.067
            const t = 50 * Math.random() + 50;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;

            const vx = clip.vars.vx as number | undefined ?? 0;
            const vy = clip.vars.vy as number | undefined ?? 0;
            clip.vars.vx = vx / (3 + 3 * Math.random());
            clip.vars.vy = vy / (3 + Math.floor(Math.random() * 3));

            clip.gotoAndPlay(Math.floor(Math.random() * 30));

            clip.onEnterFrame = (c) => {
              // AS DefineSprite_15_fumee onEnterFrame
              const cvx = c.vars.vx as number;
              const cvy = c.vars.vy as number;
              c.x += cvx;
              c.y += cvy;
              c.vars.vx = cvx / 1.067;
              c.vars.vy = cvy / 1.067;
            };
          },
        ],
        [
          45,
          (clip) => {
            // AS DefineSprite_15_fumee/frame_46/DoAction.as:
            //   removeMovieClip(this)
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_fumee2 — larger smoke/impact particle ---------------
    // AS: DefineSprite_14_fumee2/frame_1/DoAction.as
    //     DefineSprite_14_fumee2/frame_49/DoAction.as
    this.fumee2Sym = {
      name: "fumee2",
      totalFrames: 51,
      frames: textures.getFrames("lib_fumee2"),
      anchorX: fumee2Anchor.x,
      anchorY: fumee2Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_14_fumee2/frame_1/DoAction.as:
            //   t = 20 * Math.random() + 80
            //   gotoAndPlay(random(45))
            //   _xscale = t; _yscale = t
            //   vx *= 2; vy *= 2
            //   onEnterFrame: _X += vx; _Y += vy; vx /= 1.1; vy /= 1.1
            const t = 20 * Math.random() + 80;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;

            const vx = clip.vars.vx as number | undefined ?? 0;
            const vy = clip.vars.vy as number | undefined ?? 0;
            clip.vars.vx = vx * 2;
            clip.vars.vy = vy * 2;

            clip.gotoAndPlay(Math.floor(Math.random() * 45));

            clip.onEnterFrame = (c) => {
              // AS DefineSprite_14_fumee2 onEnterFrame
              const cvx = c.vars.vx as number;
              const cvy = c.vars.vy as number;
              c.x += cvx;
              c.y += cvy;
              c.vars.vx = cvx / 1.1;
              c.vars.vy = cvy / 1.1;
            };
          },
        ],
        [
          48,
          (clip) => {
            // AS DefineSprite_14_fumee2/frame_49/DoAction.as:
            //   removeMovieClip(this)
            clip.remove();
          },
        ],
      ]),
    };

    // ---- move — projectile container, spawns fumee trail ---------
    // AS: DefineSprite_8_move/frame_1/DoAction.as
    // Container-only (harness drives position). frame_1 seeds xi/yi/nf
    // and installs an onEnterFrame that spawns fumee particles at the
    // current position each tick, recording previous pos for velocity.
    const fumeeSym = this.fumeeSym;
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
            // AS DefineSprite_8_move/frame_1/DoAction.as:
            //   xi = this._x; yi = this._y
            //   nf = this._parent.level * 1
            //   onEnterFrame: spawn nf fumee particles with drift velocity
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
            const level = (clip.parent?.vars.level as number) ?? 1;
            clip.vars.nf = level * 1;
            clip.vars.c = 0;

            clip.onEnterFrame = (c, ectx) => {
              // AS DefineSprite_8_move onEnterFrame:
              //   while(loc3 < nf) { attachMovie("fumee","fumee"+c, c+10); set pos/vel; c++ }
              //   xi = this._x; yi = this._y
              const nf = c.vars.nf as number;
              const xi = c.vars.xi as number;
              const yi = c.vars.yi as number;
              let counter = c.vars.c as number;

              for (let loc3 = 0; loc3 < nf; loc3++) {
                const instanceName = `fumee${counter}`;
                const parent = c.parent;
                if (parent) {
                  const f = parent.attach(fumeeSym, instanceName, counter + 10, ectx);
                  f.x = c.x;
                  f.y = c.y;
                  f.vars.vx = c.x - xi + 6.67 * (Math.random() - 0.5);
                  f.vars.vy = c.y - yi + 6.67 * (Math.random() - 0.5);
                }
                counter++;
              }

              c.vars.c = counter;
              c.vars.xi = c.x;
              c.vars.yi = c.y;
            };
          },
        ],
      ]),
    };

    // ---- shoot — 93-frame authored animation at target -----------
    // AS: DefineSprite_4_shoot/frame_1, frame_37, frame_91/DoAction.as
    // frame_1: reset rotation, seed xi/yi/nf/c, spawn 3 fumee2 puffs
    // frame_37: spawn 9 more fumee2 puffs (impact burst)
    // frame_91: _parent.removeMovieClip → complete()
    const fumee2Sym = this.fumee2Sym;
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
            // AS DefineSprite_4_shoot/frame_1/DoAction.as:
            //   _rotation = 0
            //   xi = this._x; yi = this._y
            //   nf = this._parent.level * 2; c = 0
            //   loop p < 3: attachMovie("fumee2","fumee2"+(c+200), c+200)
            //     set f._x, f._y, f.vx, f.vy; c++; xi=_x; yi=_y; p++
            clip.rotation = 0;

            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
            const level = (clip.parent?.vars.level as number) ?? 1;
            clip.vars.nf = level * 2;
            clip.vars.c = 0;

            let c = 0;
            let xi = clip.x;
            let yi = clip.y;

            for (let p = 0; p < 3; p++) {
              const instanceName = `fumee2${c}200`;
              const parent = clip.parent;
              if (parent) {
                const f = parent.attach(fumee2Sym, instanceName, c + 200, ctx);
                f.x = clip.x;
                f.y = clip.y - 30;
                f.vars.vx = clip.x - xi + 6.67 * (Math.random() - 0.5);
                f.vars.vy = clip.y - yi + 6.67 * (Math.random() - 0.5);
              }
              c++;
              xi = clip.x;
              yi = clip.y;
            }

            clip.vars.c = c;
            clip.vars.xi = xi;
            clip.vars.yi = yi;
          },
        ],
        [
          36,
          (clip, ctx) => {
            // AS DefineSprite_4_shoot/frame_37/DoAction.as:
            //   xi = this._x; yi = this._y
            //   nf = this._parent.level * 2
            //   loop p < 9: attachMovie("fumee2","fumee2"+c, c+200)
            //     set f._x, f._y, f.vx, f.vy; c++; xi=_x; yi=_y; p++
            let c = clip.vars.c as number;
            let xi = clip.x;
            let yi = clip.y;
            clip.vars.xi = xi;
            clip.vars.yi = yi;

            const parent = clip.parent;
            for (let p = 0; p < 9; p++) {
              const instanceName = `fumee2${c}`;
              if (parent) {
                const f = parent.attach(fumee2Sym, instanceName, c + 200, ctx);
                f.x = clip.x;
                f.y = clip.y - 30;
                f.vars.vx = clip.x - xi + 6.67 * (Math.random() - 0.5);
                f.vars.vy = clip.y - yi + 6.67 * (Math.random() - 0.5);
              }
              c++;
              xi = clip.x;
              yi = clip.y;
            }

            clip.vars.c = c;
            clip.vars.xi = xi;
            clip.vars.yi = yi;
          },
        ],
        [
          90,
          (clip) => {
            // AS DefineSprite_4_shoot/frame_91/DoAction.as:
            //   _parent.removeMovieClip()
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.fumeeSym);
    this.registry.register(this.fumee2Sym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // AS frame_1/DoAction.as: SOMA.playSound("larve_tir");
    callbacks.playSound("larve_tir");
  }
}
