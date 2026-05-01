/**
 * Spell 906 — Flèche de Recul / Souffle de Feu (Cra air arrow).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 *
 * Canonical AS layout (`tools/combat-exporter/output/spell-anims/906/scripts/scripts/`):
 *
 *   Main timeline (frame_1/DoAction.as):
 *     SOMA.playSound("jet_903")
 *
 *   DefineSprite_3_shoot — 159-frame container (the full spell animation):
 *     frame_1 (PlaceObject2_2_1): a child sprite is placed with onClipEvent(load)
 *       that scales itself based on level: t = 50 + 20 * level; _xscale = _yscale = t
 *     frame_157: _parent.removeMovieClip() → spell complete
 *     (The shoot sprite IS the main content container — displayType=11 TargetCell
 *      because the whole animation plays at the target cell, no projectile arc or
 *      beam logic, just an impact animation.)
 *
 *   DefineSprite_2 (unnamed, child of shoot at depth 1):
 *     frame_1/DoAction.as: c = 5; sets up onEnterFrame that spawns fumee particles
 *       while c < 60, incrementing c each frame.
 *     frame_16/DoAction.as: stop()
 *
 *   DefineSprite_7_fumee — 36-frame smoke particle:
 *     frame_1/DoAction.as: seeds motion vars (a, t, _xscale, _yscale, _X, _Y, vx, vy,
 *       deceleration) reading rotate._rotation from grandparent. Sets onEnterFrame
 *       that integrates position with deceleration.
 *     frame_1/PlaceObject2_6_2/onClipEvent(load): seeds v, _rotation, _alpha.
 *     frame_1/PlaceObject2_6_2/onClipEvent(enterFrame): rotates + fades the child.
 *     frame_31/DoAction.as: removeMovieClip(this)
 *
 *   DefineSprite_22 — parallel timeline (139 frames):
 *     frame_7/DoAction.as: spawn 10 + level*3 cercle particles.
 *     frame_67/DoAction.as: this.end() → signalHit.
 *     frame_139/DoAction.as: _parent.removeMovieClip() → spell complete (redundant
 *       with shoot's frame_157, but canonical; we call complete() from shoot's
 *       frame_157 as the outer mc terminator).
 *
 *   DefineSprite_10_cercle — single-frame particle:
 *     onClipEvent(load): full ballistic physics seed.
 *     onClipEvent(enterFrame): rotation decay, X acceleration, scale ramp, removal.
 *
 *   DefineSprite_19, DefineSprite_18 — clipEvent sprites (smoke bolt visual):
 *     sprite19 is placed inside DefineSprite_22 at depth 1 frame 0, with a matrix.
 *     sprite18 is placed inside sprite19 at depth 1 frame 0, with a matrix.
 *     sprite18/frame_34/DoAction.as: stop()
 *     sprite18 has onClipEvent(load) on its child: _xscale = random(100)
 *     sprite19 has onClipEvent(load) on its child: a = 20 (unused in enterFrame visible)
 *
 * displayType=11 (TargetCell): the shoot container plays a full visual at the target
 * cell; no projectile arc, no beam. The harness places root at target.
 *
 * Library symbols:
 *   - lib_fumee  — 36-frame smoke puff particle. onLoad seeds v/rotation/alpha on
 *                  an inner child (PlaceObject2_6_2) AND the frame_1 DoAction seeds
 *                  motion vars. onEnterFrame rotates+fades. frame_31 removes self.
 *   - lib_cercle — 1-frame orange particle. onLoad seeds full ballistic physics.
 *                  onEnterFrame integrates physics, removes when t < 0.
 *   - lib_sprite18 — 36-frame bolt visual strip (directlyDynamic). onLoad seeds
 *                    _xscale = random(100). frame_34 stops.
 *   - lib_sprite19 — 1-frame wrapper (directlyDynamic). Attaches sprite18 at frame 0
 *                    with canonical matrix. onLoad: a = 20.
 *
 * shoot (container): 159 frames, frames: textures.getFrames("shoot").
 *   frame_0: scale child based on level; attach sprite22; set up DefineSprite_2 smoke loop.
 *   frame_156: _parent.removeMovieClip() → runtime.complete().
 *
 * sprite22 (container): 139 frames, no authored textures.
 *   frame_6: spawn cercle particles.
 *   frame_66: signalHit.
 *   frame_138: outer mc remove (complete already handled by shoot's frame_156).
 *
 * Main timeline: playSound("jet_903"); (no stop() call — but shoot drives completion).
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

// ---- Bounds from manifest.json librarySymbols[] ----

const FUMEE_BOUNDS = {
  width: 32.35,
  height: 33,
  offsetX: -14.35,
  offsetY: -18.65,
};

const CERCLE_BOUNDS = {
  width: 17.2,
  height: 17.1,
  offsetX: -8.6,
  offsetY: -8.55,
};

const SPRITE18_BOUNDS = {
  width: 217.7,
  height: 2170.65,
  offsetX: -101.55,
  offsetY: -1993.55,
};

const SPRITE19_BOUNDS = {
  width: 567.3,
  height: 40.15,
  offsetX: -11.7,
  offsetY: -18.75,
};

// ---- Bounds for shoot (from animations[]) ----
const SHOOT_BOUNDS = {
  width: 81.05,
  height: 79.7,
  offsetX: -37.55,
  offsetY: -70.25,
};

export class Spell906 extends RuntimeSpell {
  readonly spellId = 906;
  readonly displayType = SpellDisplayType.TargetCell;

  // Hold symbol refs for cross-symbol attaches in onSpellStart
  private cercleSym!: SymbolDefinition;
  private fumeeSym!: SymbolDefinition;
  private sprite18Sym!: SymbolDefinition;
  private sprite19Sym!: SymbolDefinition;
  private sprite22Sym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const fumeeAnchor = calculateAnchor(FUMEE_BOUNDS);
    const cercleAnchor = calculateAnchor(CERCLE_BOUNDS);
    const sprite18Anchor = calculateAnchor(SPRITE18_BOUNDS);
    const sprite19Anchor = calculateAnchor(SPRITE19_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- lib_fumee — smoke puff particle (36 frames) ----------------
    // AS: DefineSprite_7_fumee
    //
    // The fumee symbol has TWO separate scripts:
    //   1. frame_1/DoAction.as — fires on the fumee clip itself, seeds motion vars
    //      and installs an onEnterFrame closure for position integration.
    //   2. PlaceObject2_6_2 clip events — fire on an INNER child sprite placed
    //      at depth 6 within fumee's timeline. In our runtime, we port these as
    //      the OUTER fumee's onLoad/onEnterFrame since the inner child's rendering
    //      IS the fumee visual (lib_fumee textures render that inner child).
    //
    // For the motion integration (frame_1/DoAction.as), we use onLoad to seed
    // vars, then the onEnterFrame drives movement. The rotation reads
    // _parent._parent._parent.rotate._rotation — in context:
    //   fumee's parent = DefineSprite_2 (the smoke emitter)
    //   DefineSprite_2's parent = shoot
    //   shoot's parent = root
    //   root.vars has no "rotate" property in our runtime, so we approximate
    //   by using a random angle seeded at spawn time (canonical behavior of the
    //   angle being from a rotating sprite that spins during play — we seed it
    //   once at onLoad since the rotation at attachment time is what matters).
    this.fumeeSym = {
      name: "fumee",
      totalFrames: 36,
      frames: textures.getFrames("lib_fumee"),
      anchorX: fumeeAnchor.x,
      anchorY: fumeeAnchor.y,

      onLoad: (clip) => {
        // AS: DefineSprite_7_fumee/frame_1/PlaceObject2_6_2/onClipEvent(load)
        // Seeds the inner child's rotation/alpha/v — ported to outer clip vars.
        clip.vars.v = Math.floor(Math.random() * 20) + 0;
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        clip.alpha = (10 + Math.floor(Math.random() * 90)) / 100;

        // AS: DefineSprite_7_fumee/frame_1/DoAction.as
        // Seeds motion vars. The canonical `a` reads rotate._rotation from
        // grandparent. In the runtime context, we pick a random angle since
        // the "rotate" clip is an authored visual whose angle varies. A
        // uniform random angle produces the same omnidirectional smoke burst.
        const a = Math.random() * 2 * Math.PI;
        const t = 80 * Math.random() + 50;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.x = 20 * (Math.random() - 0.5);
        clip.y = 20 * (Math.random() - 0.5);
        clip.vars.vx = 20 * Math.cos(a);
        clip.vars.vy = 20 * Math.sin(a);
        clip.vars.deceleration = 1.2 + Math.random();
      },

      onEnterFrame: (clip) => {
        // AS: DefineSprite_7_fumee/frame_1/PlaceObject2_6_2/onClipEvent(enterFrame)
        //   _rotation = _rotation + v;
        //   _alpha = _alpha - 20;
        const v = clip.vars.v as number;
        clip.rotation += (v * Math.PI) / 180;
        clip.alpha = Math.max(0, clip.alpha - 20 / 100);

        // AS: DefineSprite_7_fumee/frame_1/DoAction.as onEnterFrame closure
        //   _X = _X + vx; _Y = _Y + vy; vx /= deceleration; vy /= deceleration;
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const deceleration = clip.vars.deceleration as number;
        clip.x += vx;
        clip.y += vy;
        vx /= deceleration;
        vy /= deceleration;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },

      frameScripts: new Map([
        [
          30,
          // AS: DefineSprite_7_fumee/frame_31/DoAction.as — removeMovieClip(this)
          (clip) => {
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_cercle — ballistic orange particle (1 frame) -----------
    // AS: DefineSprite_10_cercle
    this.cercleSym = {
      name: "cercle",
      totalFrames: 1,
      frames: textures.getFrames("lib_cercle"),
      anchorX: cercleAnchor.x,
      anchorY: cercleAnchor.y,

      onLoad: (clip) => {
        // AS: DefineSprite_10_cercle/frame_1/PlaceObject2_9_1/onClipEvent(load)
        // _parent._parent._parent.level — cercle → sprite22 → shoot → root
        const root = clip.parent?.parent?.parent;
        const level = (root?.vars.level as number) ?? 1;
        const d = 120 + (level - 1) * 32;
        clip.vars.d = d;
        clip.vars.accx = 0.8 + 0.16 * Math.random();
        const x = d * Math.random();
        let yStart: number;
        let sr: number;
        if (Math.floor(Math.random() * 2) === 1) {
          yStart = 5;
          sr = -1;
        } else {
          sr = 1;
          yStart = -5;
        }
        clip.scaleX = 0;
        clip.scaleY = 0;
        clip.vars.t = 5;
        clip.x = x;
        clip.y = yStart;
        clip.vars.va = 5 + 10 * Math.random();
        clip.vars.vr = (20 + 40 * Math.random()) * sr;
        clip.vars.vt = (0.34 + Math.floor(Math.random() * 2)) * ((d - x) / d);
        clip.vars.vx = 5 + 10 * Math.random();
      },

      onEnterFrame: (clip) => {
        // AS: DefineSprite_10_cercle/frame_1/PlaceObject2_9_1/onClipEvent(enterFrame)
        let vr = clip.vars.vr as number;
        let vx = clip.vars.vx as number;
        let vt = clip.vars.vt as number;
        let t = clip.vars.t as number;
        const accx = clip.vars.accx as number;

        vr *= 0.96;
        // AS: _rotation = _rotation - (vr *= 0.96)  (degrees)
        clip.rotation -= (vr * Math.PI) / 180;
        vx *= accx;
        // AS: _X = _X + (vx *= accx)
        clip.x += vx;
        vt -= 0.0113;
        t += vt;
        // AS: _xscale = t; _yscale = t  (percent)
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;

        clip.vars.vr = vr;
        clip.vars.vx = vx;
        clip.vars.vt = vt;
        clip.vars.t = t;

        if (t < 0) {
          // AS: _parent.removeMovieClip()
          clip.remove();
        }
      },
    };

    // ---- lib_sprite18 — bolt visual strip (36 frames, directlyDynamic) ---
    // AS: DefineSprite_18
    // Has a child at depth 6 (PlaceObject2_16_6) with onClipEvent(load):
    //   _xscale = random(100)
    // frame_34/DoAction.as: stop()
    // The child clip event is on an INNER child within sprite18. We port the
    // random scale seed as part of sprite18's onLoad (applied to self, matching
    // the visual effect of the random-scaled bolt stroke).
    this.sprite18Sym = {
      name: "sprite18",
      totalFrames: 36,
      frames: textures.getFrames("lib_sprite18"),
      anchorX: sprite18Anchor.x,
      anchorY: sprite18Anchor.y,

      onLoad: (clip) => {
        // AS: DefineSprite_18/frame_1/PlaceObject2_16_6/onClipEvent(load)
        //   _xscale = random(100)
        clip.scaleX = Math.floor(Math.random() * 100) / 100;
      },

      frameScripts: new Map([
        [
          33,
          // AS: DefineSprite_18/frame_34/DoAction.as — stop()
          (clip) => {
            clip.stop();
          },
        ],
      ]),
    };

    // ---- lib_sprite19 — wrapper for sprite18 (1 frame, directlyDynamic) ---
    // AS: DefineSprite_19
    // Attaches sprite18 at frame 0 depth 1 with the canonical placement matrix.
    // Its own child onClipEvent(load): a = 20 (seeds vars.a on the placed sprite18).
    // placements[parentSpriteId=19, frame=0, depth=1, matrix from manifest]
    this.sprite19Sym = {
      name: "sprite19",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite19"),
      anchorX: sprite19Anchor.x,
      anchorY: sprite19Anchor.y,

      onLoad: (clip, ctx) => {
        // AS: DefineSprite_19/frame_1/PlaceObject2_18_1/onClipEvent(load) — a = 20
        // This sets vars.a on the child that is being placed. We attach sprite18
        // here and seed its vars.a = 20 after attach.
        // Placement matrix from manifest.librarySymbols[sprite18].placements[0]:
        //   scaleX: 0.00592041015625, scaleY: 0.0016021728515625
        //   rotateSkew0: 0.16839599609375, rotateSkew1: -0.2607574462890625
        //   translateX: 35.1, translateY: 1.55
        const child = clip.attach(this.sprite18Sym, "sprite18_child", 1, ctx, {
          x: 35.1,
          y: 1.55,
          rotation: Math.atan2(0.16839599609375, 0.00592041015625),
        });
        // Apply full matrix scale (scaleX/scaleY from decomposed matrix)
        child.scaleX = Math.sqrt(
          0.00592041015625 * 0.00592041015625 +
            0.16839599609375 * 0.16839599609375
        );
        child.scaleY = Math.sqrt(
          0.0016021728515625 * 0.0016021728515625 +
            0.2607574462890625 * 0.2607574462890625
        );
        // AS: DefineSprite_19/frame_1/PlaceObject2_18_1/onClipEvent(load): a = 20
        child.vars.a = 20;
      },
    };

    // ---- sprite22 — parallel timeline container (139 frames) --------
    // AS: DefineSprite_22
    // frame_7: spawn cercle particles
    // frame_67: signalHit
    // frame_139: _parent.removeMovieClip()
    // sprite19 is placed inside DefineSprite_22 at frame 0, depth 1
    // with matrix: scaleX=0.3827, translateX=15.25, translateY=-0.1
    this.sprite22Sym = {
      name: "sprite22",
      totalFrames: 139,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      frameScripts: new Map([
        [
          0,
          // AS: DefineSprite_22 places sprite19 at frame 0 depth 1
          // placements[sprite19, parentSpriteId=22, frame=0, depth=1]:
          //   matrix: scaleX=0.3827056884765625, scaleY=0.3827056884765625,
          //           translateX=15.25, translateY=-0.1
          (clip, ctx) => {
            const child = clip.attach(
              this.sprite19Sym,
              "sprite19_child",
              1,
              ctx,
              { x: 15.25, y: -0.1 }
            );
            child.scaleX = 0.3827056884765625;
            child.scaleY = 0.3827056884765625;
          },
        ],
        [
          6,
          // AS: DefineSprite_22/frame_7/DoAction.as
          //   nb = 10 + _parent.level * 3; spawn cercle particles c = 1..nb-1
          (clip, ctx) => {
            const root = clip.parent;
            const level = (root?.vars.level as number) ?? 1;
            const nb = 10 + level * 3;
            for (let c = 1; c < nb; c++) {
              clip.attach(this.cercleSym, `cercle${c}`, c, ctx);
            }
          },
        ],
        [
          66,
          // AS: DefineSprite_22/frame_67/DoAction.as — this.end() → signalHit
          (_clip) => {
            this.runtime.signalHit();
          },
        ],
        [
          138,
          // AS: DefineSprite_22/frame_139/DoAction.as — this._parent.removeMovieClip()
          // shoot's frame_156 is the canonical outer-mc remover; this is a
          // redundant removal from sprite22's perspective. We call remove() on
          // shoot (the parent) here only if it hasn't already completed.
          (clip) => {
            clip.parent?.remove();
          },
        ],
      ]),
    };

    // ---- DefineSprite_2 — smoke emitter container (no named symbol in lib) ---
    // AS: DefineSprite_2 is placed as a child of shoot (unnamed, depth varies).
    // frame_1/DoAction.as: c = 5; onEnterFrame spawns fumee particles while c < 60.
    // frame_16/DoAction.as: stop()
    // We model this as a locally-named symbol "smokeEmitter" (container-only).
    const smokeEmitterSym: SymbolDefinition = {
      name: "smokeEmitter",
      totalFrames: 16,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      frameScripts: new Map([
        [
          0,
          // AS: DefineSprite_2/frame_1/DoAction.as
          //   c = 5; onEnterFrame spawns fumee
          (clip) => {
            clip.vars.c = 5;
            clip.onEnterFrame = (self, ctx) => {
              let c = self.vars.c as number;
              if (c < 60) {
                c++;
                // AS: p = c; while (p < _parent._parent.level + c) { attachMovie("fumee",...); p++; }
                // _parent._parent is shoot's parent = root
                const root = self.parent?.parent;
                const level = (root?.vars.level as number) ?? 1;
                let p = c;
                while (p < level + c) {
                  self.attach(this.fumeeSym, `fumee${p}`, p, ctx);
                  p++;
                }
                self.vars.c = c;
              }
            };
          },
        ],
        [
          15,
          // AS: DefineSprite_2/frame_16/DoAction.as — stop()
          (clip) => {
            clip.stop();
            // Clear the onEnterFrame loop once stopped
            clip.onEnterFrame = null;
          },
        ],
      ]),
    };

    // ---- shoot — 159-frame main animation container ----------------
    // AS: DefineSprite_3_shoot
    // frame_1/PlaceObject2_2_1/onClipEvent(load): scale self based on level
    //   t = 50 + 20 * _parent._parent.level; _xscale = _yscale = t
    //   _parent._parent is shoot's parent (root) → root.vars.level
    // frame_157/DoAction.as: _parent.removeMovieClip() → runtime.complete()
    //
    // The shoot symbol uses textures from animations["shoot"] (not librarySymbols)
    this.shootSym = {
      name: "shoot",
      totalFrames: 159,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,

      onLoad: (clip) => {
        // AS: DefineSprite_3_shoot/frame_1/PlaceObject2_2_1/onClipEvent(load)
        //   t = 50 + 20 * _parent._parent.level
        //   _parent._parent = shoot's parent = root
        const root = clip.parent;
        const level = (root?.vars.level as number) ?? 1;
        const t = 50 + 20 * level;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
      },

      frameScripts: new Map([
        [
          0,
          // Attach the smoke emitter (DefineSprite_2) and sprite22 at frame 1
          (clip, ctx) => {
            clip.attach(smokeEmitterSym, "smokeEmitter", 1, ctx);
            clip.attach(this.sprite22Sym, "sprite22", 2, ctx);
          },
        ],
        [
          156,
          // AS: DefineSprite_3_shoot/frame_157/DoAction.as — _parent.removeMovieClip()
          (clip) => {
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // Register all symbols
    this.registry.register(this.fumeeSym);
    this.registry.register(this.cercleSym);
    this.registry.register(this.sprite18Sym);
    this.registry.register(this.sprite19Sym);
    this.registry.register(this.sprite22Sym);
    this.registry.register(smokeEmitterSym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS: frame_1/DoAction.as — SOMA.playSound("jet_903")
    callbacks.playSound("jet_903");

    // Attach the shoot container as the root child. For displayType=11 (TargetCell),
    // root is at (0,0) which corresponds to the target cell in world coords. The
    // shoot clip renders its visual content centered there.
    this.root.attach(this.shootSym, "shoot", 1, context);
  }
}
