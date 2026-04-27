/**
 * Spell 2109 — Wabbit swirl / orbital attack (Wabbit class).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2109/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The main timeline's frame_2 places sprite_22
 * (target-anchored, 84-frame impact) and the outer onLoad positions it at
 * cellTo. DefineSprite_15 (sprite_15, 30-frame orbiter) positions itself at
 * cellFrom, computes distance d = dist(cellFrom,cellTo)/2, and drives an
 * orbiting "sprite_13" child along an elliptical arc. That child in turn
 * spawns `cercle` particles (library symbol) as a trail.
 * DefineSprite_22 (sprite_22) fires `this.end()` (signalHit) at frame 55 and
 * stops at frame 82, triggering spell completion.
 *
 * Canonical structure:
 *   Main timeline (frame_2): stop(); place sprite_22 at cellTo; play wab_swirl.
 *   sprite_22 (84 frames, target-side):
 *     frame_55: this.end() → signalHit
 *     frame_82: stop() → complete
 *   sprite_15 (30 frames, orbiter container):
 *     DoAction_2 (frame_1): position at cellFrom, compute d, rotation to target, stop()
 *     frame_1 places DefineSprite_13 child with orbital onEnterFrame
 *     frame_28: _parent.removeMovieClip(); stop()
 *   DefineSprite_13 (orbital driver):
 *     frame_1 DoAction: sets up onEnterFrame that samples its own position, spawns
 *                       `cercle` particles at _parent (sprite_15 level) carrying vx/vy
 *   lib_cercle (single-frame particle):
 *     onLoad: seed va, t (scale), alpha, r (friction divisor)
 *     onEnterFrame: fade by va; drift by vx/vy (divided by r each frame); remove when alpha<10
 *
 * Library symbols (librarySymbols[]):
 *   - cercle (characterId 7) — trailing particle. Used by DefineSprite_13's
 *     attachMovie("cercle","cercleN",N).
 *
 * Non-library animations (animations[]) used as container timelines:
 *   - sprite_5   — inner sprite inside DefineSprite_6. Has its own onLoad/onEnterFrame
 *                  driven by DefineSprite_6's clip events (r divisor on rotation).
 *   - sprite_12  — the sprite inside sprite_15's PlaceObject2_13_1 (DefineSprite_13).
 *                  Its frame_1 DoAction sets up the orbital spawner.
 *   - sprite_15  — orbiter container (30 frames).
 *   - sprite_22  — target-side impact (84 frames).
 *
 * Note on DefineSprite_6: this is the inner rotating element placed INSIDE
 * the DefineSprite_13 composite at PlaceObject2_5_1. Its clip events read
 * `_parent.r` which is seeded by lib_cercle's onLoad (r = 1.3 + 0.5*random).
 * Since DefineSprite_6 is placed on the cercle clip's timeline, the `_parent`
 * of the DefineSprite_6 instance IS the cercle clip — so `_parent.r` == cercle's r.
 * We model this by registering a "sprite_6_inner" symbol used inside cercle.
 *
 * displayType=50 (WorldAbsolute): harness sets cellFrom/cellTo/angle on root.vars
 * and anchors the container at world (0,0). Per-spell scripts position children
 * using absolute world coords.
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

// Bounds from manifest animations[]
const SPRITE_5_BOUNDS = {
  width: 26.6,
  height: 15.1,
  offsetX: -13.5,
  offsetY: -13.75,
};

const SPRITE_12_BOUNDS = {
  width: 19.35,
  height: 19.35,
  offsetX: -9.6,
  offsetY: -9.85,
};

const SPRITE_15_BOUNDS = {
  width: 32.75,
  height: 27.25,
  offsetX: -16.35,
  offsetY: -17.65,
};

const SPRITE_22_BOUNDS = {
  width: 62.55,
  height: 69,
  offsetX: -27.2,
  offsetY: -46.95,
};

export class Spell2109 extends RuntimeSpell {
  readonly spellId = 2109;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  // Store symbols needed across registerSymbols + onSpellStart
  private cercleSym!: SymbolDefinition;
  private sprite6InnerSym!: SymbolDefinition;
  private sprite13Sym!: SymbolDefinition;
  private sprite15Sym!: SymbolDefinition;
  private sprite22Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const cercleAnchor = calculateAnchor(CERCLE_BOUNDS);
    const sprite5Anchor = calculateAnchor(SPRITE_5_BOUNDS);
    const sprite12Anchor = calculateAnchor(SPRITE_12_BOUNDS);
    const sprite15Anchor = calculateAnchor(SPRITE_15_BOUNDS);
    const sprite22Anchor = calculateAnchor(SPRITE_22_BOUNDS);

    // ---- DefineSprite_6 inner rotating element -------------------
    // This symbol is placed inside lib_cercle (PlaceObject2_5_1).
    // Clip events read _parent.r (the cercle clip's r variable).
    // AS: DefineSprite_6/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    //   vr = random(100) + 50;
    //   _rotation = random(360);
    //   gotoAndStop(random(_totalframes) + 1);
    // AS: DefineSprite_6/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = _rotation + (vr /= _parent.r);
    this.sprite6InnerSym = {
      name: "sprite_6_inner",
      totalFrames: 10,
      frames: textures.getFrames("sprite_5"),
      anchorX: sprite5Anchor.x,
      anchorY: sprite5Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_6/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
        const vr = Math.floor(Math.random() * 100) + 50;
        clip.vars.vr = vr;
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        const randomFrame = Math.floor(Math.random() * clip.totalFrames);
        clip.gotoAndStop(randomFrame);
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_6/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let vr = clip.vars.vr as number;
        const parentR = (clip.parent?.vars.r as number) ?? 1.3;
        vr = vr / parentR;
        clip.vars.vr = vr;
        clip.rotation += (vr * Math.PI) / 180;
      },
    };

    // ---- lib_cercle — trailing particle (library symbol) ----------
    // AS: DefineSprite_7_cercle/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
    //   va = 8 - random(3);
    //   t = 60 + random(70);
    //   _xscale = t; _yscale = t;
    //   _alpha = 90 + random(30);
    //   r = 1.3 + 0.5 * Math.random();
    // AS: DefineSprite_7_cercle/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   if(_alpha < 10) { _parent.removeMovieClip(); }
    //   _alpha -= va;
    //   _X += _parent.vx; _Y += _parent.vy;
    //   _parent.vx /= r; _parent.vy /= r;
    this.cercleSym = {
      name: "cercle",
      totalFrames: 1,
      frames: textures.getFrames("lib_cercle"),
      anchorX: cercleAnchor.x,
      anchorY: cercleAnchor.y,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_7_cercle/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
        const va = 8 - Math.floor(Math.random() * 3);
        const t = 60 + Math.floor(Math.random() * 70);
        clip.vars.va = va;
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (90 + Math.floor(Math.random() * 30)) / 100;
        clip.vars.r = 1.3 + 0.5 * Math.random();
        // Attach the inner rotating sprite_6 element (PlaceObject2_5_1 inside cercle)
        clip.attach(this.sprite6InnerSym, "inner", 1, ctx);
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_7_cercle/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const currentAlpha = clip.alpha * 100; // convert back to 0-100 range for comparison
        if (currentAlpha < 10) {
          clip.parent?.remove();
          return;
        }
        const va = clip.vars.va as number;
        const r = clip.vars.r as number;
        clip.alpha -= va / 100;
        // vx / vy are stored on the cercle clip itself (set by DefineSprite_13's spawner)
        const vx = (clip.vars.vx as number) ?? 0;
        const vy = (clip.vars.vy as number) ?? 0;
        clip.x += vx;
        clip.y += vy;
        clip.vars.vx = vx / r;
        clip.vars.vy = vy / r;
      },
    };

    // ---- DefineSprite_13 — orbital motion driver -----------------
    // AS: DefineSprite_13/frame_1/DoAction.as
    //   c = 100; xi = _X; yi = _Y;
    //   this.onEnterFrame = function() {
    //     vx = _X - xi; vy = _Y - yi;
    //     _parent.attachMovie("cercle","cercle"+c,c);
    //     eval("_parent.cercle"+c)._x = _X;
    //     eval("_parent.cercle"+c)._y = _Y;
    //     eval("_parent.cercle"+c).vx = vx;
    //     eval("_parent.cercle"+c).vy = vy;
    //     c++; xi = _X; yi = _Y;
    //   };
    // Note: DefineSprite_13 renders using sprite_12 textures.
    this.sprite13Sym = {
      name: "sprite_13",
      totalFrames: 9,
      frames: textures.getFrames("sprite_12"),
      anchorX: sprite12Anchor.x,
      anchorY: sprite12Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_13/frame_1/DoAction.as — initialise particle counter + position tracking
        clip.vars.c = 100;
        clip.vars.xi = clip.x;
        clip.vars.yi = clip.y;
      },
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_13/frame_1/DoAction.as — onEnterFrame closure
        const xi = clip.vars.xi as number;
        const yi = clip.vars.yi as number;
        const vx = clip.x - xi;
        const vy = clip.y - yi;
        let c = clip.vars.c as number;
        // _parent.attachMovie("cercle","cercle"+c,c)
        // _parent here is sprite_15, so we attach the cercle onto sprite_15
        const parentClip = clip.parent;
        if (parentClip) {
          const newCercle = parentClip.attach(
            this.cercleSym,
            `cercle${c}`,
            c,
            ctx
          );
          // Set position at current driver position (world-space within sprite_15's local)
          newCercle.x = clip.x;
          newCercle.y = clip.y;
          // Seed velocity from delta
          newCercle.vars.vx = vx;
          newCercle.vars.vy = vy;
        }
        c++;
        clip.vars.c = c;
        clip.vars.xi = clip.x;
        clip.vars.yi = clip.y;
      },
    };

    // ---- sprite_15 — orbiter container (30 frames) ---------------
    // AS DefineSprite_15/frame_1/DoAction_2.as:
    //   x = _parent.cellFrom.x; y = _parent.cellFrom.y;
    //   _X = x; _Y = y;
    //   dx = _parent.cellTo.x - x; dy = _parent.cellTo.y - y;
    //   d = Math.sqrt(dx*dx + dy*dy) / 2;
    //   _rotation = Math.atan2(dy,dx)*180/PI;
    //   stop();
    // AS DefineSprite_15/frame_1/PlaceObject2_13_1/onClipEvent(load):
    //   pi=3.1415; v=0.3; size=0.8+3*random; a=0; b=0; t=0; nFramesToIgnore=2; nCurrentFrameState=0;
    // AS DefineSprite_15/frame_1/PlaceObject2_13_1/onClipEvent(enterFrame): orbital ellipse motion
    // AS DefineSprite_15/frame_1/DoAction.as: SOMA.playSound("wab_swirl")
    // AS DefineSprite_15/frame_28/DoAction.as: _parent.removeMovieClip(); stop();
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
            // AS DefineSprite_15/frame_1/DoAction.as + DoAction_2.as
            // DoAction.as: SOMA.playSound("wab_swirl") — sound is played in onSpellStart
            // DoAction_2.as: position self at cellFrom, compute d, rotation, stop()
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
            const x = cellFrom?.x ?? 0;
            const y = cellFrom?.y ?? 0;
            const tx = cellTo?.x ?? 0;
            const ty = cellTo?.y ?? 0;
            const dx = tx - x;
            const dy = ty - y;
            const d = Math.sqrt(dx * dx + dy * dy) / 2;
            clip.vars.d = d;
            clip.rotation = Math.atan2(dy, dx);
            clip.stop();
            // Place the orbital driver (DefineSprite_13 / PlaceObject2_13_1)
            const driver = clip.attach(this.sprite13Sym, "driver", 1, ctx);
            // AS PlaceObject2_13_1/onClipEvent(load):
            // pi=3.1415; v=0.3; size=0.8+3*random; a=0; b=0; t=0;
            // nFramesToIgnore=2; nCurrentFrameState=0;
            driver.vars.pi = 3.1415;
            driver.vars.v = 0.3;
            driver.vars.size = 0.8 + 3 * Math.random();
            driver.vars.a = 0;
            driver.vars.b = 0;
            driver.vars.t = 0;
            driver.vars.nFramesToIgnore = 2;
            driver.vars.nCurrentFrameState = 0;
            // Override onEnterFrame with orbital motion
            driver.onEnterFrame = (driverClip, _driverCtx) => {
              // AS DefineSprite_15/frame_1/PlaceObject2_13_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
              const parentClip = driverClip.parent;
              if (!parentClip) {
                return;
              }
              const d2 = (parentClip.vars.d as number) ?? 0;
              let v = driverClip.vars.v as number;
              let a = driverClip.vars.a as number;
              let b = driverClip.vars.b as number;
              let t = driverClip.vars.t as number;
              const size = driverClip.vars.size as number;
              let nCurrentFrameState = driverClip.vars.nCurrentFrameState as number;
              const nFramesToIgnore = driverClip.vars.nFramesToIgnore as number;
              const pi = driverClip.vars.pi as number;

              if (t > 28) {
                // Trigger sprite_15 to play frame 2 onward
                parentClip.gotoAndPlay(1);
              } else if (nCurrentFrameState > 0) {
                b = a;
                b += v / 3;
                driverClip.x = d2 + d2 * Math.cos(pi + b);
                driverClip.y = (d2 * Math.sin(b)) / size;
                nCurrentFrameState--;
                driverClip.vars.b = b;
                driverClip.vars.nCurrentFrameState = nCurrentFrameState;
              } else {
                driverClip.x = d2 + d2 * Math.cos(pi + a);
                driverClip.y = (d2 * Math.sin(a)) / size;
                a += v;
                t++;
                if (t <= 14) {
                  v -= 0.015;
                } else {
                  v += 0.03;
                }
                nCurrentFrameState = nFramesToIgnore;
                driverClip.vars.a = a;
                driverClip.vars.t = t;
                driverClip.vars.v = v;
                driverClip.vars.nCurrentFrameState = nCurrentFrameState;
              }
            };
          },
        ],
        [
          27,
          (clip) => {
            // AS DefineSprite_15/frame_28/DoAction.as: _parent.removeMovieClip(); stop();
            clip.parent?.remove();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_22 — target-side impact (84 frames) --------------
    // AS DefineSprite_22/frame_55/DoAction_2.as: this.end() → signalHit
    // AS DefineSprite_22/frame_82/DoAction.as: stop() → spell complete
    // onLoad (from frame_2/PlaceObject2_22_3): _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    this.sprite22Sym = {
      name: "sprite_22",
      totalFrames: 84,
      frames: textures.getFrames("sprite_22"),
      anchorX: sprite22Anchor.x,
      anchorY: sprite22Anchor.y,
      onLoad: (clip) => {
        // AS scripts/frame_2/PlaceObject2_22_3/CLIPACTIONRECORD onClipEvent(load).as
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
            // AS DefineSprite_22/frame_55/DoAction_2.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          81,
          (clip) => {
            // AS DefineSprite_22/frame_82/DoAction.as: stop() → spell complete
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.cercleSym);
    this.registry.register(this.sprite6InnerSym);
    this.registry.register(this.sprite13Sym);
    this.registry.register(this.sprite15Sym);
    this.registry.register(this.sprite22Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS scripts/frame_2/DoAction.as: stop()
    // AS DefineSprite_15/frame_1/DoAction.as: SOMA.playSound("wab_swirl")
    callbacks.playSound("wab_swirl");

    // Main timeline frame_2 places sprite_22 (target-side) and sprite_15 (orbiter).
    // sprite_22 is placed at depth 3 (PlaceObject2_22_3) and positions itself via onLoad.
    this.root.attach(this.sprite22Sym, "sprite22", 3, context);
    // sprite_15 is placed at depth implied by the manifest ordering; use depth 1.
    this.root.attach(this.sprite15Sym, "sprite15", 1, context);
  }
}
