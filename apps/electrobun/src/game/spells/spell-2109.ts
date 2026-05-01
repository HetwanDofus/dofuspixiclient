/**
 * Spell 2109 — Water Swirl (Pandawa / Cra water spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2109/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The main timeline frame_2 positions
 * sprite_22 (the 84-frame target-side impact) at cellTo, and sprite_15
 * (the 30-frame caster-side swirl projectile) which internally reads
 * _parent.cellFrom / _parent.cellTo to compute its orbit path.
 * Two parallel authored timelines anchored in world space — identical
 * pattern to spell-909's WorldAbsolute layout.
 *
 * Library symbols:
 *   - cercle (characterId 7) — single-frame water droplet particle.
 *     onLoad: seeds va (fade speed), t (scale 60-130), alpha 90-120,
 *     r (friction 1.3-1.8). onEnterFrame: fades by va; drifts by
 *     parent.vx/vy; divides parent velocity by r each tick; removes
 *     self when alpha < 10.
 *
 *   - sprite6 (characterId 6, directlyDynamic) — a small rotating
 *     sub-sprite placed inside cercle at frame 0 depth 1. onLoad:
 *     seeds vr (rotation speed 50-150), random initial rotation,
 *     random frame. onEnterFrame: increments rotation by vr/parent.r;
 *     parent.r is the friction value stored on the cercle clip.
 *
 *   - DefineSprite_13 — an invisible "tracker" placed on DefineSprite_15
 *     at frame 0. Its frame_1 DoAction seeds xi/yi and installs an
 *     onEnterFrame that spawns cercle particles along the spiraling path.
 *
 *   - sprite_15 (the swirl projectile, 30 frames):
 *       frame_1 DoAction: SOMA.playSound("wab_swirl") + stops.
 *       frame_1 DoAction_2: positions self at cellFrom, computes d =
 *         half-distance to target, sets rotation to face target, stops.
 *       frame_1 PlaceObject2_13_1 clipEvent: the tracker child with
 *         orbital spiral physics (v, a, b, t, nFramesToIgnore).
 *       frame_28: _parent.removeMovieClip(); stop() → completes spell.
 *
 *   - sprite_22 (the 84-frame target-side composite, placed at cellTo):
 *       frame_2 onClipEvent(load): positions at cellTo.
 *       frame_55 DoAction_2: this.end() → signalHit.
 *       frame_82: stop().
 *
 * Main timeline (frame_2 / DoAction.as): stop().
 * sprite_22 child placed via PlaceObject2_22_3 at main-timeline frame 2
 * with onClipEvent(load) that sets _X/_Y to cellTo.
 *
 * signalHit fires from sprite_22 frame_55 (DoAction_2: this.end()).
 * complete() fires from sprite_15 frame_28 (_parent.removeMovieClip()).
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

// ---- Manifest bounds for library symbols ----
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

// ---- Manifest bounds for animation symbols ----
const SPRITE15_BOUNDS = {
  width: 32.75,
  height: 27.25,
  offsetX: -16.35,
  offsetY: -17.65,
};

const SPRITE22_BOUNDS = {
  width: 62.55,
  height: 69,
  offsetX: -27.2,
  offsetY: -46.95,
};

export class Spell2109 extends RuntimeSpell {
  readonly spellId = 2109;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite15Sym!: SymbolDefinition;
  private sprite22Sym!: SymbolDefinition;
  private cercleSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const cercleAnchor = calculateAnchor(CERCLE_BOUNDS);
    const sprite6Anchor = calculateAnchor(SPRITE6_BOUNDS);
    const sprite15Anchor = calculateAnchor(SPRITE15_BOUNDS);
    const sprite22Anchor = calculateAnchor(SPRITE22_BOUNDS);

    // ---- sprite6 (characterId 6) — rotating sub-particle inside cercle ----
    // Placed inside DefineSprite_7_cercle at frame 0 depth 1 via PlaceObject2_6_1.
    // directlyDynamic: true — owns its own CLIPACTIONRECORD handlers.
    //
    // AS DefineSprite_6/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    //   vr = random(100) + 50;
    //   _rotation = random(360);
    //   gotoAndStop(random(_totalframes) + 1);
    //
    // AS DefineSprite_6/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = _rotation + (vr /= _parent.r);
    //
    // Note: _parent here is the cercle clip, which stores `r` on its vars.
    const sprite6Sym: SymbolDefinition = {
      name: "sprite6",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite6"),
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_6/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.vr = Math.floor(Math.random() * 100) + 50;
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        // gotoAndStop(random(_totalframes) + 1) — totalFrames is 1, so always frame 0
        clip.gotoAndStop(Math.floor(Math.random() * 1));
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_6/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = _rotation + (vr /= _parent.r)
        // _parent is the cercle clip which stores r on vars.
        let vr = clip.vars.vr as number;
        const parentR = (clip.parent?.vars.r as number) ?? 1.3;
        vr = vr / parentR;
        clip.vars.vr = vr;
        clip.rotation += (vr * Math.PI) / 180;
      },
    };

    // ---- cercle (characterId 7) — water droplet particle ----
    // Placed inside DefineSprite_15 at runtime by DefineSprite_13's onEnterFrame.
    //
    // The cercle symbol itself has a child (sprite6) placed on its frame 0
    // via PlaceObject2_6_1. We attach sprite6 in cercle's frameScripts[0]
    // so it starts ticking alongside the cercle clip.
    //
    // AS DefineSprite_7_cercle/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
    //   va = 8 - random(3);
    //   t = 60 + random(70);
    //   _xscale = t; _yscale = t;
    //   _alpha = 90 + random(30);
    //   r = 1.3 + 0.5 * Math.random();
    //
    // AS DefineSprite_7_cercle/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   if(_alpha < 10) { _parent.removeMovieClip(); }
    //   _alpha = _alpha - va;
    //   _X = _X + _parent.vx;
    //   _Y = _Y + _parent.vy;
    //   _parent.vx /= r;
    //   _parent.vy /= r;
    this.cercleSym = {
      name: "cercle",
      totalFrames: 1,
      frames: textures.getFrames("lib_cercle"),
      anchorX: cercleAnchor.x,
      anchorY: cercleAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_7_cercle/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
        const va = 8 - Math.floor(Math.random() * 3);
        const t = 60 + Math.floor(Math.random() * 70);
        clip.vars.va = va;
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (90 + Math.floor(Math.random() * 30)) / 100;
        clip.vars.r = 1.3 + 0.5 * Math.random();
      },
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_7_cercle/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const va = clip.vars.va as number;
        const r = clip.vars.r as number;
        const currentAlpha = clip.alpha * 100;

        if (currentAlpha < 10) {
          clip.remove();
          return;
        }

        clip.alpha = (currentAlpha - va) / 100;

        // _parent here is sprite_15 (or whoever attached this cercle).
        // vx/vy are stored on the parent clip vars by DefineSprite_13's onEnterFrame.
        const parent = clip.parent;
        if (parent) {
          const vx = (parent.vars.vx as number) ?? 0;
          const vy = (parent.vars.vy as number) ?? 0;
          clip.x += vx;
          clip.y += vy;
          parent.vars.vx = vx / r;
          parent.vars.vy = vy / r;
        }
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Attach sprite6 as the inner rotating sub-sprite, matching the
            // canonical PlaceObject2_6_1 placement inside DefineSprite_7_cercle.
            // matrix: scaleX=1, scaleY=0.861, rotateSkew1=-0.283, translateX=0, translateY=-0.05
            // The skew encodes a slight rotation; convert via atan2.
            // rotateSkew0=0, rotateSkew1=-0.2827 → rotation = atan2(-0.2827, 0.861) radians
            const rotation = Math.atan2(-0.282684326171875, 0.861114501953125);
            clip.attach(sprite6Sym, "sprite6", 1, ctx, {
              x: 0,
              y: -0.05,
              rotation: rotation,
            });
          },
        ],
      ]),
    };

    // ---- DefineSprite_13 — the "tracker" sprite placed inside sprite_15 ----
    // This is a zero-visual sprite. Its frame_1 DoAction installs an onEnterFrame
    // that spawns cercle particles at the current position of the tracker as it
    // orbits along the spiral path (driven by the outer clip event on the
    // PlaceObject2_13_1 placement inside sprite_15).
    //
    // The tracker is referenced as "this" in DefineSprite_13/frame_1/DoAction.as:
    //   c = 100;
    //   xi = _X; yi = _Y;
    //   this.onEnterFrame = function() {
    //     vx = _X - xi; vy = _Y - yi;
    //     _parent.attachMovie("cercle","cercle" + c, c);
    //     eval("_parent.cercle" + c)._x = _X;
    //     eval("_parent.cercle" + c)._y = _Y;
    //     eval("_parent.cercle" + c).vx = vx;
    //     eval("_parent.cercle" + c).vy = vy;
    //     c++; xi = _X; yi = _Y;
    //   };
    //
    // In TS: we implement the frame_1 script to seed c/xi/yi, and then
    // the tracker's onEnterFrame mirrors the spawning loop.
    // The tracker is attached at (0,0) inside sprite_15; its position is
    // updated each tick by the outer clip-event handler (PlaceObject2_13_1
    // onClipEvent(enterFrame)) which we implement via the sprite15Sym's
    // frameScripts tracking logic below.
    //
    // We model DefineSprite_13 as a container symbol with:
    //   - frameScripts[0]: seed vars.c, vars.xi, vars.yi
    //   - onEnterFrame: spawn cercle particles at current position
    const sprite13Sym: SymbolDefinition = {
      name: "sprite13",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_13/frame_1/DoAction.as
            // c = 100; xi = _X; yi = _Y;
            clip.vars.c = 100;
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
          },
        ],
      ]),
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_13/frame_1/DoAction.as (onEnterFrame function)
        // vx = _X - xi; vy = _Y - yi;
        // _parent.attachMovie("cercle","cercle" + c, c);
        // ... set position and velocity on the spawned cercle ...
        let c = clip.vars.c as number;
        const xi = clip.vars.xi as number;
        const yi = clip.vars.yi as number;

        const vx = clip.x - xi;
        const vy = clip.y - yi;

        // _parent is sprite_15; attach cercle there
        const parent = clip.parent;
        if (parent) {
          const cercleName = `cercle${c}`;
          const newCercle = parent.attach(this.cercleSym, cercleName, c, ctx);
          newCercle.x = clip.x;
          newCercle.y = clip.y;
          // vx/vy are read from the cercle's PARENT (sprite_15) inside the
          // cercle's onEnterFrame. The tracker spawns them onto the parent.
          // But per the AS: eval("_parent.cercle" + c).vx = vx
          // This sets vx on the CERCLE clip itself (via eval ref), NOT on
          // the parent. However the cercle's enterFrame reads _parent.vx
          // which is the sprite_15 clip. We store them on sprite_15.
          // Actually re-reading the AS carefully:
          //   eval("_parent.cercle" + c).vx = vx  — sets on the new cercle
          //   but cercle's enterFrame does: _X += _parent.vx  (_parent = sprite_15)
          // So vx/vy are set on the NEWLY SPAWNED cercle clip, but then
          // the cercle reads them from _parent (sprite_15). This is a quirk
          // where the eval sets on the cercle object, and then the AS reads
          // _parent.vx — which in Flash would be the same reference since
          // the cercle was assigned to _parent.cercleN. But in AS2, setting
          // cercle.vx and then reading _parent.vx inside cercle would read
          // the PARENT clip's vx, not cercle's own.
          //
          // Looking at the cercle onEnterFrame more carefully:
          //   _X = _X + _parent.vx   → reads sprite_15.vx (the parent)
          //   _parent.vx /= r        → sets sprite_15.vx
          //
          // So the tracker MUST store vx/vy on sprite_15 (the parent of tracker
          // AND the parent of cercle). Each cercle spawned gets the CURRENT
          // sprite_15.vx/vy as its initial velocity, and then decays it.
          //
          // Since multiple cercle instances share the same parent.vx/vy, each
          // newly spawned one gets the freshly set values, and all running ones
          // decay those values simultaneously. This is a shared velocity slot.
          parent.vars.vx = vx;
          parent.vars.vy = vy;
        }

        clip.vars.c = c + 1;
        clip.vars.xi = clip.x;
        clip.vars.yi = clip.y;
      },
    };

    // ---- sprite_15 — caster-side swirl projectile (30 frames) ----
    // Contains:
    //   frame_1 DoAction: SOMA.playSound("wab_swirl")
    //   frame_1 DoAction_2: position at cellFrom, compute d, set rotation, stop()
    //   frame_1 PlaceObject2_13_1: attach tracker (sprite13) with orbital clip events
    //   frame_28: _parent.removeMovieClip(); stop() → complete()
    //
    // The tracker's position is driven by the onClipEvent(enterFrame) from
    // PlaceObject2_13_1 — we port that as sprite_15's onEnterFrame which
    // drives the tracker child's position each tick.
    this.sprite15Sym = {
      name: "sprite_15",
      totalFrames: 30,
      frames: textures.getFrames("sprite_15"),
      anchorX: sprite15Anchor.x,
      anchorY: sprite15Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_15/frame_1/DoAction.as
            // SOMA.playSound("wab_swirl") — played from onSpellStart instead
            // (we call it there since we have the callbacks reference).

            // AS DefineSprite_15/frame_1/DoAction_2.as
            // x = _parent.cellFrom.x; y = _parent.cellFrom.y;
            // _X = x; _Y = y;
            // dx = _parent.cellTo.x - x; dy = _parent.cellTo.y - y;
            // d = Math.sqrt(dx*dx + dy*dy) / 2;
            // _rotation = Math.atan2(dy,dx) * 180 / 3.1415;
            // stop();
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;

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
            } else {
              clip.vars.d = 0;
            }

            // Seed the orbital tracker state vars (from PlaceObject2_13_1 onClipEvent(load))
            // pi = 3.1415; v = 0.3; size = 0.8 + 3*Math.random();
            // a = 0; b = 0; t = 0; nFramesToIgnore = 2; nCurrentFrameState = 0;
            clip.vars.trackerPi = 3.1415;
            clip.vars.trackerV = 0.3;
            clip.vars.trackerSize = 0.8 + 3 * Math.random();
            clip.vars.trackerA = 0;
            clip.vars.trackerB = 0;
            clip.vars.trackerT = 0;
            clip.vars.trackerNFramesToIgnore = 2;
            clip.vars.trackerNCurrentFrameState = 0;

            clip.stop();

            // Attach the tracker sprite (DefineSprite_13) inside sprite_15
            // (matching PlaceObject2_13_1 placement at frame_1)
            const tracker = clip.attach(sprite13Sym, "tracker13", 1, ctx);
            // Initialize tracker position to current clip position
            tracker.x = clip.x;
            tracker.y = clip.y;
            tracker.vars.xi = clip.x;
            tracker.vars.yi = clip.y;
          },
        ],
        [
          27,
          (clip) => {
            // AS DefineSprite_15/frame_28/DoAction.as
            // _parent.removeMovieClip(); stop();
            // This is sprite_15 removing itself from the root — signals completion.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS DefineSprite_15/frame_1/PlaceObject2_13_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // This drives the position of the tracker child each tick.
        //
        // if(t > 28) {
        //   _parent.gotoAndPlay(2);
        // } else if(nCurrentFrameState > 0) {
        //   b = a; b += v/3;
        //   _X = _parent.d + _parent.d * Math.cos(pi + b);
        //   _Y = _parent.d * Math.sin(b) / size;
        //   nCurrentFrameState--;
        // } else {
        //   _X = _parent.d + _parent.d * Math.cos(pi + a);
        //   _Y = _parent.d * Math.sin(a) / size;
        //   a += v; t++;
        //   if(t <= 14) { v -= 0.015; } else { v += 0.03; }
        //   nCurrentFrameState = nFramesToIgnore;
        // }
        //
        // NOTE: "this" in the AS is the tracker clip (PlaceObject2_13_1 instance),
        // and _parent is sprite_15. In our model, we drive the tracker from
        // sprite_15's onEnterFrame so we need to find the tracker child.

        const pi = clip.vars.trackerPi as number;
        let v = clip.vars.trackerV as number;
        let a = clip.vars.trackerA as number;
        let b = clip.vars.trackerB as number;
        let t = clip.vars.trackerT as number;
        let nCurrentFrameState = clip.vars.trackerNCurrentFrameState as number;
        const nFramesToIgnore = clip.vars.trackerNFramesToIgnore as number;
        const size = clip.vars.trackerSize as number;
        const d = clip.vars.d as number;

        const tracker = clip.children.get("tracker13");

        if (t > 28) {
          // _parent.gotoAndPlay(2) — sprite_15 plays from frame 2
          clip.gotoAndPlay(1);
        } else if (nCurrentFrameState > 0) {
          b = a;
          b += v / 3;
          const newX = d + d * Math.cos(pi + b);
          const newY = (d * Math.sin(b)) / size;
          if (tracker) {
            tracker.x = newX;
            tracker.y = newY;
          }
          nCurrentFrameState--;
          clip.vars.trackerB = b;
          clip.vars.trackerNCurrentFrameState = nCurrentFrameState;
        } else {
          const newX = d + d * Math.cos(pi + a);
          const newY = (d * Math.sin(a)) / size;
          if (tracker) {
            tracker.x = newX;
            tracker.y = newY;
          }
          a += v;
          t++;
          if (t <= 14) {
            v -= 0.015;
          } else {
            v += 0.03;
          }
          nCurrentFrameState = nFramesToIgnore;
          clip.vars.trackerA = a;
          clip.vars.trackerT = t;
          clip.vars.trackerV = v;
          clip.vars.trackerNCurrentFrameState = nCurrentFrameState;
        }
      },
    };

    // ---- sprite_22 — target-side impact composite (84 frames) ----
    // Placed at frame_2 of the main timeline via PlaceObject2_22_3.
    // onClipEvent(load): _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    // frame_55 DoAction_2: this.end() → signalHit
    // frame_82: stop()
    this.sprite22Sym = {
      name: "sprite_22",
      totalFrames: 84,
      frames: textures.getFrames("sprite_22"),
      anchorX: sprite22Anchor.x,
      anchorY: sprite22Anchor.y,
      onLoad: (clip) => {
        // AS frame_2/PlaceObject2_22_3/CLIPACTIONRECORD onClipEvent(load).as
        // _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
        const root = clip.parent;
        const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
        if (cellTo) {
          clip.x = cellTo.x;
          clip.y = cellTo.y;
        }
      },
      frameScripts: new Map([
        [
          54,
          () => {
            // AS DefineSprite_22/frame_55/DoAction_2.as
            // this.end() → signalHit (damage popup at target)
            this.runtime.signalHit();
          },
        ],
        [
          81,
          (clip) => {
            // AS DefineSprite_22/frame_82/DoAction.as
            // stop()
            clip.stop();
          },
        ],
      ]),
    };

    this.registry.register(sprite6Sym);
    this.registry.register(this.cercleSym);
    this.registry.register(sprite13Sym);
    this.registry.register(this.sprite15Sym);
    this.registry.register(this.sprite22Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS DefineSprite_15/frame_1/DoAction.as: SOMA.playSound("wab_swirl")
    callbacks.playSound("wab_swirl");

    // AS frame_2/DoAction.as: stop()
    // Main timeline places sprite_22 (depth 3) and sprite_15 (implicitly).
    // We attach both so they start ticking.

    // sprite_22 is placed at main-timeline frame 2 depth 3 with the
    // onClipEvent(load) that positions it at cellTo.
    this.root.attach(this.sprite22Sym, "sprite22", 3, context);

    // sprite_15 (the swirl projectile) is the other authored timeline.
    // It positions itself at cellFrom in its own frame_1 DoAction_2.
    this.root.attach(this.sprite15Sym, "sprite15", 1, context);
  }
}
