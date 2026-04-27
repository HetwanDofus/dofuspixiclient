/**
 * Spell 316 — Pépite (Enutrof gold nugget shower).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/316/scripts/scripts/
 *
 * displayType=11 (TargetCell). The outer SWF places a single "DefineSprite_8"
 * container at the target cell. That container's frame_1 script spawns up to
 * 119 `pepite` particles (attachMovie loop: c runs 1..119) via an onEnterFrame
 * loop. Each `pepite` is a 45-frame gold-nugget sprite with its own physics:
 *   - frame_1: seeds rotation, starting Y=-90, gravity, scatter X/amp, scale,
 *     horizontal drift velocity, and a "bounce floor" height `h` that increments
 *     per particle from _parent.h.
 *   - onEnterFrame: integrates gravity, bounces off floor (damping vx/v on hit),
 *     stops when energy exhausted.
 *   - frame_45: stop().
 *   - An inner PlaceObject clip (frame_1 onClipEvent(load)): gotoAndStop(random(2)+1)
 *     — picks one of two visual variants for the nugget.
 *
 * DefineSprite_8 also has:
 *   - frame_127: a PlaceObject clip whose onEnterFrame fades _parent._alpha by 5
 *     per frame (fade-out of the whole container starting at frame 127).
 *   - frame_160: _parent.removeMovieClip() → spell complete. stop().
 *
 * Library symbols:
 *   - lib_pepite — 45-frame gold nugget. onLoad: gotoAndStop(random(2)+1).
 *     frame_1: seeds physics + onEnterFrame. frame_45: stop().
 *
 * Main timeline (DefineSprite_8 is the outer container): The harness attaches
 * the container at the target cell. We model DefineSprite_8 as the root-level
 * clip via `onSpellStart`, attaching a single "sprite8" container whose
 * frameScripts replicate the outer timeline behaviour.
 *
 * No SOMA.playSound in the canonical scripts — no sound call needed.
 *
 * signalHit: fired at frame_127 of DefineSprite_8 (when the fade begins,
 * matching the impact moment).
 * complete: fired at frame_160 of DefineSprite_8 (_parent.removeMovieClip()).
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
  private sprite8Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const pepiteAnchor = calculateAnchor(PEPITE_BOUNDS);

    // ---- lib_pepite — 45-frame gold nugget particle ---------------
    // Textures: librarySymbols entry "pepite" → textures.getFrames("lib_pepite")
    this.pepiteSym = {
      name: "pepite",
      totalFrames: 45,
      frames: textures.getFrames("lib_pepite"),
      anchorX: pepiteAnchor.x,
      anchorY: pepiteAnchor.y,

      // AS: DefineSprite_5_pepite/frame_1/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(load).as
      // gotoAndStop(random(2) + 1) — picks visual variant 1 or 2 (0-based: 0 or 1)
      onLoad: (clip) => {
        clip.gotoAndStop(Math.floor(Math.random() * 2));
      },

      onEnterFrame: (clip) => {
        // AS: DefineSprite_5_pepite/frame_1/DoAction.as — onEnterFrame function
        // _X = _X + vx; _Y = _Y + (v += g);
        // if (_Y > -h) { bounce + stop/dampen }
        const vx = clip.vars.vx as number;
        let v = clip.vars.v as number;
        const g = clip.vars.g as number;
        let h = clip.vars.h as number;
        let dh = clip.vars.dh as number;

        clip.x += vx;
        v += g;
        clip.y += v;

        if (clip.y > -h) {
          clip.y = -h;
          h -= Math.floor(Math.random() * Math.round(dh));
          dh *= 0.5 + 0.5 * Math.random();
          clip.vars.vx = vx * 0.23;
          clip.vars.v = (-v) / (3 + Math.floor(Math.random() * 7));
          clip.vars.h = h;
          clip.vars.dh = dh;
          clip.stop();
          // onEnterFrame is still registered but clip is stopped —
          // it won't advance frames but enterFrame still fires.
          // To match AS: when stopped, onEnterFrame keeps running
          // but the clip doesn't move frames. We nullify it to avoid
          // re-entering the bounce logic repeatedly while stopped.
          clip.onEnterFrame = null;
        } else {
          clip.vars.v = v;
          clip.vars.h = h;
          clip.vars.dh = dh;
        }
      },

      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_5_pepite/frame_1/DoAction.as
            // _rotation = random(360);
            // _Y = -90; g = 0.6; v = 0;
            // h = _parent.h; _parent.h += 0.5;
            // amp = 60 - h; dh = random(5);
            // _X = amp * (-0.5 + Math.random());
            // t = 30 + 70 * Math.random(); _xscale = t; _yscale = t;
            // vx = -0.5 + Math.random();
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            clip.y = -90;

            const parentH = (clip.parent?.vars.h as number) ?? -10;
            // increment parent's h
            if (clip.parent) {
              clip.parent.vars.h = parentH + 0.5;
            }

            const h = parentH;
            const amp = 60 - h;
            const dh = Math.floor(Math.random() * 5);
            clip.x = amp * (-0.5 + Math.random());

            const t = 30 + 70 * Math.random();
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;

            clip.vars.g = 0.6;
            clip.vars.v = 0;
            clip.vars.h = h;
            clip.vars.dh = dh;
            clip.vars.vx = -0.5 + Math.random();
          },
        ],
        [
          44,
          (clip) => {
            // AS: DefineSprite_5_pepite/frame_45/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite8 — outer container (160-frame timeline) ----------
    // Models DefineSprite_8 which the outer SWF places at the target cell.
    // frame_1: seeds c=1, h=-10, starts spawning pepite particles via onEnterFrame
    // frame_127: a placed clip fades _parent._alpha by 5 per frame — we implement
    //            this as a root.onEnterFrame that starts at frame 127.
    // frame_160: _parent.removeMovieClip(); stop() → complete the spell.
    this.sprite8Sym = {
      name: "sprite8",
      totalFrames: 160,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_8/frame_1/DoAction.as
            // c = 1; h = -10;
            // this.onEnterFrame = function() { if(c < 120) { attachMovie("pepite","pepite"+c,c); c++; } };
            clip.vars.c = 1;
            clip.vars.h = -10;
            clip.onEnterFrame = (self, ctx) => {
              const c = self.vars.c as number;
              if (c < 120) {
                self.attach(this.pepiteSym, `pepite${c}`, c, ctx);
                self.vars.c = c + 1;
              }
            };
          },
        ],
        [
          126,
          (clip) => {
            // AS: DefineSprite_8/frame_127/PlaceObject2_7_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
            // _parent._alpha -= 5;
            // The placed clip at frame_127 fires this every frame from 127 onward.
            // We replace the onEnterFrame (particle spawning is done by now since
            // c reaches 120 well before frame 127) with the fade logic.
            this.runtime.signalHit();
            clip.onEnterFrame = (self) => {
              self.alpha = Math.max(0, self.alpha - 5 / 100);
            };
          },
        ],
        [
          159,
          (clip) => {
            // AS: DefineSprite_8/frame_160/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.pepiteSym);
    this.registry.register(this.sprite8Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // No SOMA.playSound in canonical scripts.
    // Attach the outer sprite8 container at root — it becomes the
    // primary timeline driving particle spawning and fade-out.
    this.root.attach(this.sprite8Sym, "sprite8", 1, context);
  }
}
