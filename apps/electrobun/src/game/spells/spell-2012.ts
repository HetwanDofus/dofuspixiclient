/**
 * Spell 2012 — (Projectile with smoke trail).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2012/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has explicit `move` and `shoot`
 * symbols: `move` (DefineSprite_6_move) emits `fumee` smoke particles as a trail
 * during projectile flight; `shoot` (DefineSprite_3_shoot) is the 75-frame impact
 * that emits `fumee2` puff particles and then calls `_parent.removeMovieClip()`.
 * The harness drives the parabolic arc, attaches `move` at root, fires `signalHit()`
 * on landing, and attaches `shoot` at the target — per-spell code does NOT call
 * signalHit() again.
 *
 * Library symbols:
 *   - lib_fumee  — 48-frame small smoke particle. frame_1 seeds scale/vx/vy, jumps
 *                  to a random frame, runs onEnterFrame to drift with friction.
 *                  frame_46 removes self.
 *   - lib_fumee2 — 51-frame larger smoke puff. frame_1 seeds scale/vx/vy, jumps to
 *                  random frame, gravity-affected drift in onEnterFrame.
 *                  frame_49 removes self.
 *
 * Container symbols (no frames):
 *   - move  (DefineSprite_6_move): frame_1 sets up onEnterFrame to spawn `fumee`
 *           trail particles continuously while the projectile flies.
 *           Contains a rotating child (PlaceObject2_5_2) that spins at +75 deg/frame.
 *   - shoot (DefineSprite_3_shoot): frame_1 resets rotation, spawns 7 `fumee2` puffs
 *           at the landing position. frame_73 calls `_parent.removeMovieClip()` →
 *           runtime.complete().
 *
 * Main timeline: no sound found in AS. The harness handles move+shoot attachment.
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
  width: 2,
  height: 2.05,
  offsetX: -0.3,
  offsetY: -0.55,
};

const FUMEE2_BOUNDS = {
  width: 13.25,
  height: 8.25,
  offsetX: -8.45,
  offsetY: -7.3,
};

export class Spell2012 extends RuntimeSpell {
  readonly spellId = 2012;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const fumeeAnchor = calculateAnchor(FUMEE_BOUNDS);
    const fumee2Anchor = calculateAnchor(FUMEE2_BOUNDS);

    // ---- lib_fumee — small trail smoke particle -------------------
    // AS: DefineSprite_13_fumee/frame_1/DoAction.as
    //     DefineSprite_13_fumee/frame_46/DoAction.as
    const fumeeSym: SymbolDefinition = {
      name: "fumee",
      totalFrames: 48,
      frames: textures.getFrames("lib_fumee"),
      anchorX: fumeeAnchor.x,
      anchorY: fumeeAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_13_fumee/frame_1/DoAction.as
            // t = 50 * Math.random() + 50;
            // gotoAndPlay(random(30));
            // _xscale = t; _yscale = t;
            // vx /= 3 + 3 * Math.random();
            // vy /= 3 + random(3);
            // this.onEnterFrame = function() { _X += vx; _Y += vy; vx /= 1.2; vy /= 1.2; }
            const t = 50 * Math.random() + 50;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            const vxIn = clip.vars.vx as number | undefined ?? 0;
            const vyIn = clip.vars.vy as number | undefined ?? 0;
            clip.vars.vx = vxIn / (3 + 3 * Math.random());
            clip.vars.vy = vyIn / (3 + Math.floor(Math.random() * 3));
            // Jump to a random frame so particles are staggered visually.
            clip.gotoAndPlay(Math.floor(Math.random() * 30));
            clip.onEnterFrame = (c) => {
              // AS: this.onEnterFrame inline inside frame_1
              const vx = c.vars.vx as number;
              const vy = c.vars.vy as number;
              c.x += vx;
              c.y += vy;
              c.vars.vx = vx / 1.2;
              c.vars.vy = vy / 1.2;
            };
          },
        ],
        [
          45,
          (clip) => {
            // AS: DefineSprite_13_fumee/frame_46/DoAction.as
            // this.removeMovieClip();
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_fumee2 — larger impact smoke puff -------------------
    // AS: DefineSprite_11_fumee2/frame_1/DoAction.as
    //     DefineSprite_11_fumee2/frame_49/DoAction.as
    const fumee2Sym: SymbolDefinition = {
      name: "fumee2",
      totalFrames: 51,
      frames: textures.getFrames("lib_fumee2"),
      anchorX: fumee2Anchor.x,
      anchorY: fumee2Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_11_fumee2/frame_1/DoAction.as
            // t = 20 * Math.random() + 80;
            // gotoAndPlay(random(45));
            // _xscale = t; _yscale = t;
            // vx *= 0.67; vy *= 0.67;
            // this.onEnterFrame = function() { _X += vx; _Y += vy; vy += 0.5; }
            const t = 20 * Math.random() + 80;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            const vxIn = clip.vars.vx as number | undefined ?? 0;
            const vyIn = clip.vars.vy as number | undefined ?? 0;
            clip.vars.vx = vxIn * 0.67;
            clip.vars.vy = vyIn * 0.67;
            // Jump to a random frame so puffs are staggered visually.
            clip.gotoAndPlay(Math.floor(Math.random() * 45));
            clip.onEnterFrame = (c) => {
              // AS: this.onEnterFrame inline inside frame_1
              const vx = c.vars.vx as number;
              let vy = c.vars.vy as number;
              c.x += vx;
              c.y += vy;
              vy += 0.5;
              c.vars.vy = vy;
            };
          },
        ],
        [
          48,
          (clip) => {
            // AS: DefineSprite_11_fumee2/frame_49/DoAction.as
            // this.removeMovieClip();
            clip.remove();
          },
        ],
      ]),
    };

    // ---- move — trail-emitting projectile container --------------
    // AS: DefineSprite_6_move/frame_1/DoAction.as
    //     DefineSprite_6_move/frame_1/PlaceObject2_5_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // The move clip has a child placed on its authored timeline
    // (PlaceObject2_5_2 — DefineSprite_10) that spins at +75 degrees per
    // frame. We model this as an onLoad that attaches the spinner child via
    // a minimal inline symbol. The canonical DoAction sets up an onEnterFrame
    // that continuously spawns `fumee` smoke particles at the current position,
    // tracking the previous position for velocity deltas.
    //
    // DefineSprite_10/frame_1/DoAction.as: _rotation = random(360)
    // PlaceObject2_5_2/onClipEvent(enterFrame): _rotation += 75
    const spinnerSym: SymbolDefinition = {
      name: "_spinner",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_10/frame_1/DoAction.as
            // _rotation = random(360);
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS: DefineSprite_6_move/frame_1/PlaceObject2_5_2/onClipEvent(enterFrame)
        // _rotation = _rotation + 75;
        clip.rotation += (75 * Math.PI) / 180;
      },
    };

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
            // AS: DefineSprite_6_move/frame_1/DoAction.as
            // xi = this._x; yi = this._y; nf = 5; c = 0;
            // this.onEnterFrame = function() { spawn nf fumee particles per frame }
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
            clip.vars.nf = 5;
            clip.vars.c = 0;

            // Attach the spinning child that exists on the authored move timeline
            // (PlaceObject2_5_2 / DefineSprite_10).
            clip.attach(spinnerSym, "_spinnerChild", 2, ctx);

            clip.onEnterFrame = (c) => {
              // AS: DefineSprite_6_move/frame_1 inline onEnterFrame
              // while(_loc3_ < nf) { attachMovie("fumee","fumee"+c, c+5); ... }
              const nf = c.vars.nf as number;
              let count = c.vars.c as number;
              const xi = c.vars.xi as number;
              const yi = c.vars.yi as number;
              const parent = c.parent;
              if (!parent) {
                return;
              }
              for (let loc3 = 0; loc3 < nf; loc3++) {
                const instName = `fumee${count}`;
                const child = parent.attach(fumeeSym, instName, count + 5, ctx);
                child.x = c.x;
                child.y = c.y;
                child.vars.vx = c.x - xi + 6.67 * (Math.random() - 0.5);
                child.vars.vy = c.y - yi + 6.67 * (Math.random() - 0.5);
                count++;
              }
              c.vars.c = count;
              c.vars.xi = c.x;
              c.vars.yi = c.y;
            };
          },
        ],
      ]),
    };

    // ---- shoot — 75-frame impact puff container ------------------
    // AS: DefineSprite_3_shoot/frame_1/DoAction.as
    //     DefineSprite_3_shoot/frame_73/DoAction.as
    //
    // frame_1: _rotation = 0; spawn 7 fumee2 particles at shoot position.
    // frame_73: _parent.removeMovieClip() → runtime.complete()
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 75,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_3_shoot/frame_1/DoAction.as
            // _rotation = 0;
            // xi = this._x; yi = this._y; c = 0;
            // while(p < 7) { attachMovie("fumee2","fumee2"+c+200,c+200); set pos/vel; c++; p++ }
            clip.rotation = 0;
            const xi = clip.x;
            const yi = clip.y;
            let c = 0;
            const parent = clip.parent;
            if (!parent) {
              return;
            }
            let currentXi = xi;
            // yi is recorded but the AS loop body uses `this._x` and `this._y`
            // (which don't change during the loop — xi and yi stay the same).
            void yi;
            for (let p = 0; p < 7; p++) {
              const instName = `fumee2${c}200`;
              const f = parent.attach(fumee2Sym, instName, c + 200, ctx);
              f.x = clip.x;
              f.y = clip.y - 30;
              f.vars.vx = clip.x - currentXi + 5 * (Math.random() - 0.5);
              f.vars.vy = -7 * Math.random();
              c++;
              currentXi = clip.x;
            }
          },
        ],
        [
          72,
          (clip) => {
            // AS: DefineSprite_3_shoot/frame_73/DoAction.as
            // _parent.removeMovieClip();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(fumeeSym);
    this.registry.register(fumee2Sym);
    this.registry.register(spinnerSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // No SOMA.playSound found in main timeline AS for spell 2012.
    // The harness (displayType=30) handles attaching move and shoot.
  }
}
