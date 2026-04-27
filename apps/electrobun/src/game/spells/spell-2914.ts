/**
 * Spell 2914 — Fireworks (Sacrieur / festive spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2914/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single `shoot` animation
 * anchored at the target cell. There is no `move` symbol, no caster-side
 * parallel timeline, and no dual-anchor world-absolute logic — the entire
 * visual is a 291-frame composite `shoot` sprite playing at the target,
 * containing internally spawned particles (plumes, plumes2, feux). This
 * maps cleanly to TargetCell.
 *
 * Canonical AS layout:
 *
 *   main timeline:
 *     frame_259: removeMovieClip(this) — outer mc removal (spell complete).
 *
 *   DefineSprite_3_shoot (291-frame composite, registered as "shoot"):
 *     frame_1/DoAction.as:    _rotation = 0  (resets any harness-applied rotation)
 *     frame_1/PlaceObject2_2_1 onClipEvent(load): seed t=70 for inner sprite scale
 *     frame_289/DoAction.as:  _parent.removeMovieClip(); stop()
 *       → The shoot inner sprite also removes its parent (the outer mc).
 *       → We treat frame 289 (0-based: 288) as the completion frame.
 *
 *   DefineSprite_21 (inner sprite inside shoot — not directly registered,
 *   but its behaviour is embedded in the shoot timeline via authored frames):
 *     frame_16:  gotoAndPlay(1)   — loop
 *     frame_58:  SOMA.playSound("explo_fireworks")
 *     frame_64:  spawn 19 `feux` particles + 9 `plumes2` particles
 *     frame_85:  stop()
 *
 *   DefineSprite_22 (firework rocket sub-sprite, 3 instances at depths 1,6,11
 *   in the shoot frame_1 authored placement):
 *     frame_1/DoAction.as: stop()
 *     onClipEvent(load): vx=0, g=0.67, v=3.34, t=0
 *     onClipEvent(enterFrame): countdown t to 150, then gotoAndPlay("exp");
 *       on frame 3 spawn plumes, apply gravity/motion.
 *
 *   DefineSprite_18 (random-rotation spark inside DefineSprite_22):
 *     frame_1/DoAction.as: random rotation + scale 60-100%
 *
 *   DefineSprite_12 (inner content of plumes/plumes2, gotoAndStop random 2-4):
 *     frame_1/DoAction.as: gotoAndStop(random(3) + 2)  (0-based: random 1-3)
 *
 *   lib_feux — single-frame spark particle with full physics (innerClip).
 *     onLoad: seed rotation, vg, g, va, t, dmax, _X, d, acc, vacc
 *     onEnterFrame: random rotation+scale each frame; gravity; alpha decay;
 *                   approach d; remove when alpha < 0.
 *
 *   lib_plumes2 — single-frame feather particle.
 *     onLoad: seed t, duree, vy, vx, vch, vr, amp, a=1.15, time=0
 *     onEnterFrame: fade after duree; oscillate + drift upward while _Y < 0
 *
 *   lib_plumes — same clip-event code as plumes2 (identical onLoad/onEnterFrame),
 *     different texture/bounds.
 *
 * Notes on complexity:
 *   - DefineSprite_21, DefineSprite_22, DefineSprite_18, DefineSprite_12 are
 *     "anonymous" sub-sprites that live inside the authored shoot SWF frames.
 *     They are NOT directly attachMovie'd by name from the main AS scripts we
 *     can intercept. Their behaviour is encoded in the 291-frame shoot composite
 *     asset that the texture provider renders. We therefore treat shoot as a
 *     single flat animated sprite (all 291 authored composite frames) and only
 *     register the three explicitly attachMovie'd library symbols (feux, plumes2,
 *     plumes) that the outer scripts spawn at runtime.
 *   - The `eval("_parent.plumes2" + i).plume._x = _X` pattern sets a position
 *     on a child named "plume" inside each plumes2 instance. In the runtime
 *     this translates to positioning the plumes2 clip itself (since our symbol
 *     is a flat single-frame sprite, not a nested "plume" child). We use the
 *     clip's own x/y to approximate the canonical behaviour.
 *   - signalHit is fired at frame 64 (0-based: 63) of the shoot symbol, which
 *     is when the canonical DefineSprite_21/frame_64 spawns the feux explosion
 *     particles — this is the canonical "impact moment" of the firework burst.
 *   - complete() is fired at frame 288 (0-based) which mirrors the canonical
 *     DefineSprite_3_shoot/frame_289: `_parent.removeMovieClip(); stop();`
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

// --- Bounds from manifest.json librarySymbols[] entries ---

const FEUX_BOUNDS = {
  width: 9,
  height: 9,
  offsetX: -4.55,
  offsetY: -4.4,
};

const PLUMES2_BOUNDS = {
  width: 10.3,
  height: 12.15,
  offsetX: -5.1,
  offsetY: 19.65,
};

const PLUMES_BOUNDS = {
  width: 10.3,
  height: 12.15,
  offsetX: -8.1,
  offsetY: -50.35,
};

// --- Bounds from manifest.json animations[] entry for shoot ---

const SHOOT_BOUNDS = {
  width: 92.9,
  height: 92.9,
  offsetX: -43.5,
  offsetY: -74.2,
};

export class Spell2914 extends RuntimeSpell {
  readonly spellId = 2914;
  readonly displayType = SpellDisplayType.TargetCell;

  // Keep symbol refs for cross-symbol attachment from frameScripts
  private plumesSym!: SymbolDefinition;
  private plumes2Sym!: SymbolDefinition;
  private feuxSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const feuxAnchor = calculateAnchor(FEUX_BOUNDS);
    const plumes2Anchor = calculateAnchor(PLUMES2_BOUNDS);
    const plumesAnchor = calculateAnchor(PLUMES_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ----------------------------------------------------------------
    // lib_feux — spark/firework particle
    // AS: DefineSprite_13_feux/frame_1/PlaceObject2_12_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    // ----------------------------------------------------------------
    this.feuxSym = {
      name: "feux",
      totalFrames: 1,
      frames: textures.getFrames("lib_feux"),
      anchorX: feuxAnchor.x,
      anchorY: feuxAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_13_feux/frame_1/PlaceObject2_12_1/onClipEvent(load):
        //   _parent._rotation = random(360);
        //   vg = -6 * Math.random();
        //   g = 1 * Math.random();
        //   va = 0;
        //   t = 100 + random(100);
        //   _xscale = t; _yscale = t;
        //   dmax = 100;
        //   _X = 10 + random(20);
        //   d = dmax - random(70);
        //   acc = 3.34 + Math.random() * 5;
        //   vacc = 1 + 1 * Math.random();
        //
        // Note: `_parent._rotation` sets the parent clip's rotation.
        // In our model the parent is the feux clip itself (the outer
        // mc of the PlaceObject2 chain). We apply it to clip directly.
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        clip.vars.vg = -6 * Math.random();
        clip.vars.g = 1 * Math.random();
        clip.vars.va = 0;
        const t = 100 + Math.floor(Math.random() * 100);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.dmax = 100;
        clip.x = 10 + Math.floor(Math.random() * 20);
        clip.vars.d = 100 - Math.floor(Math.random() * 70);
        clip.vars.acc = 3.34 + Math.random() * 5;
        clip.vars.vacc = 1 + 1 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_13_feux/frame_1/PlaceObject2_12_1/onClipEvent(enterFrame):
        //   _rotation = random(360);
        //   t = 20 + random(80);
        //   _xscale = t; _yscale = t;
        //   _parent._y += g;
        //   _alpha = 150 - (va += vacc);
        //   _X = _X - (_X - d) / acc;
        //   if(_alpha < 0) { _parent.removeMovieClip(); }
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        const tScale = 20 + Math.floor(Math.random() * 80);
        clip.scaleX = tScale / 100;
        clip.scaleY = tScale / 100;

        const g = clip.vars.g as number;
        const acc = clip.vars.acc as number;
        const d = clip.vars.d as number;
        const vacc = clip.vars.vacc as number;
        let va = clip.vars.va as number;

        // _parent._y += g  (parent y drift)
        if (clip.parent) {
          clip.parent.y += g;
        }

        va += vacc;
        clip.vars.va = va;
        const alpha = (150 - va) / 100;
        clip.alpha = Math.max(0, alpha);

        clip.x = clip.x - (clip.x - d) / acc;

        if (alpha < 0) {
          clip.remove();
        }
      },
    };

    // ----------------------------------------------------------------
    // lib_plumes2 — feather particle (spawned at target area)
    // AS: DefineSprite_7_plumes2/frame_1/PlaceObject2_6_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    // ----------------------------------------------------------------
    this.plumes2Sym = {
      name: "plumes2",
      totalFrames: 1,
      frames: textures.getFrames("lib_plumes2"),
      anchorX: plumes2Anchor.x,
      anchorY: plumes2Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_7_plumes2/frame_1/PlaceObject2_6_1/onClipEvent(load):
        //   t = 30 + random(30);
        //   _xscale = t; _yscale = t;
        //   duree = 60 + random(30);
        //   vy = 2 + 2 * Math.random();
        //   vx = -10 + 20 * Math.random();
        //   vch = 0.1 + 0.1 * Math.random();
        //   vr = 0.03 + 0.1 * Math.random();
        //   amp = 30 + random(50);
        //   a = 1.15;
        //   time = 0;
        const t = 30 + Math.floor(Math.random() * 30);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.duree = 60 + Math.floor(Math.random() * 30);
        clip.vars.vy = 2 + 2 * Math.random();
        clip.vars.vx = -10 + 20 * Math.random();
        clip.vars.vch = 0.1 + 0.1 * Math.random();
        clip.vars.vr = 0.03 + 0.1 * Math.random();
        clip.vars.amp = 30 + Math.floor(Math.random() * 50);
        clip.vars.a = 1.15;
        clip.vars.time = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_7_plumes2/frame_1/PlaceObject2_6_1/onClipEvent(enterFrame):
        //   if(time++ > duree) { _alpha = _alpha - 6.34; }
        //   if(_Y < 0) {
        //     _Y = _Y + (vy += vch);
        //     _X = _X + vx;
        //     vy *= 0.9; vx *= 0.9; amp *= 0.98;
        //     _rotation = amp * Math.sin(a += vr);
        //   }
        let time = clip.vars.time as number;
        const duree = clip.vars.duree as number;
        if (time++ > duree) {
          clip.alpha = Math.max(0, clip.alpha - 6.34 / 100);
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
          clip.rotation = (amp * Math.sin(a) * Math.PI) / 180;

          clip.vars.vy = vy;
          clip.vars.vx = vx;
          clip.vars.amp = amp;
          clip.vars.a = a;
        }
      },
    };

    // ----------------------------------------------------------------
    // lib_plumes — feather particle (spawned by firework rocket sub-sprites)
    // AS: DefineSprite_8_plumes/frame_1/PlaceObject2_6_1/
    //     CLIPACTIONRECORD onClipEvent(load).as   (identical to plumes2)
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as  (identical to plumes2)
    // ----------------------------------------------------------------
    this.plumesSym = {
      name: "plumes",
      totalFrames: 1,
      frames: textures.getFrames("lib_plumes"),
      anchorX: plumesAnchor.x,
      anchorY: plumesAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_8_plumes/frame_1/PlaceObject2_6_1/onClipEvent(load):
        //   (identical structure to plumes2 onLoad)
        const t = 30 + Math.floor(Math.random() * 30);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.duree = 60 + Math.floor(Math.random() * 30);
        clip.vars.vy = 2 + 2 * Math.random();
        clip.vars.vx = -10 + 20 * Math.random();
        clip.vars.vch = 0.1 + 0.1 * Math.random();
        clip.vars.vr = 0.03 + 0.1 * Math.random();
        clip.vars.amp = 30 + Math.floor(Math.random() * 50);
        clip.vars.a = 1.15;
        clip.vars.time = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_8_plumes/frame_1/PlaceObject2_6_1/onClipEvent(enterFrame):
        //   (identical structure to plumes2 onEnterFrame)
        let time = clip.vars.time as number;
        const duree = clip.vars.duree as number;
        if (time++ > duree) {
          clip.alpha = Math.max(0, clip.alpha - 6.34 / 100);
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
          clip.rotation = (amp * Math.sin(a) * Math.PI) / 180;

          clip.vars.vy = vy;
          clip.vars.vx = vx;
          clip.vars.amp = amp;
          clip.vars.a = a;
        }
      },
    };

    // ----------------------------------------------------------------
    // shoot — 291-frame composite animated sprite at target cell.
    // AS: DefineSprite_3_shoot
    //   frame_1/DoAction.as:   _rotation = 0
    //   frame_289/DoAction.as: _parent.removeMovieClip(); stop();
    //
    // Key frame events embedded in the authored composite frames:
    //   frame_64 (0-based: 63): explosion burst → signalHit
    //   frame_289 (0-based: 288): _parent.removeMovieClip → complete()
    //
    // The inner DefineSprite_21 (frame 64 in AS) spawns feux and plumes2
    // particles. We reproduce those spawns from our frameScripts at frame
    // 63 (0-based), using the shoot clip's own position as the spawn origin.
    //
    // The PlaceObject2_2_1 onClipEvent(load) seeds t=70, _xscale=_yscale=70
    // for an inner sub-sprite. We apply this scale to the shoot clip itself
    // since we treat it as a flat sprite (the sub-sprite is baked into frames).
    // ----------------------------------------------------------------
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 291,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_3_shoot/frame_1/PlaceObject2_2_1/onClipEvent(load):
        //   t = 70; _xscale = t; _yscale = t;
        // Applied to the shoot clip representing the inner sub-sprite scale.
        clip.scaleX = 70 / 100;
        clip.scaleY = 70 / 100;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_3_shoot/frame_1/DoAction.as:
            //   _rotation = 0;
            clip.rotation = 0;
          },
        ],
        [
          63,
          (clip, ctx) => {
            // AS DefineSprite_21/frame_64/DoAction.as:
            //   i = 1; while(i < 20) { attachMovie("feux","feux"+i,i); i++; }
            //   i = 1; while(i < 10) {
            //     _parent.attachMovie("plumes2","plumes2"+i,i);
            //     eval("_parent.plumes2"+i).plume._x = _X;
            //     eval("_parent.plumes2"+i).plume._y = _Y;
            //     i++;
            //   }
            //
            // Spawn 19 feux particles on the shoot clip (as the inner mc).
            for (let i = 1; i < 20; i++) {
              clip.attach(this.feuxSym, `feux${i}`, i, ctx);
            }
            // Spawn 9 plumes2 particles on the parent (root/target cell clip).
            // Canonical: _parent.attachMovie("plumes2",...) then set
            // plume._x = _X, plume._y = _Y (position of this inner sprite).
            // We position each plumes2 at the shoot clip's local position.
            if (clip.parent) {
              for (let i = 1; i < 10; i++) {
                const p2 = clip.parent.attach(
                  this.plumes2Sym,
                  `plumes2${i}`,
                  i,
                  ctx,
                );
                p2.x = clip.x;
                p2.y = clip.y;
              }
            }
            // Signal hit at the explosion burst frame.
            this.runtime.signalHit();
          },
        ],
        [
          288,
          (clip) => {
            // AS DefineSprite_3_shoot/frame_289/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.feuxSym);
    this.registry.register(this.plumes2Sym);
    this.registry.register(this.plumesSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS DefineSprite_21/frame_58/DoAction.as: SOMA.playSound("explo_fireworks")
    // The sound is authored at frame 58 of the inner DefineSprite_21 which
    // lives inside the shoot composite. Since it is baked into the shoot
    // authored timeline and not separately accessible, we play it here as
    // the canonical intro sound for this spell. The manifest also records
    // this sound at frame 57 (0-indexed) of the main timeline.
    callbacks.playSound("explo_fireworks");

    // Attach the shoot symbol at root — the harness for TargetCell does
    // not auto-attach shoot (that's only for ProjectileBallistic/Linear).
    // The shoot composite is the entire spell visual.
    const shootSym = this.registry.resolve("shoot");
    if (shootSym) {
      this.root.attach(shootSym, "shoot", 1, context);
    }
  }
}
