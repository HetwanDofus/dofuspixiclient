/**
 * Spell 316 — Pépite (Enutrof gold nugget shower).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/316/scripts/scripts/
 *
 * displayType=11 (TargetCell). The outer sprite (DefineSprite_8) has no
 * `move` / `shoot` / `duplicate` symbols, no caster reference, and no
 * projectile motion — it is a pure impact effect at the target cell.
 * The spell container is anchored at cellTo.
 *
 * Canonical AS layout:
 *
 *   - DefineSprite_8 (outer container, 160 frames):
 *       frame_1:  initialises c=1, h=-10, then each enterFrame tick
 *                 spawns one `pepite` particle until c reaches 120.
 *       frame_127: places a child clip (PlaceObject2_7_2) that carries
 *                  an onClipEvent(enterFrame): `_parent._alpha -= 5`.
 *                  This is a distinct SymbolDefinition ("fader") with
 *                  onEnterFrame draining its parent's alpha by 5/100
 *                  per tick.
 *       frame_160: `_parent.removeMovieClip(); stop();` → spell complete.
 *
 *   - lib_pepite (DefineSprite_5_pepite, 45 frames):
 *       frame_1/DoAction.as: seeds rotation, gravity, initial position,
 *                  amplitude, scale, vx; installs per-clip onEnterFrame
 *                  gravity loop that makes the nugget fall and bounce.
 *       frame_1/PlaceObject2_3_1/onClipEvent(load): inner child that
 *                  picks a random start frame via gotoAndStop(random(2)+1).
 *                  Ported as onLoad on the pepite SymbolDefinition since
 *                  the inner child is baked into the lib_pepite SVG atlas.
 *       frame_45/DoAction.as: stop().
 *
 * Library symbols:
 *   - lib_pepite — 45-frame gold nugget particle. onLoad randomises
 *     start frame (porting inner PlaceObject2_3_1 onClipEvent(load)).
 *     frame_1 (index 0) seeds all physics vars and installs a per-clip
 *     onEnterFrame gravity+bounce loop. frame_44 (index 44) stops.
 *   - fader — zero-frame container placed by DefineSprite_8 at frame 127.
 *     onEnterFrame: `_parent._alpha -= 5` (porting PlaceObject2_7_2
 *     onClipEvent(enterFrame)).
 *
 * Main timeline: DefineSprite_8 ("outer") is the sole child — attached
 * in onSpellStart. No SOMA.playSound found in the extracted scripts.
 *
 * signalHit is fired on the first pepite attachment (first tick of the
 * spawn loop). complete() is fired at frame 160 of the outer container.
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

const PEPITE_BOUNDS = {
  width: 13.3,
  height: 17.8,
  offsetX: -6.55,
  offsetY: -12.25,
};

export class Spell316 extends RuntimeSpell {
  readonly spellId = 316;
  readonly displayType = SpellDisplayType.TargetCell;

  private pepiteSym!: SymbolDefinition;
  private faderSym!: SymbolDefinition;
  private outerSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const pepiteAnchor = calculateAnchor(PEPITE_BOUNDS);

    // ---- fader — invisible child placed at frame 127 of outer mc ----
    //
    // AS: DefineSprite_8/frame_127/PlaceObject2_7_2/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //     → _parent._alpha -= 5;
    //
    // This clip has no visual content of its own. Its sole purpose is
    // to run the enterFrame handler that fades the outer container.
    // Placed at depth 2 on frame 127 of DefineSprite_8.
    this.faderSym = {
      name: "fader",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS DefineSprite_8/frame_127/PlaceObject2_7_2/
        //    CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _parent._alpha -= 5   (AS 0-100 → TS 0-1, so -= 5/100)
        const parent = clip.parent;
        if (parent) {
          parent.alpha = Math.max(0, parent.alpha - 5 / 100);
        }
      },
    };

    // ---- lib_pepite — gold nugget particle (45 frames) -----------
    //
    // onLoad ports:
    //   AS DefineSprite_5_pepite/frame_1/PlaceObject2_3_1/
    //      CLIPACTIONRECORD onClipEvent(load).as
    //      → gotoAndStop(random(2) + 1)
    //   The inner PlaceObject2_3_1 child is baked into the lib_pepite
    //   SVG atlas, so we honour the random frame pick by randomising
    //   the particle clip's own starting frame (frame 0 or 1, 0-based).
    //
    // frameScripts[0] ports:
    //   AS DefineSprite_5_pepite/frame_1/DoAction.as — physics init
    //   plus installing the per-clip onEnterFrame gravity+bounce loop.
    //
    // frameScripts[44] ports:
    //   AS DefineSprite_5_pepite/frame_45/DoAction.as — stop()
    this.pepiteSym = {
      name: "pepite",
      totalFrames: 45,
      frames: textures.getFrames("lib_pepite"),
      anchorX: pepiteAnchor.x,
      anchorY: pepiteAnchor.y,

      onLoad: (clip) => {
        // AS DefineSprite_5_pepite/frame_1/PlaceObject2_3_1/
        //    CLIPACTIONRECORD onClipEvent(load).as
        // gotoAndStop(random(2) + 1) → 1-based AS → 0-based TS: 0 or 1
        const startFrame = Math.floor(Math.random() * 2);
        clip.gotoAndStop(startFrame);
      },

      frameScripts: new Map([
        [
          0,
          (clip, _ctx) => {
            // AS DefineSprite_5_pepite/frame_1/DoAction.as

            // _rotation = random(360)
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;

            // _Y = -90
            clip.y = -90;

            // g = 0.6; v = 0
            clip.vars.g = 0.6;
            clip.vars.v = 0;

            // h = _parent.h; _parent.h += 0.5
            const parent = clip.parent;
            const parentH = (parent?.vars.h as number) ?? -10;
            clip.vars.h = parentH;
            if (parent) {
              parent.vars.h = parentH + 0.5;
            }

            // amp = 60 - h
            const amp = 60 - parentH;

            // dh = random(5)
            clip.vars.dh = Math.floor(Math.random() * 5);

            // _X = amp * (-0.5 + Math.random())
            clip.x = amp * (-0.5 + Math.random());

            // t = 30 + 70 * Math.random(); _xscale = t; _yscale = t
            const t = 30 + 70 * Math.random();
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;

            // vx = -0.5 + Math.random()
            clip.vars.vx = -0.5 + Math.random();

            // this.onEnterFrame = function() { … }
            clip.onEnterFrame = (c) => {
              // AS DefineSprite_5_pepite/frame_1/DoAction.as (onEnterFrame body)
              const vx = c.vars.vx as number;
              let v = c.vars.v as number;
              const g = c.vars.g as number;
              let h = c.vars.h as number;
              let dh = c.vars.dh as number;

              // _X = _X + vx
              c.x += vx;

              // _Y = _Y + (v += g)
              v += g;
              c.y += v;
              c.vars.v = v;

              // if (_Y > -h) { bounce }
              if (c.y > -h) {
                // _Y = -h
                c.y = -h;

                // h -= random(Math.round(dh))
                h -= Math.floor(Math.random() * Math.round(dh));
                c.vars.h = h;

                // dh *= 0.5 + 0.5 * Math.random()
                dh *= 0.5 + 0.5 * Math.random();
                c.vars.dh = dh;

                // vx *= 0.23
                c.vars.vx = vx * 0.23;

                // stop()
                c.stop();

                // v = (-v) / (3 + random(7))
                c.vars.v = (-v) / (3 + Math.floor(Math.random() * 7));
              }
            };
          },
        ],
        [
          44,
          (clip) => {
            // AS DefineSprite_5_pepite/frame_45/DoAction.as
            // stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- outer — DefineSprite_8 container (160 frames) -----------
    //
    // frame_1/DoAction.as:
    //   c = 1; h = -10;
    //   this.onEnterFrame = function() {
    //     if (c < 120) { attachMovie("pepite","pepite"+c,c); c++; }
    //   };
    //
    // frame_127: attach fader clip (PlaceObject2_7_2 at depth 2)
    //   whose onEnterFrame drains _parent._alpha by 5 each tick.
    //
    // frame_160/DoAction.as:
    //   _parent.removeMovieClip(); stop(); → spell complete.
    this.outerSym = {
      name: "outer",
      totalFrames: 160,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_8/frame_1/DoAction.as
            // c = 1; h = -10;
            clip.vars.c = 1;
            clip.vars.h = -10;

            // this.onEnterFrame = function() { … }
            // Spawns one pepite per tick while c < 120.
            let hitSignalled = false;
            clip.onEnterFrame = (c, innerCtx) => {
              const count = c.vars.c as number;
              if (count < 120) {
                c.attach(
                  this.pepiteSym,
                  `pepite${count}`,
                  count,
                  innerCtx,
                );
                c.vars.c = count + 1;

                // Signal hit on the very first particle placement
                if (!hitSignalled) {
                  hitSignalled = true;
                  this.runtime.signalHit();
                }
              }
            };

            void ctx;
          },
        ],
        [
          126,
          (clip, ctx) => {
            // AS DefineSprite_8/frame_127: PlaceObject2_7_2 places a clip
            // at depth 2 whose onClipEvent(enterFrame) does _parent._alpha -= 5.
            // We attach the fader symbol here so its onEnterFrame runs
            // each tick from this point onward.
            clip.attach(this.faderSym, "fader", 2, ctx);
          },
        ],
        [
          159,
          (clip) => {
            // AS DefineSprite_8/frame_160/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.faderSym);
    this.registry.register(this.pepiteSym);
    this.registry.register(this.outerSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // No SOMA.playSound found in the extracted scripts.
    // Attach the outer container so it starts ticking from the next frame.
    this.root.attach(this.outerSym, "outer", 1, context);
  }
}
