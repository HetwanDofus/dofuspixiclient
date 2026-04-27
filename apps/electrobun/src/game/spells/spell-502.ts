/**
 * Spell 502 — Many (earth/rock impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/502/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no move/shoot/duplicate pattern,
 * no caster-anchor reference, no WorldAbsolute dual-timeline. The spell
 * plays a single composite animation at the target cell. The outer
 * DefineSprite_12 timeline (74 frames, matching anim1) fires signalHit
 * at frame 49 and removes itself at frame 73.
 *
 * Library symbols:
 *   - lib_pierres — single-frame rock/pebble particle. onLoad seeds vx/vy
 *     velocity, random scale [60,100]%, random alpha [20,109]%, upward
 *     initial velocity v ∈ [-20,-5], rotation spin vr ∈ [-20,20] deg/frame.
 *     onEnterFrame: integrates position (X drift + gravity on Y),
 *     bounces when Y>0, eventually comes to rest (t=1 sentinel).
 *
 * Inner structure (from scripts):
 *   - DefineSprite_9: onClipEvent(load) spawns 20 `pierres` particles.
 *   - DefineSprite_8: frame_18 → stop(). (Inner anim timeline.)
 *   - DefineSprite_12: outer wrapper:
 *       frame_49 → this.end() → signalHit
 *       frame_73 → _parent.removeMovieClip() + stop() → complete
 *
 * The `anim1` animation (74 frames) is the composite visual for DefineSprite_12.
 * DefineSprite_9 (the particle emitter) is an authored child inside DefineSprite_12.
 * We model the whole thing as a single `anim1` symbol attached at the root whose
 * frameScripts fire at frame 49 (hit) and frame 73 (complete), and whose
 * onLoad spawns the 20 pierres particles.
 *
 * Main timeline: SOMA.playSound("many_502")
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

const ANIM1_BOUNDS = {
  width: 173.9,
  height: 161.55,
  offsetX: -86.95,
  offsetY: -117.45,
};

export class Spell502 extends RuntimeSpell {
  readonly spellId = 502;
  readonly displayType = SpellDisplayType.TargetCell;

  private pierresSym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- lib_pierres — rock/pebble particle ----------------------
    // Canonical AS:
    //   DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    //   DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // In the canonical AS, the clip event handlers are placed on the
    // *content* inside the pierres symbol (PlaceObject2_2_1), but they
    // reference _parent._x / _parent._y to position the containing pierres
    // clip, and _Y / _rotation / _xscale / _yscale / _alpha for the inner
    // content. We collapse both layers into one SpellClip: the onLoad /
    // onEnterFrame manipulate the clip's own transform (the pierres clip
    // as a whole), storing the inner Y offset in vars.innerY to mirror
    // the _Y ↔ _parent._Y separation in the original.
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,

      onLoad: (clip) => {
        // AS DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/onClipEvent(load)
        // vx / vy drive _parent._x / _parent._y drift (the pierres clip pos)
        clip.vars.vx = 5 * (Math.random() - 0.5);
        clip.vars.vy = 2 * (Math.random() - 0.5);
        // AS: _parent._x = 20*(random-0.5); _parent._y = 10*(random-0.5)
        clip.x = 20 * (Math.random() - 0.5);
        clip.y = 10 * (Math.random() - 0.5);
        // AS: t = 60 + 40*random(); _xscale = _yscale = t
        const t = 60 + 40 * Math.random();
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        // AS: _alpha = 20 + random(90)
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        // AS: v = -15*random() - 5  (upward velocity in _Y space)
        clip.vars.v = -15 * Math.random() - 5;
        // innerY tracks the AS inner-content _Y (starts at 0)
        clip.vars.innerY = 0;
        // AS: vr = 40 * (-0.5 + random())  (degrees/frame)
        clip.vars.vr = 40 * (-0.5 + Math.random());
      },

      onEnterFrame: (clip) => {
        // AS DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/onClipEvent(enterFrame)
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        let v = clip.vars.v as number;
        let vr = clip.vars.vr as number;
        let innerY = clip.vars.innerY as number;
        const t = clip.vars.t as number;

        // AS: _parent._x += vx; _parent._y += vy;
        clip.x += vx;
        clip.y += vy;

        if (t !== 1) {
          // AS: _Y = _Y + v; _rotation = _rotation + vr; v += 1.5;
          innerY = innerY + v;
          clip.rotation += (vr * Math.PI) / 180;
          v += 1.5;

          if (innerY > 0) {
            // AS: bounce / settle on ground
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
        }

        clip.vars.vx = vx;
        clip.vars.vy = vy;
        clip.vars.v = v;
        clip.vars.vr = vr;
        clip.vars.innerY = innerY;
      },
    };

    // ---- anim1 — outer composite timeline (DefineSprite_12) ------
    // Canonical AS:
    //   DefineSprite_12/frame_49/DoAction.as  → this.end() (signalHit)
    //   DefineSprite_12/frame_73/DoAction.as  → _parent.removeMovieClip(); stop()
    //
    // The authored timeline also contains DefineSprite_9 (particle emitter)
    // which on load spawns 20 pierres particles. We model that emitter's
    // onLoad directly on the anim1 clip's own onLoad.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 74,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      onLoad: (clip, ctx) => {
        // AS DefineSprite_9/frame_1/PlaceObject2_6_1/onClipEvent(load)
        // Spawn 20 pierres particles inside the anim1 clip.
        let c = 0;
        while (c < 20) {
          clip.attach(this.pierresSym, `pierres${c}`, c, ctx);
          c++;
        }
      },

      frameScripts: new Map([
        [
          48,
          () => {
            // AS DefineSprite_12/frame_49/DoAction.as: this.end()
            this.runtime.signalHit();
          },
        ],
        [
          72,
          (clip) => {
            // AS DefineSprite_12/frame_73/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.pierresSym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("many_502");
    callbacks.playSound("many_502");

    // Attach the outer composite timeline at the root.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
