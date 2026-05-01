/**
 * Spell 208 — Flèche de Givre (Cra ice arrow / earth arrow).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/208/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The harness attaches `move` at
 * caster, drives a parabolic arc to target, then attaches `shoot` at
 * impact. Evidence:
 *   - DefineSprite_15_move/frame_1/DoAction.as accesses `this._x`,
 *     `this._y`, and `this._parent.level` — the canonical projectile-
 *     in-flight pattern.
 *   - DefineSprite_26_shoot/frame_1/DoAction.as does `_rotation =
 *     -_parent.angle` and DefineSprite_26_shoot/frame_97/DoAction.as
 *     does `_parent.removeMovieClip()` — canonical 97-frame burn at
 *     target after landing.
 *   - move spawns `fumee` smoke trail particles during flight.
 *
 * Library symbols:
 *   - fumee      — 36-frame smoke puff spawned along the flight path.
 *                  frame_1 randomises rotation; frame_8 skips forward
 *                  randomly; frame_36 removes self.
 *   - plumes     — 1-frame feather particle. onLoad seeds velocity/
 *                  scale/rotation physics. onEnterFrame drives Y drift
 *                  + rotation oscillation + alpha fade.
 *   - pierres    — 1-frame stone chip particle. onLoad seeds velocity,
 *                  angle-based acceleration, scale. onEnterFrame drives
 *                  position + rotation + deceleration + fade + removal.
 *   - sprite25   — 20-frame impact composite (directlyDynamic: true).
 *                  Placed inside shoot at depth 1. onLoad (PlaceObject2)
 *                  sets scale to 60%. frame_20 stops. Also hosts the
 *                  "plumes" spawning logic (frame_1 attaches 10 plumes)
 *                  and the pierres spawning loop (onEnterFrame on its
 *                  inner PlaceObject2_23_2).
 *   - move       — container. frame_1 onEnterFrame spawns fumee trail.
 *                  PlaceObject2_14_8 onEnterFrame oscillates yscale.
 *   - shoot      — container, 97 frames. frame_1 sets rotation to
 *                  -_parent.angle and attaches sprite25 at depth 1.
 *                  frame_97 removes outer mc → complete().
 *
 * Main timeline: SOMA.playSound("flèche") — exact sound key unknown
 * from scripts; no explicit playSound found in provided AS, so
 * onSpellStart is minimal.
 *
 * Harness drives signalHit automatically at ballistic landing
 * (displayType=30). Do NOT call signalHit manually.
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

// ---- Manifest bounds for calculateAnchor ----
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
const SPRITE25_BOUNDS = {
  width: 103.9,
  height: 103.9,
  offsetX: -54.05,
  offsetY: -95.35,
};

export class Spell208 extends RuntimeSpell {
  readonly spellId = 208;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  // Symbols are stored as fields so onSpellStart and frameScripts can
  // reference them before registerSymbols completes — safe because all
  // accesses happen in callbacks (post-init).
  private fumeeSym!: SymbolDefinition;
  private plumesSym!: SymbolDefinition;
  private pierresSym!: SymbolDefinition;
  private sprite25Sym!: SymbolDefinition;
  private moveSym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const fumeeAnchor = calculateAnchor(FUMEE_BOUNDS);
    const plumesAnchor = calculateAnchor(PLUMES_BOUNDS);
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const sprite25Anchor = calculateAnchor(SPRITE25_BOUNDS);

    // ----------------------------------------------------------------
    // lib_fumee — 36-frame smoke puff spawned along flight path
    // ----------------------------------------------------------------
    // AS: DefineSprite_22_fumee/frame_1/DoAction.as
    //   _rotation = random(360);
    // AS: DefineSprite_22_fumee/frame_8/DoAction.as
    //   gotoAndPlay(_currentframe + random(7));
    // AS: DefineSprite_22_fumee/frame_36/DoAction.as
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
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
        [
          7,
          (clip) => {
            // AS DefineSprite_22_fumee/frame_8/DoAction.as
            // gotoAndPlay(_currentframe + random(7))
            // currentFrame here is 7 (0-based), AS sees frame 8.
            // Jump forward 0-6 frames from current position.
            const jump = Math.floor(Math.random() * 7);
            clip.gotoAndPlay(clip.currentFrame + jump);
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

    // ----------------------------------------------------------------
    // lib_plumes — 1-frame feather particle
    // ----------------------------------------------------------------
    // AS: DefineSprite_18_plumes/frame_1/PlaceObject2_17_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //     onClipEvent(enterFrame).as
    this.plumesSym = {
      name: "plumes",
      totalFrames: 1,
      frames: textures.getFrames("lib_plumes"),
      anchorX: plumesAnchor.x,
      anchorY: plumesAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_18_plumes/frame_1/PlaceObject2_17_1/onClipEvent(load)
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
        // AS DefineSprite_18_plumes/frame_1/PlaceObject2_17_1/onClipEvent(enterFrame)
        const duree = clip.vars.duree as number;
        let time = clip.vars.time as number;
        let vy = clip.vars.vy as number;
        let vx = clip.vars.vx as number;
        let vch = clip.vars.vch as number;
        let amp = clip.vars.amp as number;
        let a = clip.vars.a as number;
        const vr = clip.vars.vr as number;

        time++;
        clip.vars.time = time;

        if (time > duree) {
          clip.alpha = clip.alpha - 10 / 100;
        }

        if (clip.y < 0) {
          vy += vch;
          clip.y = clip.y + vy;
          clip.x = clip.x + vx;
          vy *= 0.9;
          vx *= 0.9;
          amp *= 0.98;
          a += vr;
          // AS rotation in degrees
          clip.rotation = (amp * Math.cos(a) * Math.PI) / 180;

          clip.vars.vy = vy;
          clip.vars.vx = vx;
          clip.vars.amp = amp;
          clip.vars.a = a;
        }
      },
    };

    // ----------------------------------------------------------------
    // lib_pierres — 1-frame stone chip particle
    // ----------------------------------------------------------------
    // AS: DefineSprite_6_pierres/frame_1/PlaceObject2_5_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // Note: "pierres" is placed via PlaceObject2 on a PARENT container.
    // The parent container is what moves (_parent._x, _parent._y).
    // The "pierres" clip itself handles rotation + self-relative _X/_Y.
    // We collapse the _parent._x/_y scatter into the onLoad (seeded on
    // the container) and apply it to the clip's parent via clip.parent.
    // The _parent._parent._parent._parent._parent.angle traversal is:
    //   pierres (clip) → parent container (pierresContainer) →
    //   sprite25 → shoot → root
    // which collapses to: clip.parent?.parent?.parent?.parent
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_6_pierres/frame_1/PlaceObject2_5_1/onClipEvent(load)
        const vd = 30 + Math.floor(Math.random() * 30);
        clip.vars.vd = vd;
        clip.gotoAndPlay(Math.floor(Math.random() * 4)); // gotoAndPlay(random(4)+1) → 0-based: random(4)
        clip.vars.vx = 15 * (Math.random() - 0.5);
        clip.vars.vy = 15 * (Math.random() - 0.5);

        // _parent._parent._parent._parent._parent.angle
        // pierres → pierresContainer → sprite25 → shoot → root
        const rootClip =
          clip.parent?.parent?.parent?.parent ?? null;
        const angleDeg = (rootClip?.vars.angle as number) ?? 0;
        const an = (angleDeg * Math.PI) / 180 + Math.PI;
        clip.vars.an = an;
        clip.vars.v2x = Math.cos(an) * 2;
        clip.vars.v2y = Math.sin(an) * 5;

        // Scatter the PARENT container
        if (clip.parent) {
          clip.parent.x = 20 * (Math.random() - 0.5);
          clip.parent.y = 10 * (Math.random() - 0.5);
        }

        const t = 60 + 40 * Math.random();
        clip.vars.t = t;
        clip.vars.v = -10;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.vr = 60 * (-0.5 + Math.random());
        clip.vars.tps = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_6_pierres/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame)
        if (clip.alpha < 10 / 100) {
          // removeMovieClip(_parent) — remove the container
          if (clip.parent) {
            clip.parent.remove();
          }
          return;
        }

        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const vr = clip.vars.vr as number;
        const vd = clip.vars.vd as number;
        let v2x = clip.vars.v2x as number;
        let v2y = clip.vars.v2y as number;
        let v = clip.vars.v as number;
        let tps = clip.vars.tps as number;

        if (clip.parent) {
          clip.parent.x += vx;
          clip.parent.y += vy;
        }
        // AS rotation in degrees
        clip.rotation += (vr * Math.PI) / 180;

        // AS: tps++ evaluates THEN increments — two separate ++ calls
        // in AS means tps is incremented twice per frame. First
        // comparison uses current tps, second uses tps+1.
        if (tps < vd) {
          vx /= 1.2;
          vy /= 1.2;
          v /= 1.2;
        }
        tps++;
        if (tps > vd) {
          v2y *= 1.2;
          v2x *= 1.2;
          clip.y += v2y;
          clip.x += v2x;
          clip.alpha -= 10 / 100;
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

    // ----------------------------------------------------------------
    // sprite25 — 20-frame impact composite (directlyDynamic: true)
    // ----------------------------------------------------------------
    // Placed inside shoot at depth 1, frame 0, with scale ~0.98 and
    // near-zero offset (per manifest placements[]).
    //
    // AS: DefineSprite_25/frame_1/DoAction.as
    //   Spawns 10 plumes particles.
    // AS: DefineSprite_25/frame_1/PlaceObject2_23_2/
    //   onClipEvent(enterFrame) — the "PlaceObject2_23_2" is a sub-clip
    //   placed on sprite25's timeline. Its enterFrame continuously
    //   spawns pierres pairs. We implement this as sprite25's own
    //   onEnterFrame since we can't nest a PlaceObject2 sub-clip here.
    // AS: DefineSprite_25/frame_20/DoAction.as → stop()
    // AS: DefineSprite_26_shoot/frame_1/PlaceObject2_25_1/
    //   onClipEvent(load): t=60; _xscale=t; _yscale=t
    this.sprite25Sym = {
      name: "sprite25",
      totalFrames: 20,
      frames: textures.getFrames("lib_sprite25"),
      anchorX: sprite25Anchor.x,
      anchorY: sprite25Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_26_shoot/frame_1/PlaceObject2_25_1/onClipEvent(load)
        // t = 60; _xscale = t; _yscale = t
        clip.scaleX = 60 / 100;
        clip.scaleY = 60 / 100;
        // Init the pierres spawn counter (for the PlaceObject2_23_2
        // onEnterFrame which we drive from sprite25's own onEnterFrame)
        clip.vars.pierresC = 0;
      },
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_25/frame_1/PlaceObject2_23_2/onClipEvent(enterFrame)
        // if (c < _parent._parent._parent.level * 3) {
        //   c += 1; attachMovie("pierres", "pierres" + c, c);
        //   c += 1; attachMovie("pierres", "pierres" + c, c);
        // }
        // _parent._parent._parent — PlaceObject2_23_2 clip → sprite25 → shoot → root
        // We are already on sprite25, so root = clip.parent?.parent
        const root = clip.parent?.parent ?? null;
        const level = (root?.vars.level as number) ?? 1;
        let c = clip.vars.pierresC as number;

        if (c < level * 3) {
          c += 1;
          // Each "pierres" clip needs a wrapper container so that the
          // onLoad can set _parent._x/_y for scatter. We use a
          // synthetic approach: attach pierres directly and handle
          // parent-scatter inside onLoad using clip.parent.
          clip.attach(this.pierresSym, `pierres${c}`, c, ctx);
          c += 1;
          clip.attach(this.pierresSym, `pierres${c}`, c, ctx);
        }

        clip.vars.pierresC = c;
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_25/frame_1/DoAction.as
            // c = 0; p = 0; while(p < 10) { attachMovie("plumes",...) ... p++ }
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
          },
        ],
        [
          19,
          (clip) => {
            // AS DefineSprite_25/frame_20/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // move — container driving smoke trail during flight
    // ----------------------------------------------------------------
    // AS: DefineSprite_15_move/frame_1/DoAction.as
    //   xi = this._x; yi = this._y; nf = this._parent.level;
    //   this.onEnterFrame = function() {
    //     _parent.attachMovie("fumee", "fumee" + c, c + 10);
    //     _loc2_._x = this._x; _loc2_._y = this._y;
    //     _loc2_.vx = this._x - xi + 20*(Math.random()-0.5);
    //     _loc2_.vy = this._y - yi + 20*(Math.random()-0.5);
    //     c++; xi = this._x; yi = this._y;
    //   }
    // AS: DefineSprite_15_move/frame_1/PlaceObject2_14_8/
    //   onClipEvent(enterFrame): _yscale = 100*sin(i += sin(a += 0.02))
    //   (PlaceObject2_14_8 is a sub-clip placed on move's timeline;
    //    we model its oscillation via move's onEnterFrame since no
    //    separate symbol exists for PlaceObject2_14_8.)
    //
    // The harness drives move's position along the parabolic arc.
    // frame_1 script seeds the xi/yi/c vars and installs the per-frame
    // fumee spawning via clip.onEnterFrame. The yscale oscillation on
    // PlaceObject2_14_8 is applied to the move clip itself here since
    // there is no separate nested symbol to host it.
    this.moveSym = {
      name: "move",
      totalFrames: 2,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_15_move/frame_1/DoAction.as
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
            clip.vars.c = 0;
            // Oscillation state for PlaceObject2_14_8 onEnterFrame
            clip.vars.oscI = 0;
            clip.vars.oscA = 0;

            clip.onEnterFrame = (self, ctx) => {
              // Smoke trail — attach fumee to parent (outer mc = root)
              const parent = self.parent;
              if (parent) {
                const c = self.vars.c as number;
                const xi = self.vars.xi as number;
                const yi = self.vars.yi as number;
                const fumeeName = `fumee${c}`;
                const smokeClip = parent.attach(
                  this.fumeeSym,
                  fumeeName,
                  c + 10,
                  ctx
                );
                smokeClip.x = self.x;
                smokeClip.y = self.y;
                smokeClip.vars.vx =
                  self.x - xi + 20 * (Math.random() - 0.5);
                smokeClip.vars.vy =
                  self.y - yi + 20 * (Math.random() - 0.5);
                self.vars.xi = self.x;
                self.vars.yi = self.y;
                self.vars.c = c + 1;
              }

              // AS DefineSprite_15_move/frame_1/PlaceObject2_14_8/
              // onClipEvent(enterFrame):
              //   _yscale = 100 * Math.sin(i += Math.sin(a += 0.02))
              let oscA = self.vars.oscA as number;
              let oscI = self.vars.oscI as number;
              oscA += 0.02;
              oscI += Math.sin(oscA);
              self.scaleY = Math.sin(oscI);
              self.vars.oscA = oscA;
              self.vars.oscI = oscI;
            };
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // shoot — 97-frame container anchored at target after landing
    // ----------------------------------------------------------------
    // AS: DefineSprite_26_shoot/frame_1/DoAction.as
    //   _rotation = -_parent.angle
    //   (sprite25 is placed on shoot's timeline via PlaceObject2 at
    //    frame 1 / depth 1 — we attach it from frame_1 script)
    // AS: DefineSprite_26_shoot/frame_97/DoAction.as
    //   _parent.removeMovieClip(); stop();
    this.shootSym = {
      name: "shoot",
      totalFrames: 97,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_26_shoot/frame_1/DoAction.as
            // _rotation = -_parent.angle  (angle is in degrees on root.vars)
            const root = clip.parent;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            clip.rotation = ((-angleDeg) * Math.PI) / 180;

            // PlaceObject2_25_1 places sprite25 at depth 1 on shoot's
            // timeline at frame 0. Matrix from manifest placements[]:
            // scaleX=0.9817, scaleY=0.9817, translateX=0.05, translateY=-0.1
            const s25 = clip.attach(
              this.sprite25Sym,
              "sprite25_1",
              1,
              ctx,
              { x: 0.05, y: -0.1 }
            );
            s25.scaleX = 0.981719970703125;
            s25.scaleY = 0.981719970703125;
            // onLoad of sprite25Sym already ran (from attach), which
            // sets scale to 0.6. The PlaceObject2 matrix scale
            // overrides that. Re-apply:
            s25.scaleX = 0.6 * 0.981719970703125;
            s25.scaleY = 0.6 * 0.981719970703125;
          },
        ],
        [
          96,
          (clip) => {
            // AS DefineSprite_26_shoot/frame_97/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.fumeeSym);
    this.registry.register(this.plumesSym);
    this.registry.register(this.pierresSym);
    this.registry.register(this.sprite25Sym);
    this.registry.register(this.moveSym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // No explicit SOMA.playSound found in the provided AS scripts for
    // this spell's main timeline. The harness has already attached
    // `move` and will attach `shoot` on landing.
  }
}
