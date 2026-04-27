/**
 * Spell 902 — Flèche Empoisonnée / Poison Arrow (Cra).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/902/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has `move` and `shoot`
 * container symbols, with `move` trailing smoke particles along the arc and
 * `shoot` spawning a burst of `fumee` smoke puffs at impact. The harness
 * drives the parabolic arc, attaches `shoot` at landing, and calls
 * `runtime.signalHit()` automatically — we must NOT call it again.
 *
 * Library symbols:
 *   - lib_fumee — 51-frame smoke puff. frame_1: randomise scale/rotation/
 *                 velocity, then onEnterFrame drifts with rapid deceleration.
 *                 frame_49: removeMovieClip(this).
 *
 * Container symbols (no frame textures):
 *   - move     — 1-frame container. PlaceObject2_4_1 (an inner clip) carries
 *                onClipEvent(load): seeds rotation amplitude `a`, scale from
 *                level. onClipEvent(enterFrame): oscillates rotation.
 *                frame_1/DoAction: sets up onEnterFrame on `move` itself that
 *                spawns `fumee` particles on the parent (root) each tick,
 *                tracking the projectile position.
 *   - shoot    — 1-frame container. PlaceObject2_6_1 (an inner clip) carries
 *                onClipEvent(load): seeds scale from level.
 *                DefineSprite_6 (the unnamed inner sprite inside shoot):
 *                frame_1/DoAction: spawns 7 `fumee` particles in a burst.
 *                frame_64/DoAction: _parent.removeMovieClip() → complete().
 *
 * Main timeline: no SOMA.playSound found in manifest scripts — no sound.
 *
 * NOTE on the inner clip structure:
 *   DefineSprite_7_shoot contains one authored child clip (PlaceObject2_6_1,
 *   which is DefineSprite_6 — the unnamed 64-frame burst container). We model
 *   this as a second SymbolDefinition (`shootInner`) that `shoot`'s frame_1
 *   attaches explicitly, mirroring the canonical PlaceObject2 placement.
 *
 *   Similarly DefineSprite_8_move contains one authored child (PlaceObject2_4_1)
 *   whose clip-events we model as `moveInner`.
 *
 *   DefineSprite_6 (the shootInner / frame_1 burst + frame_64 removal) also
 *   has its own authored child (PlaceObject2_4_2) with the rotation oscillator.
 *   We model that as `shootInnerParticle`.
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
  width: 28.7,
  height: 28.7,
  offsetX: -14.35,
  offsetY: -14.35,
};

export class Spell902 extends RuntimeSpell {
  readonly spellId = 902;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  // Stored so inner-symbol frame scripts can reference it via closure.
  private fumeeSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const fumeeAnchor = calculateAnchor(FUMEE_BOUNDS);

    // ---- lib_fumee — 51-frame smoke puff ------------------------
    // AS: DefineSprite_13_fumee/frame_1/DoAction.as
    //     DefineSprite_13_fumee/frame_49/DoAction.as
    //
    // Particles are attached by two different parents:
    //  a) `move`'s onEnterFrame spawns them on the ROOT (as trailing smoke).
    //  b) `shoot`'s inner clip (DefineSprite_6) spawns 7 of them as the burst.
    //
    // In both cases the spawning code sets `vx` / `vy` on the particle before
    // frame_1 runs (AS: eval("this.fumee"+c).vx = ...). We read those from
    // clip.vars in frame_1.
    this.fumeeSym = {
      name: "fumee",
      totalFrames: 51,
      frames: textures.getFrames("lib_fumee"),
      anchorX: fumeeAnchor.x,
      anchorY: fumeeAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_13_fumee/frame_1/DoAction.as
            const t = 50 * Math.random() + 50;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            // vx / vy were set by the spawning code before this frame fires.
            let vx = (clip.vars.vx as number) ?? 0;
            let vy = (clip.vars.vy as number) ?? 0;
            vx = vx / (1 + 3 * Math.random());
            vy = vy / 3;
            clip.vars.vx = vx;
            clip.vars.vy = vy;
            clip.onEnterFrame = (self) => {
              // AS: DefineSprite_13_fumee/frame_1/DoAction.as (onEnterFrame fn)
              const cvx = self.vars.vx as number;
              const cvy = self.vars.vy as number;
              self.x += cvx;
              self.y += cvy;
              self.vars.vx = cvx / 3;
              self.vars.vy = cvy / 3;
            };
          },
        ],
        [
          48,
          (clip) => {
            // AS: DefineSprite_13_fumee/frame_49/DoAction.as
            clip.remove();
          },
        ],
      ]),
    };

    // ---- shootInnerParticle — the rotation-oscillator child of DefineSprite_6
    // AS: DefineSprite_6/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_6/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // This is an authored child clip placed inside the shoot-burst container.
    // It has no visual content itself — it's the standard "wobble indicator"
    // sprite that just oscillates its own rotation.
    const shootInnerParticleSym: SymbolDefinition = {
      name: "shootInnerParticle",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: DefineSprite_6/frame_1/PlaceObject2_4_2/onClipEvent(load)
        clip.vars.a = 15;
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_6/frame_1/PlaceObject2_4_2/onClipEvent(enterFrame)
        //   _rotation = 90 + a * Math.cos(i += 3.1415);
        //   a /= 1.1;
        let a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += 3.1415;
        clip.rotation = ((90 + a * Math.cos(i)) * Math.PI) / 180;
        a /= 1.1;
        clip.vars.a = a;
        clip.vars.i = i;
      },
    };

    // ---- shootInner — DefineSprite_6, the 64-frame burst inside `shoot`
    // AS: DefineSprite_6/frame_1/DoAction.as  → spawns 7 fumee particles
    //     DefineSprite_6/frame_64/DoAction.as → _parent.removeMovieClip()
    //
    // Uses a shared counter `c` across the 7 iterations (as in canonical AS).
    // The rotation-oscillator child (PlaceObject2_4_2) is placed on frame_1
    // as an authored timeline child — we attach it explicitly in frame_1 here.
    const shootInnerSym: SymbolDefinition = {
      name: "shootInner",
      totalFrames: 64,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_6/frame_1/DoAction.as
            // Attach the rotation-oscillator authored child.
            clip.attach(shootInnerParticleSym, "rotOscillator", 2, ctx);

            // p = 0; while(p < 7) { attachMovie("fumee","fumee"+c,c); ... c++; p++; }
            // `c` is a variable on the clip (carried over from wherever it was
            // set — in canonical AS the outer script initialised c=0 before
            // the loop). We initialise it here on first entry.
            if (clip.vars.c === undefined) {
              clip.vars.c = 0;
            }
            let c = clip.vars.c as number;
            for (let p = 0; p < 7; p++) {
              const vx = 180 * (Math.random() - 0.5);
              const vy = 180 * (Math.random() - 0.5);
              const child = clip.attach(this.fumeeSym, `fumee${c}`, c, ctx);
              child.vars.vx = vx;
              child.vars.vy = vy;
              c++;
            }
            clip.vars.c = c;
          },
        ],
        [
          63,
          (clip) => {
            // AS: DefineSprite_6/frame_64/DoAction.as
            // _parent.removeMovieClip() — `clip` is shootInner; its parent is
            // `shoot`; shoot's parent is the root mc. We remove shoot and
            // signal completion.
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- shoot — 1-frame container (projectile landing / impact) --------
    // AS: DefineSprite_7_shoot/frame_1/PlaceObject2_6_1/onClipEvent(load)
    //   t = 50 + 20 * _parent._parent.level;
    //   _xscale = t; _yscale = t;
    //
    // PlaceObject2_6_1 is DefineSprite_6 (shootInner) placed as an authored
    // timeline child. We attach it in shoot's frame_1 script.
    // The load handler on PlaceObject2_6_1 scales the inner clip by level.
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_7_shoot/frame_1 — attach the authored inner
            // burst clip (PlaceObject2_6_1 == DefineSprite_6 == shootInner).
            const inner = clip.attach(shootInnerSym, "inner", 1, ctx);

            // AS: PlaceObject2_6_1/onClipEvent(load)
            //   t = 50 + 20 * _parent._parent.level;
            //   _xscale = t; _yscale = t;
            // inner's _parent is shoot; shoot's _parent is root.
            const root = clip.parent;
            const level = (root?.vars.level as number) ?? 1;
            const t = 50 + 20 * level;
            inner.scaleX = t / 100;
            inner.scaleY = t / 100;
          },
        ],
      ]),
    };

    // ---- moveInner — the authored rotation-oscillator child in `move`
    // AS: DefineSprite_8_move/frame_1/PlaceObject2_4_1/onClipEvent(load)
    //   a = 20;
    //   t = 10 + 3 * _parent._parent.level;
    //   _xscale = t; _yscale = t;
    // AS: DefineSprite_8_move/frame_1/PlaceObject2_4_1/onClipEvent(enterFrame)
    //   _rotation = 90 + a * Math.cos(i += 1);
    //   a /= 1.3;
    const moveInnerSym: SymbolDefinition = {
      name: "moveInner",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: DefineSprite_8_move/frame_1/PlaceObject2_4_1/onClipEvent(load)
        clip.vars.a = 20;
        clip.vars.i = 0;
        // _parent._parent.level: moveInner's _parent is `move`; move's
        // _parent is root.
        const root = clip.parent?.parent;
        const level = (root?.vars.level as number) ?? 1;
        const t = 10 + 3 * level;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_8_move/frame_1/PlaceObject2_4_1/onClipEvent(enterFrame)
        let a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += 1;
        clip.rotation = ((90 + a * Math.cos(i)) * Math.PI) / 180;
        a /= 1.3;
        clip.vars.a = a;
        clip.vars.i = i;
      },
    };

    // ---- move — 1-frame projectile container (drives the arc) ----------
    // AS: DefineSprite_8_move/frame_1/DoAction.as
    //   xi = this._x; yi = this._y; nf = 1; c = 0;
    //   this.onEnterFrame = function() {
    //     // each tick: attach 1 fumee on _parent at current position ± 15px
    //     this._parent.attachMovie("fumee","fumee"+c, c+10);
    //     _loc3_._x = this._x + 15*(Math.random()-0.5);
    //     _loc3_._y = this._y + 15*(Math.random()-0.5);
    //     c++;
    //   }
    //
    // The inner authored child (PlaceObject2_4_1 == moveInner) is attached
    // in frame_1.
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
            // AS: DefineSprite_8_move/frame_1/DoAction.as
            // Attach the authored wobble child.
            clip.attach(moveInnerSym, "wobble", 1, ctx);

            // c is local to the move instance.
            clip.vars.c = 0;
            // Set up per-tick trailing smoke on the root.
            clip.onEnterFrame = (self) => {
              // AS: DefineSprite_8_move/frame_1/DoAction.as (inner onEnterFrame)
              const parent = self.parent;
              if (!parent) {
                return;
              }
              let c = self.vars.c as number;
              const px = self.x + 15 * (Math.random() - 0.5);
              const py = self.y + 15 * (Math.random() - 0.5);
              const trail = parent.attach(
                this.fumeeSym,
                `fumee${c}`,
                c + 10,
                ctx,
              );
              trail.x = px;
              trail.y = py;
              // vx / vy for trailing smoke — not set by spawn site in
              // canonical AS (no explicit assignment before attachMovie
              // for the trail), so they default to 0 → particle stays
              // near spawn, quickly decelerates per fumee's onEnterFrame.
              trail.vars.vx = 0;
              trail.vars.vy = 0;
              c++;
              self.vars.c = c;
            };
          },
        ],
      ]),
    };

    this.registry.register(this.fumeeSym);
    this.registry.register(shootInnerParticleSym);
    this.registry.register(shootInnerSym);
    this.registry.register(shootSym);
    this.registry.register(moveInnerSym);
    this.registry.register(moveSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // Main timeline: no SOMA.playSound found in the manifest scripts.
    // No explicit child attaches needed — harness handles move/shoot for
    // displayType=30.
  }
}
