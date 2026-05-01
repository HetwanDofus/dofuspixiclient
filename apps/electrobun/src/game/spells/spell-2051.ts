/**
 * Spell 2051 — Wab (Osamodas swirl/wind effect).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2051/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The main timeline frame_2 places sprite_21
 * (the main animated timeline) at cellTo, and DefineSprite_14 (the orbiting
 * particle system) positions itself at cellFrom / cellTo using _parent.cellFrom
 * and _parent.cellTo. Both sprites need absolute world coords → WorldAbsolute.
 *
 * Library symbols:
 *   - cercle  (DefineSprite_7_cercle) — single-frame particle. onLoad seeds va
 *             (alpha decay), t (scale), alpha, r (friction). onEnterFrame fades
 *             alpha by va, drifts by parent.vx/vy (with friction), removes when
 *             alpha < 10.
 *   - sprite6 (DefineSprite_6, directlyDynamic: true) — spinning sub-particle
 *             placed inside cercle. onLoad seeds vr (rotation speed), randomises
 *             rotation + frame. onEnterFrame spins by vr /= _parent.r.
 *
 * Main timeline:
 *   frame_2/DoAction.as: stop(); + onClipEvent(load) positions sprite_21 at cellTo.
 *
 * DefineSprite_14 (the travelling swirl):
 *   frame_1/DoAction_2.as: positions self at cellFrom, computes dx/dy/d, sets
 *                          rotation to face cellTo, stops.
 *   frame_1/DoAction.as: SOMA.playSound("wab_swirl").
 *   Contains PlaceObject2_12_1 (an inner clip that drives the elliptical orbit
 *   of the sprite + spawns cercle particles). Its onLoad / onEnterFrame are the
 *   physics core.
 *   frame_28/DoAction.as: _parent.removeMovieClip(); stop();
 *
 * DefineSprite_21 (target impact timeline, 84 frames):
 *   frame_55/DoAction_2.as: this.end() → signalHit.
 *   frame_82/DoAction.as:   stop().
 *   (No explicit removeMovieClip — completion is driven by DefineSprite_14's
 *   frame_28 removing itself as the outer mc for the whole spell. We fire
 *   complete() there.)
 *
 * Orbit inner clip (DefineSprite_12 inside DefineSprite_14):
 *   frame_1/DoAction.as: seeds c=100, xi/yi; onEnterFrame spawns cercle
 *                         particles at current position with velocity (vx,vy).
 *   This is a container-only symbol placed inside sprite_14 at depth 1.
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

// Bounds from manifest librarySymbols[]
const CERCLE_BOUNDS = {
  width: 24.75,
  height: 10.45,
  offsetX: -11.15,
  offsetY: -9.5,
};

const SPRITE6_BOUNDS = {
  width: 21.3,
  height: 12.1,
  offsetX: -10.8,
  offsetY: -10.95,
};

// Bounds from manifest animations[] for the container symbols
const SPRITE14_BOUNDS = {
  width: 32.75,
  height: 27.25,
  offsetX: -16.35,
  offsetY: -17.65,
};

const SPRITE21_BOUNDS = {
  width: 62.55,
  height: 69,
  offsetX: -27.2,
  offsetY: -46.95,
};

export class Spell2051 extends RuntimeSpell {
  readonly spellId = 2051;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private cercleSym!: SymbolDefinition;
  private sprite6Sym!: SymbolDefinition;
  private sprite14Sym!: SymbolDefinition;
  private sprite21Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const cercleAnchor = calculateAnchor(CERCLE_BOUNDS);
    const sprite6Anchor = calculateAnchor(SPRITE6_BOUNDS);
    const sprite14Anchor = calculateAnchor(SPRITE14_BOUNDS);
    const sprite21Anchor = calculateAnchor(SPRITE21_BOUNDS);

    // ---- sprite6 (DefineSprite_6) — spinning sub-particle inside cercle ----
    // directlyDynamic: true. Placed at depth 1 inside DefineSprite_7_cercle
    // via PlaceObject2_5_1. Placement matrix has rotateSkew1=-0.282684,
    // so it starts slightly tilted — but onLoad overrides rotation immediately.
    //
    // AS DefineSprite_6/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    //   vr = random(100) + 50;
    //   _rotation = random(360);
    //   gotoAndStop(random(_totalframes) + 1);
    //
    // AS DefineSprite_6/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = _rotation + (vr /= _parent.r);
    this.sprite6Sym = {
      name: "sprite6",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite6"),
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,
      onLoad: (clip) => {
        // AS: vr = random(100) + 50;
        clip.vars.vr = Math.floor(Math.random() * 100) + 50;
        // AS: _rotation = random(360);
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        // AS: gotoAndStop(random(_totalframes) + 1);
        // totalFrames = 1, so random(1) = 0, gotoAndStop(1) = frame 0 (no-op)
        clip.gotoAndStop(Math.floor(Math.random() * clip.totalFrames));
      },
      onEnterFrame: (clip) => {
        // AS: _rotation = _rotation + (vr /= _parent.r);
        // _parent is the cercle clip which holds vars.r
        const r = (clip.parent?.vars.r as number) ?? 1.3;
        let vr = clip.vars.vr as number;
        vr = vr / r;
        clip.vars.vr = vr;
        clip.rotation += (vr * Math.PI) / 180;
      },
    };

    // ---- cercle (DefineSprite_7_cercle) — particle spawned by orbit clip ----
    // Contains sprite6 placed at depth 1 (PlaceObject2_6_1 in the SWF frame_1).
    // The cercle clip itself owns onLoad + onEnterFrame at PlaceObject2_6_1
    // but the file paths in the manifest tell us these are the handlers
    // FOR THE INNER sprite6 child placed inside cercle. The outer cercle's
    // own physics are driven by what DefineSprite_12 stores in cercle's
    // vars (vx, vy) at attach time.
    //
    // AS DefineSprite_7_cercle/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
    //   va = 8 - random(3);
    //   t = 60 + random(70);
    //   _xscale = t; _yscale = t;
    //   _alpha = 90 + random(30);
    //   r = 1.3 + 0.5 * Math.random();
    //
    // AS DefineSprite_7_cercle/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   if (_alpha < 10) { _parent.removeMovieClip(); }
    //   _alpha = _alpha - va;
    //   _X = _X + _parent.vx;
    //   _Y = _Y + _parent.vy;
    //   _parent.vx /= r;
    //   _parent.vy /= r;
    //
    // NOTE: The CLIPACTIONRECORD files are in the DefineSprite_7_cercle
    // directory at PlaceObject2_6_1 — these are the onLoad/onEnterFrame
    // handlers attached TO the sprite6 child placed inside cercle.
    // The cercle clip itself acts as a container that also carries
    // vx, vy, r vars used by its child handlers.
    this.cercleSym = {
      name: "cercle",
      totalFrames: 1,
      frames: textures.getFrames("lib_cercle"),
      anchorX: cercleAnchor.x,
      anchorY: cercleAnchor.y,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_7_cercle/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
        // These vars are on the INNER sprite6 child — seed them on cercle
        // since sprite6's handlers read _parent.r (i.e. cercle.vars.r).
        // We also apply scale/alpha to cercle itself as the visual host.
        const va = 8 - Math.floor(Math.random() * 3);
        const t = 60 + Math.floor(Math.random() * 70);
        clip.vars.va = va;
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (90 + Math.floor(Math.random() * 30)) / 100;
        clip.vars.r = 1.3 + 0.5 * Math.random();

        // Attach the inner sprite6 child (PlaceObject2_6_1 in frame_1 of cercle).
        // Apply the canonical placement matrix from manifest:
        //   scaleX=1, scaleY=0.861, rotateSkew1=-0.282684, translateX=0, translateY=-0.05
        // Rotation from matrix: atan2(rotateSkew1, scaleX) = atan2(-0.2827, 1) ≈ -0.2763 rad
        const matrixRotation = Math.atan2(-0.282684326171875, 1);
        clip.attach(this.sprite6Sym, "sprite6_1", 1, ctx, {
          x: 0,
          y: -0.05,
          rotation: matrixRotation,
        });
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_7_cercle/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // The enterFrame for the inner sprite6 child also runs via sprite6's own
        // onEnterFrame. The OUTER cercle behaviour (drift + fade + removal) is:
        const currentAlpha = clip.alpha;
        if (currentAlpha < 0.1) {
          clip.remove();
          return;
        }
        const va = clip.vars.va as number;
        const r = clip.vars.r as number;
        // vx, vy are stored on cercle itself (set by the orbit clip at spawn time)
        let vx = (clip.vars.vx as number) ?? 0;
        let vy = (clip.vars.vy as number) ?? 0;
        clip.alpha = currentAlpha - va / 100;
        clip.x += vx;
        clip.y += vy;
        vx /= r;
        vy /= r;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
    };

    // ---- orbit inner clip (DefineSprite_12) — elliptical orbit driver ----
    // Placed inside DefineSprite_14 (sprite_14). Container-only.
    // AS DefineSprite_12/frame_1/DoAction.as:
    //   c = 100; xi = _X; yi = _Y;
    //   this.onEnterFrame = function() {
    //     vx = _X - xi; vy = _Y - yi;
    //     _parent.attachMovie("cercle","cercle"+c,c);
    //     eval("_parent.cercle"+c)._x = _X; .._y = _Y; .vx = vx; .vy = vy;
    //     c++; xi = _X; yi = _Y;
    //   };
    // This clip's onEnterFrame is set up inside its own frame_1 script.
    // The clip has its own inner physics (elliptical orbit) driven by
    // DefineSprite_14's PlaceObject2_12_1 onClipEvent(enterFrame).
    // We implement the orbit as onEnterFrame on this clip; separately,
    // we implement the cercle-spawning as an onEnterFrame too — but since
    // AS adds it in frame_1 we fold both into the same onEnterFrame.
    const orbitClipSym: SymbolDefinition = {
      name: "orbitClip",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_14/frame_1/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.pi = 3.1415;
        clip.vars.v = 0.3;
        clip.vars.size = 0.8 + 3 * Math.random();
        clip.vars.a = 0;
        clip.vars.b = 0;
        clip.vars.t = 0;
        clip.vars.nFramesToIgnore = 2;
        clip.vars.nCurrentFrameState = 0;
        // AS DefineSprite_12/frame_1/DoAction.as — init cercle-spawner vars
        clip.vars.c = 100;
        clip.vars.xi = clip.x;
        clip.vars.yi = clip.y;
      },
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_14/frame_1/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // (drives the elliptical orbit of this clip inside sprite_14)
        const pi = clip.vars.pi as number;
        let v = clip.vars.v as number;
        let a = clip.vars.a as number;
        let b = clip.vars.b as number;
        let t = clip.vars.t as number;
        const size = clip.vars.size as number;
        let nCurrentFrameState = clip.vars.nCurrentFrameState as number;
        const nFramesToIgnore = clip.vars.nFramesToIgnore as number;

        const parentClip = clip.parent;
        const d = (parentClip?.vars.d as number) ?? 0;

        if (t > 28) {
          // AS: _parent.gotoAndPlay(2) — the sprite_14 container → gotoAndPlay(2)
          // means frame index 1 (0-based), which leads to frame_28 removal
          parentClip?.gotoAndPlay(1);
        } else if (nCurrentFrameState > 0) {
          b = a;
          b += v / 3;
          clip.x = d + d * Math.cos(pi + b);
          clip.y = (d * Math.sin(b)) / size;
          nCurrentFrameState--;
          clip.vars.b = b;
          clip.vars.nCurrentFrameState = nCurrentFrameState;
        } else {
          clip.x = d + d * Math.cos(pi + a);
          clip.y = (d * Math.sin(a)) / size;
          a += v;
          t++;
          if (t <= 14) {
            v -= 0.015;
          } else {
            v += 0.03;
          }
          nCurrentFrameState = nFramesToIgnore;
          clip.vars.a = a;
          clip.vars.t = t;
          clip.vars.v = v;
          clip.vars.nCurrentFrameState = nCurrentFrameState;
        }

        // AS DefineSprite_12/frame_1/DoAction.as onEnterFrame:
        // spawns cercle particles at current position with velocity delta
        const xi = clip.vars.xi as number;
        const yi = clip.vars.yi as number;
        let c = clip.vars.c as number;
        const vx = clip.x - xi;
        const vy = clip.y - yi;

        // Attach cercle to the grandparent (sprite_14's parent = root),
        // but canonical AS does: _parent.attachMovie("cercle",...) where
        // _parent of orbitClip = sprite_14, so cercle goes into sprite_14.
        if (parentClip) {
          const cercleChild = parentClip.attach(
            this.cercleSym,
            `cercle${c}`,
            c,
            ctx
          );
          cercleChild.x = clip.x;
          cercleChild.y = clip.y;
          cercleChild.vars.vx = vx;
          cercleChild.vars.vy = vy;
        }

        c++;
        clip.vars.c = c;
        clip.vars.xi = clip.x;
        clip.vars.yi = clip.y;
      },
    };

    // ---- sprite_14 (DefineSprite_14) — travelling swirl from cellFrom ----
    // 30 frames. frame_1: position at cellFrom, compute d, rotate to face cellTo,
    // play sound, stop(). frame_28: _parent.removeMovieClip() + stop() → complete.
    // Contains orbitClip at depth 1 (PlaceObject2_12_1).
    this.sprite14Sym = {
      name: "sprite_14",
      totalFrames: 30,
      frames: textures.getFrames("sprite_14"),
      anchorX: sprite14Anchor.x,
      anchorY: sprite14Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_14/frame_1/DoAction_2.as
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y;
            }
            if (cellFrom && cellTo) {
              const dx = cellTo.x - cellFrom.x;
              const dy = cellTo.y - cellFrom.y;
              const d = Math.sqrt(dx * dx + dy * dy) / 2;
              clip.vars.d = d;
              clip.rotation = Math.atan2(dy, dx);
            }
            clip.stop();

            // Place the orbit inner clip (PlaceObject2_12_1)
            clip.attach(orbitClipSym, "orbitClip", 1, ctx);
          },
        ],
        [
          27,
          (clip) => {
            // AS DefineSprite_14/frame_28/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- sprite_21 (DefineSprite_21) — target impact timeline (84 frames) ----
    // Placed at cellTo by main timeline onClipEvent(load).
    // frame_55 (index 54): this.end() → signalHit.
    // frame_82 (index 81): stop().
    this.sprite21Sym = {
      name: "sprite_21",
      totalFrames: 84,
      frames: textures.getFrames("sprite_21"),
      anchorX: sprite21Anchor.x,
      anchorY: sprite21Anchor.y,
      onLoad: (clip) => {
        // AS frame_2/PlaceObject2_21_3/CLIPACTIONRECORD onClipEvent(load).as
        // _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
        const root = clip.parent;
        const cellTo = root?.vars.cellTo as
          | { x: number; y: number }
          | undefined;
        if (cellTo) {
          clip.x = cellTo.x;
          clip.y = cellTo.y;
        }
      },
      frameScripts: new Map([
        [
          54,
          () => {
            // AS DefineSprite_21/frame_55/DoAction_2.as: this.end();
            this.runtime.signalHit();
          },
        ],
        [
          81,
          (clip) => {
            // AS DefineSprite_21/frame_82/DoAction.as: stop();
            clip.stop();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite6Sym);
    this.registry.register(this.cercleSym);
    this.registry.register(this.sprite14Sym);
    this.registry.register(this.sprite21Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS DefineSprite_14/frame_1/DoAction.as: SOMA.playSound("wab_swirl");
    // (played when sprite_14 is first constructed)
    callbacks.playSound("wab_swirl");

    // AS frame_2/DoAction.as: stop(); + PlaceObject2_21_3 placed at frame_2
    // of the main timeline. The onClipEvent(load) on PlaceObject2_21_3
    // positions sprite_21 at cellTo — handled by sprite21Sym.onLoad.
    this.root.attach(this.sprite21Sym, "sprite21", 3, context);

    // sprite_14 is also part of the main timeline (placed at an earlier frame).
    // Attach it so it starts its orbit + swirl logic immediately.
    this.root.attach(this.sprite14Sym, "sprite14", 2, context);
  }
}
