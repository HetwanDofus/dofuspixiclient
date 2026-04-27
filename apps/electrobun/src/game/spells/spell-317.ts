/**
 * Spell 317 — Scierie (Feca rock-throwing attack).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/317/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has a `move` symbol that
 * trails `cercle` smoke particles behind the projectile, and a `shoot` symbol
 * (53-frame composite) that plays an impact animation at the target. The
 * harness drives the parabolic arc for `move`, attaches `shoot` on landing,
 * and fires `runtime.signalHit()` automatically — we must NOT call it again.
 *
 * Library symbols:
 *   - lib_cercle  — smoke/dust ring particle trailing the projectile. onLoad
 *                   seeds va (fade speed), t (scale 60–130), alpha (70–100),
 *                   r (decel factor 1.1–1.6). onEnterFrame fades by va, drifts
 *                   by parent.vx/vy (decelerating via r), removes when alpha < 10.
 *   - lib_pierres — small tumbling rock chip. onLoad seeds vx/vy/v/vr/t/alpha.
 *                   onEnterFrame simulates gravity + bounce, stops when settled.
 *
 * DefineSprite_7 (used inside shoot's authored composite frames, depth-13 mc):
 *   frame_6: gotoAndPlay(1) — looping sub-animation inside the shoot composite.
 *   This sprite's clip-events (DefineSprite_14) seed rotation + random frame,
 *   then spin with decaying vr / parent.r.
 *
 * `move` (DefineSprite_8_move) — container-only projectile body:
 *   frame_1: sets up onEnterFrame that spawns a cercle particle each tick
 *            at the move clip's current position, passing current velocity
 *            as vx/vy to the particle for drift.
 *
 * `shoot` (DefineSprite_24_shoot) — 53-frame composite impact:
 *   frame_1:  SOMA.playSound("setag_310"); a depth-11 sub-mc (pierres spawner)
 *             onLoad spawns 5 `pierres` children.
 *   frame_44: depth-13 sub-mc onEnterFrame: _parent._alpha -= 10 (fade out).
 *   frame_53: _parent.removeMovieClip(); stop() → spell complete.
 *
 * Main timeline frame_1: SOMA.playSound("setag_305").
 *
 * Note: DefineSprite_14 (the spinning sub-sprite inside shoot's authored frame
 * content) has onLoad/onEnterFrame clip events. Since it is part of the
 * authored `shoot` composite frames (not an attachMovie'd library symbol),
 * its behaviour is baked into the rendered SVG frames. We do NOT need to
 * register it separately. The only runtime-spawned symbols are `cercle` and
 * `pierres` (via attachMovie in the AS scripts).
 *
 * The depth-11 sub-mc inside shoot (PlaceObject2_19_11) is the pierres spawner.
 * It is placed on shoot's authored timeline frame_1, so we model it as shoot's
 * frameScripts[0] onLoad logic: attach 5 pierres children to the shoot clip.
 *
 * The depth-13 sub-mc fade (frame_44 onEnterFrame) is modelled as an
 * onEnterFrame on the shoot clip itself, activated at frame_44.
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

const CERCLE_BOUNDS = {
  width: 44.2,
  height: 18.6,
  offsetX: -19.55,
  offsetY: -17.1,
};

const PIERRES_BOUNDS = {
  width: 6.4,
  height: 3.85,
  offsetX: -3.2,
  offsetY: -2.2,
};

export class Spell317 extends RuntimeSpell {
  readonly spellId = 317;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  private cercleSym!: SymbolDefinition;
  private pierresSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const cercleAnchor = calculateAnchor(CERCLE_BOUNDS);
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);

    // ---- lib_cercle — smoke/dust ring trailing the projectile ----
    // AS: DefineSprite_15_cercle/frame_1/PlaceObject2_14_1/onClipEvent(load)
    //     DefineSprite_15_cercle/frame_1/PlaceObject2_14_1/onClipEvent(enterFrame)
    //
    // The cercle clip's _parent is the outer mc (shoot/move context).
    // vx/vy are set on the parent by move's frame_1 script each tick.
    // In our model, vx/vy are stored on the cercle clip's own vars
    // (set by the move frame_1 attach call), matching the AS:
    //   eval("_parent.cercle" + c).vx = vx;
    this.cercleSym = {
      name: "cercle",
      totalFrames: 1,
      frames: textures.getFrames("lib_cercle"),
      anchorX: cercleAnchor.x,
      anchorY: cercleAnchor.y,
      onLoad: (clip) => {
        // AS onClipEvent(load):
        //   va = 4 - random(3);    → [1, 4]
        //   t = 60 + random(70);   → [60, 129]
        //   _xscale = t; _yscale = t;
        //   _alpha = 70 + random(30);
        //   r = 1.1 + 0.5 * Math.random();
        clip.vars.va = 4 - Math.floor(Math.random() * 3);
        const t = 60 + Math.floor(Math.random() * 70);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (70 + Math.floor(Math.random() * 30)) / 100;
        clip.vars.r = 1.1 + 0.5 * Math.random();
        // vx/vy are set externally by the move frame_1 script after attach
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame):
        //   if (_alpha < 10) { _parent.removeMovieClip(); }
        //   _alpha = _alpha - va;
        //   _X = _X + _parent.vx;
        //   _Y = _Y + _parent.vy;
        //   _parent.vx /= r;
        //   _parent.vy /= r;
        //
        // In the AS the cercle clip reads _parent.vx/_parent.vy, meaning
        // the container mc's vx/vy. We store vx/vy on the cercle clip's
        // own vars (set at attach time from move's onEnterFrame), and
        // decay them here — this matches the semantic intent.
        const va = clip.vars.va as number;
        const r = clip.vars.r as number;

        if (clip.alpha * 100 < 10) {
          clip.remove();
          return;
        }

        clip.alpha -= va / 100;

        const vx = (clip.vars.vx as number) ?? 0;
        const vy = (clip.vars.vy as number) ?? 0;
        clip.x += vx;
        clip.y += vy;
        clip.vars.vx = vx / r;
        clip.vars.vy = vy / r;
      },
    };

    // ---- lib_pierres — tumbling rock chip at impact ---------------
    // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/onClipEvent(load)
    //     DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/onClipEvent(enterFrame)
    //
    // Note: the AS scatters _parent._x/_parent._y (the pierres container mc)
    // and applies vx/vy to _parent._x/_parent._y in enterFrame.
    // The inner clip (PlaceObject2_2_1) handles _Y (vertical bounce) and
    // _rotation. In our model, the pierres SpellClip IS the container,
    // so we fold both _parent._x and inner _Y into clip.x / clip.y.
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,
      onLoad: (clip) => {
        // AS onClipEvent(load):
        //   vx = 5 * (Math.random() - 0.5);
        //   vy = 2 * (Math.random() - 0.5);
        //   _parent._x = 20 * (Math.random() - 0.5);
        //   _parent._y = 10 * (Math.random() - 0.5);
        //   t = 60 + 40 * Math.random();
        //   _xscale = t; _yscale = t;
        //   _alpha = 20 + random(90);
        //   v = -10 * Math.random() - 5;
        //   vr = 40 * (-0.5 + Math.random());
        clip.vars.vx = 5 * (Math.random() - 0.5);
        clip.vars.vy = 2 * (Math.random() - 0.5);
        clip.x = 20 * (Math.random() - 0.5);
        clip.y = 10 * (Math.random() - 0.5);
        const t = 60 + 40 * Math.random();
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        clip.vars.v = -10 * Math.random() - 5;
        clip.vars.vr = 40 * (-0.5 + Math.random());
        // Inner _Y (vertical offset within clip) tracked via vars.innerY
        clip.vars.innerY = 0;
        // t flag: 1 = settled
        clip.vars.t = 0;
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame):
        //   _parent._x += vx;
        //   _parent._y += vy;
        //   if (t != 1) {
        //     _Y = _Y + v;
        //     _rotation = _rotation + vr;
        //     v += 1.5;
        //     if (_Y > 0) {
        //       vx /= 2; vy /= 2;
        //       _rotation = 0; _Y = 0;
        //       v = (-v) / 4;
        //       if (Math.abs(v) < 1) { vx = 0; vy = 0; t = 1; }
        //     }
        //   }
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        let v = clip.vars.v as number;
        let vr = clip.vars.vr as number;
        const t = clip.vars.t as number;
        let innerY = clip.vars.innerY as number;

        clip.x += vx;
        clip.y += vy;

        if (t !== 1) {
          innerY += v;
          clip.rotation += (vr * Math.PI) / 180;
          v += 1.5;

          if (innerY > 0) {
            vx /= 2;
            vy /= 2;
            clip.rotation = 0;
            innerY = 0;
            v = (-v) / 4;
            if (Math.abs(v) < 1) {
              vx = 0;
              vy = 0;
              clip.vars.t = 1;
            }
          }

          clip.vars.v = v;
          clip.vars.vr = vr;
          clip.vars.innerY = innerY;
          clip.vars.vx = vx;
          clip.vars.vy = vy;
        }
      },
    };

    // ---- move — projectile container (DefineSprite_8_move) -------
    // AS: DefineSprite_8_move/frame_1/DoAction.as
    //   c = 100;
    //   xi = _X; yi = _Y;
    //   this.onEnterFrame = function() {
    //     vx = _X - xi; vy = _Y - yi;
    //     _parent.attachMovie("cercle","cercle" + c, c);
    //     eval("_parent.cercle" + c)._x = _X;
    //     eval("_parent.cercle" + c)._y = _Y - 20;
    //     eval("_parent.cercle" + c).vx = vx;
    //     eval("_parent.cercle" + c).vy = vy;
    //     c++; xi = _X; yi = _Y;
    //   };
    //
    // The harness drives move's position along the arc each tick (via
    // root.onEnterFrame). move's own frame_1 script sets up a per-tick
    // action that spawns a cercle particle at its current position.
    // We model this as move's onEnterFrame (which runs every tick).
    const cercleSym = this.cercleSym;
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 2,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS frame_1: initialise the tracking vars.
            clip.vars.c = 100;
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
          },
        ],
      ]),
      onEnterFrame: (clip, ctx) => {
        // AS this.onEnterFrame (set up in frame_1):
        //   vx = _X - xi; vy = _Y - yi;
        //   spawn cercle on _parent at current _X, _Y-20
        const c = clip.vars.c as number;
        const xi = clip.vars.xi as number;
        const yi = clip.vars.yi as number;
        const vx = clip.x - xi;
        const vy = clip.y - yi;

        const parent = clip.parent;
        if (parent) {
          const child = parent.attach(cercleSym, `cercle${c}`, c, ctx, {
            x: clip.x,
            y: clip.y - 20,
          });
          // Pass current velocity to the cercle particle for drift.
          child.vars.vx = vx;
          child.vars.vy = vy;
        }

        clip.vars.c = c + 1;
        clip.vars.xi = clip.x;
        clip.vars.yi = clip.y;
      },
    };

    // ---- shoot — 53-frame impact composite (DefineSprite_24_shoot) -
    // AS: DefineSprite_24_shoot/frame_1/DoAction.as
    //       SOMA.playSound("setag_310");
    //     frame_1/PlaceObject2_19_11/onClipEvent(load):
    //       c = 0; while (c < 5) { attachMovie("pierres","pierres"+c,c); c++; }
    //     frame_44/PlaceObject2_23_13/onClipEvent(enterFrame):
    //       _parent._alpha -= 10;
    //     frame_53/DoAction.as:
    //       _parent.removeMovieClip(); stop();
    //
    // The depth-11 sub-mc (pierres spawner) fires its onLoad on frame_1.
    // We model this as shoot's frameScripts[0]: play sound + spawn 5 pierres.
    // The depth-13 sub-mc fade begins on frame_44 (0-based: 43); we activate
    // an onEnterFrame on the shoot clip at that frame to handle the fade.
    // frame_53 (0-based: 52) removes outer mc + signals completion.
    const pierresSym = this.pierresSym;
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 53,
      frames: textures.getFrames("shoot"),
      anchorX: calculateAnchor({
        width: 108.75,
        height: 64.95,
        offsetX: -43.6,
        offsetY: -63.4,
      }).x,
      anchorY: calculateAnchor({
        width: 108.75,
        height: 64.95,
        offsetX: -43.6,
        offsetY: -63.4,
      }).y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_24_shoot/frame_1/DoAction.as:
            //   SOMA.playSound("setag_310");
            // We cannot call callbacks here (not in scope), but the
            // sound is already triggered via the manifest sounds[] entry
            // and onSpellStart. No further action needed from frame_1.
            //
            // AS DefineSprite_24_shoot/frame_1/PlaceObject2_19_11/
            //    onClipEvent(load):
            //   c = 0; while (c < 5) { attachMovie("pierres","pierres"+c,c); c++; }
            for (let c = 0; c < 5; c++) {
              clip.attach(pierresSym, `pierres${c}`, c, ctx);
            }
          },
        ],
        [
          43,
          (clip) => {
            // AS DefineSprite_24_shoot/frame_44/PlaceObject2_23_13/
            //    onClipEvent(enterFrame): _parent._alpha -= 10;
            // Activate fade-out from this frame onward by setting an
            // onEnterFrame on the shoot clip itself.
            clip.onEnterFrame = (self) => {
              self.alpha = Math.max(0, self.alpha - 10 / 100);
            };
          },
        ],
        [
          52,
          (clip) => {
            // AS DefineSprite_24_shoot/frame_53/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.cercleSym);
    this.registry.register(this.pierresSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("setag_305");
    callbacks.playSound("setag_305");
    // setag_310 is played from shoot's frame_1 script (DefineSprite_24_shoot).
    // We also trigger it here since shoot's frameScripts[0] cannot access
    // callbacks. The manifest lists both sounds at frame 0.
    callbacks.playSound("setag_310");
  }
}
