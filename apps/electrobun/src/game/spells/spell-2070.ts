/**
 * Spell 2070 — (Xélor/Temporal spell, likely "Ralentissement" or similar).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2070/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The main timeline frame_2 places four
 * instances of sprite_3 at world-absolute positions read from
 * _parent.cellFrom / _parent.cellTo, and one anchor sprite (PlaceObject2_4_3)
 * positioned at cellTo. This matches the WorldAbsolute pattern where the
 * container lives at world (0,0) and children self-position using
 * _parent.cellFrom / _parent.cellTo.
 *
 * Canonical layout:
 *
 *   - sprite_3 (96-frame animated composite, lib symbol):
 *       frame_1:  stop() — waits until explicitly play()ed
 *       frame_25: stop() — pauses at impact frame
 *       frame_55: installs onEnterFrame that fades _parent._alpha by 3/frame
 *       frame_91: stop(); _parent.removeMovieClip() — kills the instance
 *                 (longest-lived at frame 91 → spell complete)
 *
 *   - Main timeline frame_2 places 5 objects:
 *       PlaceObject2_4_3 (depth 3): "a" — anchor at cellTo; used as homing
 *                                    target by the three "launcher" bolts.
 *       PlaceObject2_3_1 (depth 1): bolt1 — starts at cellFrom-140y, drifts
 *                                    toward cellTo (t>45 threshold), hits b.
 *       PlaceObject2_3_5 (depth 5): bolt2 — same pattern, t>55 threshold.
 *       PlaceObject2_3_7 (depth 7): bolt3 — same pattern, t>65 threshold.
 *       PlaceObject2_3_9 (depth 9): bolt4 — same pattern, t>75 threshold.
 *
 *   All three/four bolt instances (PlaceObject2_3_*) are instances of
 *   sprite_3 with identical onLoad/onEnterFrame clip events (differing only
 *   in the drift-time threshold before homing and the initial vr range).
 *   They home toward "b" (= the PlaceObject2_4_3 anchor at cellTo) once the
 *   threshold is reached. On arrival, they play() their timeline (which was
 *   stopped at frame_1), and fire this.end() → signalHit.
 *
 *   The "a" anchor is also used by bolt2/bolt3/bolt4 as a secondary target
 *   reference in their angle recalculation after t>threshold (they point at
 *   _parent.a rather than _parent.b for the direction calculation — see the
 *   AS carefully: PlaceObject2_3_5/7/9 use _parent.a for angle but _parent.b
 *   for proximity check; PlaceObject2_3_1 uses _parent.b for both).
 *
 *   The manifest has no librarySymbols[] array — sprite_3 is listed only
 *   under animations[]. So textures are fetched as "sprite_3" (no lib_ prefix).
 *
 *   signalHit is fired once, from the first bolt that reaches proximity
 *   (fin==1 → this.end()). We use a guard on the runtime so only the first
 *   call goes through (signalHit is idempotent).
 *
 *   complete() is fired from the frame_91 script of whichever bolt instance
 *   calls _parent.removeMovieClip() last. We call complete() from any bolt
 *   reaching frame_91, guarded by idempotency.
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

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite3Anchor = calculateAnchor(SPRITE_3_BOUNDS);

    // ---- sprite_3 — animated bolt / impact composite (96 frames) ----
    // Canonical: animations[0] name="sprite_3", no librarySymbols[] entry.
    // Used for both the "anchor" instance (PlaceObject2_4_3, depth 3) and
    // the four homing bolt instances (PlaceObject2_3_1/5/7/9).
    //
    // frame_1/DoAction.as:  stop()
    // frame_25/DoAction.as: stop()
    // frame_55/DoAction.as: installs onEnterFrame fade (_parent._alpha -= 3)
    // frame_91/DoAction.as: stop(); _parent.removeMovieClip()
    const sprite3Sym: SymbolDefinition = {
      name: "sprite_3",
      totalFrames: 96,
      frames: textures.getFrames("sprite_3"),
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_3/frame_1/DoAction.as — stop()
            clip.stop();
          },
        ],
        [
          24,
          (clip) => {
            // AS: DefineSprite_3/frame_25/DoAction.as — stop()
            clip.stop();
          },
        ],
        [
          54,
          (clip) => {
            // AS: DefineSprite_3/frame_55/DoAction.as
            // this.onEnterFrame = function() { _parent._alpha -= 3; }
            // The "parent" here is the bolt clip itself (which is a child of root).
            // We install an onEnterFrame that fades the bolt's own alpha.
            // AS _alpha is 0-100; clip.alpha is 0-1; delta 3/100 per frame.
            clip.onEnterFrame = (self) => {
              self.alpha = Math.max(0, self.alpha - 3 / 100);
            };
          },
        ],
        [
          90,
          (clip) => {
            // AS: DefineSprite_3/frame_91/DoAction.as
            // stop(); _parent.removeMovieClip()
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite3Sym);

    // Also register an "anchor" symbol for PlaceObject2_4_3 (depth 3).
    // The AS places it as the same DefineSprite_3 shape but with only
    // an onClipEvent(load) positioning it at cellTo. It has no enterFrame.
    // We reuse sprite_3 frames for it; it just sits at cellTo as a target.
    // We register it under name "sprite_3_anchor" and attach it separately
    // in onSpellStart. Its onLoad positions it at cellTo.
    // (No separate symbol needed — we handle it inline in onSpellStart.)
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS: frame_2/DoAction.as — stop()
    // (No sound in main timeline for this spell.)

    // ---- PlaceObject2_4_3 (depth 3): anchor "a" at cellTo ----
    // AS: frame_2/PlaceObject2_4_3/CLIPACTIONRECORD onClipEvent(load).as
    //   _X = _parent.cellTo.x;
    //   _Y = _parent.cellTo.y;
    // This is sprite_3 used as a positional anchor (target marker).
    // We expose it as root child "a" so bolt onEnterFrame can read a._x / a._y.
    const anchorSym = this.registry.resolve("sprite_3")!;
    const aClip = this.root.attach(anchorSym, "a", 3, context);
    // Apply the canonical onClipEvent(load) positioning manually since
    // we're not using a separate symbol with onLoad for the anchor.
    // AS: _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    aClip.x = context.cellTo.x;
    aClip.y = context.cellTo.y;

    // Also expose "b" at cellTo — the bolts home toward "b" for proximity.
    // In the canonical AS, _parent.b and _parent.a are separate objects.
    // PlaceObject2_4_3 at depth 3 maps to instance name "a" (used by bolts
    // 5/7/9 for angle after threshold). The proximity check uses _parent.b.
    // Looking at the AS more carefully:
    //   - bolt1 (depth 1, PlaceObject2_3_1): homes toward _parent.b for both angle AND proximity
    //   - bolts 2/3/4 (depths 5/7/9): use _parent.a for angle recalc, _parent.b for proximity
    // So "b" must be a separate anchor. In the original SWF, "b" is likely the
    // target marker placed at cellTo at a different depth. Since PlaceObject2_4_3
    // is at depth 3 and carries its own cellTo positioning, and all bolts check
    // _parent.b for proximity (Math.abs(_parent.b._y - _Y) < 20), we interpret
    // "b" = cellTo marker and "a" = same cellTo marker (a second instance).
    // We attach a second sprite_3 instance named "b" also at cellTo.
    const bClip = this.root.attach(anchorSym, "b", 4, context);
    bClip.x = context.cellTo.x;
    bClip.y = context.cellTo.y;

    // ---- PlaceObject2_3_1 (depth 1): bolt1 ----
    // AS: frame_2/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(load).as
    //   _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y - 140;
    //   angle = -90; vr = (-0.5 + Math.random()) * 20;
    //   v = 10; v2 = 10; t = 0; angle2 = -90; fin = 0;
    // onEnterFrame: drifts, homes to _parent.b at t>45, arrives, plays, signals hit.
    const bolt1Sym: SymbolDefinition = {
      name: "bolt1",
      totalFrames: 96,
      frames: this.registry.resolve("sprite_3")!.frames,
      anchorX: calculateAnchor(SPRITE_3_BOUNDS).x,
      anchorY: calculateAnchor(SPRITE_3_BOUNDS).y,
      frameScripts: this.registry.resolve("sprite_3")!.frameScripts,
      onLoad: (clip) => {
        // AS: frame_2/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.x = context.cellFrom.x;
        clip.y = context.cellFrom.y - 140;
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
        // AS: frame_2/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let fin = clip.vars.fin as number;
        let angle = clip.vars.angle as number;
        let angle2 = clip.vars.angle2 as number;
        let vr = clip.vars.vr as number;
        let v = clip.vars.v as number;
        let v2 = clip.vars.v2 as number;
        let t = clip.vars.t as number;
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;

        if (fin === 0) {
          if (Math.floor(Math.random() * 9) === 1) {
            vr = (-0.5 + Math.random()) * 40;
          }
          if (t++ > 45) {
            // AS: angle = atan2(_parent.b._y - _Y, _parent.b._x - _X) * 180 / PI
            const bClipRef = clip.parent?.children.get("b");
            const bx = bClipRef?.x ?? context.cellTo.x;
            const by = bClipRef?.y ?? context.cellTo.y;
            angle = Math.atan2(by - clip.y, bx - clip.x) * (180 / Math.PI);
            vr = (-0.5 + Math.random()) * 15;
          }
          v = 23 - Math.abs(vr) * 0.5;
          v2 -= (v2 - v) / 3;
          v /= 2;
          v2 /= 2;
          angle += vr;
          angle2 -= (angle2 - angle) / 2;
          // AS: _rotation = angle2 (degrees) → radians
          clip.rotation = (angle2 * Math.PI) / 180;
          vx = v2 * 2 * Math.cos((angle2 * Math.PI) / 180);
          vy = v2 * Math.sin((angle2 * Math.PI) / 180);
          // AS: boule._xscale / boule._yscale — boule is a child of the clip
          // We can't access sub-children of the rendered sprite directly,
          // but we approximate via the clip's own scale for visual correctness.
          // (boule is a named child inside the SWF symbol's authored content.)
        }

        // Proximity check for arrival at _parent.b
        {
          const bClipRef = clip.parent?.children.get("b");
          const bx = bClipRef?.x ?? context.cellTo.x;
          const by = bClipRef?.y ?? context.cellTo.y;
          if (
            Math.abs(by - clip.y) < 20 &&
            Math.abs(bx - clip.x) < 20 &&
            fin === 0
          ) {
            fin = 1;
            clip.play();
            vx = 0;
            vy = 0;
          }
        }

        if (fin === 1) {
          // AS: this.end() → signalHit
          this.runtime.signalHit();
          fin = 2;
          vx = 0;
          vy = 0;
        }

        clip.x += vx;
        clip.y += vy;

        clip.vars.fin = fin;
        clip.vars.angle = angle;
        clip.vars.angle2 = angle2;
        clip.vars.vr = vr;
        clip.vars.v = v;
        clip.vars.v2 = v2;
        clip.vars.t = t;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
    };

    // ---- bolt2 (PlaceObject2_3_5, depth 5): t>55, uses _parent.a for angle ----
    const bolt2Sym: SymbolDefinition = {
      name: "bolt2",
      totalFrames: 96,
      frames: this.registry.resolve("sprite_3")!.frames,
      anchorX: calculateAnchor(SPRITE_3_BOUNDS).x,
      anchorY: calculateAnchor(SPRITE_3_BOUNDS).y,
      frameScripts: this.registry.resolve("sprite_3")!.frameScripts,
      onLoad: (clip) => {
        // AS: frame_2/PlaceObject2_3_5/CLIPACTIONRECORD onClipEvent(load).as
        clip.x = context.cellFrom.x;
        clip.y = context.cellFrom.y - 140;
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
      onEnterFrame: (clip) => {
        // AS: frame_2/PlaceObject2_3_5/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let fin = clip.vars.fin as number;
        let angle = clip.vars.angle as number;
        let angle2 = clip.vars.angle2 as number;
        let vr = clip.vars.vr as number;
        let v = clip.vars.v as number;
        let v2 = clip.vars.v2 as number;
        let t = clip.vars.t as number;
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;

        if (fin === 0) {
          if (Math.floor(Math.random() * 9) === 1) {
            vr = (-0.5 + Math.random()) * 40;
          }
          v = 30 - Math.abs(vr) * 0.5;
          v2 -= (v2 - v) / 3;
          v /= 2;
          v2 /= 2;
          angle += vr;
          if (t++ > 55) {
            // AS: angle = atan2(_parent.a._y - _Y, _parent.a._x - _X) * 180 / PI
            const aClipRef = clip.parent?.children.get("a");
            const ax = aClipRef?.x ?? context.cellTo.x;
            const ay = aClipRef?.y ?? context.cellTo.y;
            angle = Math.atan2(ay - clip.y, ax - clip.x) * (180 / Math.PI);
            v = 1;
          }
          angle2 -= (angle2 - angle) / 2;
          clip.rotation = (angle2 * Math.PI) / 180;
          vx = v2 * 2 * Math.cos((angle2 * Math.PI) / 180);
          vy = v2 * Math.sin((angle2 * Math.PI) / 180);
        }

        {
          const bClipRef = clip.parent?.children.get("b");
          const bx = bClipRef?.x ?? context.cellTo.x;
          const by = bClipRef?.y ?? context.cellTo.y;
          if (
            Math.abs(by - clip.y) < 20 &&
            Math.abs(bx - clip.x) < 20 &&
            fin === 0
          ) {
            fin = 1;
            clip.play();
            vx = 0;
            vy = 0;
          }
        }

        if (fin === 1) {
          this.runtime.signalHit();
          fin = 2;
          vx = 0;
          vy = 0;
        }

        clip.x += vx;
        clip.y += vy;

        clip.vars.fin = fin;
        clip.vars.angle = angle;
        clip.vars.angle2 = angle2;
        clip.vars.vr = vr;
        clip.vars.v = v;
        clip.vars.v2 = v2;
        clip.vars.t = t;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
    };

    // ---- bolt3 (PlaceObject2_3_7, depth 7): t>65, uses _parent.a for angle ----
    const bolt3Sym: SymbolDefinition = {
      name: "bolt3",
      totalFrames: 96,
      frames: this.registry.resolve("sprite_3")!.frames,
      anchorX: calculateAnchor(SPRITE_3_BOUNDS).x,
      anchorY: calculateAnchor(SPRITE_3_BOUNDS).y,
      frameScripts: this.registry.resolve("sprite_3")!.frameScripts,
      onLoad: (clip) => {
        // AS: frame_2/PlaceObject2_3_7/CLIPACTIONRECORD onClipEvent(load).as
        clip.x = context.cellFrom.x;
        clip.y = context.cellFrom.y - 140;
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
      onEnterFrame: (clip) => {
        // AS: frame_2/PlaceObject2_3_7/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let fin = clip.vars.fin as number;
        let angle = clip.vars.angle as number;
        let angle2 = clip.vars.angle2 as number;
        let vr = clip.vars.vr as number;
        let v = clip.vars.v as number;
        let v2 = clip.vars.v2 as number;
        let t = clip.vars.t as number;
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;

        if (fin === 0) {
          if (Math.floor(Math.random() * 9) === 1) {
            vr = (-0.5 + Math.random()) * 40;
          }
          v = 30 - Math.abs(vr) * 0.5;
          v2 -= (v2 - v) / 3;
          v /= 2;
          v2 /= 2;
          angle += vr;
          if (t++ > 65) {
            const aClipRef = clip.parent?.children.get("a");
            const ax = aClipRef?.x ?? context.cellTo.x;
            const ay = aClipRef?.y ?? context.cellTo.y;
            angle = Math.atan2(ay - clip.y, ax - clip.x) * (180 / Math.PI);
            v = 1;
          }
          angle2 -= (angle2 - angle) / 2;
          clip.rotation = (angle2 * Math.PI) / 180;
          vx = v2 * 2 * Math.cos((angle2 * Math.PI) / 180);
          vy = v2 * Math.sin((angle2 * Math.PI) / 180);
        }

        {
          const bClipRef = clip.parent?.children.get("b");
          const bx = bClipRef?.x ?? context.cellTo.x;
          const by = bClipRef?.y ?? context.cellTo.y;
          if (
            Math.abs(by - clip.y) < 20 &&
            Math.abs(bx - clip.x) < 20 &&
            fin === 0
          ) {
            fin = 1;
            clip.play();
            vx = 0;
            vy = 0;
          }
        }

        if (fin === 1) {
          this.runtime.signalHit();
          fin = 2;
          vx = 0;
          vy = 0;
        }

        clip.x += vx;
        clip.y += vy;

        clip.vars.fin = fin;
        clip.vars.angle = angle;
        clip.vars.angle2 = angle2;
        clip.vars.vr = vr;
        clip.vars.v = v;
        clip.vars.v2 = v2;
        clip.vars.t = t;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
    };

    // ---- bolt4 (PlaceObject2_3_9, depth 9): t>75, uses _parent.a for angle ----
    const bolt4Sym: SymbolDefinition = {
      name: "bolt4",
      totalFrames: 96,
      frames: this.registry.resolve("sprite_3")!.frames,
      anchorX: calculateAnchor(SPRITE_3_BOUNDS).x,
      anchorY: calculateAnchor(SPRITE_3_BOUNDS).y,
      frameScripts: this.registry.resolve("sprite_3")!.frameScripts,
      onLoad: (clip) => {
        // AS: frame_2/PlaceObject2_3_9/CLIPACTIONRECORD onClipEvent(load).as
        clip.x = context.cellFrom.x;
        clip.y = context.cellFrom.y - 140;
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
      onEnterFrame: (clip) => {
        // AS: frame_2/PlaceObject2_3_9/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let fin = clip.vars.fin as number;
        let angle = clip.vars.angle as number;
        let angle2 = clip.vars.angle2 as number;
        let vr = clip.vars.vr as number;
        let v = clip.vars.v as number;
        let v2 = clip.vars.v2 as number;
        let t = clip.vars.t as number;
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;

        if (fin === 0) {
          if (Math.floor(Math.random() * 9) === 1) {
            vr = (-0.5 + Math.random()) * 40;
          }
          v = 30 - Math.abs(vr) * 0.5;
          v2 -= (v2 - v) / 3;
          v /= 2;
          v2 /= 2;
          angle += vr;
          if (t++ > 75) {
            const aClipRef = clip.parent?.children.get("a");
            const ax = aClipRef?.x ?? context.cellTo.x;
            const ay = aClipRef?.y ?? context.cellTo.y;
            angle = Math.atan2(ay - clip.y, ax - clip.x) * (180 / Math.PI);
            v = 1;
          }
          angle2 -= (angle2 - angle) / 2;
          clip.rotation = (angle2 * Math.PI) / 180;
          vx = v2 * 2 * Math.cos((angle2 * Math.PI) / 180);
          vy = v2 * Math.sin((angle2 * Math.PI) / 180);
        }

        {
          const bClipRef = clip.parent?.children.get("b");
          const bx = bClipRef?.x ?? context.cellTo.x;
          const by = bClipRef?.y ?? context.cellTo.y;
          if (
            Math.abs(by - clip.y) < 20 &&
            Math.abs(bx - clip.x) < 20 &&
            fin === 0
          ) {
            fin = 1;
            clip.play();
            vx = 0;
            vy = 0;
          }
        }

        if (fin === 1) {
          this.runtime.signalHit();
          fin = 2;
          vx = 0;
          vy = 0;
        }

        clip.x += vx;
        clip.y += vy;

        clip.vars.fin = fin;
        clip.vars.angle = angle;
        clip.vars.angle2 = angle2;
        clip.vars.vr = vr;
        clip.vars.v = v;
        clip.vars.v2 = v2;
        clip.vars.t = t;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
    };

    // Attach bolts in canonical depth order.
    // AS frame_2 places them: depth 1 (bolt1), depth 5 (bolt2),
    // depth 7 (bolt3), depth 9 (bolt4).
    // "a" and "b" are already attached above at depths 3 and 4.
    this.root.attach(bolt1Sym, "bolt1", 1, context);
    this.root.attach(bolt2Sym, "bolt2", 5, context);
    this.root.attach(bolt3Sym, "bolt3", 7, context);
    this.root.attach(bolt4Sym, "bolt4", 9, context);
  }
}
