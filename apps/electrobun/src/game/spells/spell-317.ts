/**
 * Spell 317 — Séisme (Sadida earth tremor).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/317/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell launches a ballistic
 * projectile (the `move` container) that spawns `cercle` trail particles
 * as it flies, then lands and attaches `shoot` at impact. The `shoot`
 * symbol is a 53-frame composite with authored SVG frames; at frame_1 it
 * spawns `pierres` rock particles (which have full bounce/gravity physics)
 * and plays "setag_310"; at frame_44 an inner sprite begins fading the
 * parent alpha down by 10/tick; at frame_53 the outer mc is removed and
 * the spell completes.
 *
 * Library symbols:
 *   - lib_cercle — oval trail particle attached to `move` in flight.
 *     Contains a placed `sprite14` child (DefineSprite_14) with clip
 *     events: onLoad seeds vr/rotation/frame; onEnterFrame spins by
 *     vr/=r each tick. The cercle's own clip event (PlaceObject2_14_1)
 *     seeds va/t/scale/alpha/r, then each frame fades via va, drifts
 *     X/Y by parent.vx/vy, decays vx/vy by r, and removes when alpha<10.
 *   - lib_pierres — small rock particle placed inside `shoot`. onLoad
 *     seeds physics (vx, vy, v, vr, t, scale, alpha, parent scatter).
 *     onEnterFrame: moves parent, bounces off Y=0 with gravity, stops
 *     and freezes when v small enough.
 *   - lib_sprite14 — spinning inner disc placed inside cercle at frame_1
 *     with a slight skew matrix. onLoad seeds rotation and spin rate vr.
 *     onEnterFrame spins vr /= r each frame (r from parent cercle clip).
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("setag_305").
 *
 * Harness drives displayType=30: attaches `move` at caster, animates
 * parabolic arc, attaches `shoot` at landing and calls signalHit().
 * We must NOT call signalHit() ourselves.
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
const SPRITE14_BOUNDS = {
  width: 38.1,
  height: 21.6,
  offsetX: -19.05,
  offsetY: -19.8,
};
const SHOOT_BOUNDS = {
  width: 108.75,
  height: 64.95,
  offsetX: -43.6,
  offsetY: -63.4,
};

export class Spell317 extends RuntimeSpell {
  readonly spellId = 317;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  // Keep symbol refs so shoot's frameScripts can reference them.
  private pierresSym!: SymbolDefinition;
  private cercleSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const cercleAnchor = calculateAnchor(CERCLE_BOUNDS);
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const sprite14Anchor = calculateAnchor(SPRITE14_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---------------------------------------------------------------
    // lib_sprite14 — spinning disc child placed inside each cercle.
    //
    // AS: DefineSprite_14/frame_1/PlaceObject2_13_1/
    //   CLIPACTIONRECORD onClipEvent(load).as
    //   CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // Placed in cercle's authored timeline at frame_1 with matrix:
    //   scaleX=1, scaleY≈0.861, rotateSkew1≈-0.2827, translateY=-0.05
    // The placement matrix encodes a mild skew/scale; we apply it in
    // cercle's frameScripts after attaching.
    // ---------------------------------------------------------------
    const sprite14Sym: SymbolDefinition = {
      name: "sprite14",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite14"),
      anchorX: sprite14Anchor.x,
      anchorY: sprite14Anchor.y,

      onLoad: (clip) => {
        // AS: DefineSprite_14/frame_1/PlaceObject2_13_1/onClipEvent(load)
        //   vr = random(200) + 100
        //   _rotation = random(360)
        //   gotoAndStop(random(_totalframes) + 1)
        const vr = Math.floor(Math.random() * 200) + 100;
        clip.vars.vr = vr;
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        // gotoAndStop(random(1)+1) → frame 0 or 0 (totalFrames=1, so
        // random(1)=0, AS frame 1 = index 0 here). No-op but keep for
        // fidelity.
        clip.gotoAndStop(Math.floor(Math.random() * clip.totalFrames));
      },

      onEnterFrame: (clip) => {
        // AS: DefineSprite_14/frame_1/PlaceObject2_13_1/onClipEvent(enterFrame)
        //   _rotation = _rotation + (vr /= _parent.r)
        // _parent here is the cercle clip that contains sprite14.
        const parent = clip.parent;
        const r = (parent?.vars.r as number) ?? 1.1;
        let vr = clip.vars.vr as number;
        vr = vr / r;
        clip.vars.vr = vr;
        clip.rotation += (vr * Math.PI) / 180;
      },
    };

    // ---------------------------------------------------------------
    // lib_cercle — oval trail particle spawned by `move`'s onEnterFrame.
    //
    // The cercle contains one placed child (sprite14) at its own frame_1
    // via PlaceObject2_14_1. We attach it in frameScripts[0] with the
    // canonical placement matrix from the manifest.
    //
    // AS: DefineSprite_15_cercle/frame_1/PlaceObject2_14_1/
    //   CLIPACTIONRECORD onClipEvent(load).as  — seeds va, t, scale, alpha, r
    //   CLIPACTIONRECORD onClipEvent(enterFrame).as — fades, drifts, decays, removes
    // ---------------------------------------------------------------
    this.cercleSym = {
      name: "cercle",
      totalFrames: 1,
      frames: textures.getFrames("lib_cercle"),
      anchorX: cercleAnchor.x,
      anchorY: cercleAnchor.y,

      onLoad: (clip, ctx) => {
        // AS: DefineSprite_15_cercle/frame_1/PlaceObject2_14_1/onClipEvent(load)
        //   va = 4 - random(3)
        //   t = 60 + random(70)
        //   _xscale = t; _yscale = t
        //   _alpha = 70 + random(30)
        //   r = 1.1 + 0.5 * Math.random()
        const va = 4 - Math.floor(Math.random() * 3);
        const t = 60 + Math.floor(Math.random() * 70);
        clip.vars.va = va;
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (70 + Math.floor(Math.random() * 30)) / 100;
        const r = 1.1 + 0.5 * Math.random();
        clip.vars.r = r;

        // Attach the inner sprite14 child with its authored placement matrix.
        // Manifest placements[0]: scaleX=1, scaleY≈0.861, rotateSkew1≈-0.2827,
        // translateX=0, translateY=-0.05
        // We apply translation and the skew-encoded rotation.
        // rotateSkew1 = sin(-rotation) when scaleX=1, so rotation ≈ atan2(-skew1, scaleX)
        const placementRotation = Math.atan2(-(-0.282684326171875), 1); // ≈ 0.2776 rad
        const child = clip.attach(sprite14Sym, "sprite14", 1, ctx, {
          x: 0,
          y: -0.05,
          rotation: placementRotation,
        });
        // Apply the scaleY from the matrix (scaleY ≈ 0.861)
        child.scaleY = 0.861114501953125;
      },

      onEnterFrame: (clip) => {
        // AS: DefineSprite_15_cercle/frame_1/PlaceObject2_14_1/onClipEvent(enterFrame)
        //   if(_alpha < 10) { _parent.removeMovieClip() }
        //   _alpha = _alpha - va
        //   _X = _X + _parent.vx
        //   _Y = _Y + _parent.vy
        //   _parent.vx /= r
        //   _parent.vy /= r
        //
        // Note: _parent here is the cercle clip itself (the PlaceObject2_14_1
        // handler lives on sprite14 which is a child of cercle, so
        // _parent = cercle). But the handler text says _alpha and _parent.vx —
        // reading the AS carefully: the CLIPACTIONRECORD belongs to the
        // PlaceObject2_14_1 instance INSIDE DefineSprite_15_cercle's frame.
        // That means "this" = the inner child sprite, and "_parent" = cercle.
        // However, alpha/X/Y manipulations on "this" but vx/vy are on _parent
        // (cercle). For the runtime we model this at the CERCLE level since
        // cercle drives the outer lifecycle (removeMovieClip on cercle).
        // We implement as the onEnterFrame on cercle directly — cercle owns
        // vx/vy on its vars (set by move's onEnterFrame when attaching cercle).
        const alphaCurrent = clip.alpha * 100;
        if (alphaCurrent < 10) {
          clip.remove();
          return;
        }
        const va = clip.vars.va as number;
        const r = clip.vars.r as number;
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        clip.alpha = (alphaCurrent - va) / 100;
        clip.x += vx;
        clip.y += vy;
        vx = vx / r;
        vy = vy / r;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
    };

    // ---------------------------------------------------------------
    // lib_pierres — small rock particle spawned inside shoot.
    //
    // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/
    //   CLIPACTIONRECORD onClipEvent(load).as
    //   CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // The handler text uses "this" (the inner PlaceObject2 child) and
    // "_parent" (the pierres clip). We model as the pierres clip itself
    // with its own onLoad/onEnterFrame since there is no meaningful
    // distinction in the runtime representation.
    // ---------------------------------------------------------------
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,

      onLoad: (clip) => {
        // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/onClipEvent(load)
        //   vx = 5 * (Math.random() - 0.5)
        //   vy = 2 * (Math.random() - 0.5)
        //   _parent._x = 20 * (Math.random() - 0.5)
        //   _parent._y = 10 * (Math.random() - 0.5)
        //   t = 60 + 40 * Math.random()
        //   _xscale = t; _yscale = t
        //   _alpha = 20 + random(90)
        //   v = -10 * Math.random() - 5
        //   vr = 40 * (-0.5 + Math.random())
        const vx = 5 * (Math.random() - 0.5);
        const vy = 2 * (Math.random() - 0.5);
        clip.vars.vx = vx;
        clip.vars.vy = vy;
        // _parent is the pierres clip, _parent._x/y sets the clip's position
        clip.x = 20 * (Math.random() - 0.5);
        clip.y = 10 * (Math.random() - 0.5);
        const t = 60 + 40 * Math.random();
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        const v = -10 * Math.random() - 5;
        clip.vars.v = v;
        // Inner sprite Y position starts at 0 (the PlaceObject2 child's _Y)
        clip.vars.innerY = 0;
        const vr = 40 * (-0.5 + Math.random());
        clip.vars.vr = vr;
      },

      onEnterFrame: (clip) => {
        // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/onClipEvent(enterFrame)
        //   _parent._x += vx
        //   _parent._y += vy
        //   if(t != 1) {
        //     _Y = _Y + v
        //     _rotation = _rotation + vr
        //     v += 1.5
        //     if(_Y > 0) {
        //       vx /= 2; vy /= 2; _rotation = 0; _Y = 0
        //       v = (-v) / 4
        //       if(Math.abs(v) < 1) { vx=0; vy=0; t=1 }
        //     }
        //   }
        //
        // "this" = inner PlaceObject2 child (Y/rotation driven here),
        // "_parent" = pierres clip (X/Y position of the container).
        // We model t, innerY, vr, v as vars on the clip itself.
        let t = clip.vars.t as number;
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        let v = clip.vars.v as number;
        let vr = clip.vars.vr as number;
        let innerY = clip.vars.innerY as number;

        // Move the pierres container (_parent._x/_y += vx/vy)
        clip.x += vx;
        clip.y += vy;

        if (t !== 1) {
          // Advance inner Y and rotation (the PlaceObject2 child's local _Y/_rotation)
          // We track innerY as a separate var since clip.y is the container position.
          innerY = innerY + v;
          vr = vr; // rotation delta in degrees
          clip.rotation += (vr * Math.PI) / 180;
          v += 1.5;

          if (innerY > 0) {
            vx = vx / 2;
            vy = vy / 2;
            clip.rotation = 0;
            innerY = 0;
            v = (-v) / 4;
            if (Math.abs(v) < 1) {
              vx = 0;
              vy = 0;
              t = 1;
            }
          }
        }

        clip.vars.t = t;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
        clip.vars.v = v;
        clip.vars.vr = vr;
        clip.vars.innerY = innerY;
      },
    };

    // ---------------------------------------------------------------
    // DefineSprite_7 — inner looping helper used by shoot's alpha-fade
    // region. frame_6/DoAction.as: gotoAndPlay(1). This creates a 6-frame
    // looping clip. It is placed at depth 13 inside shoot at frame_44
    // (PlaceObject2_23_13) and its onClipEvent(enterFrame) fades _parent.
    // We model it as "sprite7" with a clip event that decrements parent alpha.
    // ---------------------------------------------------------------
    const sprite7Sym: SymbolDefinition = {
      name: "sprite7",
      totalFrames: 6,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          5,
          (clip) => {
            // AS: DefineSprite_7/frame_6/DoAction.as — gotoAndPlay(1)
            clip.gotoAndPlay(0);
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS: DefineSprite_24_shoot/frame_44/PlaceObject2_23_13/onClipEvent(enterFrame)
        //   _parent._alpha -= 10
        // _parent here is the shoot clip.
        const parent = clip.parent;
        if (parent) {
          const newAlpha = parent.alpha - 10 / 100;
          parent.alpha = newAlpha < 0 ? 0 : newAlpha;
        }
      },
    };

    // ---------------------------------------------------------------
    // move — 1-frame container. frame_1/DoAction.as sets up an
    // onEnterFrame that tracks clip position delta and spawns cercle
    // trail particles in the parent (outer mc) at each tick.
    //
    // AS: DefineSprite_8_move/frame_1/DoAction.as
    //   c = 100; xi = _X; yi = _Y
    //   this.onEnterFrame = function() {
    //     vx = _X - xi; vy = _Y - yi
    //     _parent.attachMovie("cercle","cercle"+c, c)
    //     eval("_parent.cercle"+c)._x = _X
    //     eval("_parent.cercle"+c)._y = _Y - 20
    //     eval("_parent.cercle"+c).vx = vx
    //     eval("_parent.cercle"+c).vy = vy
    //     c++; xi=_X; yi=_Y
    //   }
    // ---------------------------------------------------------------
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_8_move/frame_1/DoAction.as
            clip.vars.c = 100;
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
          },
        ],
      ]),
      onEnterFrame: (clip, ctx) => {
        // AS: move's this.onEnterFrame (set up in frame_1)
        // Track delta position to feed as vx/vy to each new cercle.
        let c = clip.vars.c as number;
        const xi = clip.vars.xi as number;
        const yi = clip.vars.yi as number;

        const vx = clip.x - xi;
        const vy = clip.y - yi;

        const parent = clip.parent;
        if (parent) {
          const instanceName = `cercle${c}`;
          const attached = parent.attach(this.cercleSym, instanceName, c, ctx, {
            x: clip.x,
            y: clip.y - 20,
          });
          attached.vars.vx = vx;
          attached.vars.vy = vy;
        }

        clip.vars.c = c + 1;
        clip.vars.xi = clip.x;
        clip.vars.yi = clip.y;
      },
    };

    // ---------------------------------------------------------------
    // shoot — 53-frame composite with authored SVG frames (the impact
    // explosion). Frame_1 plays a sound and places a stones container
    // (PlaceObject2_19_11) that spawns 5 pierres particles. Frame_44
    // places sprite7 (PlaceObject2_23_13) whose onEnterFrame fades the
    // shoot alpha. Frame_53 removes parent and calls complete().
    //
    // PlaceObject2_19_11: the "container" for stones — in canonical AS
    // it IS a clip instance at depth 11 of shoot, with its OWN
    // onClipEvent(load) that spawns 5 pierres via attachMovie("pierres",...).
    // We don't have a separate librarySymbols entry for the container;
    // we inline the pierres-spawning as shoot's frameScripts[0] since
    // the container's only purpose is that load handler.
    // ---------------------------------------------------------------
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 53,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_24_shoot/frame_1/DoAction.as
            //   SOMA.playSound("setag_310")
            // (sound emitted from onSpellStart for the main timeline;
            // shoot has its own sound call)
            // We capture callbacks via the runtime's callback ref.
            // The runtime's callbacks are accessible via runtime.callbacks.
            this.runtime.callbacks.playSound("setag_310");

            // AS: DefineSprite_24_shoot/frame_1/PlaceObject2_19_11/onClipEvent(load)
            //   c=0; while(c<5) { this.attachMovie("pierres","pierres"+c,c); c++ }
            // The PlaceObject2_19_11 instance is a container clip at depth 11.
            // Its load handler spawns pierres inside itself. We model this
            // by attaching pierres directly into shoot at depths 0-4 for
            // simplicity (the container has no visible content of its own).
            for (let c = 0; c < 5; c++) {
              clip.attach(this.pierresSym, `pierres${c}`, c, ctx);
            }
          },
        ],
        [
          43,
          (clip, ctx) => {
            // AS: DefineSprite_24_shoot/frame_44 — PlaceObject2_23_13 places
            // sprite7 at depth 13. Its onClipEvent(enterFrame) decrements
            // _parent._alpha by 10 each tick.
            clip.attach(sprite7Sym, "sprite7", 13, ctx);
          },
        ],
        [
          52,
          (clip) => {
            // AS: DefineSprite_24_shoot/frame_53/DoAction.as
            //   _parent.removeMovieClip(); stop();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite14Sym);
    this.registry.register(this.cercleSym);
    this.registry.register(this.pierresSym);
    this.registry.register(sprite7Sym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // AS: scripts/frame_1/DoAction.as
    //   SOMA.playSound("setag_305")
    callbacks.playSound("setag_305");
  }
}
