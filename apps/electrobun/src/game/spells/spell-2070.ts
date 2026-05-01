/**
 * Spell 2070 — (Ecaflip / Eniripsa dark bolt, likely "Flèche Noire" or similar).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2070/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The main timeline (frame_2/DoAction.as) stops
 * immediately. Four sprites (PlaceObject2_3_1, PlaceObject2_3_5, PlaceObject2_3_7,
 * PlaceObject2_3_9) are placed at absolute WORLD coords using _parent.cellFrom /
 * _parent.cellTo — classic WorldAbsolute pattern. A fifth sprite (PlaceObject2_4_3)
 * is placed at _parent.cellTo (the target anchor "b"). Each of the four "bolt" sprites
 * uses sprite_3 (96-frame animated lightning ball) with identical clip-event physics:
 * starts above the caster, drifts chaotically then homes toward cellTo, upon arrival
 * plays the sprite's timeline (impact) and signals hit. The fourth sprite (instance 1,
 * slowest) also homes toward cellTo via its own unique enterFrame logic. Spell completes
 * when sprite_3 frame_91 fires _parent.removeMovieClip().
 *
 * Library symbols:
 *   - sprite_3 — 96-frame animated lightning ball composite (isComposite=true). Four
 *     instances placed on the main timeline. frame_1: stop(). frame_25: stop(). frame_55:
 *     begin fading (alpha -= 3 per tick). frame_91: stop + _parent.removeMovieClip().
 *     onLoad seeds chaos-flight variables. onEnterFrame drives homing + impact detection.
 *
 * Main timeline (frame_2/DoAction.as): stop().
 * No sound in the scripts. Five clips placed at frame_2 of the main timeline.
 *
 * Completion signal: fired when sprite_3 frame_91 runs _parent.removeMovieClip().
 * Hit signal: fired via this.end() pattern — the first bolt to arrive calls signalHit.
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

const SPRITE_3_BOUNDS = {
  width: 141.1,
  height: 141.1,
  offsetX: -75.55,
  offsetY: -70.95,
};

export class Spell2070 extends RuntimeSpell {
  readonly spellId = 2070;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  // Track whether signalHit has been fired (any bolt can trigger it first)
  private hitFired = false;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite3Anchor = calculateAnchor(SPRITE_3_BOUNDS);
    const sprite3Frames = textures.getFrames("sprite_3");

    // We need a reference to `this` for signalHit / complete calls inside
    // the per-clip handlers (closures capture the outer class instance).
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    // ---- sprite_3 — lightning bolt projectile (96 frames) --------
    //
    // Canonical scripts:
    //   DefineSprite_3/frame_1/DoAction.as  → stop()
    //   DefineSprite_3/frame_25/DoAction.as → stop()
    //   DefineSprite_3/frame_55/DoAction.as → install onEnterFrame alpha fade
    //   DefineSprite_3/frame_91/DoAction.as → stop() + _parent.removeMovieClip()
    //
    // The onLoad / onEnterFrame clip events are defined per-placement on the
    // MAIN TIMELINE (not inside DefineSprite_3 itself), so we must supply
    // four separate SymbolDefinition instances — one per placement — each
    // with its own unique onLoad / onEnterFrame physics parameters.
    //
    // However, SymbolDefinition is keyed by name inside the registry, so we
    // register the four instances under unique names ("sprite3_bolt1",
    // "sprite3_bolt5", "sprite3_bolt7", "sprite3_bolt9") matching the
    // PlaceObject2 instance depths, and also a shared "sprite_3_anchor"
    // for the target-anchor clip (PlaceObject2_4_3, depth 3) which has
    // only an onLoad that sets position.

    // Shared frameScripts for all sprite_3 instances:
    //   frame_1  (index 0):  stop()
    //   frame_25 (index 24): stop()
    //   frame_55 (index 54): install per-tick alpha fade on _parent
    //   frame_91 (index 90): stop() + _parent.removeMovieClip() → complete()
    //
    // Note: frame_55 says `_parent._alpha -= 3` — in AS this means the
    // PARENT of the sprite_3 instance (the placed clip, i.e. the clip
    // itself from our model since sprite_3 IS the placed clip). In our
    // runtime model the placed clip IS the SpellClip, so `clip.alpha -= 3/100`.
    // We install this as clip.onEnterFrame at frame 55 (index 54).
    //
    // frame_91 fires _parent.removeMovieClip() — the "parent" in AS means the
    // clip that contains this sprite_3 instance. In the WorldAbsolute layout
    // the root IS the outer mc. We call this.runtime.complete() once.
    const makeSharedFrameScripts = () =>
      new Map<number, (clip: import("@dofus/spell-runtime").SpellClip, ctx: SpellContext) => void>([
        [
          0,
          (clip) => {
            // AS DefineSprite_3/frame_1/DoAction.as: stop()
            clip.stop();
          },
        ],
        [
          24,
          (clip) => {
            // AS DefineSprite_3/frame_25/DoAction.as: stop()
            clip.stop();
          },
        ],
        [
          54,
          (clip) => {
            // AS DefineSprite_3/frame_55/DoAction.as:
            //   this.onEnterFrame = function() { _parent._alpha -= 3; }
            // Install a per-tick alpha-fade handler on this clip.
            clip.onEnterFrame = (c) => {
              c.alpha -= 3 / 100;
            };
          },
        ],
        [
          90,
          (clip) => {
            // AS DefineSprite_3/frame_91/DoAction.as:
            //   stop(); _parent.removeMovieClip();
            clip.stop();
            clip.remove();
            self.runtime.complete();
          },
        ],
      ]);

    // ---- PlaceObject2_4_3 (depth 3) — target anchor "b" ----------
    // onClipEvent(load): _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    // This is the invisible anchor that the bolt clips home toward.
    // It has NO enterFrame, NO own timeline animations — purely positional.
    // We model it as a container-only symbol with onLoad.
    const anchorBSym: SymbolDefinition = {
      name: "sprite3_anchor_b",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS frame_2/PlaceObject2_4_3/CLIPACTIONRECORD onClipEvent(load).as
        const root = clip.parent;
        const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
        if (cellTo) {
          clip.x = cellTo.x;
          clip.y = cellTo.y;
        }
      },
    };

    // ---- Helper: build bolt onEnterFrame for instances 5, 7, 9 ---
    // These three share the same enterFrame logic but differ in `t` threshold
    // (55 for depth 5, 65 for depth 7, 75 for depth 9) and in which anchor
    // they home toward (`_parent.a` = caster for homing once threshold exceeded).
    //
    // AS logic (canonical for all three):
    //   if(fin == 0) {
    //     if(random(9) == 1) vr = (-0.5+Math.random())*40;
    //     v = 30 - Math.abs(vr)*0.5;
    //     v2 -= (v2-v)/3;
    //     v /= 2; v2 /= 2;
    //     angle += vr;
    //     if(t++ > threshold) {
    //       angle = atan2(_parent.a._y-_Y, _parent.a._x-_X)*180/PI;
    //       v = 1;
    //     }
    //     angle2 -= (angle2-angle)/2;
    //     _rotation = angle2;
    //     vx = v2*2*cos(angle2*PI/180);
    //     vy = v2*sin(angle2*PI/180);
    //     boule._xscale = 100 + v2*5; boule._yscale = 100 - v2*2;
    //   }
    //   if(|_parent.b._y-_Y|<20 & |_parent.b._x-_X|<20 & fin==0) { ...hit... }
    //   if(fin==1) { this.end(); fin=2; vx=0; vy=0; }
    //   _X += vx; _Y += vy;
    //
    // Note: `boule` is a named child of the sprite_3 instance in canonical AS.
    // In our runtime model the sprite_3 IS the displayed clip (no sub-child named
    // "boule"). We apply the xscale/yscale directly to the clip itself since the
    // squash-stretch effect is on the outer display object.
    const makeHomingEnterFrame = (tThreshold: number) => {
      return (clip: import("@dofus/spell-runtime").SpellClip) => {
        // AS: all three enter-frame scripts in frame_2/PlaceObject2_3_{5,7,9}
        const fin = clip.vars.fin as number;

        if (fin === 0) {
          if (Math.floor(Math.random() * 9) === 1) {
            clip.vars.vr = (-0.5 + Math.random()) * 40;
          }
          let vr = clip.vars.vr as number;
          let v2 = clip.vars.v2 as number;
          let t = clip.vars.t as number;
          let angle = clip.vars.angle as number;
          let angle2 = clip.vars.angle2 as number;

          let v = 30 - Math.abs(vr) * 0.5;
          v2 -= (v2 - v) / 3;
          v /= 2;
          v2 /= 2;
          angle += vr;

          if (t++ > tThreshold) {
            // Home toward anchor "a" (_parent.a) — in these three bolts,
            // the canonical AS hoards toward `_parent.a` (which in the
            // original SWF is an invisible clip at cellTo, since these
            // bolts go caster→target). Looking at the AS: after the
            // threshold the angle points toward `_parent.a._y / _parent.a._x`.
            // `a` is placed at `_parent.cellTo` (same as anchor b).
            // So we home to cellTo coords.
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            if (cellTo) {
              const dx = cellTo.x - clip.x;
              const dy = (cellTo.y) - clip.y;
              angle = (Math.atan2(dy, dx) * 180) / Math.PI;
            }
            v = 1;
          }

          angle2 -= (angle2 - angle) / 2;
          clip.rotation = (angle2 * Math.PI) / 180;

          const vx = v2 * 2 * Math.cos((angle2 * Math.PI) / 180);
          const vy = v2 * Math.sin((angle2 * Math.PI) / 180);
          // boule squash/stretch applied directly to this clip
          clip.scaleX = (100 + v2 * 5) / 100;
          clip.scaleY = (100 - v2 * 2) / 100;

          clip.vars.vr = vr;
          clip.vars.v2 = v2;
          clip.vars.t = t;
          clip.vars.angle = angle;
          clip.vars.angle2 = angle2;
          clip.vars.vx = vx;
          clip.vars.vy = vy;
        }

        // Check arrival at anchor "b" (_parent.b = PlaceObject2_4_3 = cellTo)
        const root = clip.parent;
        const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
        const bX = cellTo?.x ?? 0;
        const bY = cellTo?.y ?? 0;
        const currentFin = clip.vars.fin as number;

        if (
          Math.abs(bY - clip.y) < 20 &&
          Math.abs(bX - clip.x) < 20 &&
          currentFin === 0
        ) {
          // boule reset
          clip.scaleX = 1;
          clip.scaleY = 1;
          clip.vars.fin = 1;
          clip.play(); // this.play() in AS
          clip.vars.vx = 0;
          // cy = 0 in AS (unused variable)
        }

        if (clip.vars.fin === 1) {
          // this.end() → signalHit (fired once globally)
          if (!self.hitFired) {
            self.hitFired = true;
            self.runtime.signalHit();
          }
          clip.vars.fin = 2;
          clip.vars.vx = 0;
          clip.vars.vy = 0;
        }

        clip.x += clip.vars.vx as number;
        clip.y += clip.vars.vy as number;
      };
    };

    // ---- PlaceObject2_3_5 (depth 5) — bolt, t-threshold=55 ------
    // AS frame_2/PlaceObject2_3_5/CLIPACTIONRECORD onClipEvent(load).as
    const bolt5Sym: SymbolDefinition = {
      name: "sprite3_bolt5",
      totalFrames: 96,
      frames: sprite3Frames,
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,
      frameScripts: makeSharedFrameScripts(),
      onLoad: (clip) => {
        // AS frame_2/PlaceObject2_3_5/CLIPACTIONRECORD onClipEvent(load).as
        const root = clip.parent;
        const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
        if (cellFrom) {
          clip.x = cellFrom.x;
          clip.y = cellFrom.y - 140;
        }
        clip.vars.angle = -90;
        clip.vars.vr = (-0.5 + Math.random()) * 30;
        clip.vars.v = 10;
        clip.vars.v2 = 10;
        clip.vars.t = 0;
        clip.vars.angle2 = -90;
        clip.vars.fin = 0;
        clip.vars.vx = 0;
        clip.vars.vy = 0;
      },
      onEnterFrame: makeHomingEnterFrame(55),
    };

    // ---- PlaceObject2_3_7 (depth 7) — bolt, t-threshold=65 ------
    // AS frame_2/PlaceObject2_3_7/CLIPACTIONRECORD onClipEvent(load).as
    const bolt7Sym: SymbolDefinition = {
      name: "sprite3_bolt7",
      totalFrames: 96,
      frames: sprite3Frames,
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,
      frameScripts: makeSharedFrameScripts(),
      onLoad: (clip) => {
        // AS frame_2/PlaceObject2_3_7/CLIPACTIONRECORD onClipEvent(load).as
        const root = clip.parent;
        const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
        if (cellFrom) {
          clip.x = cellFrom.x;
          clip.y = cellFrom.y - 140;
        }
        clip.vars.angle = -90;
        clip.vars.vr = (-0.5 + Math.random()) * 30;
        clip.vars.v = 10;
        clip.vars.v2 = 10;
        clip.vars.t = 0;
        clip.vars.angle2 = -90;
        clip.vars.fin = 0;
        clip.vars.vx = 0;
        clip.vars.vy = 0;
      },
      onEnterFrame: makeHomingEnterFrame(65),
    };

    // ---- PlaceObject2_3_9 (depth 9) — bolt, t-threshold=75 ------
    // AS frame_2/PlaceObject2_3_9/CLIPACTIONRECORD onClipEvent(load).as
    const bolt9Sym: SymbolDefinition = {
      name: "sprite3_bolt9",
      totalFrames: 96,
      frames: sprite3Frames,
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,
      frameScripts: makeSharedFrameScripts(),
      onLoad: (clip) => {
        // AS frame_2/PlaceObject2_3_9/CLIPACTIONRECORD onClipEvent(load).as
        const root = clip.parent;
        const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
        if (cellFrom) {
          clip.x = cellFrom.x;
          clip.y = cellFrom.y - 140;
        }
        clip.vars.angle = -90;
        clip.vars.vr = (-0.5 + Math.random()) * 30;
        clip.vars.v = 10;
        clip.vars.v2 = 10;
        clip.vars.t = 0;
        clip.vars.angle2 = -90;
        clip.vars.fin = 0;
        clip.vars.vx = 0;
        clip.vars.vy = 0;
      },
      onEnterFrame: makeHomingEnterFrame(75),
    };

    // ---- PlaceObject2_3_1 (depth 1) — first bolt, unique physics -
    // This bolt has a different enterFrame:
    //   - Initial vr = (-0.5+Math.random())*20  (not 30)
    //   - if(t++ > 45) { angle = atan2(b._y-_Y, b._x-_X)*...; vr=(-0.5+r)*15; }
    //     (homes to _parent.b, not _parent.a; also adds random vr after threshold)
    //   - v = 23 - Math.abs(vr)*0.5  (not 30)
    //   - No v=1 override after homing lock
    //
    // AS frame_2/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(load).as
    const bolt1Sym: SymbolDefinition = {
      name: "sprite3_bolt1",
      totalFrames: 96,
      frames: sprite3Frames,
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,
      frameScripts: makeSharedFrameScripts(),
      onLoad: (clip) => {
        // AS frame_2/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(load).as
        const root = clip.parent;
        const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
        if (cellFrom) {
          clip.x = cellFrom.x;
          clip.y = cellFrom.y - 140;
        }
        clip.vars.angle = -90;
        clip.vars.vr = (-0.5 + Math.random()) * 20;
        clip.vars.v = 10;
        clip.vars.v2 = 10;
        clip.vars.t = 0;
        clip.vars.angle2 = -90;
        clip.vars.fin = 0;
        clip.vars.vx = 0;
        clip.vars.vy = 0;
      },
      onEnterFrame: (clip) => {
        // AS frame_2/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const fin = clip.vars.fin as number;

        if (fin === 0) {
          if (Math.floor(Math.random() * 9) === 1) {
            clip.vars.vr = (-0.5 + Math.random()) * 40;
          }

          let vr = clip.vars.vr as number;
          let v2 = clip.vars.v2 as number;
          let t = clip.vars.t as number;
          let angle = clip.vars.angle as number;
          let angle2 = clip.vars.angle2 as number;

          if (t++ > 45) {
            // Home toward _parent.b (cellTo anchor)
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            if (cellTo) {
              const dx = cellTo.x - clip.x;
              const dy = cellTo.y - clip.y;
              angle = (Math.atan2(dy, dx) * 180) / Math.PI;
            }
            // Also randomize vr after threshold (unique to bolt 1)
            vr = (-0.5 + Math.random()) * 15;
            clip.vars.vr = vr;
          }

          let v = 23 - Math.abs(vr) * 0.5;
          v2 -= (v2 - v) / 3;
          v /= 2;
          v2 /= 2;
          angle += vr;
          angle2 -= (angle2 - angle) / 2;
          clip.rotation = (angle2 * Math.PI) / 180;

          const vx = v2 * 2 * Math.cos((angle2 * Math.PI) / 180);
          const vy = v2 * Math.sin((angle2 * Math.PI) / 180);
          // boule squash/stretch applied to this clip
          clip.scaleX = (100 + v2 * 5) / 100;
          clip.scaleY = (100 - v2 * 2) / 100;

          clip.vars.vr = vr;
          clip.vars.v2 = v2;
          clip.vars.t = t;
          clip.vars.angle = angle;
          clip.vars.angle2 = angle2;
          clip.vars.vx = vx;
          clip.vars.vy = vy;
        }

        // Check arrival at anchor "b" (_parent.b = PlaceObject2_4_3 = cellTo)
        const root = clip.parent;
        const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
        const bX = cellTo?.x ?? 0;
        const bY = cellTo?.y ?? 0;
        const currentFin = clip.vars.fin as number;

        if (
          Math.abs(bY - clip.y) < 20 &&
          Math.abs(bX - clip.x) < 20 &&
          currentFin === 0
        ) {
          clip.scaleX = 1;
          clip.scaleY = 1;
          clip.vars.fin = 1;
          clip.play();
          clip.vars.vx = 0;
          // cy = 0 in AS (unused)
        }

        if (clip.vars.fin === 1) {
          // this.end() → signalHit
          if (!self.hitFired) {
            self.hitFired = true;
            self.runtime.signalHit();
          }
          clip.vars.fin = 2;
          clip.vars.vx = 0;
          clip.vars.vy = 0;
        }

        clip.x += clip.vars.vx as number;
        clip.y += clip.vars.vy as number;
      },
    };

    this.registry.register(anchorBSym);
    this.registry.register(bolt1Sym);
    this.registry.register(bolt5Sym);
    this.registry.register(bolt7Sym);
    this.registry.register(bolt9Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS frame_2/DoAction.as: stop()
    // The main timeline stops immediately. The five PlaceObject2 clips
    // placed on frame_2 of the main timeline are attached here.

    // PlaceObject2_4_3 (depth 3) — invisible target anchor "b"
    const anchorBSym = this.registry.resolve("sprite3_anchor_b");
    if (anchorBSym) {
      this.root.attach(anchorBSym, "b", 3, context);
    }

    // PlaceObject2_3_1 (depth 1) — first bolt (unique physics)
    const bolt1Sym = this.registry.resolve("sprite3_bolt1");
    if (bolt1Sym) {
      this.root.attach(bolt1Sym, "bolt1", 1, context);
    }

    // PlaceObject2_3_5 (depth 5) — second bolt (threshold 55)
    const bolt5Sym = this.registry.resolve("sprite3_bolt5");
    if (bolt5Sym) {
      this.root.attach(bolt5Sym, "bolt5", 5, context);
    }

    // PlaceObject2_3_7 (depth 7) — third bolt (threshold 65)
    const bolt7Sym = this.registry.resolve("sprite3_bolt7");
    if (bolt7Sym) {
      this.root.attach(bolt7Sym, "bolt7", 7, context);
    }

    // PlaceObject2_3_9 (depth 9) — fourth bolt (threshold 75)
    const bolt9Sym = this.registry.resolve("sprite3_bolt9");
    if (bolt9Sym) {
      this.root.attach(bolt9Sym, "bolt9", 9, context);
    }
  }
}
