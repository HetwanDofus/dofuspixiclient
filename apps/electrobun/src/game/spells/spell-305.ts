/**
 * Spell 305 — Séisme (Feca earth spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/305/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has a `move` symbol that
 * leaves a trail of `cercle` ring particles as it flies, and a `shoot`
 * symbol (159-frame composite) that is the impact animation at the target.
 * The harness drives the parabolic arc and calls signalHit() automatically
 * on landing.
 *
 * Library symbols:
 *   - lib_pierres — small stone particle. onLoad seeds vx/vy/scale/alpha/
 *                   gravity/rotation-speed. onEnterFrame does parabolic
 *                   bounce physics.
 *   - lib_cercle  — ring trail particle. onLoad seeds va/t/scale/alpha/r.
 *                   onEnterFrame fades out, drifts with inherited vx/vy,
 *                   removes itself when fully transparent.
 *
 * Container symbols (no authored frame textures):
 *   - move  — 1-frame container. frame_1 registers an onEnterFrame that
 *             drops a `cercle` particle at the move clip's current position
 *             every tick as the harness pushes it along the arc.
 *   - shoot — 159-frame composite (has authored frame textures).
 *             frame_1 plays "setag_310" sound + spawns 5 pierres particles
 *             (via a PlaceObject2_9_7 clip) + a rocking sub-sprite
 *             (PlaceObject2_8_4). frame_130 the outer shoot starts fading
 *             (_alpha -= 5 each frame). frame_157 _parent.removeMovieClip()
 *             → complete().
 *
 * Note on DefineSprite_17 and DefineSprite_27:
 *   DefineSprite_17 is the sub-sprite at PlaceObject2_8_4 (depth 4) inside
 *   shoot, whose frame_11 loops back to frame_1 — it is the rocking/wobble
 *   animation. DefineSprite_27 is placed inside each `pierres` instance as
 *   the spinning stone graphic; it spins via vr / r divisor.
 *
 * Main timeline: SOMA.playSound("setag_305"); (frame_1/DoAction.as)
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

const PIERRES_BOUNDS = {
  width: 6.4,
  height: 3.85,
  offsetX: -3.2,
  offsetY: -2.2,
};

const CERCLE_BOUNDS = {
  width: 44.2,
  height: 18.6,
  offsetX: -19.55,
  offsetY: -17.1,
};

export class Spell305 extends RuntimeSpell {
  readonly spellId = 305;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  // Held so onSpellStart can reference them when attaching
  private cercleSym!: SymbolDefinition;
  private pierresSym!: SymbolDefinition;
  private moveSym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  // Capture playSound for use inside frame scripts that fire after onSpellStart
  private playSoundFn?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const cercleAnchor = calculateAnchor(CERCLE_BOUNDS);

    // ---- lib_pierres — bouncing stone particle at impact ----------
    // Placed inside the shoot clip via PlaceObject2_9_7 onClipEvent(load).
    //
    // AS DefineSprite_21_pierres/frame_1/PlaceObject2_20_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   vx = 5 * (Math.random() - 0.5)
    //   vy = 2 * (Math.random() - 0.5)
    //   _parent._x = 20 * (Math.random() - 0.5)
    //   _parent._y = 10 * (Math.random() - 0.5)
    //   t = 60 + 40 * Math.random()
    //   _xscale = t; _yscale = t
    //   _alpha = 20 + random(90)
    //   v = -10 * Math.random() - 5
    //   vr = 40 * (-0.5 + Math.random())
    //
    // Note: the clip event handler lives on the INNER sprite (PlaceObject2_20_1)
    // but reads/writes _parent._x/_y for scatter positioning.
    // In the runtime, `clip` IS the pierres instance (which contains the
    // inner DefineSprite_27 spinning stone). We model the inner clip event
    // on the pierres symbol itself — the "this" in onLoad/onEnterFrame is
    // the pierres clip, and _parent references (scatter offsets) are applied
    // on the clip itself since we don't model the inner DefineSprite_27 as
    // a separate attachment (it has no authored sprite data we need to
    // simulate beyond its rotation, which we handle here).
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_21_pierres/frame_1/PlaceObject2_20_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.vx = 5 * (Math.random() - 0.5);
        clip.vars.vy = 2 * (Math.random() - 0.5);
        // _parent._x / _parent._y in AS means the pierres clip's own position
        // (the parent of the inner sprite is the pierres clip itself)
        clip.x = 20 * (Math.random() - 0.5);
        clip.y = 10 * (Math.random() - 0.5);
        const t = 60 + 40 * Math.random();
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        clip.vars.v = -10 * Math.random() - 5;
        clip.vars.vr = 40 * (-0.5 + Math.random());
        clip.vars.t = t;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_21_pierres/frame_1/PlaceObject2_20_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const vx = clip.vars.vx as number;
        const vy = clip.vars.vy as number;
        let v = clip.vars.v as number;
        let vr = clip.vars.vr as number;
        let tFlag = clip.vars.t as number;

        clip.x += vx;
        clip.y += vy;

        if (tFlag !== 1) {
          // _Y = _Y + v  — inner Y relative to the pierres origin
          // We track an internal localY on vars since the pierres clip
          // position is already used for horizontal scatter
          let localY = (clip.vars.localY as number) ?? 0;
          localY += v;
          clip.rotation += (vr * Math.PI) / 180;
          v += 1.5;

          if (localY > 0) {
            clip.vars.vx = vx / 2;
            clip.vars.vy = vy / 2;
            clip.rotation = 0;
            localY = 0;
            v = (-v) / 4;
            if (Math.abs(v) < 1) {
              clip.vars.vx = 0;
              clip.vars.vy = 0;
              tFlag = 1;
            }
          }

          clip.vars.localY = localY;
          clip.vars.v = v;
          clip.vars.vr = vr;
          clip.vars.t = tFlag;
        }
      },
    };

    // ---- lib_cercle — ring trail particle left during flight -----
    //
    // AS DefineSprite_28_cercle/frame_1/PlaceObject2_27_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   va = 3 - random(3)
    //   t = 60 + random(70)
    //   _xscale = t; _yscale = t
    //   _alpha = 70 + random(30)
    //   r = 1.03 + 0.5 * Math.random()
    //
    // AS DefineSprite_28_cercle/frame_1/PlaceObject2_27_1/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   if (_alpha < 5) { _parent.removeMovieClip() }
    //   _alpha -= va
    //   _X += _parent.vx
    //   _Y += _parent.vy
    //   _parent.vx /= r
    //   _parent.vy /= r
    //
    // The cercle clip is _parent of the PlaceObject2_27_1 inner sprite.
    // vx/vy are set on the cercle clip by the move script before attaching,
    // matching `eval("_parent.cercle"+c).vx = vx` in the move frame_1.
    this.cercleSym = {
      name: "cercle",
      totalFrames: 1,
      frames: textures.getFrames("lib_cercle"),
      anchorX: cercleAnchor.x,
      anchorY: cercleAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_28_cercle/frame_1/PlaceObject2_27_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.va = 3 - Math.floor(Math.random() * 3);
        const t = 60 + Math.floor(Math.random() * 70);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (70 + Math.floor(Math.random() * 30)) / 100;
        clip.vars.r = 1.03 + 0.5 * Math.random();
        // vx/vy may already be set by the move script before onLoad fires
        if (clip.vars.vx === undefined) {
          clip.vars.vx = 0;
        }
        if (clip.vars.vy === undefined) {
          clip.vars.vy = 0;
        }
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_28_cercle/frame_1/PlaceObject2_27_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const va = clip.vars.va as number;
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const r = clip.vars.r as number;

        if (clip.alpha < 0.05) {
          clip.remove();
          return;
        }

        clip.alpha -= va / 100;
        clip.x += vx;
        clip.y += vy;
        vx /= r;
        vy /= r;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
    };

    // ---- move — container that trails cercle rings as it arcs ----
    //
    // AS DefineSprite_18_move/frame_1/DoAction.as:
    //   c = 33;
    //   xi = _X; yi = _Y;
    //   this.onEnterFrame = function() {
    //     vx = _X - xi; vy = _Y - yi;
    //     _parent.attachMovie("cercle", "cercle"+c, c);
    //     eval("_parent.cercle"+c)._x = _X;
    //     eval("_parent.cercle"+c)._y = _Y - 20;
    //     eval("_parent.cercle"+c).vx = vx;
    //     eval("_parent.cercle"+c).vy = vy;
    //     c++; xi = _X; yi = _Y;
    //   }
    //
    // The harness drives move's _X/_Y along the parabolic arc each tick.
    // We read clip.x/clip.y each frame, compute the velocity delta, and
    // drop a cercle on root at that position.
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
            // AS DefineSprite_18_move/frame_1/DoAction.as
            clip.vars.c = 33;
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
          },
        ],
      ]),
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_18_move/frame_1/DoAction.as (the onEnterFrame closure)
        let c = clip.vars.c as number;
        const xi = clip.vars.xi as number;
        const yi = clip.vars.yi as number;

        const vx = clip.x - xi;
        const vy = clip.y - yi;

        const parent = clip.parent;
        if (parent) {
          const instanceName = `cercle${c}`;
          const child = parent.attach(this.cercleSym, instanceName, c, ctx);
          child.x = clip.x;
          child.y = clip.y - 20;
          child.vars.vx = vx;
          child.vars.vy = vy;
        }

        clip.vars.c = c + 1;
        clip.vars.xi = clip.x;
        clip.vars.yi = clip.y;
      },
    };

    // ---- shoot — 159-frame impact composite at target ------------
    //
    // Three authored sub-sprite behaviours in shoot:
    //
    // 1. PlaceObject2_8_4 (depth 4) — rocking wobble sprite
    //    (DefineSprite_17 which loops at frame_11 back to frame_1).
    //    onLoad: amp=30, s=1
    //    onEnterFrame: _rotation = amp*s; s*=-1; amp/=1.5
    //
    // 2. PlaceObject2_9_7 (depth 7) — spawns 5 pierres particles on load.
    //
    // 3. PlaceObject2_13_9 (depth 9, placed at frame_130) — fades the whole
    //    shoot clip: _parent._alpha -= 5 each frame.
    //
    // frame_1/DoAction.as: SOMA.playSound("setag_310")
    // frame_157/DoAction.as: _parent.removeMovieClip(); stop();
    //
    // We model sub-sprites 1, 2, and 3 as synthetic SpellClips attached
    // in the shoot's frame scripts, using container-only SymbolDefinitions
    // defined inline.

    // Sub-symbol: the rocking wobble clip (DefineSprite_17, depth 4)
    // Loops every 11 frames. We model it with just the clip-event logic.
    const wobbleSym: SymbolDefinition = {
      name: "_shoot_wobble",
      totalFrames: 11,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_14_shoot/frame_1/PlaceObject2_8_4/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.amp = 30;
        clip.vars.s = 1;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_14_shoot/frame_1/PlaceObject2_8_4/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const amp = clip.vars.amp as number;
        const s = clip.vars.s as number;
        clip.rotation = ((amp * s) * Math.PI) / 180;
        clip.vars.s = s * -1;
        clip.vars.amp = amp / 1.5;
      },
      frameScripts: new Map([
        [
          10,
          (clip) => {
            // AS DefineSprite_17/frame_11/DoAction.as: gotoAndPlay(1)
            clip.gotoAndPlay(0);
          },
        ],
      ]),
    };

    // Sub-symbol: the pierres spawner container (PlaceObject2_9_7, depth 7)
    const pierresSpawnerSym: SymbolDefinition = {
      name: "_shoot_pierres_spawner",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_14_shoot/frame_1/PlaceObject2_9_7/CLIPACTIONRECORD onClipEvent(load).as
        for (let c = 0; c < 5; c++) {
          clip.attach(this.pierresSym, `pierres${c}`, c, ctx);
        }
      },
    };

    // Sub-symbol: the fade driver container (PlaceObject2_13_9, depth 9)
    // Placed at frame_130 of shoot. Its onEnterFrame fades the parent (shoot).
    const fadeSym: SymbolDefinition = {
      name: "_shoot_fader",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS DefineSprite_14_shoot/frame_130/PlaceObject2_13_9/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _parent._alpha -= 5
        const parent = clip.parent;
        if (parent) {
          parent.alpha = Math.max(0, parent.alpha - 5 / 100);
        }
      },
    };

    this.shootSym = {
      name: "shoot",
      totalFrames: 159,
      frames: textures.getFrames("shoot"),
      anchorX: calculateAnchor({ width: 108.75, height: 67.5, offsetX: -43.6, offsetY: -63.4 }).x,
      anchorY: calculateAnchor({ width: 108.75, height: 67.5, offsetX: -43.6, offsetY: -63.4 }).y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_14_shoot/frame_1/DoAction.as: SOMA.playSound("setag_310")
            this.playSoundFn?.("setag_310");

            // Attach PlaceObject2_8_4 — the rocking wobble sprite (depth 4)
            clip.attach(wobbleSym, "wobble4", 4, ctx);

            // Attach PlaceObject2_9_7 — the pierres spawner (depth 7)
            clip.attach(pierresSpawnerSym, "pierresSpawner7", 7, ctx);

            // Signal hit at the first impact frame
            this.runtime.signalHit();
          },
        ],
        [
          129,
          (clip, ctx) => {
            // frame_130 in AS — place the fade driver (PlaceObject2_13_9, depth 9)
            clip.attach(fadeSym, "fader9", 9, ctx);
          },
        ],
        [
          156,
          (clip) => {
            // AS DefineSprite_14_shoot/frame_157/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.pierresSym);
    this.registry.register(this.cercleSym);
    this.registry.register(this.moveSym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("setag_305")
    callbacks.playSound("setag_305");

    // Capture playSound for frame scripts that fire sounds after init
    this.playSoundFn = callbacks.playSound;
  }
}
